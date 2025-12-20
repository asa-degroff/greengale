/**
 * TTS Web Worker
 *
 * Runs Kokoro TTS model off the main thread to prevent UI blocking.
 * Streams audio chunks back to main thread for playback.
 */

import { KokoroTTS } from 'kokoro-js'
import type {
  WorkerRequest,
  WorkerMessage,
  ModelProgressMessage,
  ModelReadyMessage,
  AudioChunkMessage,
  GenerationProgressMessage,
  GenerationCompleteMessage,
  ErrorMessage,
  StoppedMessage,
} from './tts'
import { MODEL_ID, DEFAULT_VOICE, splitIntoSentences } from './tts'

let tts: KokoroTTS | null = null
let currentVoice = DEFAULT_VOICE
let isGenerating = false
let stopRequested = false

function postMessage(message: WorkerMessage, transfer?: Transferable[]) {
  if (transfer) {
    self.postMessage(message, { transfer })
  } else {
    self.postMessage(message)
  }
}

async function initializeModel(device: 'webgpu' | 'wasm', _dtype: 'fp32' | 'q8', voice: string) {
  // Try the requested device first, fall back to WASM if WebGPU fails
  const devicesToTry: Array<{ device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8' }> =
    device === 'webgpu'
      ? [{ device: 'webgpu', dtype: 'fp32' }, { device: 'wasm', dtype: 'q8' }]
      : [{ device: 'wasm', dtype: 'q8' }]

  let lastError: Error | null = null

  for (const config of devicesToTry) {
    try {
      console.log('[TTS Worker] Attempting to initialize model with device:', config.device, 'dtype:', config.dtype)

      postMessage({
        type: 'model-progress',
        progress: 0,
        status: config.device === 'webgpu'
          ? 'Initializing TTS with GPU acceleration...'
          : 'Initializing TTS model...',
      } satisfies ModelProgressMessage)

      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: config.dtype,
        device: config.device,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (progress: any) => {
          // Progress can be various types depending on the stage
          const percent = typeof progress?.progress === 'number'
            ? Math.round(progress.progress * 100)
            : 0
          postMessage({
            type: 'model-progress',
            progress: percent,
            status: progress?.status || 'Downloading model...',
          } satisfies ModelProgressMessage)
        },
      })

      currentVoice = voice

      console.log('[TTS Worker] Model loaded successfully with', config.device)

      // Get available voices from the voices getter (returns an object, not array)
      // We extract the keys to get voice IDs
      let voiceIds: string[] = [DEFAULT_VOICE]
      try {
        const voicesObj = tts.voices
        if (voicesObj && typeof voicesObj === 'object') {
          voiceIds = Object.keys(voicesObj)
          console.log('[TTS Worker] Available voices:', voiceIds)
        }
      } catch (e) {
        console.warn('[TTS Worker] Could not get voices list:', e)
      }

      postMessage({
        type: 'model-ready',
        voices: voiceIds,
        cachedFromIndexedDB: true, // Transformers.js caches in IndexedDB
      } satisfies ModelReadyMessage)

      return // Success!
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn('[TTS Worker] Failed to initialize with', config.device, ':', lastError.message)

      // If this was WebGPU and we have WASM to try, continue
      if (config.device === 'webgpu' && devicesToTry.length > 1) {
        console.log('[TTS Worker] Falling back to WASM...')
        continue
      }
    }
  }

  // All attempts failed
  const message = lastError?.message || 'Unknown error'

  // Detect specific error types
  let code: ErrorMessage['code'] = 'MODEL_LOAD_FAILED'
  if (message.includes('WebGPU')) {
    code = 'WEBGPU_NOT_SUPPORTED'
  } else if (message.includes('memory') || message.includes('OOM')) {
    code = 'OUT_OF_MEMORY'
  }

  postMessage({
    type: 'error',
    error: message,
    code,
    recoverable: false,
  } satisfies ErrorMessage)
}

async function generateAudio(text: string, voice?: string) {
  console.log('[TTS Worker] generateAudio called, tts:', tts ? 'initialized' : 'null')

  if (!tts) {
    console.error('[TTS Worker] TTS model not initialized!')
    postMessage({
      type: 'error',
      error: 'TTS model not initialized',
      code: 'GENERATION_FAILED',
      recoverable: false,
    } satisfies ErrorMessage)
    return
  }

  const useVoice = voice || currentVoice
  isGenerating = true
  stopRequested = false

  try {
    const sentences = splitIntoSentences(text)
    const totalSentences = sentences.length
    console.log('[TTS Worker] Generating', totalSentences, 'sentences with voice:', useVoice)

    for (let i = 0; i < sentences.length; i++) {
      // Check if stop was requested
      if (stopRequested) {
        postMessage({ type: 'stopped' } satisfies StoppedMessage)
        isGenerating = false
        return
      }

      const sentence = sentences[i]

      postMessage({
        type: 'generation-progress',
        progress: Math.round((i / totalSentences) * 100),
        sentenceIndex: i,
        totalSentences,
        currentSentence: sentence,
      } satisfies GenerationProgressMessage)

      // Generate audio for this sentence
      // Cast voice to any since the type is a specific union that we validate at runtime
      console.log('[TTS Worker] Generating sentence', i + 1, '/', totalSentences, ':', sentence.substring(0, 50) + (sentence.length > 50 ? '...' : ''))

      let result
      try {
        result = await tts.generate(sentence, { voice: useVoice as 'af_heart' })
      } catch (genError) {
        console.error('[TTS Worker] Generation error for sentence', i, ':', genError)
        throw genError
      }

      console.log('[TTS Worker] Generation complete, result type:', typeof result, 'has audio:', result?.audio ? 'yes' : 'no')

      // Check stop again after generation
      if (stopRequested) {
        postMessage({ type: 'stopped' } satisfies StoppedMessage)
        isGenerating = false
        return
      }

      // Extract audio data - kokoro-js returns a RawAudio object with audio property
      if (!result || !result.audio) {
        console.error('[TTS Worker] Invalid result from generate:', result)
        throw new Error('TTS generate returned invalid result')
      }

      const audioData = result.audio as Float32Array
      console.log('[TTS Worker] Audio data length:', audioData.length, 'sample rate:', result.sampling_rate)

      // Clone the audio data before transferring since RawAudio might hold references
      const audioClone = new Float32Array(audioData)

      postMessage(
        {
          type: 'audio-chunk',
          audio: audioClone,
          text: sentence,
          sentenceIndex: i,
          totalSentences,
          isLast: i === sentences.length - 1,
        } satisfies AudioChunkMessage,
        [audioClone.buffer]
      )
    }

    postMessage({
      type: 'generation-complete',
    } satisfies GenerationCompleteMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    let code: ErrorMessage['code'] = 'GENERATION_FAILED'
    if (message.includes('memory') || message.includes('OOM')) {
      code = 'OUT_OF_MEMORY'
    }

    postMessage({
      type: 'error',
      error: message,
      code,
      recoverable: true,
    } satisfies ErrorMessage)
  } finally {
    isGenerating = false
  }
}

function stopGeneration() {
  stopRequested = true
  if (!isGenerating) {
    postMessage({ type: 'stopped' } satisfies StoppedMessage)
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  console.log('[TTS Worker] Received message:', request.type)

  switch (request.type) {
    case 'initialize':
      await initializeModel(request.options.device, request.options.dtype, request.options.voice)
      break

    case 'generate':
      await generateAudio(request.text, request.voice)
      break

    case 'stop':
      stopGeneration()
      break
  }
}
