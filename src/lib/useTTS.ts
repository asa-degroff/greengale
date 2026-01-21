/**
 * React hook for Text-to-Speech using Kokoro TTS
 *
 * Manages Web Worker lifecycle and audio playback via HTMLAudioElement.
 * Speed control uses HTMLAudioElement.playbackRate with preservesPitch=true.
 * Pitch control uses WSOLA-based pitch shifting applied before playback.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { WorkerRequest, WorkerMessage, TTSState, PlaybackRate, PitchRate } from './tts'
import {
  initialTTSState,
  detectCapabilities,
  SAMPLE_RATE,
  DEFAULT_VOICE,
  splitIntoSentences,
  shiftPitch,
  float32ToWavBlob,
} from './tts'
import TTSWorker from './tts.worker?worker'

interface AudioChunk {
  audio: Float32Array // Raw audio samples (before pitch shifting)
  blobUrl: string | null // Cached blob URL for current pitch setting
  cachedPitch: PitchRate // The pitch value this blobUrl was created for
  text: string
  sentenceIndex: number
  duration: number // in seconds
}

interface IndexedSentence {
  index: number
  text: string
}

interface PendingGeneration {
  sentences: IndexedSentence[]
  voice?: string
}

interface UseTTSReturn {
  state: TTSState
  playbackState: {
    isPlaying: boolean
    currentTime: number
    duration: number
    playbackRate: PlaybackRate
    pitch: PitchRate
    playbackProgress: number
    bufferProgress: number
  }
  availableVoices: string[]
  currentVoice: string
  start: (text: string, options?: { voice?: string; pitch?: PitchRate; speed?: PlaybackRate }) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  setPlaybackRate: (rate: PlaybackRate) => void
  setPitch: (rate: PitchRate) => void
  setVoice: (voice: string) => void
  seek: (sentenceText: string) => void
}

// Minimum seconds of audio to buffer before starting playback
const MIN_BUFFER_SECONDS = 5
const SAMPLE_RATE_FOR_CALC = 24000

export function useTTS(): UseTTSReturn {
  const [state, setState] = useState<TTSState>(initialTTSState)
  const [playbackState, setPlaybackState] = useState({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0 as PlaybackRate,
    pitch: 1.0 as PitchRate,
    playbackProgress: 0, // 0-100, based on sentence position
    bufferProgress: 0, // 0-100, based on chunks generated
  })
  const [availableVoices, setAvailableVoices] = useState<string[]>([])
  const [currentVoice, setCurrentVoiceState] = useState<string>(DEFAULT_VOICE)

  const workerRef = useRef<Worker | null>(null)
  // HTMLAudioElement for playback (supports preservesPitch for speed control)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioQueueRef = useRef<AudioChunk[]>([])
  const allChunksRef = useRef<Map<number, AudioChunk>>(new Map()) // Map of sentenceIndex -> chunk (persists across seeks)
  const currentChunkIndexRef = useRef<number>(0) // Current sentence index being played
  const isPlayingRef = useRef(false)
  const playbackRateRef = useRef<PlaybackRate>(1.0)
  const pitchRef = useRef<PitchRate>(1.0)
  const currentVoiceRef = useRef<string>(DEFAULT_VOICE)
  const isPausedRef = useRef(false)
  const isStartingChunkRef = useRef(false) // Guard against concurrent playNextChunk calls
  const pendingGenerationRef = useRef<PendingGeneration | null>(null)
  const generationCompleteRef = useRef(false)
  const modelLoadedOnceRef = useRef(false) // Track if model has been loaded at least once
  const originalTextRef = useRef<string>('')
  const allSentencesRef = useRef<string[]>([])
  const totalDurationRef = useRef<number>(0)
  const playedDurationRef = useRef<number>(0)
  const playbackIntervalRef = useRef<number | null>(null)
  // Track position within current chunk for accurate timing
  const chunkStartTimeRef = useRef<number>(0)

  // Get or create HTMLAudioElement for playback
  const getOrCreateAudioElement = useCallback(() => {
    if (!audioElementRef.current) {
      const audio = new Audio()
      // Enable pitch preservation when changing playback rate
      // This ensures speed changes don't affect pitch
      audio.preservesPitch = true
      // Also set the webkit version for Safari
      ;(audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true
      audioElementRef.current = audio
    }
    return audioElementRef.current
  }, [])

  // Create blob URL for a chunk, applying pitch shift if needed
  const getChunkBlobUrl = useCallback((chunk: AudioChunk): string => {
    // If we have a cached blob URL for the current pitch, use it
    if (chunk.blobUrl && chunk.cachedPitch === pitchRef.current) {
      return chunk.blobUrl
    }

    // Revoke old blob URL if it exists
    if (chunk.blobUrl) {
      URL.revokeObjectURL(chunk.blobUrl)
    }

    // Apply pitch shifting if pitch != 1.0
    let samples = chunk.audio
    if (pitchRef.current !== 1.0) {
      samples = shiftPitch(samples, pitchRef.current, SAMPLE_RATE)
    }

    // Convert to WAV blob and create URL
    const blob = float32ToWavBlob(samples, SAMPLE_RATE)
    chunk.blobUrl = URL.createObjectURL(blob)
    chunk.cachedPitch = pitchRef.current

    return chunk.blobUrl
  }, [])

  // Pre-process upcoming chunks in the background to avoid processing during playback transitions
  const preProcessNextChunks = useCallback((fromIndex: number, count: number = 2) => {
    for (let i = 0; i < count; i++) {
      const nextIndex = fromIndex + 1 + i
      const nextChunk = allChunksRef.current.get(nextIndex)
      if (nextChunk && (!nextChunk.blobUrl || nextChunk.cachedPitch !== pitchRef.current)) {
        // Use setTimeout to defer processing and avoid blocking
        setTimeout(() => {
          // Double-check chunk still needs processing (might have been processed already)
          if (nextChunk && (!nextChunk.blobUrl || nextChunk.cachedPitch !== pitchRef.current)) {
            getChunkBlobUrl(nextChunk)
          }
        }, i * 50) // Stagger processing by 50ms each
      }
    }
  }, [getChunkBlobUrl])

  // Play the next chunk in sequence using HTMLAudioElement
  const playNextChunk = useCallback(async () => {
    if (!isPlayingRef.current || isPausedRef.current) return

    // Guard against concurrent calls - if we're already starting a chunk, skip
    if (isStartingChunkRef.current) return
    isStartingChunkRef.current = true

    const queue = audioQueueRef.current
    const expectedIndex = currentChunkIndexRef.current
    const totalSentences = allSentencesRef.current.length

    // Check if we've finished all sentences
    if (expectedIndex >= totalSentences) {
      // Pause at the end instead of closing - keeps buffer available for seeking back
      isPlayingRef.current = false
      isPausedRef.current = true
      isStartingChunkRef.current = false
      setState((prev) => ({ ...prev, status: 'paused', currentSentence: 'Finished - click text to seek' }))
      setPlaybackState((prev) => ({ ...prev, isPlaying: false, playbackProgress: 100 }))
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
      return
    }

    // Find chunk for the expected sentence index
    // First check queue (for pre-loaded chunks from seek)
    let chunk: AudioChunk | undefined
    const queueIndex = queue.findIndex((c) => c.sentenceIndex === expectedIndex)
    if (queueIndex !== -1) {
      chunk = queue.splice(queueIndex, 1)[0]
    } else {
      // Check the Map for newly generated chunks
      chunk = allChunksRef.current.get(expectedIndex)
    }

    if (!chunk) {
      // Chunk not yet available
      isStartingChunkRef.current = false
      if (generationCompleteRef.current) {
        // Generation is done but chunk not found - skip to next
        console.log('[TTS] Chunk', expectedIndex, 'not found, skipping')
        currentChunkIndexRef.current = expectedIndex + 1
        playNextChunk()
      }
      // Otherwise, wait for generation - the audio-chunk handler will trigger playback
      return
    }

    const audio = getOrCreateAudioElement()

    // Get or create blob URL for this chunk (applies pitch shifting if needed)
    const blobUrl = getChunkBlobUrl(chunk)

    // Set up audio element
    audio.src = blobUrl
    audio.playbackRate = playbackRateRef.current
    // preservesPitch is set during audio element creation
    // Wait for metadata to load and get actual duration
    // This is critical for pitch-shifted audio where the SOLA algorithm
    // may produce audio with a different actual duration than calculated
    const actualDuration = await new Promise<number>((resolve) => {
      // If metadata already loaded (readyState >= 1), use current duration
      if (audio.readyState >= 1 && audio.duration && !isNaN(audio.duration)) {
        resolve(audio.duration)
        return
      }

      const handleMetadata = () => {
        audio.removeEventListener('loadedmetadata', handleMetadata)
        resolve(audio.duration)
      }
      audio.addEventListener('loadedmetadata', handleMetadata)
    })

    chunkStartTimeRef.current = Date.now() / 1000

    // Update current sentence and playback progress
    const playbackProgress = totalSentences > 0 ? (chunk.sentenceIndex / totalSentences) * 100 : 0

    setState((prev) => ({
      ...prev,
      status: 'playing',
      currentSentence: chunk.text,
      sentenceIndex: chunk.sentenceIndex,
    }))

    setPlaybackState((prev) => ({ ...prev, playbackProgress }))

    // Handle chunk end - move to next chunk
    // Use actualDuration (from audio element) instead of chunk.duration (calculated from original samples)
    const handleEnded = () => {
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)

      playedDurationRef.current += actualDuration
      currentChunkIndexRef.current = expectedIndex + 1
      isStartingChunkRef.current = false
      playNextChunk()
    }

    // Handle audio errors gracefully
    const handleError = (e: Event) => {
      console.error('[TTS] Audio error on chunk', expectedIndex, ':', e)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      isStartingChunkRef.current = false
      // Try to continue with next chunk
      currentChunkIndexRef.current = expectedIndex + 1
      playNextChunk()
    }

    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    // Start playback
    audio.play().catch((e) => {
      console.error('[TTS] Playback failed:', e)
      isStartingChunkRef.current = false
    })
    isStartingChunkRef.current = false

    // Pre-process upcoming chunks in the background while this one plays
    preProcessNextChunks(expectedIndex, 3)
  }, [getOrCreateAudioElement, getChunkBlobUrl, preProcessNextChunks])

  // Try to start playback when we have enough buffered audio
  const tryStartPlayback = useCallback(() => {
    if (isPlayingRef.current) return

    const queue = audioQueueRef.current
    if (queue.length === 0) return

    // Calculate total buffered duration
    const bufferedSeconds = queue.reduce((sum, chunk) => sum + chunk.duration, 0)

    // Start playback if we have enough buffer OR if generation is complete
    const hasEnoughBuffer = bufferedSeconds >= MIN_BUFFER_SECONDS
    const generationDone = generationCompleteRef.current

    if (hasEnoughBuffer || generationDone) {
      isPlayingRef.current = true
      isPausedRef.current = false
      setState((prev) => ({ ...prev, status: 'playing' }))
      setPlaybackState((prev) => ({ ...prev, isPlaying: true }))

      // Start playback time tracking using Date.now()
      if (!playbackIntervalRef.current) {
        playbackIntervalRef.current = window.setInterval(() => {
          if (isPlayingRef.current && !isPausedRef.current) {
            // Calculate time within current chunk using wall clock
            const now = Date.now() / 1000
            const chunkElapsed = (now - chunkStartTimeRef.current) * playbackRateRef.current
            const totalTime = playedDurationRef.current + Math.max(0, chunkElapsed)
            setPlaybackState((prev) => ({
              ...prev,
              currentTime: totalTime,
              duration: totalDurationRef.current,
              isPlaying: true,
            }))
          }
        }, 100)
      }

      playNextChunk()
    }
  }, [playNextChunk])

  // Handle messages from the TTS worker
  const handleWorkerMessage = useCallback(
    (event: MessageEvent<WorkerMessage>) => {
      const message = event.data

      switch (message.type) {
        case 'model-progress':
          // Only show loading UI on initial load, not during seeks (model is cached)
          if (!modelLoadedOnceRef.current) {
            setState((prev) => ({
              ...prev,
              status: 'loading-model',
              modelProgress: message.progress,
            }))
          }
          break

        case 'model-ready':
          modelLoadedOnceRef.current = true
          // Store available voices from the worker
          if (message.voices && message.voices.length > 0) {
            setAvailableVoices(message.voices)
          }
          setState((prev) => ({
            ...prev,
            status: prev.status === 'playing' ? 'playing' : 'generating',
            modelProgress: 100,
            isModelCached: message.cachedFromIndexedDB,
          }))

          // Send pending generation request with indexed sentences
          if (pendingGenerationRef.current && workerRef.current) {
            const generateRequest: WorkerRequest = {
              type: 'generate',
              sentences: pendingGenerationRef.current.sentences,
              voice: pendingGenerationRef.current.voice,
            }
            workerRef.current.postMessage(generateRequest)
            pendingGenerationRef.current = null
          }
          break

        case 'generation-progress':
          setState((prev) => ({
            ...prev,
            status: prev.status === 'playing' ? 'playing' : 'generating',
            generationProgress: message.progress,
            totalSentences: message.totalSentences,
          }))
          break

        case 'audio-chunk': {
          const duration = message.audio.length / SAMPLE_RATE_FOR_CALC

          // DON'T process chunks on arrival - this causes memory pressure that can crash Safari
          // Instead, store raw audio and process lazily when needed for playback
          const chunk: AudioChunk = {
            audio: message.audio,
            blobUrl: null, // Will be created when needed
            cachedPitch: 1.0, // Will be updated when processed
            text: message.text,
            sentenceIndex: message.sentenceIndex,
            duration,
          }

          // Store in Map by sentenceIndex for persistent buffer across seeks
          allChunksRef.current.set(message.sentenceIndex, chunk)

          // Add to queue for immediate playback if this is the next expected chunk
          // or if we're doing initial generation (no seeking)
          if (message.sentenceIndex === currentChunkIndexRef.current || !isPlayingRef.current) {
            audioQueueRef.current.push(chunk)
          }

          // Update buffer progress based on unique sentences generated
          const totalSentences = allSentencesRef.current.length
          if (totalSentences > 0) {
            const bufferProgress = (allChunksRef.current.size / totalSentences) * 100
            setPlaybackState((prev) => ({ ...prev, bufferProgress }))
          }

          // If we're playing and waiting for this chunk, trigger playback
          if (isPlayingRef.current && message.sentenceIndex === currentChunkIndexRef.current) {
            playNextChunk()
          } else {
            // Try to start playback if we have enough buffered
            tryStartPlayback()
          }
          break
        }

        case 'generation-complete':
          generationCompleteRef.current = true
          setState((prev) => ({
            ...prev,
            generationProgress: 100,
          }))

          // Start playback if we have audio but haven't started yet
          if (!isPlayingRef.current && audioQueueRef.current.length > 0) {
            tryStartPlayback()
          }

          // If queue is empty and we're not playing, we're done - but keep paused to allow seeking
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            isPausedRef.current = true
            setState((prev) => ({ ...prev, status: 'paused', currentSentence: 'Finished - click text to seek' }))
          }
          break

        case 'error':
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: message.error,
          }))
          isPlayingRef.current = false
          setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
          break

        case 'stopped':
          setState((prev) => ({ ...prev, status: 'idle' }))
          isPlayingRef.current = false
          setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
          break
      }
    },
    [tryStartPlayback, playNextChunk]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      // Clean up HTMLAudioElement
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        audioElementRef.current.src = ''
        audioElementRef.current = null
      }
      // Clean up blob URLs
      for (const chunk of allChunksRef.current.values()) {
        if (chunk.blobUrl) {
          URL.revokeObjectURL(chunk.blobUrl)
        }
      }
      audioQueueRef.current = []
      allChunksRef.current.clear()
    }
  }, [])

  const start = useCallback(
    async (text: string, options?: { voice?: string; pitch?: PitchRate; speed?: PlaybackRate }) => {
      // Reset state
      setState({ ...initialTTSState, status: 'loading-model' })

      // Apply provided options or use current values
      const voice = options?.voice ?? currentVoiceRef.current
      const pitch = options?.pitch ?? pitchRef.current
      const speed = options?.speed ?? playbackRateRef.current

      // Update refs and state with new values
      currentVoiceRef.current = voice
      pitchRef.current = pitch
      playbackRateRef.current = speed
      setCurrentVoiceState(voice)

      // IMPORTANT: Create audio element during user gesture to enable autoplay
      // Safari and other browsers may block audio playback if not initiated during user interaction
      const audio = getOrCreateAudioElement()
      // Play a silent audio to unlock autoplay (helps with Safari)
      audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA=='
      audio.play().catch(() => {
        // Ignore errors - this is just to unlock
      })

      // Stop any currently playing audio
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        audioElementRef.current.src = ''
      }

      // Clean up old blob URLs
      for (const chunk of allChunksRef.current.values()) {
        if (chunk.blobUrl) {
          URL.revokeObjectURL(chunk.blobUrl)
        }
      }

      audioQueueRef.current = []
      allChunksRef.current.clear()
      originalTextRef.current = text
      allSentencesRef.current = splitIntoSentences(text)
      generationCompleteRef.current = false
      isPlayingRef.current = false
      isPausedRef.current = false
      isStartingChunkRef.current = false
      totalDurationRef.current = 0
      playedDurationRef.current = 0
      currentChunkIndexRef.current = 0

      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }

      setPlaybackState({
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        playbackRate: speed,
        pitch: pitch,
        playbackProgress: 0,
        bufferProgress: 0,
      })

      // Detect browser capabilities
      const capabilities = await detectCapabilities()

      if (!capabilities.wasm && !capabilities.webgpu) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Your browser does not support WebAssembly or WebGPU, which are required for TTS.',
        }))
        return
      }

      // Create worker
      if (workerRef.current) {
        workerRef.current.terminate()
      }
      workerRef.current = new TTSWorker()
      workerRef.current.onmessage = handleWorkerMessage
      workerRef.current.onerror = (event) => {
        console.error('[TTS] Worker error:', event)
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: `TTS worker crashed: ${event.message || 'Unknown error'}`,
        }))
        isPlayingRef.current = false
        setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
      }

      // Create indexed sentences for the worker
      const indexedSentences: IndexedSentence[] = allSentencesRef.current.map((text, index) => ({
        index,
        text,
      }))

      // Store pending generation with indexed sentences and voice
      pendingGenerationRef.current = { sentences: indexedSentences, voice }

      // Initialize model with selected voice
      const initRequest: WorkerRequest = {
        type: 'initialize',
        options: {
          device: capabilities.recommended.device,
          dtype: capabilities.recommended.dtype,
          voice,
        },
      }
      workerRef.current.postMessage(initRequest)
    },
    [handleWorkerMessage, getOrCreateAudioElement]
  )

  const pause = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return

    isPausedRef.current = true

    // Pause the HTMLAudioElement
    if (audioElementRef.current) {
      audioElementRef.current.pause()
    }

    setState((prev) => ({ ...prev, status: 'paused' }))
    setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
  }, [])

  const resume = useCallback(() => {
    if (!isPausedRef.current) return

    isPausedRef.current = false

    // Resume the HTMLAudioElement
    if (audioElementRef.current && audioElementRef.current.paused && audioElementRef.current.src) {
      audioElementRef.current.play().then(() => {
        setState((prev) => ({ ...prev, status: 'playing' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
      }).catch((e) => {
        console.error('[TTS] Resume failed:', e)
        // Try playing next chunk instead
        setState((prev) => ({ ...prev, status: 'playing' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
        playNextChunk()
      })
    } else {
      // No active audio, try to play next chunk
      setState((prev) => ({ ...prev, status: 'playing' }))
      setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
      playNextChunk()
    }
  }, [playNextChunk])

  const stop = useCallback(() => {
    // Stop playback interval
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current)
      playbackIntervalRef.current = null
    }

    // Stop the worker
    if (workerRef.current) {
      const stopRequest: WorkerRequest = { type: 'stop' }
      workerRef.current.postMessage(stopRequest)
      workerRef.current.terminate()
      workerRef.current = null
    }

    // Stop HTMLAudioElement playback
    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current.src = ''
    }

    // Clean up blob URLs
    for (const chunk of allChunksRef.current.values()) {
      if (chunk.blobUrl) {
        URL.revokeObjectURL(chunk.blobUrl)
      }
    }

    // Reset state
    audioQueueRef.current = []
    allChunksRef.current.clear()
    isPlayingRef.current = false
    isPausedRef.current = false
    isStartingChunkRef.current = false
    generationCompleteRef.current = false
    pendingGenerationRef.current = null
    totalDurationRef.current = 0
    playedDurationRef.current = 0

    setState(initialTTSState)
    setPlaybackState({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: playbackRateRef.current,
      pitch: pitchRef.current,
      playbackProgress: 0,
      bufferProgress: 0,
    })
  }, [])

  const setPlaybackRate = useCallback((rate: PlaybackRate) => {
    playbackRateRef.current = rate
    setPlaybackState((prev) => ({ ...prev, playbackRate: rate }))

    // Update currently playing audio element's playback rate
    // HTMLAudioElement with preservesPitch=true keeps pitch constant
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = rate
    }
  }, [])

  const setPitch = useCallback((rate: PitchRate) => {
    pitchRef.current = rate
    setPlaybackState((prev) => ({ ...prev, pitch: rate }))

    // Pitch changes will take effect on the next chunk
    // (current chunk was already pitch-shifted when its blob URL was created)
    // Invalidate cached blob URLs so they'll be regenerated with new pitch
    for (const chunk of allChunksRef.current.values()) {
      if (chunk.blobUrl && chunk.cachedPitch !== rate) {
        URL.revokeObjectURL(chunk.blobUrl)
        chunk.blobUrl = null
      }
    }
  }, [])

  // Change voice - requires regenerating audio from current position
  const setVoice = useCallback(
    async (voice: string) => {
      currentVoiceRef.current = voice
      setCurrentVoiceState(voice)

      // If we're currently playing or paused with content, regenerate from current position
      if ((isPlayingRef.current || isPausedRef.current) && allSentencesRef.current.length > 0) {
        const currentIndex = currentChunkIndexRef.current
        const currentText = allSentencesRef.current[currentIndex]

        // Stop current playback
        if (audioElementRef.current) {
          audioElementRef.current.pause()
          audioElementRef.current.src = ''
        }

        // Stop current worker
        if (workerRef.current) {
          const stopRequest: WorkerRequest = { type: 'stop' }
          workerRef.current.postMessage(stopRequest)
          workerRef.current.terminate()
          workerRef.current = null
        }

        // Clean up blob URLs and clear all buffered chunks (they're for the old voice)
        for (const chunk of allChunksRef.current.values()) {
          if (chunk.blobUrl) {
            URL.revokeObjectURL(chunk.blobUrl)
          }
        }
        audioQueueRef.current = []
        allChunksRef.current.clear()

        // Build sentences to regenerate from current position
        const remainingSentences: IndexedSentence[] = allSentencesRef.current
          .slice(currentIndex)
          .map((text, i) => ({ index: currentIndex + i, text }))

        if (remainingSentences.length === 0) return

        // Update state
        generationCompleteRef.current = false
        setState((prev) => ({ ...prev, status: 'generating', currentSentence: currentText }))

        // Detect capabilities and create new worker
        const capabilities = await detectCapabilities()

        workerRef.current = new TTSWorker()
        workerRef.current.onmessage = handleWorkerMessage
        workerRef.current.onerror = (event) => {
          console.error('[TTS] Worker error:', event)
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: `TTS worker crashed: ${event.message || 'Unknown error'}`,
          }))
          isPlayingRef.current = false
          setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
        }

        // Store pending generation with new voice
        pendingGenerationRef.current = { sentences: remainingSentences, voice }

        // Initialize model with new voice
        const initRequest: WorkerRequest = {
          type: 'initialize',
          options: {
            device: capabilities.recommended.device,
            dtype: capabilities.recommended.dtype,
            voice,
          },
        }
        workerRef.current.postMessage(initRequest)
      }
    },
    [handleWorkerMessage]
  )

  // Seek to a specific sentence by its text content
  const seek = useCallback(
    async (sentenceText: string) => {
      // Normalize the search text for comparison
      let normalizedSearch = sentenceText.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!normalizedSearch) return

      // If the search text contains multiple sentences (user clicked on a paragraph),
      // extract just the first sentence to find the right starting point.
      // Require punctuation to be followed by space or end-of-string to avoid
      // splitting on decimal numbers (9.6) or abbreviations (Dr. Smith).
      const sentenceEndMatch = normalizedSearch.match(/^.+?[.!?](?=\s|$)/)
      if (sentenceEndMatch) {
        const firstSentence = sentenceEndMatch[0].trim()
        // Use the first sentence if it's meaningful (not just an abbreviation)
        if (firstSentence.length >= 5) {
          normalizedSearch = firstSentence
        }
      }

      // Strip trailing punctuation (TTS adds periods to list items that don't have them)
      const stripPunctuation = (text: string) => text.replace(/[.!?:]+$/, '')

      // Normalize text to match TTS transformations (parentheses → commas)
      const normalizeTTSText = (text: string) =>
        text
          .replace(/\(/g, ', ')
          .replace(/\)/g, ', ')
          .replace(/,\s*,/g, ',')
          .replace(/,\s*([.!?])/g, '$1')
          .replace(/,\s*:/g, ':')
          .replace(/(^|[\n])(\s*),\s*/g, '$1$2')
          .replace(/\s+/g, ' ')
          .trim()

      // Score how well two texts match (higher = better match)
      // Returns 0 for no match, up to 100 for exact match
      const scoreMatch = (chunkText: string, searchText: string): number => {
        const chunkNoPunct = stripPunctuation(chunkText)
        const searchTextNoPunct = stripPunctuation(searchText)

        // Also try TTS-normalized versions (handles parentheses → commas transformation)
        const searchNormalized = normalizeTTSText(searchTextNoPunct).toLowerCase()
        const chunkNormalized = normalizeTTSText(chunkNoPunct).toLowerCase()

        // Exact match = perfect score
        if (chunkText === searchText || chunkNoPunct === searchTextNoPunct) {
          return 100
        }

        // Exact match after TTS normalization
        if (chunkNormalized === searchNormalized) {
          return 100
        }

        // One contains the other = very high score, weighted by length similarity
        // Check with TTS normalization too
        if (chunkNoPunct.includes(searchTextNoPunct) || chunkNormalized.includes(searchNormalized)) {
          const lengthRatio = searchTextNoPunct.length / chunkNoPunct.length
          return 90 * lengthRatio // Prefer when lengths are similar
        }
        if (searchTextNoPunct.includes(chunkNoPunct) || searchNormalized.includes(chunkNormalized)) {
          const lengthRatio = chunkNoPunct.length / searchTextNoPunct.length
          return 90 * lengthRatio
        }

        // Check if search starts with chunk or vice versa (partial match at beginning)
        // Use both raw and normalized versions
        const chunkPrefix = chunkNoPunct.slice(0, 50)
        const searchPrefix = searchTextNoPunct.slice(0, 50)
        const chunkNormalizedPrefix = chunkNormalized.slice(0, 50)
        const searchNormalizedPrefix = searchNormalized.slice(0, 50)

        if (
          chunkNoPunct.startsWith(searchPrefix) ||
          searchTextNoPunct.startsWith(chunkPrefix) ||
          chunkNormalized.startsWith(searchNormalizedPrefix) ||
          searchNormalized.startsWith(chunkNormalizedPrefix)
        ) {
          return 70
        }

        // Word overlap with length penalty
        // Normalize to handle TTS transformations in word matching
        const words1 = [...new Set(chunkNormalized.split(' ').filter((w) => w.length > 2))]
        const words2 = [...new Set(searchNormalized.split(' ').filter((w) => w.length > 2))]
        if (words1.length === 0 || words2.length === 0) return 0

        const matchingWords = words1.filter((w) => words2.includes(w))
        const overlapRatio = matchingWords.length / Math.max(words1.length, words2.length)

        // Length similarity factor (penalize big length differences)
        const lengthRatio = Math.min(words1.length, words2.length) / Math.max(words1.length, words2.length)

        // Combined score: overlap * length similarity
        // Lower threshold since TTS normalization helps match better
        if (overlapRatio < 0.4) return 0

        return overlapRatio * lengthRatio * 60 // Max 60 for word overlap matches
      }

      // Find the best matching sentence in the full document
      const MIN_SCORE = 25 // Minimum score to consider a match
      let bestSentenceIndex = -1
      let bestSentenceScore = 0

      for (let i = 0; i < allSentencesRef.current.length; i++) {
        const sentence = allSentencesRef.current[i]
        const normalizedSentence = sentence.replace(/\s+/g, ' ').trim().toLowerCase()
        const score = scoreMatch(normalizedSentence, normalizedSearch)

        if (score > bestSentenceScore && score >= MIN_SCORE) {
          bestSentenceScore = score
          bestSentenceIndex = i
        }
      }

      if (bestSentenceIndex === -1) {
        console.log('[TTS] Cannot seek - sentence not found in text')
        return
      }

      const targetIndex = bestSentenceIndex
      console.log('[TTS] Seeking to sentence', targetIndex)

      // Stop current HTMLAudioElement playback
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        audioElementRef.current.src = ''
      }

      // Stop current worker generation
      if (workerRef.current) {
        const stopRequest: WorkerRequest = { type: 'stop' }
        workerRef.current.postMessage(stopRequest)
        workerRef.current.terminate()
        workerRef.current = null
      }

      // Clear current queue (but keep allChunksRef - the buffer!)
      audioQueueRef.current = []

      // Build the playback queue from targetIndex onwards
      // Use existing buffered chunks where available
      const newQueue: AudioChunk[] = []
      const missingSentences: IndexedSentence[] = []

      for (let i = targetIndex; i < allSentencesRef.current.length; i++) {
        const existingChunk = allChunksRef.current.get(i)
        if (existingChunk) {
          // Use the existing buffered chunk
          newQueue.push(existingChunk)
        } else {
          // Need to generate this sentence
          missingSentences.push({
            index: i,
            text: allSentencesRef.current[i],
          })
        }
      }

      audioQueueRef.current = newQueue

      // Calculate played duration up to target (using buffered chunks where available)
      playedDurationRef.current = 0
      for (let i = 0; i < targetIndex; i++) {
        const chunk = allChunksRef.current.get(i)
        if (chunk) {
          playedDurationRef.current += chunk.duration
        }
      }

      currentChunkIndexRef.current = targetIndex
      isStartingChunkRef.current = false // Reset guard for fresh start

      // Update playback progress
      const totalSentences = allSentencesRef.current.length
      const playbackProgress = totalSentences > 0 ? (targetIndex / totalSentences) * 100 : 0
      setPlaybackState((prev) => ({ ...prev, playbackProgress }))

      // If we have audio in the queue, start playing
      if (newQueue.length > 0) {
        isPlayingRef.current = true
        isPausedRef.current = false
        setState((prev) => ({ ...prev, status: 'playing' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
        playNextChunk()
      }

      // If there are missing sentences, start generating them
      if (missingSentences.length > 0) {
        console.log('[TTS] Need to generate', missingSentences.length, 'missing sentences')

        // Update state to show generation if not already playing
        if (newQueue.length === 0) {
          setState((prev) => ({
            ...prev,
            status: 'generating',
            currentSentence: null,
            generationProgress: 0,
          }))
          isPlayingRef.current = false
        }

        generationCompleteRef.current = false

        // Detect capabilities and create new worker
        const capabilities = await detectCapabilities()

        workerRef.current = new TTSWorker()
        workerRef.current.onmessage = handleWorkerMessage
        workerRef.current.onerror = (event) => {
          console.error('[TTS] Worker error:', event)
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: `TTS worker crashed: ${event.message || 'Unknown error'}`,
          }))
          isPlayingRef.current = false
          setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
        }

        // Store the pending generation with only missing sentences and current voice
        pendingGenerationRef.current = { sentences: missingSentences, voice: currentVoiceRef.current }

        // Initialize model with current voice
        const initRequest: WorkerRequest = {
          type: 'initialize',
          options: {
            device: capabilities.recommended.device,
            dtype: capabilities.recommended.dtype,
            voice: currentVoiceRef.current,
          },
        }
        workerRef.current.postMessage(initRequest)
      } else {
        // All sentences already buffered
        generationCompleteRef.current = true
        console.log('[TTS] All sentences already buffered, no generation needed')
      }
    },
    [playNextChunk, handleWorkerMessage]
  )

  return {
    state,
    playbackState,
    availableVoices,
    currentVoice,
    start,
    pause,
    resume,
    stop,
    setPlaybackRate,
    setPitch,
    setVoice,
    seek,
  }
}
