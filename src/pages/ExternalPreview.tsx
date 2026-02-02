import { useLocation, Link } from 'react-router-dom'
import type { PostSearchResult } from '@/lib/appview'
import { useDocumentMeta } from '@/lib/useDocumentMeta'

export function ExternalPreviewPage() {
  const location = useLocation()
  const post = (location.state as { post?: PostSearchResult } | null)?.post

  // Set document metadata
  useDocumentMeta({
    title: post?.title ? `${post.title} (External)` : 'External Post',
    description: post?.subtitle || post?.contentPreview || undefined,
  })

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

  // No post data passed - show error
  if (!post) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-[var(--site-text)] mb-4">
            Post not found
          </h1>
          <p className="text-[var(--site-text-secondary)] mb-6">
            This external post preview is no longer available. Please search again to find the post.
          </p>
          <Link
            to="/search?type=posts"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--site-accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Back to Search
          </Link>
        </div>
      </div>
    )
  }

  const externalUrl = post.externalUrl

  // Deduplicate content: if subtitle appears at the start of contentPreview, show only the unique part
  const contentPreview = post.contentPreview
  const subtitle = post.subtitle
  let displayContent: string | null = null

  if (contentPreview) {
    const content = contentPreview.trim()
    const subtitleTrimmed = subtitle?.trim()

    if (subtitleTrimmed && content.startsWith(subtitleTrimmed)) {
      // Remove the subtitle portion from the beginning
      const remainder = content.slice(subtitleTrimmed.length).trim()
      // If there's meaningful content after the subtitle, return it
      if (remainder.length > 20) {
        displayContent = remainder
      }
      // If the content is basically just the subtitle, don't show it (displayContent stays null)
    } else {
      displayContent = content
    }
  }

  // Check if content appears truncated (doesn't end with sentence-ending punctuation)
  let contentIsTruncated = false
  if (displayContent) {
    const trimmed = displayContent.trim()
    // If it ends with sentence-ending punctuation, it's probably not truncated
    // If it's very short, probably not truncated
    // Otherwise assume it's truncated
    contentIsTruncated = !/[.!?]$/.test(trimmed) && trimmed.length >= 100
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Back link */}
      <div className="mb-6">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 text-sm text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to search
        </button>
      </div>

      {/* Source badge */}
      <div className="mb-4">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-600 text-white dark:bg-purple-900/30 dark:text-purple-300">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          External Post
        </span>
      </div>

      {/* Title */}
      <h1 className="text-3xl font-bold text-[var(--site-text)] mb-3">
        {post.title}
      </h1>

      {/* Subtitle */}
      {post.subtitle && (
        <p className="text-lg text-[var(--site-text-secondary)] mb-6">
          {post.subtitle}
        </p>
      )}

      {/* Author info */}
      <div className="flex items-center gap-3 mb-8 pb-6 border-b border-[var(--site-border)]">
        {post.avatarUrl ? (
          <img
            src={post.avatarUrl}
            alt=""
            className="w-12 h-12 rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[var(--site-border)] flex items-center justify-center">
            <svg className="w-6 h-6 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      {displayContent && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-[var(--site-text-secondary)] uppercase tracking-wide mb-3">
            Preview
          </h2>
          <div className="p-4 rounded-lg bg-[var(--site-bg-secondary)] border border-[var(--site-border)]">
            <p className="text-[var(--site-text)] whitespace-pre-wrap">
              {displayContent}
              {contentIsTruncated && (
                <span className="text-[var(--site-text-secondary)]">...</span>
              )}
            </p>
          </div>
          {contentIsTruncated && (
            <p className="mt-2 text-sm text-[var(--site-text-secondary)] italic">
              Continue reading on the original site for the full post.
            </p>
          )}
        </div>
      )}

      {/* External link CTA */}
      {externalUrl && (
        <div className="mt-8">
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-3 w-full px-6 py-4 bg-[var(--site-accent)] text-white rounded-xl hover:opacity-90 transition-opacity font-medium text-lg"
          >
            <span>Read full post on {getHostname(externalUrl)}</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <p className="text-center text-sm text-[var(--site-text-secondary)] mt-3">
            This post is hosted externally and will open in a new tab
          </p>
        </div>
      )}

      {/* If no external URL, show message */}
      {!externalUrl && (
        <div className="mt-8 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
          <p className="text-yellow-800 dark:text-yellow-200 text-sm">
            No external link is available for this post. The original source may have been removed.
          </p>
        </div>
      )}
    </div>
  )
}
