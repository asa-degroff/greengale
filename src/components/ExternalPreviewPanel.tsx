import { useEffect, useRef, useState } from 'react'
import type { PostSearchResult, UnifiedPostResult } from '@/lib/appview'

/**
 * Common post result type that works with both legacy PostSearchResult
 * and the new UnifiedPostResult from the unified search API
 */
type PostResultType = PostSearchResult | UnifiedPostResult

const TRANSITION_DURATION = 300

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

function processContent(p: PostResultType) {
  const preview = p.contentPreview
  const sub = p.subtitle
  let content: string | null = null

  if (preview) {
    const trimmed = preview.trim()
    const subTrimmed = sub?.trim()

    if (subTrimmed && trimmed.startsWith(subTrimmed)) {
      const remainder = trimmed.slice(subTrimmed.length).trim()
      if (remainder.length > 20) content = remainder
    } else {
      content = trimmed
    }
  }

  const isTruncated = !!(content && preview && preview.trim().length >= 2900)

  return { displayContent: content, contentIsTruncated: isTruncated }
}

function PreviewContent({ post }: { post: PostResultType }) {
  const { displayContent, contentIsTruncated } = processContent(post)
  const url = post.externalUrl

  return (
    <>
      {/* Scrollable content area */}
      <div className="external-preview-content flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        <h2 id="external-preview-title" className="text-2xl font-bold text-[var(--site-text)] mb-2">
          {post.title}
        </h2>

        {post.subtitle && (
          <p className="text-[var(--site-text-secondary)] mb-4">
            {post.subtitle}
          </p>
        )}

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

        {displayContent && (
          <div>
            <p className="text-base leading-relaxed text-[var(--site-text)] whitespace-pre-wrap">
              {displayContent}
              {contentIsTruncated && (
                <span className="text-[var(--site-text-secondary)]">...</span>
              )}
            </p>
            {contentIsTruncated && (
              <p className="mt-2 text-sm text-[var(--site-text-secondary)] italic">
                Continue reading on the original site for the full post.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Fixed footer with CTA */}
      <div className="flex-shrink-0 p-4 md:px-6 md:pb-6 md:pt-4 border-t border-[var(--site-border)] bg-[var(--site-bg)]">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-3 w-full px-5 py-3.5 bg-[var(--site-accent)] text-white rounded-xl hover:opacity-90 transition-opacity font-medium"
          >
            <span>Read on {getHostname(url)}</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ) : (
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
    </>
  )
}

interface ExternalPreviewPanelProps {
  post: PostResultType | null
  onClose: () => void
}

export function ExternalPreviewPanel({ post, onClose }: ExternalPreviewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [prevPostUri, setPrevPostUri] = useState<string | null>(null)
  const [exitingPost, setExitingPost] = useState<PostResultType | null>(null)
  const [prevPostSnapshot, setPrevPostSnapshot] = useState<PostResultType | null>(null)

  // Synchronous state derivation during render (React's "storing information
  // from previous renders" pattern). Only setState calls here — no side effects.
  const currentUri = post?.uri ?? null
  if (currentUri !== prevPostUri) {
    if (post && prevPostSnapshot && currentUri && prevPostUri) {
      // Post changed to a different post — trigger transition
      setExitingPost(prevPostSnapshot)
    } else if (!post) {
      // Panel closed — clear immediately (no exit animation needed)
      setExitingPost(null)
    }
    setPrevPostUri(currentUri)
    setPrevPostSnapshot(post)
  }

  // Clear exiting post after animation completes
  useEffect(() => {
    if (!exitingPost) return
    const timer = setTimeout(() => setExitingPost(null), TRANSITION_DURATION)
    return () => clearTimeout(timer)
  }, [exitingPost])

  // Check if we're on a wide screen (2xl breakpoint = 1536px)
  const isWideScreen = () => window.matchMedia('(min-width: 1536px)').matches

  // Close on escape key and handle click outside on wide screens
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // On wide screens, close panel when clicking outside of it (but not on the search results)
    function handleClickOutside(e: MouseEvent) {
      if (!isWideScreen()) return

      const target = e.target as Element
      // Don't close if clicking inside the panel
      if (panelRef.current?.contains(target)) return
      // Don't close if clicking on a search result or feed card (let them switch documents)
      if (target.closest('button[class*="transition-colors"]')) return
      if (target.closest('[data-external-post-card]')) return
      // Don't close if clicking on the sidebar
      if (target.closest('aside') || target.closest('[class*="complementary"]')) return
      // Don't close if clicking on the search bar (prevents disorienting layout shift while typing)
      if (target.closest('input[type="text"]') || target.closest('input[type="search"]') || target.closest('form')) return

      onClose()
    }

    if (post) {
      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('mousedown', handleClickOutside)

      // Only prevent body scroll on narrow screens (mobile/tablet)
      // On wide screens, allow scrolling the main content
      let previousOverflow: string | undefined
      if (!isWideScreen()) {
        previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }

      return () => {
        document.removeEventListener('keydown', handleKeyDown)
        document.removeEventListener('mousedown', handleClickOutside)
        if (previousOverflow !== undefined) {
          document.body.style.overflow = previousOverflow
        }
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [post, onClose])

  // Close when clicking backdrop
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!post) return null

  const isTransitioning = !!exitingPost

  return (
    <>
      {/* Backdrop - visible on mobile/medium screens, hidden on wide screens where content slides over */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 2xl:hidden"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Panel - slides from right on desktop, slides from bottom on mobile */}
      <div
        ref={panelRef}
        className="fixed z-50 bg-[var(--site-bg)] shadow-xl flex flex-col overflow-hidden
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
        <div className="md:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--site-border)]" />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 bg-[var(--site-bg)] border-b border-[var(--site-border)] px-4 py-3 flex items-center justify-between z-10">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
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

        {/* Content transition container — overflow hidden prevents slide animations from leaking */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {/* Active post — absolutely positioned during transition to avoid layout shift */}
          <div
            key={post.uri}
            className={`flex flex-col ${isTransitioning ? 'absolute inset-0 preview-content-slide-in' : 'h-full'}`}
          >
            <PreviewContent post={post} />
          </div>

          {/* Exiting post (fades + slides out to the left, rendered on top) */}
          {exitingPost && (
            <div
              key={exitingPost.uri}
              className="absolute inset-0 flex flex-col preview-content-slide-out"
              aria-hidden="true"
            >
              <PreviewContent post={exitingPost} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
