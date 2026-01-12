/**
 * Text-to-Speech utilities and types for Kokoro TTS integration
 */

import { extractCidFromBlobUrl, getBlobAltMap } from './image-labels'
import { getBlueskyPost, getBlueskyInteractions } from './bluesky'
import type { BlogEntry } from './atproto'

/**
 * Regex to match Bluesky post URLs for TTS processing
 * Captures: [1] = handle or DID, [2] = rkey
 */
const BLUESKY_POST_URL_REGEX = /https?:\/\/bsky\.app\/profile\/([^/\s]+)\/post\/([a-zA-Z0-9]+)/g

/**
 * Strip URLs from text for TTS (URLs don't read well aloud)
 */
function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Check if a TTS sentence is a marker for the discussions section.
 * Used to coordinate highlighting between MarkdownRenderer and BlueskyInteractions.
 *
 * Discussion markers include:
 * - "Discussions from the network." (section header)
 * - "Post by {author}: ..." (discussion post)
 * - "Reply by {author}: ..." (discussion reply)
 */
export function isDiscussionSentence(sentence: string): boolean {
  const normalized = sentence.toLowerCase().trim()
  return (
    normalized === 'discussions from the network.' ||
    /^(post|reply) by [^:]+:/i.test(sentence)
  )
}

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
  // NOTE: WebGPU produces garbled audio on some hardware configurations (mainly Linux/Android)
  // (tracked in https://github.com/huggingface/transformers.js/issues/1320)
  // Fix is coming in PR #1382: https://github.com/huggingface/transformers.js/pull/1382
  // macOS (Chrome & Safari 26+) works reliably with WebGPU, so we enable it by default there.
  // Other platforms can enable via localStorage: localStorage.setItem('tts-force-webgpu', 'true')
  const forceWebGPU = typeof localStorage !== 'undefined' && localStorage.getItem('tts-force-webgpu') === 'true'
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  const useWebGPU = (forceWebGPU || isMac) && webgpu
  const device: 'webgpu' | 'wasm' = useWebGPU ? 'webgpu' : 'wasm'
  const dtype: 'fp32' | 'q8' = device === 'webgpu' ? 'fp32' : 'q8'
  const modelSize = dtype === 'fp32' ? '~326 MB' : '~92 MB'

  console.log('[TTS] Detected capabilities:', { webgpu, wasm, device, dtype, isMac, isSafari, forceWebGPU })

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
 * Removes code blocks and formatting while preserving readable content.
 * Images are converted to spoken descriptions using alt text.
 */
export function extractTextForTTS(markdown: string, blobs?: BlogEntry['blobs']): string {
  // Build alt text map from blobs for looking up image descriptions
  const altMap = blobs ? getBlobAltMap(blobs) : new Map<string, string>()

  return (
    markdown
      // Remove fenced code blocks (with optional language)
      .replace(/```[\w-]*\n[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`[^`]+`/g, '')
      // Convert images to spoken descriptions
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, markdownAlt, url) => {
        // Try to get alt from blob metadata (preferred)
        const cid = extractCidFromBlobUrl(url)
        const blobAlt = cid ? altMap.get(cid) : undefined
        // Fall back to markdown alt text
        const alt = blobAlt || markdownAlt

        if (alt && alt.trim()) {
          return `Image: ${alt.trim()}.`
        }
        return 'Image without description.'
      })
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
 * Async version of extractTextForTTS that fetches embedded Bluesky post content
 * and optionally includes discussions from the network.
 * Replaces Bluesky URLs with speakable text: "Bluesky post by [author]: [content]"
 */
export async function extractTextForTTSAsync(
  markdown: string,
  blobs?: BlogEntry['blobs'],
  postUrl?: string
): Promise<string> {
  // Find all Bluesky URLs in the markdown
  const blueskyUrls = [...markdown.matchAll(BLUESKY_POST_URL_REGEX)]

  let processedMarkdown = markdown

  // Fetch embedded Bluesky posts in parallel
  if (blueskyUrls.length > 0) {
    const posts = await Promise.all(
      blueskyUrls.map(async (match) => {
        const [url, handle, rkey] = match
        try {
          const post = await getBlueskyPost(handle, rkey)
          return { url, post }
        } catch {
          return { url, post: null }
        }
      })
    )

    // Replace URLs with speakable content
    for (const { url, post } of posts) {
      if (post) {
        const authorName = post.author.displayName || post.author.handle
        let speakable = `Bluesky post by ${authorName}: ${post.text}`

        // Add image descriptions if the post has images with alt text
        if (post.images && post.images.length > 0) {
          const imageDescriptions = post.images
            .filter((img) => img.alt && img.alt.trim())
            .map((img) => `Image: ${img.alt.trim()}.`)
          if (imageDescriptions.length > 0) {
            speakable += ' ' + imageDescriptions.join(' ')
          }
        }

        processedMarkdown = processedMarkdown.replace(url, speakable)
      } else {
        // Failed to fetch - use a generic placeholder
        processedMarkdown = processedMarkdown.replace(url, 'Embedded Bluesky post.')
      }
    }
  }

  // Fetch discussions from the network if postUrl provided
  if (postUrl) {
    try {
      const interactions = await getBlueskyInteractions(postUrl, { limit: 10 })
      if (interactions.posts.length > 0) {
        processedMarkdown += '\n\nDiscussions from the network.\n\n'

        for (const post of interactions.posts) {
          const authorName = post.author.displayName || post.author.handle
          processedMarkdown += `Post by ${authorName}: ${stripUrls(post.text)}\n\n`

          // Include direct replies (1 level deep)
          if (post.replies && post.replies.length > 0) {
            for (const reply of post.replies) {
              const replyAuthor = reply.author.displayName || reply.author.handle
              processedMarkdown += `Reply by ${replyAuthor}: ${stripUrls(reply.text)}\n\n`
            }
          }
        }
      }
    } catch {
      // Failed to fetch discussions - continue without them
    }
  }

  // Run through existing sync extraction for final cleanup
  return extractTextForTTS(processedMarkdown, blobs)
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

export const PITCH_RATES = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5] as const
export type PitchRate = (typeof PITCH_RATES)[number]

// ==================== VOICE UTILITIES ====================

export interface VoiceInfo {
  id: string
  name: string
  gender: 'female' | 'male'
  accent: 'american' | 'british' | 'other'
}

export interface VoiceCategory {
  label: string
  voices: VoiceInfo[]
}

/**
 * Parse a Kokoro voice ID into display info.
 * Format: {accent}{gender}_{name} e.g., "af_heart" = American Female Heart
 */
export function parseVoiceId(id: string): VoiceInfo {
  const parts = id.split('_')
  if (parts.length < 2) {
    return { id, name: id, gender: 'female', accent: 'other' }
  }

  const [prefix, ...nameParts] = parts
  const name = nameParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')

  // Parse prefix: first char = accent (a=american, b=british), second char = gender (f=female, m=male)
  const accentChar = prefix.charAt(0).toLowerCase()
  const genderChar = prefix.charAt(1).toLowerCase()

  const accent: VoiceInfo['accent'] =
    accentChar === 'a' ? 'american' : accentChar === 'b' ? 'british' : 'other'
  const gender: VoiceInfo['gender'] = genderChar === 'm' ? 'male' : 'female'

  return { id, name, gender, accent }
}

/**
 * Group voices by category for UI display.
 */
export function groupVoices(voiceIds: string[]): VoiceCategory[] {
  const categories: VoiceCategory[] = [
    { label: 'American Female', voices: [] },
    { label: 'American Male', voices: [] },
    { label: 'British Female', voices: [] },
    { label: 'British Male', voices: [] },
    { label: 'Other', voices: [] },
  ]

  for (const id of voiceIds) {
    const info = parseVoiceId(id)
    let categoryIndex: number
    if (info.accent === 'american') {
      categoryIndex = info.gender === 'female' ? 0 : 1
    } else if (info.accent === 'british') {
      categoryIndex = info.gender === 'female' ? 2 : 3
    } else {
      categoryIndex = 4
    }
    categories[categoryIndex].voices.push(info)
  }

  // Sort voices within each category by name
  for (const category of categories) {
    category.voices.sort((a, b) => a.name.localeCompare(b.name))
  }

  return categories.filter((c) => c.voices.length > 0)
}

/**
 * Convert a pitch ratio to cents for Web Audio API detune.
 * Formula: cents = 1200 * log2(ratio)
 */
export function pitchToCents(ratio: number): number {
  if (ratio <= 0) return 0
  return Math.round(1200 * Math.log2(ratio))
}

// ==================== PITCH SHIFTING ====================

/**
 * Resample audio using linear interpolation.
 * This changes both pitch AND duration.
 *
 * @param samples Input audio samples
 * @param factor Resampling factor (>1 = read faster = higher pitch + shorter, <1 = lower pitch + longer)
 * @returns Resampled audio
 */
function resampleAudio(samples: Float32Array, factor: number): Float32Array {
  const newLength = Math.round(samples.length / factor)
  const output = new Float32Array(newLength)

  for (let i = 0; i < newLength; i++) {
    const srcPos = i * factor
    const srcIdx = Math.floor(srcPos)
    const frac = srcPos - srcIdx

    if (srcIdx + 1 < samples.length) {
      // Linear interpolation between adjacent samples
      output[i] = samples[srcIdx] * (1 - frac) + samples[srcIdx + 1] * frac
    } else if (srcIdx < samples.length) {
      output[i] = samples[srcIdx]
    }
  }

  return output
}

/**
 * Time-stretch audio using SOLA (Synchronized Overlap-Add).
 * Uses cross-correlation to find optimal overlap positions, eliminating
 * the "robotic" phase artifacts of simple OLA.
 *
 * Key insight: We must ensure ALL input content maps to the output.
 * The first input window maps to first output window.
 * The last input window maps to last output window.
 * Intermediate windows are evenly distributed with correlation-based alignment.
 *
 * @param samples Input audio samples
 * @param stretchFactor Factor to stretch by (>1 = longer, <1 = shorter)
 * @param sampleRate Sample rate
 * @returns Time-stretched audio
 */
function timeStretchSOLA(
  samples: Float32Array,
  stretchFactor: number,
  sampleRate: number
): Float32Array {
  const outputLength = Math.round(samples.length * stretchFactor)

  // Handle edge cases
  if (samples.length === 0) return new Float32Array(0)
  if (outputLength === 0) return new Float32Array(0)
  if (Math.abs(stretchFactor - 1.0) < 0.001) {
    // No stretching needed, just copy
    const output = new Float32Array(outputLength)
    const copyLen = Math.min(samples.length, outputLength)
    output.set(samples.subarray(0, copyLen))
    return output
  }

  // Use longer windows for smoother results with speech
  const windowSize = Math.floor(sampleRate * 0.025) // 25ms window
  const overlapSize = Math.floor(windowSize * 0.5) // 50% overlap
  const maxSearchRange = Math.floor(sampleRate * 0.01) // ±10ms search range

  const output = new Float32Array(outputLength)

  // If input is too short for windowed processing, use linear interpolation
  if (samples.length < windowSize * 2 || outputLength < windowSize * 2) {
    for (let i = 0; i < outputLength; i++) {
      const srcPos = (i / outputLength) * samples.length
      const srcIdx = Math.floor(srcPos)
      const frac = srcPos - srcIdx
      if (srcIdx + 1 < samples.length) {
        output[i] = samples[srcIdx] * (1 - frac) + samples[srcIdx + 1] * frac
      } else if (srcIdx < samples.length) {
        output[i] = samples[srcIdx]
      }
    }
    return output
  }

  // Calculate number of windows we need to place
  // First window at position 0, last window ends at outputLength
  // Windows are placed with hopOut spacing in output
  const hopOut = windowSize - overlapSize
  const numWindows = Math.max(2, Math.floor((outputLength - windowSize) / hopOut) + 1)

  // Calculate input positions for each window
  // First window: input position 0
  // Last window: input position (samples.length - windowSize)
  // Intermediate windows: evenly distributed
  const inputPositions: number[] = []
  const lastInputPos = samples.length - windowSize

  for (let w = 0; w < numWindows; w++) {
    // Linear mapping from output window index to input position
    const t = w / (numWindows - 1)
    inputPositions.push(Math.round(t * lastInputPos))
  }

  // Copy first window directly (no crossfade needed)
  const firstWindowEnd = Math.min(windowSize, samples.length, outputLength)
  for (let i = 0; i < firstWindowEnd; i++) {
    output[i] = samples[i]
  }

  // Process subsequent windows with correlation-based alignment
  for (let w = 1; w < numWindows; w++) {
    const outPos = w * hopOut
    const nominalInPos = inputPositions[w]

    // Skip if output position is past end
    if (outPos >= outputLength) break

    // Determine search range
    const searchStart = Math.max(-maxSearchRange, -nominalInPos)
    const searchEnd = Math.min(maxSearchRange, lastInputPos - nominalInPos)

    // Find best correlation offset to minimize phase discontinuity
    let bestOffset = 0
    let bestCorr = -Infinity

    if (searchEnd >= searchStart && outPos > 0) {
      for (let offset = searchStart; offset <= searchEnd; offset++) {
        const testPos = nominalInPos + offset

        // Calculate cross-correlation with existing output in overlap region
        let corr = 0
        let energy = 0
        for (let i = 0; i < overlapSize; i++) {
          const outIdx = outPos + i
          const inIdx = testPos + i
          if (outIdx < outputLength && inIdx < samples.length) {
            corr += output[outIdx] * samples[inIdx]
            energy += samples[inIdx] * samples[inIdx]
          }
        }

        // Normalize correlation by energy to avoid bias toward loud sections
        if (energy > 0.0001) {
          corr /= Math.sqrt(energy)
        }

        if (corr > bestCorr) {
          bestCorr = corr
          bestOffset = offset
        }
      }
    }

    const actualInPos = Math.max(0, Math.min(nominalInPos + bestOffset, lastInputPos))

    // Crossfade in overlap region using linear fade
    for (let i = 0; i < overlapSize; i++) {
      const outIdx = outPos + i
      const inIdx = actualInPos + i
      if (outIdx < outputLength && inIdx < samples.length) {
        const fadeOut = 1 - i / overlapSize
        const fadeIn = i / overlapSize
        output[outIdx] = output[outIdx] * fadeOut + samples[inIdx] * fadeIn
      }
    }

    // Copy the rest of the window (non-overlapping part)
    for (let i = overlapSize; i < windowSize; i++) {
      const outIdx = outPos + i
      const inIdx = actualInPos + i
      if (outIdx < outputLength && inIdx < samples.length) {
        output[outIdx] = samples[inIdx]
      }
    }
  }

  // Handle any remaining samples at the end with a final crossfade
  // to ensure we end with the actual last samples of input
  const lastOutPos = (numWindows - 1) * hopOut + windowSize
  if (lastOutPos < outputLength) {
    // Crossfade from current output to end of input
    const remainingOut = outputLength - lastOutPos
    const fadeLen = Math.min(overlapSize, remainingOut)

    for (let i = 0; i < remainingOut; i++) {
      const outIdx = lastOutPos + i
      // Map to the very end of input
      const srcPos = samples.length - remainingOut + i
      if (outIdx < outputLength && srcPos >= 0 && srcPos < samples.length) {
        if (i < fadeLen) {
          // Crossfade region
          const fadeIn = i / fadeLen
          const fadeOut = 1 - fadeIn
          output[outIdx] = output[outIdx] * fadeOut + samples[srcPos] * fadeIn
        } else {
          output[outIdx] = samples[srcPos]
        }
      }
    }
  }

  return output
}

/**
 * Apply pitch shifting to audio samples.
 * This changes pitch without changing duration using resample + time-stretch.
 *
 * @param samples Input audio samples
 * @param pitchFactor Pitch multiplier (>1 = higher pitch, <1 = lower pitch)
 * @param sampleRate Sample rate of the audio
 * @returns Pitch-shifted audio samples with same duration as input
 */
export function shiftPitch(
  samples: Float32Array,
  pitchFactor: number,
  sampleRate: number = SAMPLE_RATE
): Float32Array {
  if (pitchFactor === 1.0 || samples.length === 0) {
    return samples
  }

  // Clamp pitch factor to reasonable range to prevent artifacts
  const clampedFactor = Math.max(0.5, Math.min(2.0, pitchFactor))

  // Step 1: Resample to change pitch (this also changes duration)
  // pitchFactor > 1: higher pitch, shorter output
  // pitchFactor < 1: lower pitch, longer output
  const resampled = resampleAudio(samples, clampedFactor)

  // Step 2: Time-stretch back to original duration using SOLA
  // We need to stretch by the pitch factor to restore the original length
  // (resampled is shorter for high pitch, longer for low pitch)
  const stretched = timeStretchSOLA(resampled, clampedFactor, sampleRate)

  // Ensure output is exactly the same length as input
  // (there might be small differences due to rounding)
  if (stretched.length === samples.length) {
    return stretched
  }

  const output = new Float32Array(samples.length)
  const copyLength = Math.min(stretched.length, samples.length)
  output.set(stretched.subarray(0, copyLength))

  return output
}

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
