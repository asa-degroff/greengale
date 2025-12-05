import { Link } from 'react-router-dom'
import { extractText, extractFirstImage } from '@/lib/markdown'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'

interface BlogCardProps {
  entry: BlogEntry
  author?: AuthorProfile
}

export function BlogCard({ entry, author }: BlogCardProps) {
  const preview = extractText(entry.content, 160)
  const thumbnail = extractFirstImage(entry.content)

  const formattedDate = entry.createdAt
    ? new Date(entry.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  const authorHandle = author?.handle || entry.authorDid

  return (
    <article className="border border-[var(--site-border)] rounded-lg overflow-hidden hover:shadow-md transition-shadow bg-[var(--site-bg)]">
      <Link to={`/${authorHandle}/${entry.rkey}`} className="block">
        {thumbnail && (
          <div className="aspect-video overflow-hidden bg-[var(--site-bg-secondary)]">
            <img
              src={thumbnail}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}
        <div className="p-4">
          <h2 className="text-lg font-bold mb-2 text-[var(--site-text)] line-clamp-2">
            {entry.title || 'Untitled'}
          </h2>
          {entry.subtitle && (
            <p className="text-sm text-[var(--site-text-secondary)] mb-2 line-clamp-1">
              {entry.subtitle}
            </p>
          )}
          <p className="text-sm text-[var(--site-text-secondary)] line-clamp-3 mb-3">
            {preview}
          </p>
          <div className="flex items-center justify-between text-xs text-[var(--site-text-secondary)]">
            <div className="flex items-center gap-2">
              {author?.avatar && (
                <img
                  src={author.avatar}
                  alt=""
                  className="w-5 h-5 rounded-full"
                />
              )}
              <span>@{authorHandle}</span>
            </div>
            <div className="flex items-center gap-2">
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
              <span className="px-1.5 py-0.5 rounded bg-[var(--site-bg-secondary)] text-[var(--site-text-secondary)]">
                {entry.source === 'whitewind' ? 'WW' : 'GG'}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </article>
  )
}
