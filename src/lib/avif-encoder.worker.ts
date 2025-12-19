/**
 * AVIF Encoder Web Worker
 *
 * Runs AVIF encoding off the main thread to prevent UI blocking.
 * The @jsquash/avif encoder uses WASM with pthreads which would otherwise
 * block the main thread while waiting for worker threads.
 */

import encodeAvif, { init as initAvifEncoder } from '@jsquash/avif/encode'

// Message types for communication with main thread
export interface EncodeRequest {
  type: 'encode'
  imageData: ImageData
  cqLevelStart: number
  cqLevelMax: number
  maxBlobSize: number
}

export interface ProgressMessage {
  type: 'progress'
  progress: number
}

export interface SuccessMessage {
  type: 'success'
  encoded: ArrayBuffer
}

export interface ErrorMessage {
  type: 'error'
  error: string
  /** True if the WASM encoder itself failed (e.g., memory constraints) */
  isEncodingError: boolean
  /** True if retrying with smaller dimensions might help */
  shouldRetryWithResize: boolean
}

export type WorkerMessage = ProgressMessage | SuccessMessage | ErrorMessage

let encoderInitialized = false

async function ensureEncoderInitialized() {
  if (encoderInitialized) return
  await initAvifEncoder()
  encoderInitialized = true
}

async function encodeWithQualityAdjustment(
  imageData: ImageData,
  cqLevelStart: number,
  cqLevelMax: number,
  maxBlobSize: number
): Promise<ArrayBuffer> {
  await ensureEncoderInitialized()

  let cqLevel = cqLevelStart
  let encoded: ArrayBuffer | null = null

  while (cqLevel <= cqLevelMax) {
    const progress = Math.round(((cqLevel - cqLevelStart) / (cqLevelMax - cqLevelStart)) * 50)
    self.postMessage({ type: 'progress', progress } satisfies ProgressMessage)

    try {
      encoded = await encodeAvif(imageData, {
        cqLevel,
        speed: 6,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw { message: `AVIF encoding failed: ${message}`, isEncodingError: true, shouldRetryWithResize: true }
    }

    if (encoded.byteLength <= maxBlobSize) {
      self.postMessage({ type: 'progress', progress: 100 } satisfies ProgressMessage)
      return encoded
    }

    cqLevel += 5
  }

  throw {
    message: `Could not compress to under ${Math.round(maxBlobSize / 1024)}KB at current dimensions`,
    isEncodingError: false,
    shouldRetryWithResize: true,
  }
}

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { imageData, cqLevelStart, cqLevelMax, maxBlobSize } = event.data

  try {
    const encoded = await encodeWithQualityAdjustment(
      imageData,
      cqLevelStart,
      cqLevelMax,
      maxBlobSize
    )
    self.postMessage(
      { type: 'success', encoded } satisfies SuccessMessage,
      { transfer: [encoded] }
    )
  } catch (err) {
    const error = err as { message: string; isEncodingError: boolean; shouldRetryWithResize: boolean }
    self.postMessage({
      type: 'error',
      error: error.message || String(err),
      isEncodingError: error.isEncodingError ?? true,
      shouldRetryWithResize: error.shouldRetryWithResize ?? true,
    } satisfies ErrorMessage)
  }
}
