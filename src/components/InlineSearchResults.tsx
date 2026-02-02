import { useEffect, useRef } from 'react'
import { PostSearchResult } from '@/components/PostSearchResult'
import { AuthorSearchResultRow } from '@/components/AuthorSearchResultRow'
import type { UnifiedSearchResult, UnifiedPostResult, UnifiedAuthorResult } from '@/lib/appview'

interface InlineSearchResultsProps {
  results: UnifiedSearchResult[]
  loading: boolean
  query: string
  onClear: () => void
  onExternalPostClick: (result: UnifiedPostResult) => void
  fallbackUsed?: boolean
  selectedIndex: number
  onSelectResult: (index: number) => void
}

/**
 * Convert UnifiedAuthorResult to the legacy SearchResult format
 * expected by AuthorSearchResultRow
 */
function toSearchResult(author: UnifiedAuthorResult) {
  // Map matchedFields to a single matchType for the badge
  const matchedFields = author.matchedFields
  let matchType: 'handle' | 'displayName' | 'publicationName' | 'publicationUrl' = 'handle'
  if (matchedFields.includes('pub')) {
    matchType = 'publicationName'
  } else if (matchedFields.includes('name')) {
    matchType = 'displayName'
  } else if (matchedFields.includes('handle')) {
    matchType = 'handle'
  }

  return {
    did: author.did,
    handle: author.handle,
    displayName: author.displayName,
    avatarUrl: author.avatarUrl,
    publication: author.publication,
    matchType,
  }
}

export function InlineSearchResults({
  results,
  loading,
  query,
  onClear,
  onExternalPostClick,
  fallbackUsed,
  selectedIndex,
  onSelectResult,
}: InlineSearchResultsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  return (
    <div className="min-h-[400px]">
      {/* Results header row */}
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-[var(--site-border)]">
        {/* Result count */}
        {!loading && (
          <span className="text-sm text-[var(--site-text-secondary)]">
            {results.length} result{results.length !== 1 ? 's' : ''}
            {fallbackUsed && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                (keyword fallback)
              </span>
            )}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Close button */}
        <button
          onClick={onClear}
          className="p-1.5 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] rounded-lg transition-colors"
          aria-label="Clear search"
          title="Clear search (Esc)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center py-12">
          <svg className="animate-spin h-8 w-8 text-[var(--site-accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-4 text-sm text-[var(--site-text-secondary)]">
            Searching for "{query}"...
          </p>
        </div>
      )}

      {/* Results list */}
      {!loading && results.length > 0 && (
        <div
          ref={listRef}
          className="search-results-list border border-[var(--site-border)] rounded-lg overflow-y-auto max-h-[60vh] divide-y divide-[var(--site-border)] bg-[var(--site-bg)]"
        >
          {results.map((result, index) => (
            result.type === 'author' ? (
              <AuthorSearchResultRow
                key={`author-${result.did}`}
                result={toSearchResult(result)}
                isSelected={index === selectedIndex}
                onMouseEnter={() => onSelectResult(index)}
              />
            ) : (
              <PostSearchResult
                key={result.uri}
                result={result}
                onExternalPostClick={result.externalUrl ? (post => onExternalPostClick(post as UnifiedPostResult)) : undefined}
                isSelected={index === selectedIndex}
                onMouseEnter={() => onSelectResult(index)}
              />
            )
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && query && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-[var(--site-text-secondary)] opacity-50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-[var(--site-text-secondary)]">
            No results for "{query}"
          </p>
          <p className="text-sm text-[var(--site-text-secondary)] mt-1">
            Try a different search term or mode
          </p>
        </div>
      )}
    </div>
  )
}
