/**
 * Image Upload Module
 *
 * Handles image validation, resizing, AVIF encoding, and PDS blob upload
 * for the GreenGale blog editor.
 */

import { encode as encodeAvif } from '@jsquash/avif'

// AT Protocol blob limit is 1,000,000 bytes
// Target ~900KB to leave margin for encoding overhead
const MAX_BLOB_SIZE = 900 * 1024
const MAX_DIMENSION = 4096 // Maximum width or height
// cqLevel: 0-63, lower is better quality (like CRF)
const CQ_LEVEL_START = 25 // Starting quality (good balance)
const CQ_LEVEL_MAX = 50 // Maximum cqLevel (lower quality) to try before failing

// Supported input image types
const SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
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
      error: `Unsupported image type: ${file.type || 'unknown'}. Supported: JPEG, PNG, GIF, WebP, AVIF, BMP`,
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
 * Calculate new dimensions that fit within MAX_DIMENSION while preserving aspect ratio
 */
function calculateResizedDimensions(
  width: number,
  height: number
): { width: number; height: number; needsResize: boolean } {
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return { width, height, needsResize: false }
  }

  const aspectRatio = width / height
  let newWidth: number
  let newHeight: number

  if (width > height) {
    newWidth = MAX_DIMENSION
    newHeight = Math.round(MAX_DIMENSION / aspectRatio)
  } else {
    newHeight = MAX_DIMENSION
    newWidth = Math.round(MAX_DIMENSION * aspectRatio)
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
 * Encode ImageData to AVIF with quality adjustment to meet size limit
 */
async function encodeToAvif(
  imageData: ImageData,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  let cqLevel = CQ_LEVEL_START
  let encoded: ArrayBuffer | null = null

  while (cqLevel <= CQ_LEVEL_MAX) {
    onProgress?.(Math.round(((cqLevel - CQ_LEVEL_START) / (CQ_LEVEL_MAX - CQ_LEVEL_START)) * 50))

    encoded = await encodeAvif(imageData, {
      cqLevel,
      speed: 6, // Balance between speed and compression (0-10, higher = faster)
    })

    if (encoded.byteLength <= MAX_BLOB_SIZE) {
      onProgress?.(100)
      return encoded
    }

    // Increase cqLevel (reduce quality) and try again
    cqLevel += 5
  }

  // If we still can't get under the limit, throw an error
  throw new Error(
    `Could not compress image to under ${Math.round(MAX_BLOB_SIZE / 1024)}KB. ` +
      `Try using a smaller image or one with fewer colors.`
  )
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

  // Stage 2: Load and resize
  onProgress?.({ stage: 'resizing', progress: 0, filename })
  const img = await loadImage(file)
  const { width, height } = calculateResizedDimensions(img.width, img.height)
  const imageData = getImageData(img, width, height)
  onProgress?.({ stage: 'resizing', progress: 100, filename })

  // Stage 3: Encode to AVIF
  onProgress?.({ stage: 'encoding', progress: 0, filename })
  const encoded = await encodeToAvif(imageData, (p) => {
    onProgress?.({ stage: 'encoding', progress: p, filename })
  })

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
