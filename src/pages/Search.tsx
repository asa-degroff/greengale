import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  searchUnified,
  type UnifiedSearchResult,
  type UnifiedPostResult,
  type UnifiedAuthorResult,
  type SearchMode,
  type SearchField,
} from '@/lib/appview'
import { PostSearchResult } from '@/components/PostSearchResult'
import { SearchFilters, dateRangeToAfter, type DateRange } from '@/components/SearchFilters'
import { ExternalPreviewPanel } from '@/components/ExternalPreviewPanel'

const VALID_FIELDS: SearchField[] = ['handle', 'name', 'pub', 'title', 'content']

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // URL state
  const query = searchParams.get('q') || ''
  const modeParam = searchParams.get('mode') as SearchMode | null
  const authorParam = searchParams.get('author') || ''
  const dateParam = searchParams.get('date') as DateRange | null
  const fieldsParam = searchParams.get('fields') || ''

  // Parse fields from URL
  const parseFields = (param: string): SearchField[] => {
    if (!param) return []
    return param.split(',').filter((f): f is SearchField => VALID_FIELDS.includes(f as SearchField))
  }

  // Local state
  const [inputValue, setInputValue] = useState(query)
  const [mode, setMode] = useState<SearchMode>(modeParam || 'hybrid')
  const [author, setAuthor] = useState(authorParam)
  const [dateRange, setDateRange] = useState<DateRange>(dateParam || 'any')
  const [fields, setFields] = useState<SearchField[]>(parseFields(fieldsParam))

  // Results state
  const [results, setResults] = useState<UnifiedSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [fallbackUsed, setFallbackUsed] = useState(false)

  // External post preview panel state
  const [selectedExternalPost, setSelectedExternalPost] = useState<UnifiedPostResult | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abortControllerRef = useRef<AbortController | null>(null)

  const MIN_QUERY_LENGTH = 2
  const PAGE_SIZE = 25

  // Update URL when filters change
  const updateUrl = useCallback((updates: Record<string, string | undefined>) => {
    const newParams = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        newParams.set(key, value)
      } else {
        newParams.delete(key)
      }
    }
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams])

  // Perform unified search
  const performSearch = useCallback(async (searchQuery: string, appendResults = false) => {
    const trimmed = searchQuery.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setTotal(0)
      setHasMore(false)
      setSearched(trimmed.length > 0)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    if (appendResults) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setOffset(0)
    }
    setSearched(true)
    setFallbackUsed(false)

    try {
      const afterDate = dateRangeToAfter(dateRange)
      const searchOffset = appendResults ? offset + PAGE_SIZE : 0

      const response = await searchUnified(trimmed, {
        limit: PAGE_SIZE,
        offset: searchOffset,
        mode,
        author: author || undefined,
        after: afterDate,
        fields: fields.length > 0 ? fields : undefined,
        signal,
      })

      if (appendResults) {
        setResults(prev => [...prev, ...response.results])
        setOffset(searchOffset)
      } else {
        setResults(response.results)
        setOffset(0)
      }

      setTotal(response.total)
      setHasMore(response.hasMore)

      if (response.fallback === 'keyword') {
        setFallbackUsed(true)
      }
    } catch (err) {
      // Silently ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (!appendResults) {
        setResults([])
        setTotal(0)
        setHasMore(false)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [mode, author, dateRange, fields, offset])

  // Search when query or filters change (reset pagination)
  useEffect(() => {
    if (query) {
      setSelectedExternalPost(null)  // Close any open preview panel when search changes
      performSearch(query, false)
    }
  }, [query, mode, author, dateRange, fields]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle input changes with debounce
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (inputValue !== query) {
      debounceRef.current = setTimeout(() => {
        if (inputValue.trim()) {
          updateUrl({ q: inputValue.trim() })
        } else {
          updateUrl({ q: undefined })
          setResults([])
          setTotal(0)
          setHasMore(false)
          setSearched(false)
        }
      }, 300)
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [inputValue, query, updateUrl])

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && inputValue.trim()) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      updateUrl({ q: inputValue.trim() })
    }
  }

  function handleModeChange(newMode: SearchMode) {
    setMode(newMode)
    updateUrl({ mode: newMode === 'hybrid' ? undefined : newMode })
  }

  function handleAuthorChange(newAuthor: string) {
    setAuthor(newAuthor)
    updateUrl({ author: newAuthor || undefined })
  }

  function handleDateRangeChange(newRange: DateRange) {
    setDateRange(newRange)
    updateUrl({ date: newRange === 'any' ? undefined : newRange })
  }

  function handleFieldsChange(newFields: SearchField[]) {
    setFields(newFields)
    updateUrl({ fields: newFields.length > 0 ? newFields.join(',') : undefined })
  }

  function handleLoadMore() {
    if (!loadingMore && hasMore) {
      performSearch(query, true)
    }
  }

  function handleAuthorResultClick(result: UnifiedAuthorResult) {
    navigate(`/${result.handle}`)
  }

  // Convert unified post result to PostSearchResult type for the component
  function toPostSearchResultType(result: UnifiedPostResult) {
    return {
      uri: result.uri,
      authorDid: result.authorDid,
      handle: result.handle,
      displayName: result.displayName,
      avatarUrl: result.avatarUrl,
      rkey: result.rkey,
      title: result.title,
      subtitle: result.subtitle,
      createdAt: result.createdAt,
      contentPreview: result.contentPreview,
      score: result.score,
      matchType: result.matchType,
      source: result.source,
      externalUrl: result.externalUrl,
    }
  }

  // Get field match badge colors
  function getFieldBadgeColor(field: SearchField): string {
    switch (field) {
      case 'handle':
        return 'bg-blue-600 text-white dark:bg-blue-900/30 dark:text-blue-300'
      case 'name':
        return 'bg-green-600 text-white dark:bg-green-900/30 dark:text-green-300'
      case 'pub':
        return 'bg-purple-600 text-white dark:bg-purple-900/30 dark:text-purple-300'
      case 'title':
        return 'bg-cyan-600 text-white dark:bg-cyan-900/30 dark:text-cyan-300'
      case 'content':
        return 'bg-orange-500 text-white dark:bg-orange-900/30 dark:text-orange-300'
    }
  }

  function getFieldLabel(field: SearchField): string {
    switch (field) {
      case 'handle':
        return 'Handle'
      case 'name':
        return 'Name'
      case 'pub':
        return 'Publication'
      case 'title':
        return 'Title'
      case 'content':
        return 'Content'
    }
  }

  return (
    <div
      className="max-w-3xl mx-auto px-4 py-8 search-content-slide"
      data-panel-open={selectedExternalPost ? 'true' : 'false'}
    >
      {/* Search Input */}
      <div className="relative mb-4">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search posts, authors, or publications..."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          autoFocus
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] focus:border-transparent text-lg"
        />
        {loading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-5 w-5 text-[var(--site-text-secondary)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-6">
        <SearchFilters
          mode={mode}
          onModeChange={handleModeChange}
          author={author}
          onAuthorChange={handleAuthorChange}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
          fields={fields}
          onFieldsChange={handleFieldsChange}
        />
      </div>

      {/* Results Header */}
      {searched && !loading && (
        <div className="mb-4 text-[var(--site-text-secondary)]">
          {results.length > 0 ? (
            <span>
              {total > results.length
                ? `Showing ${results.length} of ${total} results`
                : `${total} result${total !== 1 ? 's' : ''}`
              } for "{query}"
              {fallbackUsed && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  (using keyword search - semantic unavailable)
                </span>
              )}
            </span>
          ) : query.length < MIN_QUERY_LENGTH ? (
            <span>Enter at least {MIN_QUERY_LENGTH} characters to search</span>
          ) : (
            <span>No results found for "{query}"</span>
          )}
        </div>
      )}

      {/* Unified Results */}
      {results.length > 0 && (
        <div className="border border-[var(--site-border)] rounded-lg overflow-hidden divide-y divide-[var(--site-border)] bg-[var(--site-bg)]">
          {results.map((result) => {
            if (result.type === 'post') {
              return (
                <PostSearchResult
                  key={result.uri}
                  result={toPostSearchResultType(result)}
                  onExternalPostClick={result.externalUrl ? () => setSelectedExternalPost(result) : undefined}
                />
              )
            } else {
              // Author result
              return (
                <button
                  key={result.did}
                  onClick={() => handleAuthorResultClick(result)}
                  className="w-full px-4 py-4 flex items-center gap-4 text-left transition-colors bg-[var(--site-bg)] hover:bg-[var(--site-bg-secondary)]"
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
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-600 text-white dark:bg-gray-700 dark:text-gray-300">
                        Author
                      </span>
                      {/* Show which fields matched */}
                      {result.matchedFields.map(field => (
                        <span
                          key={field}
                          className={`text-xs px-2 py-0.5 rounded ${getFieldBadgeColor(field)}`}
                        >
                          {getFieldLabel(field)}
                        </span>
                      ))}
                    </div>
                    <div className="text-sm text-[var(--site-text-secondary)] truncate mt-0.5">
                      @{result.handle}
                      {result.publication && (
                        <span className="ml-2">
                          · {result.publication.name}
                          {result.publication.isExternal && (
                            <span className="ml-1 text-purple-500">
                              <svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </span>
                          )}
                        </span>
                      )}
                      {result.postsCount > 0 && (
                        <span className="ml-2">· {result.postsCount} post{result.postsCount !== 1 ? 's' : ''}</span>
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
          })}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-6 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] transition-colors disabled:opacity-50"
          >
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading...
              </span>
            ) : (
              `Load More (${total - results.length} remaining)`
            )}
          </button>
        </div>
      )}

      {/* Empty State */}
      {searched && !loading && results.length === 0 && query.length >= MIN_QUERY_LENGTH && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-[var(--site-text-secondary)] opacity-50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-[var(--site-text-secondary)]">
            No results match your search and filters.
          </p>
        </div>
      )}

      {/* External Post Preview Panel */}
      <ExternalPreviewPanel
        post={selectedExternalPost ? toPostSearchResultType(selectedExternalPost) : null}
        onClose={() => setSelectedExternalPost(null)}
      />
    </div>
  )
}
