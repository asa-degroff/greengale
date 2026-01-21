/**
 * Banner displayed after a draft has been automatically restored.
 * Offers an "Undo" option to discard the restored draft.
 */

interface DraftRestorationBannerProps {
  /** When the draft was last saved */
  savedAt: Date
  /** Called when user clicks "Undo" to discard the restored draft */
  onUndo: () => void
  /** Called when user dismisses the banner (X button) */
  onDismiss: () => void
}

/**
 * Format a relative time string (e.g., "5 minutes ago", "2 hours ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes === 1) {
    return '1 minute ago'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minutes ago`
  } else if (diffHours === 1) {
    return '1 hour ago'
  } else if (diffHours < 24) {
    return `${diffHours} hours ago`
  } else if (diffDays === 1) {
    return 'yesterday'
  } else {
    return `${diffDays} days ago`
  }
}

export function DraftRestorationBanner({
  savedAt,
  onUndo,
  onDismiss,
}: DraftRestorationBannerProps) {
  const relativeTime = formatRelativeTime(savedAt)

  return (
    <div className="mb-6 py-2 px-4 bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded-lg flex items-center justify-between gap-4">
      <span className="text-[var(--site-text-secondary)] text-sm">
        Draft restored from <span className="font-medium text-[var(--site-text)]">{relativeTime}</span>
      </span>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onUndo}
          className="px-2.5 py-1 text-sm rounded border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg)] hover:text-[var(--site-text)] transition-colors"
        >
          Undo
        </button>
        <button
          onClick={onDismiss}
          className="p-1 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
