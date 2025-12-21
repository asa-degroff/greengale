/**
 * Text-to-Speech utilities and types for Kokoro TTS integration
 */

// ==================== STATE TYPES ====================

export type TTSStatus =
  | 'idle'
  | 'loading-model'
  | 'generating'
  | 'playing'
  | 'paused'
  | 'error'

export interface TTSState {
  status: TTSStatus
  modelProgress: number // 0-100 for model download
  generationProgress: number // 0-100 for TTS generation
  currentSentence: string | null
  sentenceIndex: number
  totalSentences: number
  error: string | null
  isModelCached: boolean
}

export const initialTTSState: TTSState = {
  status: 'idle',
  modelProgress: 0,
  generationProgress: 0,
  currentSentence: null,
  sentenceIndex: 0,
  totalSentences: 0,
  error: null,
  isModelCached: false,
}

// ==================== WORKER MESSAGE TYPES ====================

// Main thread → Worker
export interface InitializeRequest {
  type: 'initialize'
  options: {
    device: 'webgpu' | 'wasm'
    dtype: 'fp32' | 'q8'
    voice: string
  }
}

export interface IndexedSentence {
  index: number // Original sentence index in the full document
  text: string
}

export interface GenerateRequest {
  type: 'generate'
  sentences: IndexedSentence[] // Sentences with their original indices
  voice?: string
}

export interface StopRequest {
  type: 'stop'
}

export type WorkerRequest = InitializeRequest | GenerateRequest | StopRequest

// Worker → Main thread
export interface ModelProgressMessage {
  type: 'model-progress'
  progress: number
  status: string
}

export interface ModelReadyMessage {
  type: 'model-ready'
  voices: string[]
  cachedFromIndexedDB: boolean
}

export interface AudioChunkMessage {
  type: 'audio-chunk'
  audio: Float32Array
  text: string
  sentenceIndex: number
  totalSentences: number
  isLast: boolean
}

export interface GenerationProgressMessage {
  type: 'generation-progress'
  progress: number
  sentenceIndex: number
  totalSentences: number
  currentSentence: string
}

export interface GenerationCompleteMessage {
  type: 'generation-complete'
}

export interface ErrorMessage {
  type: 'error'
  error: string
  code: 'MODEL_LOAD_FAILED' | 'GENERATION_FAILED' | 'WEBGPU_NOT_SUPPORTED' | 'OUT_OF_MEMORY' | 'STOPPED'
  recoverable: boolean
}

export interface StoppedMessage {
  type: 'stopped'
}

export type WorkerMessage =
  | ModelProgressMessage
  | ModelReadyMessage
  | AudioChunkMessage
  | GenerationProgressMessage
  | GenerationCompleteMessage
  | ErrorMessage
  | StoppedMessage

// ==================== BROWSER CAPABILITIES ====================

export interface BrowserCapabilities {
  webgpu: boolean
  wasm: boolean
  audioContext: boolean
  indexedDB: boolean
  recommended: {
    device: 'webgpu' | 'wasm'
    dtype: 'fp32' | 'q8'
    modelSize: string
  }
}

/**
 * Detect browser capabilities for TTS
 */
export async function detectCapabilities(): Promise<BrowserCapabilities> {
  let webgpu = false

  // Check for WebGPU support - be thorough by requesting both adapter AND device
  if ('gpu' in navigator) {
    try {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
      if (gpu) {
        const adapter = await gpu.requestAdapter()
        if (adapter) {
          // Actually request a device to verify WebGPU is fully functional
          const device = await adapter.requestDevice()
          if (device) {
            webgpu = true
            // Clean up the test device
            device.destroy()
            console.log('[TTS] WebGPU device created successfully')
          }
        }
      }
    } catch (e) {
      console.warn('[TTS] WebGPU detection failed:', e)
      // WebGPU not available
    }
  }

  const wasm = typeof WebAssembly === 'object'
  const audioContext =
    typeof AudioContext !== 'undefined' ||
    typeof (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !== 'undefined'
  const indexedDB = typeof window.indexedDB !== 'undefined'

  // Determine optimal configuration
  // NOTE: WebGPU produces garbled audio on some hardware configurations (mainly Linux)
  // (tracked in https://github.com/huggingface/transformers.js/issues/1320)
  // Fix is coming in PR #1382: https://github.com/huggingface/transformers.js/pull/1382
  // macOS works reliably with WebGPU, so we enable it by default there.
  // Other platforms can enable via localStorage: localStorage.setItem('tts-force-webgpu', 'true')
  const forceWebGPU = typeof localStorage !== 'undefined' && localStorage.getItem('tts-force-webgpu') === 'true'
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const useWebGPU = (forceWebGPU || isMac) && webgpu
  const device: 'webgpu' | 'wasm' = useWebGPU ? 'webgpu' : 'wasm'
  const dtype: 'fp32' | 'q8' = device === 'webgpu' ? 'fp32' : 'q8'
  const modelSize = dtype === 'fp32' ? '~326 MB' : '~92 MB'

  console.log('[TTS] Detected capabilities:', { webgpu, wasm, device, dtype, isMac, forceWebGPU })

  return {
    webgpu,
    wasm,
    audioContext,
    indexedDB,
    recommended: { device, dtype, modelSize },
  }
}

// ==================== TEXT EXTRACTION ====================

/**
 * Extract speakable text from markdown for TTS.
 * Removes code blocks, images, and formatting while preserving readable content.
 */
export function extractTextForTTS(markdown: string): string {
  return (
    markdown
      // Remove fenced code blocks (with optional language)
      .replace(/```[\w-]*\n[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`[^`]+`/g, '')
      // Remove images
      .replace(/!\[.*?\]\(.*?\)/g, '')
      // Convert links to just text: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove heading markers but keep text
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic markers
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/___([^_]+)___/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove strikethrough
      .replace(/~~([^~]+)~~/g, '$1')
      // Remove blockquote markers but keep text
      .replace(/^>\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Convert list items to sentences (add period if no sentence-ending punctuation)
      // This ensures each list item becomes a separate TTS sentence
      .replace(/^([\s]*[-*+]\s+)(.+?)([.!?])?$/gm, (_, _marker, text, punct) => {
        return punct ? text + punct : text + '.'
      })
      .replace(/^([\s]*\d+\.\s+)(.+?)([.!?])?$/gm, (_, _marker, text, punct) => {
        return punct ? text + punct : text + '.'
      })
      // Remove HTML tags
      .replace(/<[^>]+>/g, '')
      // Remove LaTeX block delimiters
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      // Remove inline LaTeX
      .replace(/\$[^$\n]+\$/g, '')
      // Convert parentheses to commas for natural pauses in TTS
      // (parenthetical content) → , parenthetical content,
      .replace(/\(/g, ', ')
      .replace(/\)/g, ', ')
      // Clean up comma artifacts from parentheses conversion
      .replace(/,\s*,/g, ',') // collapse double commas
      .replace(/,\s*([.!?])/g, '$1') // remove comma before sentence-ending punctuation
      .replace(/,\s*:/g, ':') // remove comma before colon
      .replace(/(^|[\n])(\s*),\s*/g, '$1$2') // remove leading comma at line/sentence start
      // Normalize multiple newlines to double (paragraph breaks)
      .replace(/\n{3,}/g, '\n\n')
      // Normalize whitespace
      .replace(/[ \t]+/g, ' ')
      .trim()
  )
}

/**
 * Split text into sentences for streaming TTS.
 * Handles paragraph breaks, list items, and common edge cases.
 */
export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []

  // Split on newlines first to handle list items and paragraph breaks
  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0)

  for (const line of lines) {
    // Normalize whitespace within the line
    const normalized = line.replace(/\s+/g, ' ').trim()
    if (!normalized) continue

    // Check if this line ends with a colon (like "Here's what happens:")
    // If so, treat it as its own sentence
    if (normalized.endsWith(':')) {
      sentences.push(normalized)
      continue
    }

    // Split on sentence-ending punctuation followed by space
    const lineSentences = normalized
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    // If no sentences found (e.g., a list item without period), use the whole line
    if (lineSentences.length === 0 && normalized.length > 0) {
      sentences.push(normalized)
    } else {
      sentences.push(...lineSentences)
    }
  }

  return sentences.length > 0 ? sentences : [text.replace(/\s+/g, ' ').trim()]
}

// ==================== CONSTANTS ====================

export const DEFAULT_VOICE = 'af_heart'
export const SAMPLE_RATE = 24000
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

// ==================== WAV ENCODING ====================

/**
 * Convert Float32Array audio samples to a WAV Blob.
 * Used for HTMLAudioElement playback with preservesPitch support.
 */
export function float32ToWavBlob(samples: Float32Array, sampleRate: number = SAMPLE_RATE): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample

  // Calculate sizes
  const dataSize = samples.length * bytesPerSample
  const headerSize = 44
  const fileSize = headerSize + dataSize

  // Create buffer
  const buffer = new ArrayBuffer(fileSize)
  const view = new DataView(buffer)

  // Write WAV header
  // "RIFF" chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, fileSize - 8, true) // file size - 8
  writeString(view, 8, 'WAVE')

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // sub-chunk size (16 for PCM)
  view.setUint16(20, 1, true) // audio format (1 = PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // "data" sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Write audio data (convert float32 to int16)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1] and convert to int16
    const sample = Math.max(-1, Math.min(1, samples[i]))
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, int16, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
