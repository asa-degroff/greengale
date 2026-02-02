import { useNavigate } from 'react-router-dom'
import type { PostSearchResult as PostSearchResultType } from '@/lib/appview'

interface PostSearchResultProps {
  result: PostSearchResultType
  onExternalPostClick?: (post: PostSearchResultType) => void
  isSelected?: boolean
  onMouseEnter?: () => void
}

export function PostSearchResult({ result, onExternalPostClick, isSelected, onMouseEnter }: PostSearchResultProps) {
  const navigate = useNavigate()

  function handleClick() {
    // Posts with externalUrl use callback if provided (for slide-in panel)
    if (result.externalUrl && onExternalPostClick) {
      onExternalPostClick(result)
    } else if (result.externalUrl) {
      // Fallback: open external URL directly if no callback
      window.open(result.externalUrl, '_blank', 'noopener,noreferrer')
    } else {
      // Native GreenGale and WhiteWind posts navigate to the in-app post page
      navigate(`/${result.handle}/${result.rkey}`)
    }
  }

  function getMatchTypeBadge(matchType: PostSearchResultType['matchType']) {
    switch (matchType) {
      case 'semantic':
        return {
          label: 'Semantic',
          className: 'bg-amber-500 text-white dark:bg-amber-900/30 dark:text-amber-300',
        }
      case 'keyword':
        return {
          label: 'Keyword',
          className: 'bg-blue-600 text-white dark:bg-blue-900/30 dark:text-blue-300',
        }
      case 'both':
        return {
          label: 'Both',
          className: 'bg-green-600 text-white dark:bg-green-900/30 dark:text-green-300',
        }
    }
  }

  const badge = getMatchTypeBadge(result.matchType)

  function formatDate(dateString: string | null) {
    if (!dateString) return null
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return null
    }
  }

  return (
    <button
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      className={`w-full px-4 py-4 flex items-start gap-4 text-left transition-colors ${
        isSelected
          ? 'bg-[var(--site-bg-secondary)]'
          : 'bg-[var(--site-bg)] hover:bg-[var(--site-bg-secondary)]'
      }`}
    >
      {/* Post icon */}
      <div className="w-12 h-12 rounded-lg bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
        <svg className="w-6 h-6 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[var(--site-text)] line-clamp-2">
            {result.title}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${badge.className}`}>
            {badge.label}
          </span>
          {result.externalUrl && (
            <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap bg-purple-600 text-white dark:bg-purple-900/30 dark:text-purple-300 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              External
            </span>
          )}
        </div>

        {result.subtitle && (
          <p className="text-sm text-[var(--site-text-secondary)] mt-1 line-clamp-1">
            {result.subtitle}
          </p>
        )}

        <div className="flex items-center gap-2 mt-2">
          {result.avatarUrl ? (
            <img
              src={result.avatarUrl}
              alt=""
              className="w-5 h-5 rounded-full object-cover flex-shrink-0"
              loading="lazy"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          )}
          <span className="text-sm text-[var(--site-text-secondary)]">
            {result.displayName || `@${result.handle}`}
          </span>
          {result.createdAt && (
            <>
              <span className="text-[var(--site-text-secondary)]">·</span>
              <span className="text-sm text-[var(--site-text-secondary)]">
                {formatDate(result.createdAt)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Arrow */}
      <svg className="w-5 h-5 text-[var(--site-text-secondary)] flex-shrink-0 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}
