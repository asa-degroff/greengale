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
    playbackProgress: number
    bufferProgress: number
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
    playbackProgress: 0, // 0-100, based on sentence position
    bufferProgress: 0, // 0-100, based on chunks generated
  })

  const workerRef = useRef<Worker | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioQueueRef = useRef<AudioChunk[]>([])
  const allChunksRef = useRef<Map<number, AudioChunk>>(new Map()) // Map of sentenceIndex -> chunk (persists across seeks)
  const currentChunkIndexRef = useRef<number>(0) // Current sentence index being played
  const isPlayingRef = useRef(false)
  const playbackRateRef = useRef<PlaybackRate>(1.0)
  const isPausedRef = useRef(false)
  const isStartingChunkRef = useRef(false) // Guard against concurrent playNextChunk calls
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

  // Play the next chunk in sequence
  const playNextChunk = useCallback(() => {
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
      const mapChunk = allChunksRef.current.get(expectedIndex)
      if (mapChunk) {
        // Create fresh blob URL for playback
        const wavBlob = float32ToWavBlob(mapChunk.audio, SAMPLE_RATE)
        const blobUrl = URL.createObjectURL(wavBlob)
        chunk = { ...mapChunk, blobUrl }
      }
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

    // Clean up previous blob URL
    if (audio.src && audio.src.startsWith('blob:')) {
      cleanupBlobUrl(audio.src)
    }

    // Set up the new audio
    audio.src = chunk.blobUrl
    audio.playbackRate = playbackRateRef.current

    // Update current sentence and playback progress
    const playbackProgress = totalSentences > 0 ? (chunk.sentenceIndex / totalSentences) * 100 : 0

    setState((prev) => ({
      ...prev,
      status: 'playing',
      currentSentence: chunk.text,
      sentenceIndex: chunk.sentenceIndex,
    }))

    setPlaybackState((prev) => ({ ...prev, playbackProgress }))

    // Handle chunk end
    audio.onended = () => {
      playedDurationRef.current += chunk.duration
      cleanupBlobUrl(chunk.blobUrl)
      currentChunkIndexRef.current = expectedIndex + 1
      isStartingChunkRef.current = false
      playNextChunk()
    }

    audio.onerror = () => {
      console.error('[TTS] Audio playback error')
      cleanupBlobUrl(chunk.blobUrl)
      currentChunkIndexRef.current = expectedIndex + 1
      isStartingChunkRef.current = false
      playNextChunk() // Try next chunk
    }

    audio.play()
      .then(() => {
        // Audio started successfully, clear the guard
        isStartingChunkRef.current = false
      })
      .catch((err) => {
        isStartingChunkRef.current = false
        // AbortError means the audio source was changed (e.g., by a seek or new playNextChunk call)
        // This is not a real error - just ignore it as something else is handling playback
        if (err.name === 'AbortError') {
          console.log('[TTS] Play aborted (audio source changed)')
          return
        }
        console.error('[TTS] Failed to play audio:', err)
        currentChunkIndexRef.current = expectedIndex + 1
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

          // Store in Map by sentenceIndex for persistent buffer across seeks
          // (don't store blob URL in Map since we create fresh ones on demand)
          allChunksRef.current.set(message.sentenceIndex, {
            ...chunk,
            blobUrl: '', // Will be created fresh when needed
          })

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
      for (const chunk of allChunksRef.current.values()) {
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
      for (const chunk of allChunksRef.current.values()) {
        cleanupBlobUrl(chunk.blobUrl)
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

      // Create indexed sentences for the worker
      const indexedSentences: IndexedSentence[] = allSentencesRef.current.map((text, index) => ({
        index,
        text,
      }))

      // Store pending generation with indexed sentences
      pendingGenerationRef.current = { sentences: indexedSentences }

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
    for (const chunk of allChunksRef.current.values()) {
      cleanupBlobUrl(chunk.blobUrl)
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
      playbackProgress: 0,
      bufferProgress: 0,
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

      // Stop current playback
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        audioElementRef.current.onended = null
      }

      // Stop current worker generation
      if (workerRef.current) {
        const stopRequest: WorkerRequest = { type: 'stop' }
        workerRef.current.postMessage(stopRequest)
        workerRef.current.terminate()
        workerRef.current = null
      }

      // Clean up current audio queue blob URLs (but NOT allChunksRef - keep the buffer!)
      for (const chunk of audioQueueRef.current) {
        cleanupBlobUrl(chunk.blobUrl)
      }
      audioQueueRef.current = []

      // Build the playback queue from targetIndex onwards
      // Use existing buffered chunks where available
      const newQueue: AudioChunk[] = []
      const missingSentences: IndexedSentence[] = []

      for (let i = targetIndex; i < allSentencesRef.current.length; i++) {
        const existingChunk = allChunksRef.current.get(i)
        if (existingChunk) {
          // Use the existing buffered chunk - create a fresh blob URL
          const wavBlob = float32ToWavBlob(existingChunk.audio, SAMPLE_RATE)
          const blobUrl = URL.createObjectURL(wavBlob)
          newQueue.push({
            ...existingChunk,
            blobUrl,
          })
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

        // Store the pending generation with only missing sentences
        pendingGenerationRef.current = { sentences: missingSentences }

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
      } else {
        // All sentences already buffered
        generationCompleteRef.current = true
        console.log('[TTS] All sentences already buffered, no generation needed')
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
