import { useState, useEffect } from 'react'
import { getBlueskyPost, getBlueskyWebUrl, renderTextWithFacets, type BlueskyEmbedPost } from '@/lib/bluesky'

interface BlueskyEmbedProps {
  handle: string
  rkey: string
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 30) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (diffDays > 0) return `${diffDays}d`
  if (diffHours > 0) return `${diffHours}h`
  if (diffMins > 0) return `${diffMins}m`
  return 'now'
}

/**
 * Bluesky post embed component for inline display in blog posts.
 * Fetches and displays a minimal view of a Bluesky post (no engagement stats).
 */
export function BlueskyEmbed({ handle, rkey }: BlueskyEmbedProps) {
  const [post, setPost] = useState<BlueskyEmbedPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const blueskyUrl = `https://bsky.app/profile/${handle}/post/${rkey}`

  useEffect(() => {
    let cancelled = false

    async function fetchPost() {
      setLoading(true)
      setError(null)

      try {
        const result = await getBlueskyPost(handle, rkey)

        if (cancelled) return

        if (!result) {
          setError('Post not found')
        } else {
          setPost(result)
        }
      } catch (err) {
        if (cancelled) return
        setError('Failed to load post')
        console.error('BlueskyEmbed fetch error:', err)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchPost()

    return () => {
      cancelled = true
    }
  }, [handle, rkey])

  // Loading state
  if (loading) {
    return (
      <div className="my-4 p-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
        <div className="flex items-center gap-3 animate-pulse">
          {/* Avatar skeleton */}
          <div className="w-10 h-10 rounded-full bg-[var(--theme-border)]" />
          <div className="flex-1 space-y-2">
            {/* Name skeleton */}
            <div className="h-4 w-32 bg-[var(--theme-border)] rounded" />
            {/* Text skeleton */}
            <div className="h-3 w-48 bg-[var(--theme-border)] rounded" />
          </div>
          {/* Bluesky icon */}
          <svg
            className="w-5 h-5 text-[var(--theme-text-secondary)]"
            viewBox="0 0 600 530"
            fill="currentColor"
          >
            <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
          </svg>
        </div>
      </div>
    )
  }

  // Error state - show as a simple link
  if (error || !post) {
    return (
      <div className="my-4 p-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
        <div className="flex items-center gap-3 text-[var(--theme-text-secondary)]">
          <svg
            className="w-5 h-5 flex-shrink-0"
            viewBox="0 0 600 530"
            fill="currentColor"
          >
            <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{error || 'Could not load Bluesky post'}</p>
            <a
              href={blueskyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--theme-accent)] hover:underline"
            >
              View on Bluesky
            </a>
          </div>
        </div>
      </div>
    )
  }

  const postUrl = getBlueskyWebUrl(post.uri)

  // Success state - render the post
  return (
    <div className="my-4 p-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] transition-colors hover:border-[var(--theme-text-secondary)]">
      {/* Author header */}
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <a
          href={`https://bsky.app/profile/${post.author.handle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0"
        >
          {post.author.avatar ? (
            <img
              src={post.author.avatar}
              alt={post.author.displayName || post.author.handle}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[var(--theme-accent)] flex items-center justify-center text-white font-medium">
              {(post.author.displayName || post.author.handle).charAt(0).toUpperCase()}
            </div>
          )}
        </a>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Author info */}
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`https://bsky.app/profile/${post.author.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--theme-text)] hover:underline truncate"
            >
              {post.author.displayName || post.author.handle}
            </a>
            <span className="text-[var(--theme-text-secondary)] text-sm truncate">
              @{post.author.handle}
            </span>
            <span className="text-[var(--theme-text-secondary)] text-sm">
              · {formatRelativeTime(post.createdAt)}
            </span>
          </div>

          {/* Post text with facets (links, mentions, hashtags) */}
          <p className="mt-1 text-[var(--theme-text)] whitespace-pre-wrap break-words">
            {renderTextWithFacets(post.text, post.facets)}
          </p>

          {/* Embedded images (inline thumbnails) */}
          {post.images && post.images.length > 0 && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {post.images.map((img, i) => (
                <a
                  key={i}
                  href={img.fullsize}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-lg border border-[var(--theme-border)] hover:border-[var(--theme-accent)] transition-colors"
                >
                  <img
                    src={img.thumb}
                    alt={img.alt || 'Image'}
                    className="h-20 w-auto object-cover"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          )}

          {/* View on Bluesky link */}
          <div className="mt-3 flex items-center">
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-[var(--theme-accent)] hover:underline"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 600 530"
                fill="currentColor"
              >
                <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
              </svg>
              <span>View on Bluesky</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BlueskyEmbed
