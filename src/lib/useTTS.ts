/**
 * React hook for Text-to-Speech using Kokoro TTS
 *
 * Manages Web Worker lifecycle, audio playback via Web Audio API,
 * and streaming audio chunk buffering.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { WorkerRequest, WorkerMessage, TTSState, PlaybackRate } from './tts'
import { initialTTSState, detectCapabilities, SAMPLE_RATE, DEFAULT_VOICE, splitIntoSentences } from './tts'
import TTSWorker from './tts.worker?worker'

interface AudioChunk {
  audio: Float32Array
  text: string
  sentenceIndex: number
}

interface PendingGeneration {
  text: string
  voice?: string
}

interface UseTTSReturn {
  state: TTSState
  playbackState: {
    isPlaying: boolean
    currentTime: number
    duration: number
    playbackRate: PlaybackRate
  }
  start: (text: string) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  setPlaybackRate: (rate: PlaybackRate) => void
  seek: (sentenceText: string) => void
}

// Minimum seconds of audio to buffer before starting playback
// This helps prevent gaps when short sentences are followed by long ones
const MIN_BUFFER_SECONDS = 20
const SAMPLE_RATE_FOR_CALC = 24000

/**
 * Calculate detune value (in cents) to compensate for pitch change from playback rate.
 * When playback rate changes, pitch naturally shifts. This returns the detune needed
 * to maintain the original pitch.
 *
 * Formula: detune = -1200 * log2(playbackRate)
 * - At 2x speed, pitch goes up 12 semitones, so we detune -1200 cents (down 12 semitones)
 * - At 0.5x speed, pitch goes down 12 semitones, so we detune +1200 cents (up 12 semitones)
 */
function calculatePitchCompensation(playbackRate: number): number {
  if (playbackRate <= 0 || playbackRate === 1) return 0
  return -1200 * Math.log2(playbackRate)
}

export function useTTS(): UseTTSReturn {
  const [state, setState] = useState<TTSState>(initialTTSState)
  const [playbackState, setPlaybackState] = useState({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0 as PlaybackRate,
  })

  const workerRef = useRef<Worker | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const audioQueueRef = useRef<AudioChunk[]>([])
  const allChunksRef = useRef<AudioChunk[]>([]) // Store all generated chunks for seeking
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const scheduledEndTimeRef = useRef<number>(0)
  const isPlayingRef = useRef(false)
  const playbackStartTimeRef = useRef(0)
  const totalScheduledDurationRef = useRef(0)
  const playbackRateRef = useRef<PlaybackRate>(1.0)
  const isPausedRef = useRef(false)
  const pausedAtRef = useRef(0)
  const pendingGenerationRef = useRef<PendingGeneration | null>(null)
  const schedulerIntervalRef = useRef<number | null>(null)
  const generationCompleteRef = useRef(false)
  const sentenceTimeoutsRef = useRef<number[]>([])
  const originalTextRef = useRef<string>('') // Store original text for seeking to un-generated sentences
  const allSentencesRef = useRef<string[]>([]) // Store all sentences for seeking

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (schedulerIntervalRef.current) {
        clearInterval(schedulerIntervalRef.current)
        schedulerIntervalRef.current = null
      }
      for (const timeoutId of sentenceTimeoutsRef.current) {
        clearTimeout(timeoutId)
      }
      sentenceTimeoutsRef.current = []
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [])

  const getOrCreateAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioContextClass =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      audioContextRef.current = new AudioContextClass({ sampleRate: SAMPLE_RATE })
      gainNodeRef.current = audioContextRef.current.createGain()
      gainNodeRef.current.connect(audioContextRef.current.destination)
    }
    return audioContextRef.current
  }, [])

  // Schedule chunks continuously - called by interval
  const scheduleChunks = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return

    const ctx = audioContextRef.current
    const gainNode = gainNodeRef.current
    if (!ctx || !gainNode || ctx.state === 'closed') return

    const queue = audioQueueRef.current
    const currentTime = ctx.currentTime

    // Schedule all available chunks ahead of time (up to 10 seconds ahead)
    const scheduleAheadTime = 10.0
    while (queue.length > 0 && scheduledEndTimeRef.current < currentTime + scheduleAheadTime) {
      const chunk = queue.shift()
      if (!chunk) break

      const buffer = ctx.createBuffer(1, chunk.audio.length, SAMPLE_RATE)
      buffer.getChannelData(0).set(chunk.audio)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = playbackRateRef.current
      // Compensate pitch to maintain natural voice at different speeds
      source.detune.value = calculatePitchCompensation(playbackRateRef.current)
      source.connect(gainNode)

      // Start at the end of previously scheduled audio, or now if nothing scheduled
      const startTime = Math.max(currentTime + 0.01, scheduledEndTimeRef.current)
      const duration = buffer.duration / playbackRateRef.current

      source.start(startTime)
      scheduledSourcesRef.current.push(source)

      scheduledEndTimeRef.current = startTime + duration
      totalScheduledDurationRef.current += duration

      // Update current sentence when this chunk actually starts playing (not when scheduled)
      const chunkText = chunk.text
      const chunkIndex = chunk.sentenceIndex
      const delayUntilStart = (startTime - currentTime) * 1000 // Convert to milliseconds

      // Schedule the sentence update for when the audio actually starts
      const timeoutId = window.setTimeout(() => {
        // Remove this timeout from tracking
        const idx = sentenceTimeoutsRef.current.indexOf(timeoutId)
        if (idx > -1) sentenceTimeoutsRef.current.splice(idx, 1)

        // Only update if we're still playing and not paused
        if (isPlayingRef.current && !isPausedRef.current) {
          setState((prev) => ({
            ...prev,
            currentSentence: chunkText,
            sentenceIndex: chunkIndex,
          }))
        }
      }, Math.max(0, delayUntilStart))
      sentenceTimeoutsRef.current.push(timeoutId)

      source.onended = () => {
        // Remove from scheduled sources
        const idx = scheduledSourcesRef.current.indexOf(source)
        if (idx > -1) scheduledSourcesRef.current.splice(idx, 1)
      }
    }

    // Update playback time based on audio context time
    if (playbackStartTimeRef.current > 0) {
      const elapsed = (currentTime - playbackStartTimeRef.current) * playbackRateRef.current
      setPlaybackState((prev) => ({
        ...prev,
        currentTime: Math.min(elapsed, totalScheduledDurationRef.current),
        duration: totalScheduledDurationRef.current,
        isPlaying: true,
      }))
    }

    // Check if we're done (no more chunks and generation complete)
    if (queue.length === 0 && generationCompleteRef.current) {
      // Check if all scheduled audio has finished playing
      if (currentTime >= scheduledEndTimeRef.current) {
        stopScheduler()
        setState((prev) => ({ ...prev, status: 'idle' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
        isPlayingRef.current = false
      }
    }
  }, [])

  const startScheduler = useCallback(() => {
    if (schedulerIntervalRef.current) return
    // Run scheduler every 100ms to check for new chunks
    schedulerIntervalRef.current = window.setInterval(scheduleChunks, 100)
  }, [scheduleChunks])

  const stopScheduler = useCallback(() => {
    if (schedulerIntervalRef.current) {
      clearInterval(schedulerIntervalRef.current)
      schedulerIntervalRef.current = null
    }
  }, [])

  const tryStartPlayback = useCallback(() => {
    if (isPlayingRef.current) return

    const queue = audioQueueRef.current
    if (queue.length === 0) return

    // Calculate total buffered duration
    const bufferedSamples = queue.reduce((sum, chunk) => sum + chunk.audio.length, 0)
    const bufferedSeconds = bufferedSamples / SAMPLE_RATE_FOR_CALC

    // Start playback if we have enough buffer OR if generation is complete
    const hasEnoughBuffer = bufferedSeconds >= MIN_BUFFER_SECONDS
    const generationDone = generationCompleteRef.current

    if (hasEnoughBuffer || generationDone) {
      isPlayingRef.current = true
      isPausedRef.current = false
      const ctx = getOrCreateAudioContext()
      if (ctx.state === 'suspended') {
        ctx.resume()
      }
      playbackStartTimeRef.current = ctx.currentTime
      scheduledEndTimeRef.current = ctx.currentTime
      setState((prev) => ({ ...prev, status: 'playing' }))
      setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
      startScheduler()
      scheduleChunks() // Schedule immediately
    }
  }, [getOrCreateAudioContext, startScheduler, scheduleChunks])

  const handleWorkerMessage = useCallback(
    (event: MessageEvent<WorkerMessage>) => {
      const message = event.data

      switch (message.type) {
        case 'model-progress':
          setState((prev) => ({
            ...prev,
            status: 'loading-model',
            modelProgress: message.progress,
          }))
          break

        case 'model-ready':
          setState((prev) => ({
            ...prev,
            status: 'generating',
            modelProgress: 100,
            isModelCached: message.cachedFromIndexedDB,
          }))

          // Now that model is ready, send the pending generation request
          if (pendingGenerationRef.current && workerRef.current) {
            const generateRequest: WorkerRequest = {
              type: 'generate',
              text: pendingGenerationRef.current.text,
              voice: pendingGenerationRef.current.voice,
            }
            workerRef.current.postMessage(generateRequest)
            pendingGenerationRef.current = null
          }
          break

        case 'generation-progress':
          // Only update generation progress, not currentSentence
          // currentSentence is updated in scheduleChunks when audio actually plays
          setState((prev) => ({
            ...prev,
            status: prev.status === 'playing' ? 'playing' : 'generating',
            generationProgress: message.progress,
            totalSentences: message.totalSentences,
          }))
          break

        case 'audio-chunk': {
          const chunk: AudioChunk = {
            audio: message.audio,
            text: message.text,
            sentenceIndex: message.sentenceIndex,
          }
          audioQueueRef.current.push(chunk)
          allChunksRef.current.push(chunk) // Store for seeking

          // Try to start playback if we have enough buffered
          tryStartPlayback()

          // If already playing, try to schedule more chunks immediately
          if (isPlayingRef.current && !isPausedRef.current) {
            scheduleChunks()
          }
          break
        }

        case 'generation-complete':
          generationCompleteRef.current = true
          setState((prev) => ({
            ...prev,
            generationProgress: 100,
          }))

          // If we have buffered audio but haven't started playing yet
          // (content was shorter than MIN_BUFFER_SECONDS), start now
          if (!isPlayingRef.current && audioQueueRef.current.length > 0) {
            tryStartPlayback()
          }

          // If queue is empty and we're not playing, we're done
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            setState((prev) => ({ ...prev, status: 'idle' }))
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
    [tryStartPlayback, scheduleChunks]
  )

  const start = useCallback(
    async (text: string) => {
      // IMPORTANT: Create AudioContext immediately during user gesture
      // Modern browsers require this to be done during user interaction
      const ctx = getOrCreateAudioContext()
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      // Stop any existing scheduler
      stopScheduler()

      // Reset state
      setState({ ...initialTTSState, status: 'loading-model' })
      audioQueueRef.current = []
      allChunksRef.current = [] // Clear stored chunks for new session
      originalTextRef.current = text // Store for seeking
      allSentencesRef.current = splitIntoSentences(text) // Pre-split for seeking
      totalScheduledDurationRef.current = 0
      playbackStartTimeRef.current = 0
      scheduledEndTimeRef.current = 0
      generationCompleteRef.current = false
      isPlayingRef.current = false
      isPausedRef.current = false

      // Stop any scheduled sources
      for (const source of scheduledSourcesRef.current) {
        try {
          source.stop()
        } catch {
          // Source may have already ended
        }
      }
      scheduledSourcesRef.current = []

      setPlaybackState({
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        playbackRate: playbackRateRef.current,
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

      // Store the pending generation - will be sent when model is ready
      pendingGenerationRef.current = { text }

      // Initialize model
      const initRequest: WorkerRequest = {
        type: 'initialize',
        options: {
          device: capabilities.recommended.device,
          dtype: capabilities.recommended.dtype,
          voice: DEFAULT_VOICE,
        },
      }
      workerRef.current.postMessage(initRequest)
    },
    [handleWorkerMessage, stopScheduler, getOrCreateAudioContext]
  )

  const pause = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return

    isPausedRef.current = true
    pausedAtRef.current = audioContextRef.current?.currentTime || 0

    // Stop the scheduler
    stopScheduler()

    // Clear pending sentence timeouts
    for (const timeoutId of sentenceTimeoutsRef.current) {
      clearTimeout(timeoutId)
    }
    sentenceTimeoutsRef.current = []

    // Suspend audio context (this pauses all scheduled sources)
    if (audioContextRef.current) {
      audioContextRef.current.suspend()
    }

    setState((prev) => ({ ...prev, status: 'paused' }))
    setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
  }, [stopScheduler])

  const resume = useCallback(() => {
    if (!isPausedRef.current) return

    isPausedRef.current = false

    if (audioContextRef.current) {
      audioContextRef.current.resume().then(() => {
        setState((prev) => ({ ...prev, status: 'playing' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
        // Restart the scheduler
        startScheduler()
        scheduleChunks()
      })
    }
  }, [startScheduler, scheduleChunks])

  const stop = useCallback(() => {
    // Stop the scheduler
    stopScheduler()

    // Clear pending sentence timeouts
    for (const timeoutId of sentenceTimeoutsRef.current) {
      clearTimeout(timeoutId)
    }
    sentenceTimeoutsRef.current = []

    // Stop the worker
    if (workerRef.current) {
      const stopRequest: WorkerRequest = { type: 'stop' }
      workerRef.current.postMessage(stopRequest)
      workerRef.current.terminate()
      workerRef.current = null
    }

    // Stop all scheduled audio sources
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop()
      } catch {
        // Source may have already ended
      }
    }
    scheduledSourcesRef.current = []

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    // Reset state
    audioQueueRef.current = []
    isPlayingRef.current = false
    isPausedRef.current = false
    totalScheduledDurationRef.current = 0
    playbackStartTimeRef.current = 0
    scheduledEndTimeRef.current = 0
    generationCompleteRef.current = false
    pendingGenerationRef.current = null

    setState(initialTTSState)
    setPlaybackState({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackRate: playbackRateRef.current,
    })
  }, [stopScheduler])

  const setPlaybackRate = useCallback((rate: PlaybackRate) => {
    playbackRateRef.current = rate
    setPlaybackState((prev) => ({ ...prev, playbackRate: rate }))

    // Update all scheduled sources with new rate and pitch compensation
    const detune = calculatePitchCompensation(rate)
    for (const source of scheduledSourcesRef.current) {
      source.playbackRate.value = rate
      source.detune.value = detune
    }
  }, [])

  // Seek to a specific sentence by its text content
  const seek = useCallback(
    async (sentenceText: string) => {
      // Normalize the search text for comparison
      const normalizedSearch = sentenceText.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!normalizedSearch) return

      // Strip trailing punctuation (TTS adds periods to list items that don't have them)
      const stripPunctuation = (text: string) => text.replace(/[.!?:]+$/, '')

      // Helper to check if two texts match
      const textsMatch = (text1: string, text2: string): boolean => {
        // Try includes check with and without trailing punctuation
        const text1NoPunct = stripPunctuation(text1)
        const text2NoPunct = stripPunctuation(text2)

        if (text1.includes(text2) || text2.includes(text1)) return true
        if (text1NoPunct.includes(text2NoPunct) || text2NoPunct.includes(text1NoPunct)) return true
        if (text1NoPunct === text2NoPunct) return true

        // Check for significant word overlap using UNIQUE words only
        // (prevents "the" appearing twice from inflating the match ratio)
        const words1 = [...new Set(text1NoPunct.split(' ').filter(w => w.length > 2))]
        const words2 = [...new Set(text2NoPunct.split(' ').filter(w => w.length > 2))]
        if (words1.length === 0 || words2.length === 0) return false

        const matchingWords = words1.filter(w => words2.includes(w))
        const overlapRatio = matchingWords.length / Math.min(words1.length, words2.length)

        // Require higher overlap for short phrases (they're more likely to have false matches)
        const minRatio = words1.length <= 4 ? 0.8 : 0.6
        return overlapRatio >= minRatio
      }

      // Find the matching chunk in allChunks (already generated)
      const chunkIndex = allChunksRef.current.findIndex((chunk) => {
        const normalizedChunk = chunk.text.replace(/\s+/g, ' ').trim().toLowerCase()
        return textsMatch(normalizedChunk, normalizedSearch)
      })

      // Stop the scheduler and clear pending sentence timeouts
      stopScheduler()
      for (const timeoutId of sentenceTimeoutsRef.current) {
        clearTimeout(timeoutId)
      }
      sentenceTimeoutsRef.current = []

      // Stop all currently scheduled audio sources
      for (const source of scheduledSourcesRef.current) {
        try {
          source.stop()
        } catch {
          // Source may have already ended
        }
      }
      scheduledSourcesRef.current = []

      if (chunkIndex !== -1) {
        // Sentence already generated - seek to it
        console.log('[TTS] Seeking to generated sentence at index', chunkIndex)

        // Rebuild the audio queue from the selected sentence onwards
        audioQueueRef.current = allChunksRef.current.slice(chunkIndex).map((chunk) => ({
          audio: chunk.audio,
          text: chunk.text,
          sentenceIndex: chunk.sentenceIndex,
        }))

        // Reset playback timing
        const ctx = audioContextRef.current
        if (ctx) {
          totalScheduledDurationRef.current = 0
          playbackStartTimeRef.current = ctx.currentTime
          scheduledEndTimeRef.current = ctx.currentTime

          // If paused, resume the audio context
          if (isPausedRef.current) {
            isPausedRef.current = false
            ctx.resume()
          }

          // Ensure we're in playing state
          isPlayingRef.current = true
          setState((prev) => ({ ...prev, status: 'playing' }))
          setPlaybackState((prev) => ({ ...prev, isPlaying: true }))

          // Start the scheduler and schedule chunks immediately
          startScheduler()
          scheduleChunks()
        }
      } else {
        // Sentence not yet generated - find it in allSentences and restart generation
        const sentenceIndex = allSentencesRef.current.findIndex((sentence) => {
          const normalizedSentence = sentence.replace(/\s+/g, ' ').trim().toLowerCase()
          return textsMatch(normalizedSentence, normalizedSearch)
        })

        if (sentenceIndex === -1) {
          console.log('[TTS] Cannot seek - sentence not found in text')
          return
        }

        console.log('[TTS] Seeking to un-generated sentence at index', sentenceIndex, '- restarting generation')

        // Stop the current worker
        if (workerRef.current) {
          workerRef.current.terminate()
          workerRef.current = null
        }

        // Clear audio state but keep the AudioContext
        audioQueueRef.current = []
        allChunksRef.current = []
        totalScheduledDurationRef.current = 0
        generationCompleteRef.current = false
        isPlayingRef.current = false

        // Update UI state
        setState((prev) => ({
          ...prev,
          status: 'generating',
          currentSentence: null,
          sentenceIndex: 0,
          generationProgress: 0,
        }))

        // Get the text from the target sentence onwards
        // Keep allSentencesRef intact so we can seek back to earlier sentences
        const remainingSentences = allSentencesRef.current.slice(sentenceIndex)
        const remainingText = remainingSentences.join(' ')

        // Detect capabilities and create new worker
        const capabilities = await detectCapabilities()

        workerRef.current = new TTSWorker()
        workerRef.current.onmessage = handleWorkerMessage

        // Store the pending generation
        pendingGenerationRef.current = { text: remainingText }

        // Initialize model (will trigger generation when ready)
        const initRequest: WorkerRequest = {
          type: 'initialize',
          options: {
            device: capabilities.recommended.device,
            dtype: capabilities.recommended.dtype,
            voice: DEFAULT_VOICE,
          },
        }
        workerRef.current.postMessage(initRequest)

        // Reset playback timing for when audio starts
        const ctx = audioContextRef.current
        if (ctx) {
          playbackStartTimeRef.current = ctx.currentTime
          scheduledEndTimeRef.current = ctx.currentTime
          if (isPausedRef.current) {
            isPausedRef.current = false
            ctx.resume()
          }
        }
      }
    },
    [stopScheduler, startScheduler, scheduleChunks, handleWorkerMessage]
  )

  return {
    state,
    playbackState,
    start,
    pause,
    resume,
    stop,
    setPlaybackRate,
    seek,
  }
}
