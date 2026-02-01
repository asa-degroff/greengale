import { useEffect, useRef } from 'react'
import type { PostSearchResult } from '@/lib/appview'

interface ExternalPreviewPanelProps {
  post: PostSearchResult | null
  onClose: () => void
}

export function ExternalPreviewPanel({ post, onClose }: ExternalPreviewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (post) {
      document.addEventListener('keydown', handleKeyDown)
      // Prevent body scroll on mobile when panel is open
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [post, onClose])

  // Close when clicking backdrop
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return null
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    } catch {
      return null
    }
  }

  function getHostname(url: string) {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  if (!post) return null

  const externalUrl = post.externalUrl

  return (
    <>
      {/* Backdrop - visible on both mobile and desktop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Panel - slides from right on desktop, slides from bottom on mobile */}
      <div
        ref={panelRef}
        className="fixed z-50 bg-[var(--site-bg)] shadow-xl overflow-y-auto
          /* Mobile: bottom sheet */
          inset-x-0 bottom-0 top-auto max-h-[85vh] rounded-t-2xl
          /* Desktop: right side panel */
          md:inset-y-0 md:right-0 md:left-auto md:w-[480px] md:max-w-[calc(100vw-320px)] md:max-h-none md:rounded-none md:rounded-l-2xl
          /* Animation */
          animate-in slide-in-responsive duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-preview-title"
      >
        {/* Mobile drag handle */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--site-border)]" />
        </div>

        {/* Header */}
        <div className="sticky top-0 bg-[var(--site-bg)] border-b border-[var(--site-border)] px-4 py-3 flex items-center justify-between z-10">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-orange-500 text-white dark:bg-orange-900/30 dark:text-orange-300">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            External Post
          </span>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors rounded-lg hover:bg-[var(--site-bg-secondary)]"
            aria-label="Close preview"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 md:p-6">
          {/* Title */}
          <h2 id="external-preview-title" className="text-2xl font-bold text-[var(--site-text)] mb-2">
            {post.title}
          </h2>

          {/* Subtitle */}
          {post.subtitle && (
            <p className="text-[var(--site-text-secondary)] mb-4">
              {post.subtitle}
            </p>
          )}

          {/* Author info */}
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--site-border)]">
            {post.avatarUrl ? (
              <img
                src={post.avatarUrl}
                alt=""
                className="w-10 h-10 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--site-border)] flex items-center justify-center">
                <svg className="w-5 h-5 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            )}
            <div>
              <div className="font-medium text-[var(--site-text)]">
                {post.displayName || `@${post.handle}`}
              </div>
              <div className="text-sm text-[var(--site-text-secondary)]">
                {post.createdAt && formatDate(post.createdAt)}
              </div>
            </div>
          </div>

          {/* Content preview */}
          {post.contentPreview && (
            <div className="mb-6">
              <h3 className="text-xs font-medium text-[var(--site-text-secondary)] uppercase tracking-wide mb-2">
                Preview
              </h3>
              <div className="external-preview-content p-3 rounded-lg bg-[var(--site-bg-secondary)] border border-[var(--site-border)] max-h-[60vh] overflow-y-auto">
                <p className="text-sm text-[var(--site-text)] whitespace-pre-wrap">
                  {post.contentPreview}
                </p>
              </div>
            </div>
          )}

          {/* External link CTA */}
          {externalUrl && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full px-5 py-3.5 bg-[var(--site-accent)] text-white rounded-xl hover:opacity-90 transition-opacity font-medium"
            >
              <span>Read on {getHostname(externalUrl)}</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}

          {!externalUrl && (
            <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                No external link available for this post.
              </p>
            </div>
          )}

          <p className="text-center text-xs text-[var(--site-text-secondary)] mt-3">
            Opens in a new tab
          </p>
        </div>
      </div>
    </>
  )
}
