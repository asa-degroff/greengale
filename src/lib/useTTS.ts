/**
 * React hook for Text-to-Speech using Kokoro TTS
 *
 * Manages Web Worker lifecycle, audio playback via Web Audio API,
 * and streaming audio chunk buffering.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { WorkerRequest, WorkerMessage, TTSState, PlaybackRate } from './tts'
import { initialTTSState, detectCapabilities, SAMPLE_RATE, DEFAULT_VOICE } from './tts'
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
}

// Minimum chunks to buffer before starting playback
const MIN_BUFFER_CHUNKS = 2

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (schedulerIntervalRef.current) {
        clearInterval(schedulerIntervalRef.current)
        schedulerIntervalRef.current = null
      }
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

    // Schedule all available chunks ahead of time (up to 2 seconds ahead)
    const scheduleAheadTime = 2.0
    while (queue.length > 0 && scheduledEndTimeRef.current < currentTime + scheduleAheadTime) {
      const chunk = queue.shift()
      if (!chunk) break

      const buffer = ctx.createBuffer(1, chunk.audio.length, SAMPLE_RATE)
      buffer.getChannelData(0).set(chunk.audio)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = playbackRateRef.current
      source.connect(gainNode)

      // Start at the end of previously scheduled audio, or now if nothing scheduled
      const startTime = Math.max(currentTime + 0.01, scheduledEndTimeRef.current)
      const duration = buffer.duration / playbackRateRef.current

      source.start(startTime)
      scheduledSourcesRef.current.push(source)

      scheduledEndTimeRef.current = startTime + duration
      totalScheduledDurationRef.current += duration

      // Update current sentence when this chunk starts playing
      const chunkText = chunk.text
      const chunkIndex = chunk.sentenceIndex
      source.onended = () => {
        // Remove from scheduled sources
        const idx = scheduledSourcesRef.current.indexOf(source)
        if (idx > -1) scheduledSourcesRef.current.splice(idx, 1)
      }

      // Update state with current sentence
      setState((prev) => ({
        ...prev,
        currentSentence: chunkText,
        sentenceIndex: chunkIndex,
      }))
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
    const queue = audioQueueRef.current
    if (queue.length >= MIN_BUFFER_CHUNKS && !isPlayingRef.current) {
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
          setState((prev) => ({
            ...prev,
            status: prev.status === 'playing' ? 'playing' : 'generating',
            generationProgress: message.progress,
            sentenceIndex: message.sentenceIndex,
            totalSentences: message.totalSentences,
            currentSentence: message.currentSentence,
          }))
          break

        case 'audio-chunk':
          audioQueueRef.current.push({
            audio: message.audio,
            text: message.text,
            sentenceIndex: message.sentenceIndex,
          })

          // Try to start playback if we have enough buffered
          tryStartPlayback()

          // If already playing, try to schedule more chunks immediately
          if (isPlayingRef.current && !isPausedRef.current) {
            scheduleChunks()
          }
          break

        case 'generation-complete':
          generationCompleteRef.current = true
          setState((prev) => ({
            ...prev,
            generationProgress: 100,
          }))

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

    // Update all scheduled sources
    for (const source of scheduledSourcesRef.current) {
      source.playbackRate.value = rate
    }
  }, [])

  return {
    state,
    playbackState,
    start,
    pause,
    resume,
    stop,
    setPlaybackRate,
  }
}
