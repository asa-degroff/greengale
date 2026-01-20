/**
 * Voice Settings Preview Component
 *
 * Allows selecting voice, pitch, and speed settings with an optional preview feature.
 * Preview is only available when the TTS model is already cached in IndexedDB.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PitchRate, PlaybackRate } from '@/lib/tts'
import { PLAYBACK_RATES, PITCH_RATES, groupVoices, isTTSModelCached } from '@/lib/tts'
import { useTTS } from '@/lib/useTTS'

// All available Kokoro voices (same order as returned from model)
const ALL_VOICES = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
]

interface VoiceSettingsPreviewProps {
  voice: string
  pitch: PitchRate
  speed: PlaybackRate
  onVoiceChange: (voice: string) => void
  onPitchChange: (pitch: PitchRate) => void
  onSpeedChange: (speed: PlaybackRate) => void
}

const DEFAULT_SAMPLE_TEXT = 'Welcome to my publication. This is how text-to-speech will sound for your readers.'

export function VoiceSettingsPreview({
  voice,
  pitch,
  speed,
  onVoiceChange,
  onPitchChange,
  onSpeedChange,
}: VoiceSettingsPreviewProps) {
  const [isModelCached, setIsModelCached] = useState(false)
  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE_TEXT)
  const [checkingCache, setCheckingCache] = useState(true)

  const tts = useTTS()
  const ttsRef = useRef(tts)
  ttsRef.current = tts // Keep ref updated with latest tts

  const isPreviewActive = tts.state.status !== 'idle'
  const isLoading = tts.state.status === 'loading-model'

  // Check if TTS model is cached on mount
  useEffect(() => {
    let cancelled = false
    setCheckingCache(true)

    isTTSModelCached().then((cached) => {
      if (!cancelled) {
        setIsModelCached(cached)
        setCheckingCache(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Cleanup TTS on unmount only
  useEffect(() => {
    return () => {
      ttsRef.current.stop()
    }
  }, []) // Empty deps - only runs on unmount

  // Auto-reset when playback finishes
  useEffect(() => {
    if (tts.state.status === 'paused' && tts.state.currentSentence?.includes('Finished')) {
      ttsRef.current.stop()
      // After playback finishes, model is definitely cached
      if (!isModelCached) {
        setIsModelCached(true)
      }
    }
  }, [tts.state.status, tts.state.currentSentence, isModelCached])

  // Detect when model becomes ready (after download)
  useEffect(() => {
    // When we transition from loading to playing/generating, model is now cached
    if (!isModelCached && (tts.state.status === 'playing' || tts.state.status === 'generating')) {
      setIsModelCached(true)
    }
  }, [tts.state.status, isModelCached])

  const voiceCategories = groupVoices(ALL_VOICES)

  // Handle download button click - starts TTS which triggers model download
  const handleDownloadClick = useCallback(() => {
    // Start TTS with sample text to trigger model download
    tts.start(DEFAULT_SAMPLE_TEXT, {
      voice,
      pitch,
      speed,
    })
  }, [tts, voice, pitch, speed])

  const handlePreviewClick = useCallback(() => {
    if (isPreviewActive) {
      tts.stop()
    } else if (sampleText.trim()) {
      tts.start(sampleText, {
        voice,
        pitch,
        speed,
      })
    }
  }, [isPreviewActive, sampleText, voice, pitch, speed, tts])

  // Update TTS settings when they change during playback
  useEffect(() => {
    if (isPreviewActive && !isLoading) {
      ttsRef.current.setVoice(voice)
    }
  }, [voice, isPreviewActive, isLoading])

  useEffect(() => {
    if (isPreviewActive && !isLoading) {
      ttsRef.current.setPitch(pitch)
    }
  }, [pitch, isPreviewActive, isLoading])

  useEffect(() => {
    if (isPreviewActive && !isLoading) {
      ttsRef.current.setPlaybackRate(speed)
    }
  }, [speed, isPreviewActive, isLoading])

  return (
    <div className="space-y-4">
      {/* Voice Selector */}
      <div>
        <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Voice</label>
        <select
          value={voice}
          onChange={(e) => onVoiceChange(e.target.value)}
          className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
        >
          {voiceCategories.map((category) => (
            <optgroup key={category.label} label={category.label}>
              {category.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Pitch and Speed in a row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Pitch</label>
          <select
            value={pitch}
            onChange={(e) => onPitchChange(parseFloat(e.target.value) as PitchRate)}
            className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
          >
            {PITCH_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 1.0 ? '1.0x (Normal)' : `${rate}x`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Speed</label>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value) as PlaybackRate)}
            className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 1.0 ? '1.0x (Normal)' : `${rate}x`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preview Section - only shown if model is cached */}
      {isModelCached && (
        <div className="pt-3 border-t border-[var(--site-border)]">
          <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Preview Text</label>
          <textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] resize-none"
            placeholder="Enter sample text..."
          />

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreviewClick}
              disabled={!sampleText.trim() || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:text-[var(--site-text)] hover:border-[var(--site-text-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Loading...</span>
                </>
              ) : isPreviewActive ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                  </svg>
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  <span>Preview</span>
                </>
              )}
            </button>

            {isPreviewActive && tts.state.status === 'playing' && (
              <span className="text-xs text-[var(--site-text-secondary)]">
                Playing...
              </span>
            )}
          </div>
        </div>
      )}

      {/* Download section when model not cached */}
      {!checkingCache && !isModelCached && (
        <div className="pt-3 border-t border-[var(--site-border)]">
          <p className="text-xs text-[var(--site-text-secondary)] mb-3">
            Download the TTS model to preview voices. The model is cached in local storage for on-device inference.
          </p>

          {isLoading ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm text-[var(--site-text-secondary)]">
                  Downloading model... {tts.state.modelProgress}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-[var(--site-border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--site-accent)] transition-all duration-300"
                  style={{ width: `${tts.state.modelProgress}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => ttsRef.current.stop()}
                className="text-xs text-[var(--site-text-secondary)] hover:text-[var(--site-text)] underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDownloadClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:text-[var(--site-text)] hover:border-[var(--site-text-secondary)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span>Download TTS Model</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
