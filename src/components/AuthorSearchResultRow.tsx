import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SearchResult } from '@/lib/appview'
import { getPlatformInfo, getExternalDomain } from '@/lib/platform-utils'

// Static badge config - defined outside component to avoid recreation
const MATCH_TYPE_BADGES = {
  handle: {
    label: 'Handle',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  displayName: {
    label: 'Name',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  publicationName: {
    label: 'Publication',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  },
  publicationUrl: {
    label: 'URL',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  },
} as const

const DEFAULT_BADGE = {
  label: 'Match',
  className: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
}

interface AuthorSearchResultRowProps {
  result: SearchResult
  isSelected?: boolean
  onMouseEnter?: () => void
}

export function AuthorSearchResultRow({ result, isSelected, onMouseEnter }: AuthorSearchResultRowProps) {
  const navigate = useNavigate()

  // Check if this is an external publication (e.g., Blento)
  const isExternal = result.publication?.isExternal && result.publication?.url

  const handleClick = useCallback(() => {
    if (isExternal && result.publication?.url) {
      // Open external publication URL in new tab
      window.open(result.publication.url, '_blank', 'noopener,noreferrer')
    } else {
      // Navigate to GreenGale profile
      navigate(`/${result.handle}`)
    }
  }, [isExternal, result.publication?.url, result.handle, navigate])

  const platformInfo = useMemo(
    () => (isExternal && result.publication?.url ? getPlatformInfo(result.publication.url) : null),
    [isExternal, result.publication?.url]
  )

  const badge = result.matchType && result.matchType in MATCH_TYPE_BADGES
    ? MATCH_TYPE_BADGES[result.matchType as keyof typeof MATCH_TYPE_BADGES]
    : DEFAULT_BADGE

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
          <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
            Author
          </span>
          <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${badge.className}`}>
            {badge.label}
          </span>
          {isExternal && (
            <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 flex items-center gap-1">
              {platformInfo ? (
                <img src={platformInfo.icon} alt="" className="w-3 h-3" />
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              )}
              {platformInfo ? platformInfo.name : 'External'}
            </span>
          )}
        </div>

        <div className="text-sm text-[var(--site-text-secondary)] truncate mt-1">
          @{result.handle}
          {result.publication && (
            <span className="ml-2">
              · {result.publication.name}
              {isExternal && result.publication.url && (
                <span className="ml-1 text-purple-600 dark:text-purple-400">
                  ({getExternalDomain(result.publication.url)})
                </span>
              )}
            </span>
          )}
          {result.postsCount !== undefined && result.postsCount > 0 && (
            <span className="ml-2">· {result.postsCount} post{result.postsCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Arrow or External Link Icon */}
      {isExternal ? (
        <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      ) : (
        <svg className="w-5 h-5 text-[var(--site-text-secondary)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  )
}
