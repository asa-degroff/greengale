import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { extractText, extractFirstImage } from '@/lib/markdown'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'
import { extractCidFromBlobUrl, getBlobLabelsMap } from '@/lib/image-labels'

interface BlogCardProps {
  entry: BlogEntry
  author?: AuthorProfile
  externalUrl?: string | null
  tags?: string[]
}

export function BlogCard({ entry, author, externalUrl, tags }: BlogCardProps) {
  const navigate = useNavigate()
  const preview = extractText(entry.content, 160)
  const thumbnail = extractFirstImage(entry.content)

  // Check if thumbnail has content labels
  const thumbnailHasLabels = useMemo(() => {
    if (!thumbnail || !entry.blobs?.length) return false
    const cid = extractCidFromBlobUrl(thumbnail)
    if (!cid) return false
    const labelsMap = getBlobLabelsMap(entry.blobs)
    const labels = labelsMap.get(cid)
    return labels && labels.values.length > 0
  }, [thumbnail, entry.blobs])

  const formattedDate = entry.createdAt
    ? new Date(entry.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  const authorHandle = author?.handle || entry.authorDid
  const isNetworkPost = !!externalUrl

  // Extract domain from external URL for network posts
  const externalDomain = useMemo(() => {
    if (!externalUrl) return null
    try {
      const url = new URL(externalUrl)
      // Remove 'www.' prefix if present
      return url.hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }, [externalUrl])

  // Card content (shared between internal and external links)
  const cardContent = (
    <>
        {thumbnail && !thumbnailHasLabels && (
          <div className="aspect-video overflow-hidden bg-[var(--site-bg-secondary)]">
            <img
              src={thumbnail}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}
        {thumbnail && thumbnailHasLabels && (
          <div className="aspect-video overflow-hidden bg-[var(--site-bg-secondary)] flex items-center justify-center">
            <div className="text-center text-[var(--site-text-secondary)]">
              <svg
                className="w-8 h-8 mx-auto mb-1 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <span className="text-xs">Sensitive Content</span>
            </div>
          </div>
        )}
        <div className="p-4">
          <h2 className="text-lg font-bold font-title mb-2 text-[var(--site-text)] line-clamp-2">
            {entry.title || 'Untitled'}
          </h2>
          {entry.subtitle && (
            <p className="text-sm text-[var(--site-text-secondary)] mb-2 line-clamp-1">
              {entry.subtitle}
            </p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigate(`/tag/${encodeURIComponent(tag)}`)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      navigate(`/tag/${encodeURIComponent(tag)}`)
                    }
                  }}
                  className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--site-accent)]/10 text-[var(--site-accent)] hover:bg-[var(--site-accent)]/20 transition-colors cursor-pointer"
                >
                  {tag}
                </span>
              ))}
              {tags.length > 5 && (
                <span className="inline-block px-2 py-0.5 text-xs text-[var(--site-text-secondary)]">
                  +{tags.length - 5} more
                </span>
              )}
            </div>
          )}
          <p className="text-sm text-[var(--site-text-secondary)] line-clamp-3 mb-3">
            {preview}
          </p>
          {isNetworkPost ? (
            /* Network post: two-row layout */
            <div className="space-y-2 text-xs text-[var(--site-text-secondary)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {author?.avatar && (
                    <img
                      src={author.avatar}
                      alt=""
                      className="w-5 h-5 rounded-full flex-shrink-0"
                    />
                  )}
                  <span className="truncate">@{authorHandle}</span>
                </div>
                {formattedDate && <time dateTime={entry.createdAt} className="flex-shrink-0">{formattedDate}</time>}
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {externalDomain && <span className="truncate">{externalDomain}</span>}
              </div>
            </div>
          ) : (
            /* Non-network post: single-row layout */
            <div className="flex items-center justify-between text-xs text-[var(--site-text-secondary)] gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {author?.avatar && (
                  <img
                    src={author.avatar}
                    alt=""
                    className="w-5 h-5 rounded-full flex-shrink-0"
                  />
                )}
                <span className="truncate">@{authorHandle}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Visibility indicator for non-public posts */}
                {entry.visibility === 'author' && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Private
                  </span>
                )}
                {entry.visibility === 'url' && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Unlisted
                  </span>
                )}
                {formattedDate && <time dateTime={entry.createdAt}>{formattedDate}</time>}
                <span className="px-1.5 py-0.5 rounded bg-[var(--site-bg-secondary)]">
                  {entry.source === 'whitewind' ? 'WW' : 'GG'}
                </span>
              </div>
            </div>
          )}
        </div>
    </>
  )

  return (
    <article className="border border-[var(--site-border)] rounded-lg overflow-hidden hover:shadow-md transition-shadow bg-[var(--site-bg)]">
      {isNetworkPost ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          {cardContent}
        </a>
      ) : (
        <Link to={`/${authorHandle}/${entry.rkey}`} className="block">
          {cardContent}
        </Link>
      )}
    </article>
  )
}
