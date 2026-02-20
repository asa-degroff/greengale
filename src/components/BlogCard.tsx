import { useMemo, memo, useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { extractText, extractFirstImage } from '@/lib/markdown'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'
import { extractCidFromBlobUrl, getBlobLabelsMap } from '@/lib/image-labels'

interface BlogCardProps {
  entry: BlogEntry
  author?: AuthorProfile
  externalUrl?: string | null
  tags?: string[]
  // Indexed preview data (avoids extracting from content)
  contentPreview?: string | null
  firstImageCid?: string | null
  pdsEndpoint?: string | null
  // Callback for external post click (shows preview panel instead of opening URL)
  onExternalPostClick?: () => void
  // Pinned post controls (only shown for own profile)
  isPinned?: boolean
  onTogglePin?: (rkey: string) => void
  pinCount?: number
}

function CardOptionsMenu({ rkey, isPinned, pinCount, onTogglePin }: {
  rkey: string
  isPinned: boolean
  pinCount: number
  onTogglePin: (rkey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const disabled = !isPinned && pinCount >= 4

  const handleClose = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.card-options-menu')) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, handleClose])

  return (
    <div className="card-options-menu relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(prev => !prev)
        }}
        className="p-1 text-[var(--site-text)] opacity-70 hover:opacity-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-opacity"
        aria-label="Post options"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--site-bg)] border border-[var(--site-border)] rounded-md shadow-lg z-20">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!disabled) {
                onTogglePin(rkey)
                setOpen(false)
              }
            }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2 rounded-md"
          >
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 rotate-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isPinned ? (
                  <>
                    <path d="M12 17v5M8 7.3V9.44c0 .21 0 .31-.02.41a1 1 0 01-.09.25c-.05.1-.11.18-.24.34L6.08 12.4c-.67.83-1 1.25-1 1.6a1 1 0 00.38.78c.27.22.8.22 1.87.22h9.34c1.07 0 1.6 0 1.87-.22a1 1 0 00.38-.78c0-.35-.33-.77-1-1.6l-1.57-1.96a2 2 0 01-.24-.34 1 1 0 01-.09-.25c-.02-.1-.02-.2-.02-.41V7.3c0-.11 0-.17.01-.23a1 1 0 01.03-.15c.01-.05.04-.1.08-.22l1.01-2.52c.3-.73.44-1.1.38-1.4a1 1 0 00-.43-.63C17.18 2 16.78 2 15.99 2H8.01c-.79 0-1.19 0-1.44.17a1 1 0 00-.43.63c-.06.3.08.66.38 1.4l1.01 2.52c.04.11.06.17.08.22a1 1 0 01.03.15c.01.06.01.12.01.23z" />
                    <line x1="4" y1="4" x2="20" y2="20" strokeWidth="2.5" />
                  </>
                ) : (
                  <path d="M12 17v5M8 7.3V9.44c0 .21 0 .31-.02.41a1 1 0 01-.09.25c-.05.1-.11.18-.24.34L6.08 12.4c-.67.83-1 1.25-1 1.6a1 1 0 00.38.78c.27.22.8.22 1.87.22h9.34c1.07 0 1.6 0 1.87-.22a1 1 0 00.38-.78c0-.35-.33-.77-1-1.6l-1.57-1.96a2 2 0 01-.24-.34 1 1 0 01-.09-.25c-.02-.1-.02-.2-.02-.41V7.3c0-.11 0-.17.01-.23a1 1 0 01.03-.15c.01-.05.04-.1.08-.22l1.01-2.52c.3-.73.44-1.1.38-1.4a1 1 0 00-.43-.63C17.18 2 16.78 2 15.99 2H8.01c-.79 0-1.19 0-1.44.17a1 1 0 00-.43.63c-.06.3.08.66.38 1.4l1.01 2.52c.04.11.06.17.08.22a1 1 0 01.03.15c.01.06.01.12.01.23z" />
                )}
              </svg>
              {isPinned ? 'Unpin from profile' : 'Pin to profile'}
            </span>
            {disabled && <span className="text-xs text-[var(--site-text-secondary)]">Max 4</span>}
          </button>
        </div>
      )}
    </div>
  )
}

export const BlogCard = memo(function BlogCard({ entry, author, externalUrl, tags, contentPreview, firstImageCid, pdsEndpoint, onExternalPostClick, isPinned, onTogglePin, pinCount }: BlogCardProps) {
  const navigate = useNavigate()
  // Use indexed preview if available, otherwise extract from content
  const preview = contentPreview ?? extractText(entry.content, 160)
  // Use indexed thumbnail if available (construct URL from CID and PDS endpoint)
  const thumbnail = useMemo(() => {
    if (firstImageCid && pdsEndpoint) {
      return `${pdsEndpoint}/xrpc/com.atproto.sync.getBlob?did=${entry.authorDid}&cid=${firstImageCid}`
    }
    return extractFirstImage(entry.content)
  }, [firstImageCid, pdsEndpoint, entry.authorDid, entry.content])

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

  // Get platform icon for known external sites
  const platformIcon = useMemo(() => {
    if (!externalUrl) return null
    try {
      const hostname = new URL(externalUrl).hostname.toLowerCase()
      if (hostname.includes('leaflet.pub')) return '/icons/platforms/leaflet.png'
      if (hostname.includes('offprint.app')) return '/icons/platforms/offprint.png'
      if (hostname.includes('pckt.blog')) return '/icons/platforms/pckt.png'
      if (hostname.includes('blento.app')) return '/icons/platforms/blento.png'
      return null
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
              decoding="async"
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
                {platformIcon ? (
                  <img src={platformIcon} alt="" className="w-3 h-3 flex-shrink-0" />
                ) : (
                  <svg className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                )}
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
    <article
      className="relative border border-[var(--site-border)] rounded-lg hover:shadow-md transition-shadow bg-[var(--site-bg)]"
    >
      {(isPinned || onTogglePin) && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          {isPinned && (
            <div className="text-[var(--site-text)] drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]" title="Pinned">
              <svg className="w-4 h-4 rotate-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5M8 7.3V9.44c0 .21 0 .31-.02.41a1 1 0 01-.09.25c-.05.1-.11.18-.24.34L6.08 12.4c-.67.83-1 1.25-1 1.6a1 1 0 00.38.78c.27.22.8.22 1.87.22h9.34c1.07 0 1.6 0 1.87-.22a1 1 0 00.38-.78c0-.35-.33-.77-1-1.6l-1.57-1.96a2 2 0 01-.24-.34 1 1 0 01-.09-.25c-.02-.1-.02-.2-.02-.41V7.3c0-.11 0-.17.01-.23a1 1 0 01.03-.15c.01-.05.04-.1.08-.22l1.01-2.52c.3-.73.44-1.1.38-1.4a1 1 0 00-.43-.63C17.18 2 16.78 2 15.99 2H8.01c-.79 0-1.19 0-1.44.17a1 1 0 00-.43.63c-.06.3.08.66.38 1.4l1.01 2.52c.04.11.06.17.08.22a1 1 0 01.03.15c.01.06.01.12.01.23z" />
              </svg>
            </div>
          )}
          {onTogglePin && (
            <CardOptionsMenu
              rkey={entry.rkey}
              isPinned={!!isPinned}
              pinCount={pinCount ?? 0}
              onTogglePin={onTogglePin}
            />
          )}
        </div>
      )}
      {isNetworkPost && onExternalPostClick ? (
        <button
          type="button"
          onClick={onExternalPostClick}
          className="block w-full text-left rounded-lg overflow-hidden"
          data-external-post-card
        >
          {cardContent}
        </button>
      ) : isNetworkPost ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg overflow-hidden"
        >
          {cardContent}
        </a>
      ) : (
        <Link to={`/${authorHandle}/${entry.rkey}`} className="block rounded-lg overflow-hidden">
          {cardContent}
        </Link>
      )}
    </article>
  )
})
