/**
 * Audio Player Component
 *
 * Fixed bottom bar for TTS playback with play/pause, progress, speed control.
 */

import type { TTSState, PlaybackRate } from '@/lib/tts'
import { PLAYBACK_RATES } from '@/lib/tts'

interface AudioPlayerProps {
  state: TTSState
  playbackState: {
    isPlaying: boolean
    currentTime: number
    duration: number
    playbackRate: PlaybackRate
  }
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onPlaybackRateChange: (rate: PlaybackRate) => void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioPlayer({
  state,
  playbackState,
  onPause,
  onResume,
  onStop,
  onPlaybackRateChange,
}: AudioPlayerProps) {
  const progress =
    playbackState.duration > 0 ? (playbackState.currentTime / playbackState.duration) * 100 : 0

  const isGenerating = state.status === 'generating'
  const isPlaying = state.status === 'playing'
  const isPaused = state.status === 'paused'

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

        {/* Progress Section */}
        <div className="audio-player-progress-section">
          {/* Progress Bar */}
          <div className="audio-player-progress-bar">
            <div
              className="audio-player-progress-fill"
              style={{ width: `${progress}%` }}
            />
            {/* Buffer indicator when generating */}
            {isGenerating && (
              <div
                className="audio-player-progress-buffer"
                style={{ width: `${state.generationProgress}%` }}
              />
            )}
          </div>

          {/* Current Sentence */}
          <div className="audio-player-sentence">
            {state.currentSentence ? (
              <span className="truncate">{state.currentSentence}</span>
            ) : isGenerating ? (
              <span className="text-[var(--theme-text-secondary)]">Generating audio...</span>
            ) : (
              <span className="text-[var(--theme-text-secondary)]">Ready to play</span>
            )}
          </div>
        </div>

        {/* Time Display */}
        <div className="audio-player-time">
          <span>{formatTime(playbackState.currentTime)}</span>
          <span className="text-[var(--theme-text-secondary)]"> / </span>
          <span>{formatTime(playbackState.duration)}</span>
        </div>

        {/* Speed Control */}
        <div className="audio-player-speed">
          <select
            value={playbackState.playbackRate}
            onChange={(e) => onPlaybackRateChange(parseFloat(e.target.value) as PlaybackRate)}
            className="audio-player-speed-select"
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
    </div>
  )
}
