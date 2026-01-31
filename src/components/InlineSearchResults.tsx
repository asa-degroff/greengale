import { PostSearchResult } from '@/components/PostSearchResult'
import type { PostSearchResult as PostSearchResultType, SearchMode } from '@/lib/appview'

interface InlineSearchResultsProps {
  results: PostSearchResultType[]
  loading: boolean
  query: string
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  onClear: () => void
  onExternalPostClick: (result: PostSearchResultType) => void
  fallbackUsed?: boolean
}

export function InlineSearchResults({
  results,
  loading,
  query,
  mode,
  onModeChange,
  onClear,
  onExternalPostClick,
  fallbackUsed,
}: InlineSearchResultsProps) {
  const modes: { value: SearchMode; label: string }[] = [
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'semantic', label: 'Semantic' },
    { value: 'keyword', label: 'Keyword' },
  ]

  return (
    <div className="min-h-[400px]">
      {/* Options row */}
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-[var(--site-border)]">
        {/* Mode selector */}
        <div className="flex gap-1">
          {modes.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onModeChange(value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                mode === value
                  ? 'bg-[var(--site-accent)] text-white'
                  : 'bg-[var(--site-bg-secondary)] text-[var(--site-text-secondary)] hover:text-[var(--site-text)] border border-[var(--site-border)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

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
        <div className="border border-[var(--site-border)] rounded-lg overflow-hidden divide-y divide-[var(--site-border)] bg-[var(--site-bg)]">
          {results.map((result) => (
            <PostSearchResult
              key={result.uri}
              result={result}
              onExternalPostClick={result.externalUrl ? onExternalPostClick : undefined}
            />
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
