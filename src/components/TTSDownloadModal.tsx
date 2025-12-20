/**
 * TTS Download Modal
 *
 * Shows progress during first-time model download.
 */

interface TTSDownloadModalProps {
  progress: number
  modelSize?: string
  onCancel: () => void
}

export function TTSDownloadModal({
  progress,
  modelSize = '~92 MB',
  onCancel,
}: TTSDownloadModalProps) {
  return (
    <div className="tts-modal-overlay">
      <div className="tts-modal">
        {/* Icon */}
        <div className="tts-modal-icon">
          <svg
            className="w-12 h-12 text-[var(--theme-accent)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="tts-modal-title">Setting up Text-to-Speech</h2>

        {/* Status */}
        <p className="tts-modal-status">
          Downloading voice model ({modelSize})...
        </p>

        {/* Progress Bar */}
        <div className="tts-modal-progress-container">
          <div className="tts-modal-progress-bar">
            <div
              className="tts-modal-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="tts-modal-progress-text">{Math.round(progress)}%</span>
        </div>

        {/* Note */}
        <p className="tts-modal-note">
          This is a one-time setup. The model will be cached for future use.
        </p>

        {/* Cancel Button */}
        <button onClick={onCancel} className="tts-modal-cancel">
          Cancel
        </button>
      </div>
    </div>
  )
}
