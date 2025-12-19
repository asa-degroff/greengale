/**
 * Image Upload Module
 *
 * Handles image validation, resizing, AVIF encoding, and PDS blob upload
 * for the GreenGale blog editor.
 */

import type {
  EncodeRequest,
  WorkerMessage,
} from './avif-encoder.worker'
import AvifEncoderWorker from './avif-encoder.worker?worker'

// AT Protocol blob limit is 1,000,000 bytes
const MAX_BLOB_SIZE = 1000 * 1000
const MAX_PIXELS = 35_000_000 // Maximum total pixels (~50 megapixels)
const MAX_DIMENSION = 10240 // Maximum single dimension (failsafe for very thin images)
const MIN_DIMENSION = 256 // Minimum dimension before giving up on encoding
const RESIZE_FACTOR = 0.75 // Scale factor when retrying after encoding failure
// cqLevel: 0-63, lower is better quality (like CRF)
const CQ_LEVEL_START = 20 // Starting quality (good balance)
const CQ_LEVEL_MAX = 35 // Maximum cqLevel (lower quality) to try before failing

/** Error thrown when AVIF encoding fails and may benefit from resizing */
class ResizableEncodingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResizableEncodingError'
  }
}

// Supported input image types
const SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
])

/** Content label values for adult/sensitive content */
export type ContentLabelValue = 'nudity' | 'sexual' | 'porn' | 'graphic-media'

/** Self-labels structure following AT Protocol pattern */
export interface SelfLabels {
  values: Array<{ val: ContentLabelValue }>
}

export interface UploadedBlob {
  /** CID of the uploaded blob */
  cid: string
  /** MIME type of the blob */
  mimeType: string
  /** Size in bytes */
  size: number
  /** Original filename */
  name: string
  /** Alt text for accessibility */
  alt?: string
  /** Content labels (self-labels) for this image */
  labels?: SelfLabels
  /** Full blob reference object for AT Protocol record */
  blobRef: {
    $type: 'blob'
    ref: { $link: string }
    mimeType: string
    size: number
  }
}

export interface UploadProgress {
  stage: 'validating' | 'resizing' | 'encoding' | 'uploading'
  progress: number // 0-100
  filename: string
}

export type ProgressCallback = (progress: UploadProgress) => void

/**
 * Validate that a file is a supported image type
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file.type || !SUPPORTED_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `Unsupported image type: ${file.type || 'unknown'}. Supported: JPEG, PNG, GIF, WebP, AVIF, BMP, HEIC`,
    }
  }

  // Check file size (skip processing if already small enough)
  // 50MB max input size to prevent browser memory issues
  if (file.size > 50 * 1024 * 1024) {
    return {
      valid: false,
      error: 'Image file too large. Maximum input size is 50MB.',
    }
  }

  return { valid: true }
}

/**
 * Load an image file into an HTMLImageElement
 */
async function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Calculate new dimensions that fit within MAX_PIXELS and MAX_DIMENSION while preserving aspect ratio
 */
function calculateResizedDimensions(
  width: number,
  height: number
): { width: number; height: number; needsResize: boolean } {
  const currentPixels = width * height

  // Check if already within both limits
  if (currentPixels <= MAX_PIXELS && width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return { width, height, needsResize: false }
  }

  let newWidth = width
  let newHeight = height

  // First, apply dimension cap if needed
  if (newWidth > MAX_DIMENSION || newHeight > MAX_DIMENSION) {
    const dimensionScale = Math.min(MAX_DIMENSION / newWidth, MAX_DIMENSION / newHeight)
    newWidth = Math.round(newWidth * dimensionScale)
    newHeight = Math.round(newHeight * dimensionScale)
  }

  // Then, apply pixel cap if still needed
  const newPixels = newWidth * newHeight
  if (newPixels > MAX_PIXELS) {
    const pixelScale = Math.sqrt(MAX_PIXELS / newPixels)
    newWidth = Math.round(newWidth * pixelScale)
    newHeight = Math.round(newHeight * pixelScale)
  }

  return { width: newWidth, height: newHeight, needsResize: true }
}

/**
 * Get ImageData from an image, optionally resizing
 */
function getImageData(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')!

  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Draw the image scaled to the target size
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  return ctx.getImageData(0, 0, targetWidth, targetHeight)
}

/**
 * Encode ImageData to AVIF with quality adjustment to meet size limit.
 * Runs encoding in a Web Worker to avoid blocking the main thread.
 * Throws ResizableEncodingError if encoding fails and resizing might help.
 */
async function encodeToAvif(
  imageData: ImageData,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new AvifEncoderWorker()

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data

      switch (message.type) {
        case 'progress':
          onProgress?.(message.progress)
          break
        case 'success':
          worker.terminate()
          resolve(message.encoded)
          break
        case 'error':
          worker.terminate()
          if (message.shouldRetryWithResize) {
            reject(new ResizableEncodingError(message.error))
          } else {
            reject(new Error(message.error))
          }
          break
      }
    }

    worker.onerror = (event) => {
      worker.terminate()
      reject(new ResizableEncodingError(`Worker error: ${event.message}`))
    }

    const request: EncodeRequest = {
      type: 'encode',
      imageData,
      cqLevelStart: CQ_LEVEL_START,
      cqLevelMax: CQ_LEVEL_MAX,
      maxBlobSize: MAX_BLOB_SIZE,
    }

    worker.postMessage(request)
  })
}

/**
 * Upload a blob to the user's PDS
 */
async function uploadBlobToPds(
  data: ArrayBuffer,
  mimeType: string,
  fetchHandler: (url: string, init: RequestInit) => Promise<Response>
): Promise<{ cid: string; mimeType: string; size: number }> {
  const response = await fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
    },
    body: data,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { message?: string }).message || `Upload failed: ${response.status}`)
  }

  const result = (await response.json()) as {
    blob: { ref: { $link: string }; mimeType: string; size: number }
  }
  return {
    cid: result.blob.ref.$link,
    mimeType: result.blob.mimeType,
    size: result.blob.size,
  }
}

/**
 * Generate the blob URL for viewing an uploaded image
 */
export function getBlobUrl(pdsEndpoint: string, did: string, cid: string): string {
  return `${pdsEndpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
}

/**
 * Process and upload an image file
 *
 * @param file - The image file to upload
 * @param fetchHandler - Authenticated fetch handler from AT Protocol session
 * @param pdsEndpoint - User's PDS endpoint URL
 * @param did - User's DID
 * @param onProgress - Optional progress callback
 * @returns Uploaded blob information and markdown URL
 */
export async function processAndUploadImage(
  file: File,
  fetchHandler: (url: string, init: RequestInit) => Promise<Response>,
  pdsEndpoint: string,
  did: string,
  onProgress?: ProgressCallback
): Promise<{ uploadedBlob: UploadedBlob; markdownUrl: string }> {
  const filename = file.name || 'image'

  // Stage 1: Validate
  onProgress?.({ stage: 'validating', progress: 0, filename })
  const validation = validateImageFile(file)
  if (!validation.valid) {
    throw new Error(validation.error)
  }
  onProgress?.({ stage: 'validating', progress: 100, filename })

  // Stage 2: Load image
  onProgress?.({ stage: 'resizing', progress: 0, filename })
  const img = await loadImage(file)
  let { width, height } = calculateResizedDimensions(img.width, img.height)

  // Stage 3: Encode to AVIF with progressive resizing fallback
  let encoded: ArrayBuffer | null = null
  let lastError: Error | null = null

  while (width >= MIN_DIMENSION && height >= MIN_DIMENSION) {
    onProgress?.({ stage: 'resizing', progress: 50, filename })
    const imageData = getImageData(img, width, height)
    onProgress?.({ stage: 'resizing', progress: 100, filename })

    onProgress?.({ stage: 'encoding', progress: 0, filename })
    try {
      encoded = await encodeToAvif(imageData, (p) => {
        onProgress?.({ stage: 'encoding', progress: p, filename })
      })
      break // Success!
    } catch (err) {
      if (err instanceof ResizableEncodingError) {
        // Encoding failed or size limit exceeded, try with smaller dimensions
        lastError = err
        width = Math.round(width * RESIZE_FACTOR)
        height = Math.round(height * RESIZE_FACTOR)
        console.warn(
          `Encoding issue at current size, retrying with smaller dimensions: ${width}x${height}`
        )
        continue
      }
      // Non-resizable error, rethrow
      throw err
    }
  }

  if (!encoded) {
    throw new Error(
      `Could not encode image even at minimum dimensions. ` +
        `Original error: ${lastError?.message || 'Unknown encoding error'}`
    )
  }

  // Stage 4: Upload to PDS
  onProgress?.({ stage: 'uploading', progress: 0, filename })
  const { cid, mimeType, size } = await uploadBlobToPds(encoded, 'image/avif', fetchHandler)
  onProgress?.({ stage: 'uploading', progress: 100, filename })

  const uploadedBlob: UploadedBlob = {
    cid,
    mimeType,
    size,
    name: filename,
    blobRef: {
      $type: 'blob',
      ref: { $link: cid },
      mimeType,
      size,
    },
  }

  const markdownUrl = getBlobUrl(pdsEndpoint, did, cid)

  return { uploadedBlob, markdownUrl }
}

/**
 * Generate markdown image syntax
 */
export function generateMarkdownImage(alt: string, url: string): string {
  // Escape any special characters in alt text
  const escapedAlt = alt.replace(/[\[\]]/g, '\\$&')
  return `![${escapedAlt}](${url})`
}
