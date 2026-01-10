/**
 * Audio Player Component
 *
 * Fixed bottom bar for TTS playback with play/pause, current sentence, voice, pitch, and speed controls.
 * Also handles model loading state with inline progress display.
 * Shows dual progress bars: buffer progress (lighter) and playback progress (accent).
 */

import type { TTSState, PlaybackRate, PitchRate } from '@/lib/tts'
import { PLAYBACK_RATES, PITCH_RATES, groupVoices } from '@/lib/tts'

interface AudioPlayerProps {
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
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onPlaybackRateChange: (rate: PlaybackRate) => void
  onPitchChange: (rate: PitchRate) => void
  onVoiceChange: (voice: string) => void
}

export function AudioPlayer({
  state,
  playbackState,
  availableVoices,
  currentVoice,
  onPause,
  onResume,
  onStop,
  onPlaybackRateChange,
  onPitchChange,
  onVoiceChange,
}: AudioPlayerProps) {
  const voiceCategories = groupVoices(availableVoices)
  const isLoading = state.status === 'loading-model'
  const isGenerating = state.status === 'generating'
  const isPlaying = state.status === 'playing'
  const isPaused = state.status === 'paused'

  // Loading state - show progress bar at top with same layout as playback
  if (isLoading) {
    return (
      <div className="audio-player">
        {/* Progress bar at top for model loading */}
        <div className="audio-player-progress-track audio-player-progress-top">
          <div
            className="audio-player-progress-fill"
            style={{ width: `${state.modelProgress}%` }}
          />
        </div>
        <div className="audio-player-content">
          {/* Loading Icon (same position as play button) */}
          <div className="audio-player-button audio-player-loading-icon">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>

          {/* Status text (same layout as sentence display) */}
          <div className="audio-player-sentence-display">
            <span className="audio-player-sentence-text">
              Setting up Text-to-Speech ({Math.round(state.modelProgress)}%)
            </span>
          </div>

          {/* Cancel Button */}
          <button
            onClick={onStop}
            className="audio-player-button audio-player-close"
            title="Cancel"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="audio-player">
      <div className="audio-player-content">
        {/* Play/Pause Button */}
        <button
          onClick={playbackState.isPlaying ? onPause : onResume}
          disabled={!isPlaying && !isPaused && !isGenerating}
          className="audio-player-button audio-player-play"
          title={playbackState.isPlaying ? 'Pause' : 'Play'}
        >
          {playbackState.isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Current Sentence Display */}
        <div className="audio-player-sentence-display">
          {state.currentSentence ? (
            <span className="audio-player-sentence-text">{state.currentSentence}</span>
          ) : isGenerating ? (
            <span className="audio-player-sentence-placeholder">Generating audio...</span>
          ) : (
            <span className="audio-player-sentence-placeholder">Ready to play</span>
          )}
        </div>

        {/* Voice Selector */}
        {voiceCategories.length > 0 && (
          <div className="audio-player-voice">
            <select
              value={currentVoice}
              onChange={(e) => onVoiceChange(e.target.value)}
              className="audio-player-voice-select"
              title="Voice"
            >
              {voiceCategories.map((category) => (
                <optgroup key={category.label} label={category.label}>
                  {category.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {/* Pitch Control */}
        <div className="audio-player-pitch">
          <select
            value={playbackState.pitch}
            onChange={(e) => onPitchChange(parseFloat(e.target.value) as PitchRate)}
            className="audio-player-pitch-select"
            title="Pitch"
          >
            {PITCH_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 1.0 ? '1.0' : rate < 1 ? rate.toFixed(2) : `+${(rate - 1).toFixed(1)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Speed Control */}
        <div className="audio-player-speed">
          <select
            value={playbackState.playbackRate}
            onChange={(e) => onPlaybackRateChange(parseFloat(e.target.value) as PlaybackRate)}
            className="audio-player-speed-select"
            title="Speed"
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}x
              </option>
            ))}
          </select>
        </div>

        {/* Close Button */}
        <button
          onClick={onStop}
          className="audio-player-button audio-player-close"
          title="Stop and close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Seek/Buffer Progress Bar at bottom */}
      <div className="audio-player-progress-track audio-player-progress-bottom">
        {/* Buffer progress (lighter, behind) */}
        <div
          className="audio-player-buffer-fill"
          style={{ width: `${playbackState.bufferProgress}%` }}
        />
        {/* Playback progress (accent, in front) */}
        <div
          className="audio-player-playback-fill"
          style={{ width: `${playbackState.playbackProgress}%` }}
        />
      </div>
    </div>
  )
}
