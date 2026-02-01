import { useNavigate } from 'react-router-dom'
import type { SearchResult } from '@/lib/appview'

interface AuthorSearchResultRowProps {
  result: SearchResult
  isSelected?: boolean
  onMouseEnter?: () => void
}

export function AuthorSearchResultRow({ result, isSelected, onMouseEnter }: AuthorSearchResultRowProps) {
  const navigate = useNavigate()

  function handleClick() {
    navigate(`/${result.handle}`)
  }

  function getMatchTypeBadge(matchType: SearchResult['matchType']) {
    switch (matchType) {
      case 'handle':
        return {
          label: 'Handle',
          className: 'bg-blue-600 text-white dark:bg-blue-900/30 dark:text-blue-300',
        }
      case 'displayName':
        return {
          label: 'Name',
          className: 'bg-green-600 text-white dark:bg-green-900/30 dark:text-green-300',
        }
      case 'publicationName':
        return {
          label: 'Publication',
          className: 'bg-purple-600 text-white dark:bg-purple-900/30 dark:text-purple-300',
        }
      case 'publicationUrl':
        return {
          label: 'URL',
          className: 'bg-orange-500 text-white dark:bg-orange-900/30 dark:text-orange-300',
        }
      default:
        return {
          label: 'Match',
          className: 'bg-gray-600 text-white dark:bg-gray-900/30 dark:text-gray-300',
        }
    }
  }

  const badge = getMatchTypeBadge(result.matchType)

  return (
    <button
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      className={`w-full px-4 py-4 flex items-center gap-4 text-left transition-colors ${
        isSelected
          ? 'bg-[var(--site-bg-secondary)]'
          : 'bg-[var(--site-bg)] hover:bg-[var(--site-bg-secondary)]'
      }`}
    >
      {/* Avatar */}
      {result.avatarUrl ? (
        <img
          src={result.avatarUrl}
          alt=""
          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
          <svg className="w-6 h-6 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[var(--site-text)] truncate">
            {result.displayName || result.handle}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        <div className="text-sm text-[var(--site-text-secondary)] truncate mt-1">
          @{result.handle}
          {result.publication && (
            <span className="ml-2 text-[var(--site-accent)]">
              {result.publication.name}
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <svg className="w-5 h-5 text-[var(--site-text-secondary)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}
