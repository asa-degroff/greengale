/**
 * React hook for Text-to-Speech using Kokoro TTS
 *
 * Manages Web Worker lifecycle and audio playback via HTMLAudioElement
 * with preservesPitch for pitch-compensated speed changes.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { WorkerRequest, WorkerMessage, TTSState, PlaybackRate } from './tts'
import {
  initialTTSState,
  detectCapabilities,
  SAMPLE_RATE,
  DEFAULT_VOICE,
  splitIntoSentences,
  float32ToWavBlob,
} from './tts'
import TTSWorker from './tts.worker?worker'

interface AudioChunk {
  audio: Float32Array
  blobUrl: string
  text: string
  sentenceIndex: number
  duration: number // in seconds
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
const MIN_BUFFER_SECONDS = 20
const SAMPLE_RATE_FOR_CALC = 24000

export function useTTS(): UseTTSReturn {
  const [state, setState] = useState<TTSState>(initialTTSState)
  const [playbackState, setPlaybackState] = useState({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0 as PlaybackRate,
  })

  const workerRef = useRef<Worker | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioQueueRef = useRef<AudioChunk[]>([])
  const allChunksRef = useRef<AudioChunk[]>([]) // Store all generated chunks for seeking
  const currentChunkIndexRef = useRef<number>(0) // Index into allChunksRef for current playback position
  const isPlayingRef = useRef(false)
  const playbackRateRef = useRef<PlaybackRate>(1.0)
  const isPausedRef = useRef(false)
  const pendingGenerationRef = useRef<PendingGeneration | null>(null)
  const generationCompleteRef = useRef(false)
  const originalTextRef = useRef<string>('')
  const allSentencesRef = useRef<string[]>([])
  const totalDurationRef = useRef<number>(0)
  const playedDurationRef = useRef<number>(0)
  const playbackIntervalRef = useRef<number | null>(null)

  // Get or create audio element
  const getOrCreateAudioElement = useCallback(() => {
    if (!audioElementRef.current) {
      const audio = new Audio()
      audio.preservesPitch = true
      // Also set vendor-prefixed versions for broader compatibility
      ;(audio as HTMLAudioElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = true
      ;(audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true
      audioElementRef.current = audio
    }
    return audioElementRef.current
  }, [])

  // Cleanup blob URLs
  const cleanupBlobUrl = useCallback((url: string) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }, [])

  // Play the next chunk in the queue
  const playNextChunk = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return

    const queue = audioQueueRef.current
    if (queue.length === 0) {
      // No more chunks to play
      if (generationCompleteRef.current) {
        // All done
        isPlayingRef.current = false
        setState((prev) => ({ ...prev, status: 'idle', currentSentence: null }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
        if (playbackIntervalRef.current) {
          clearInterval(playbackIntervalRef.current)
          playbackIntervalRef.current = null
        }
      }
      return
    }

    const chunk = queue.shift()!
    currentChunkIndexRef.current = chunk.sentenceIndex

    const audio = getOrCreateAudioElement()

    // Clean up previous blob URL
    if (audio.src && audio.src.startsWith('blob:')) {
      cleanupBlobUrl(audio.src)
    }

    // Set up the new audio
    audio.src = chunk.blobUrl
    audio.playbackRate = playbackRateRef.current

    // Update current sentence
    setState((prev) => ({
      ...prev,
      status: 'playing',
      currentSentence: chunk.text,
      sentenceIndex: chunk.sentenceIndex,
    }))

    // Handle chunk end
    audio.onended = () => {
      playedDurationRef.current += chunk.duration
      cleanupBlobUrl(chunk.blobUrl)
      playNextChunk()
    }

    audio.onerror = () => {
      console.error('[TTS] Audio playback error')
      cleanupBlobUrl(chunk.blobUrl)
      playNextChunk() // Try next chunk
    }

    audio.play().catch((err) => {
      console.error('[TTS] Failed to play audio:', err)
      playNextChunk()
    })
  }, [getOrCreateAudioElement, cleanupBlobUrl])

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

      // Start playback time tracking
      if (!playbackIntervalRef.current) {
        playbackIntervalRef.current = window.setInterval(() => {
          const audio = audioElementRef.current
          if (audio && isPlayingRef.current && !isPausedRef.current) {
            const currentChunkTime = audio.currentTime / playbackRateRef.current
            const totalTime = playedDurationRef.current + currentChunkTime
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

          // Send pending generation request
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
            totalSentences: message.totalSentences,
          }))
          break

        case 'audio-chunk': {
          // Convert Float32Array to WAV blob
          const wavBlob = float32ToWavBlob(message.audio, SAMPLE_RATE)
          const blobUrl = URL.createObjectURL(wavBlob)
          const duration = message.audio.length / SAMPLE_RATE_FOR_CALC

          const chunk: AudioChunk = {
            audio: message.audio,
            blobUrl,
            text: message.text,
            sentenceIndex: message.sentenceIndex,
            duration,
          }

          audioQueueRef.current.push(chunk)
          allChunksRef.current.push(chunk)
          totalDurationRef.current += duration

          // Try to start playback if we have enough buffered
          tryStartPlayback()
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
    [tryStartPlayback]
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
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        if (audioElementRef.current.src) {
          cleanupBlobUrl(audioElementRef.current.src)
        }
        audioElementRef.current = null
      }
      // Clean up any remaining blob URLs
      for (const chunk of audioQueueRef.current) {
        cleanupBlobUrl(chunk.blobUrl)
      }
      for (const chunk of allChunksRef.current) {
        cleanupBlobUrl(chunk.blobUrl)
      }
    }
  }, [cleanupBlobUrl])

  const start = useCallback(
    async (text: string) => {
      // Reset state
      setState({ ...initialTTSState, status: 'loading-model' })

      // Clean up existing blob URLs
      for (const chunk of audioQueueRef.current) {
        cleanupBlobUrl(chunk.blobUrl)
      }
      for (const chunk of allChunksRef.current) {
        cleanupBlobUrl(chunk.blobUrl)
      }

      audioQueueRef.current = []
      allChunksRef.current = []
      originalTextRef.current = text
      allSentencesRef.current = splitIntoSentences(text)
      generationCompleteRef.current = false
      isPlayingRef.current = false
      isPausedRef.current = false
      totalDurationRef.current = 0
      playedDurationRef.current = 0
      currentChunkIndexRef.current = 0

      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }

      // Stop existing audio
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        if (audioElementRef.current.src) {
          cleanupBlobUrl(audioElementRef.current.src)
        }
        audioElementRef.current.src = ''
      }

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

      // Store pending generation
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
    [handleWorkerMessage, cleanupBlobUrl]
  )

  const pause = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return

    isPausedRef.current = true
    const audio = audioElementRef.current
    if (audio) {
      audio.pause()
    }

    setState((prev) => ({ ...prev, status: 'paused' }))
    setPlaybackState((prev) => ({ ...prev, isPlaying: false }))
  }, [])

  const resume = useCallback(() => {
    if (!isPausedRef.current) return

    isPausedRef.current = false
    const audio = audioElementRef.current

    if (audio && audio.src) {
      audio.play().then(() => {
        setState((prev) => ({ ...prev, status: 'playing' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
      })
    } else {
      // No current audio, try to play next chunk
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

    // Stop audio
    if (audioElementRef.current) {
      audioElementRef.current.pause()
      if (audioElementRef.current.src) {
        cleanupBlobUrl(audioElementRef.current.src)
      }
      audioElementRef.current.src = ''
    }

    // Clean up blob URLs
    for (const chunk of audioQueueRef.current) {
      cleanupBlobUrl(chunk.blobUrl)
    }
    for (const chunk of allChunksRef.current) {
      cleanupBlobUrl(chunk.blobUrl)
    }

    // Reset state
    audioQueueRef.current = []
    allChunksRef.current = []
    isPlayingRef.current = false
    isPausedRef.current = false
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
    })
  }, [cleanupBlobUrl])

  const setPlaybackRate = useCallback((rate: PlaybackRate) => {
    playbackRateRef.current = rate
    setPlaybackState((prev) => ({ ...prev, playbackRate: rate }))

    // Update current audio element's playback rate
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = rate
    }
  }, [])

  // Seek to a specific sentence by its text content
  const seek = useCallback(
    async (sentenceText: string) => {
      // Normalize the search text for comparison
      let normalizedSearch = sentenceText.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!normalizedSearch) return

      // If the search text contains multiple sentences (user clicked on a paragraph),
      // extract just the first sentence to find the right starting point
      const sentenceEndMatch = normalizedSearch.match(/^[^.!?]+[.!?]/)
      if (sentenceEndMatch) {
        const firstSentence = sentenceEndMatch[0].trim()
        // Only use the first sentence if it's substantial (not just a word or two)
        if (firstSentence.length > 20) {
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

      // Find the best matching chunk (highest score above threshold)
      let bestChunkIndex = -1
      let bestScore = 0
      const MIN_SCORE = 25 // Minimum score to consider a match

      for (let i = 0; i < allChunksRef.current.length; i++) {
        const chunk = allChunksRef.current[i]
        const normalizedChunk = chunk.text.replace(/\s+/g, ' ').trim().toLowerCase()
        const score = scoreMatch(normalizedChunk, normalizedSearch)

        if (score > bestScore && score >= MIN_SCORE) {
          bestScore = score
          bestChunkIndex = i
        }
      }

      const chunkIndex = bestChunkIndex

      // Stop current playback
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        audioElementRef.current.onended = null
      }

      if (chunkIndex !== -1) {
        // Sentence already generated - seek to it
        console.log('[TTS] Seeking to chunk', chunkIndex)

        // Rebuild the audio queue from the selected sentence onwards
        // We need to recreate blob URLs since they may have been revoked
        audioQueueRef.current = allChunksRef.current.slice(chunkIndex).map((chunk) => {
          // Create a new blob URL if the old one was revoked
          const wavBlob = float32ToWavBlob(chunk.audio, SAMPLE_RATE)
          const blobUrl = URL.createObjectURL(wavBlob)
          return {
            ...chunk,
            blobUrl,
          }
        })

        // Calculate played duration up to this point
        playedDurationRef.current = allChunksRef.current
          .slice(0, chunkIndex)
          .reduce((sum, c) => sum + c.duration, 0)

        currentChunkIndexRef.current = chunkIndex

        // Resume playback
        isPlayingRef.current = true
        isPausedRef.current = false
        setState((prev) => ({ ...prev, status: 'playing' }))
        setPlaybackState((prev) => ({ ...prev, isPlaying: true }))
        playNextChunk()
      } else {
        // Sentence not yet generated - find best match in allSentences and restart generation
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

        const sentenceIndex = bestSentenceIndex

        if (sentenceIndex === -1) {
          console.log('[TTS] Cannot seek - sentence not found in text')
          return
        }

        console.log('[TTS] Seeking to sentence', sentenceIndex, '- restarting generation')

        // Stop the current worker
        if (workerRef.current) {
          workerRef.current.terminate()
          workerRef.current = null
        }

        // Clean up blob URLs
        for (const chunk of audioQueueRef.current) {
          cleanupBlobUrl(chunk.blobUrl)
        }
        for (const chunk of allChunksRef.current) {
          cleanupBlobUrl(chunk.blobUrl)
        }

        // Clear audio state
        audioQueueRef.current = []
        allChunksRef.current = []
        totalDurationRef.current = 0
        playedDurationRef.current = 0
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
        const remainingSentences = allSentencesRef.current.slice(sentenceIndex)
        const remainingText = remainingSentences.join(' ')

        // Detect capabilities and create new worker
        const capabilities = await detectCapabilities()

        workerRef.current = new TTSWorker()
        workerRef.current.onmessage = handleWorkerMessage

        // Store the pending generation
        pendingGenerationRef.current = { text: remainingText }

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
      }
    },
    [playNextChunk, handleWorkerMessage, cleanupBlobUrl]
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
