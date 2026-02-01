import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  searchPublications,
  searchPosts,
  type SearchResult,
  type PostSearchResult as PostSearchResultType,
  type SearchMode,
} from '@/lib/appview'
import { PostSearchResult } from '@/components/PostSearchResult'
import { SearchFilters, dateRangeToAfter, type DateRange } from '@/components/SearchFilters'
import { ExternalPreviewPanel } from '@/components/ExternalPreviewPanel'

type SearchTab = 'posts' | 'authors'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // URL state
  const query = searchParams.get('q') || ''
  const tabParam = searchParams.get('type') as SearchTab | null
  const modeParam = searchParams.get('mode') as SearchMode | null
  const authorParam = searchParams.get('author') || ''
  const dateParam = searchParams.get('date') as DateRange | null

  // Local state
  const [inputValue, setInputValue] = useState(query)
  const [activeTab, setActiveTab] = useState<SearchTab>(tabParam === 'authors' ? 'authors' : 'posts')
  const [mode, setMode] = useState<SearchMode>(modeParam || 'hybrid')
  const [author, setAuthor] = useState(authorParam)
  const [dateRange, setDateRange] = useState<DateRange>(dateParam || 'any')

  // Results state
  const [authorResults, setAuthorResults] = useState<SearchResult[]>([])
  const [postResults, setPostResults] = useState<PostSearchResultType[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [fallbackUsed, setFallbackUsed] = useState(false)

  // External post preview panel state
  const [selectedExternalPost, setSelectedExternalPost] = useState<PostSearchResultType | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abortControllerRef = useRef<AbortController | null>(null)

  const MIN_QUERY_LENGTH = 2

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

  // Perform search based on active tab
  const performSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setAuthorResults([])
      setPostResults([])
      setSearched(trimmed.length > 0)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setLoading(true)
    setSearched(true)
    setFallbackUsed(false)

    try {
      if (activeTab === 'posts') {
        const afterDate = dateRangeToAfter(dateRange)
        const response = await searchPosts(trimmed, {
          limit: 50,
          mode,
          author: author || undefined,
          after: afterDate,
          signal,
        })
        setPostResults(response.posts)
        if (response.fallback === 'keyword') {
          setFallbackUsed(true)
        }
      } else {
        const response = await searchPublications(trimmed, 50, signal)
        setAuthorResults(response.results)
      }
    } catch (err) {
      // Silently ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      setAuthorResults([])
      setPostResults([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, mode, author, dateRange])

  // Search when query or filters change
  useEffect(() => {
    if (query) {
      performSearch(query)
    }
  }, [query, performSearch])

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
          setAuthorResults([])
          setPostResults([])
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

  function handleTabChange(tab: SearchTab) {
    setActiveTab(tab)
    updateUrl({ type: tab === 'posts' ? undefined : tab })
    // Clear results and re-search
    setAuthorResults([])
    setPostResults([])
    if (query.trim().length >= MIN_QUERY_LENGTH) {
      setSearched(false) // Trigger re-search via effect
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

  function handleAuthorResultClick(result: SearchResult) {
    if ((result.matchType === 'postTitle' || result.matchType === 'tag') && result.post) {
      navigate(`/${result.handle}/${result.post.rkey}`)
    } else {
      navigate(`/${result.handle}`)
    }
  }

  function getMatchTypeLabel(matchType: SearchResult['matchType']): string {
    switch (matchType) {
      case 'handle':
        return 'Handle'
      case 'displayName':
        return 'Name'
      case 'publicationName':
        return 'Publication'
      case 'publicationUrl':
        return 'URL'
      case 'postTitle':
        return 'Post'
      case 'tag':
        return 'Tag'
    }
  }

  function getMatchTypeColor(matchType: SearchResult['matchType']): string {
    switch (matchType) {
      case 'handle':
        return 'bg-blue-600 text-white dark:bg-blue-900/30 dark:text-blue-300'
      case 'displayName':
        return 'bg-green-600 text-white dark:bg-green-900/30 dark:text-green-300'
      case 'publicationName':
        return 'bg-purple-600 text-white dark:bg-purple-900/30 dark:text-purple-300'
      case 'publicationUrl':
        return 'bg-orange-500 text-white dark:bg-orange-900/30 dark:text-orange-300'
      case 'postTitle':
        return 'bg-cyan-600 text-white dark:bg-cyan-900/30 dark:text-cyan-300'
      case 'tag':
        return 'bg-pink-600 text-white dark:bg-pink-900/30 dark:text-pink-300'
    }
  }

  const results = activeTab === 'posts' ? postResults : authorResults

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
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

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[var(--site-border)]">
        <button
          onClick={() => handleTabChange('posts')}
          className={`px-4 py-2 font-medium transition-colors relative ${
            activeTab === 'posts'
              ? 'text-[var(--site-accent)]'
              : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
          }`}
        >
          Posts
          {activeTab === 'posts' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
          )}
        </button>
        <button
          onClick={() => handleTabChange('authors')}
          className={`px-4 py-2 font-medium transition-colors relative ${
            activeTab === 'authors'
              ? 'text-[var(--site-accent)]'
              : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
          }`}
        >
          Authors
          {activeTab === 'authors' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
          )}
        </button>
      </div>

      {/* Filters (Posts tab only) */}
      {activeTab === 'posts' && (
        <div className="mb-6">
          <SearchFilters
            mode={mode}
            onModeChange={handleModeChange}
            author={author}
            onAuthorChange={handleAuthorChange}
            dateRange={dateRange}
            onDateRangeChange={handleDateRangeChange}
          />
        </div>
      )}

      {/* Results Header */}
      {searched && !loading && (
        <div className="mb-4 text-[var(--site-text-secondary)]">
          {results.length > 0 ? (
            <span>
              {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
              {fallbackUsed && activeTab === 'posts' && (
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

      {/* Post Results */}
      {activeTab === 'posts' && postResults.length > 0 && (
        <div className="border border-[var(--site-border)] rounded-lg overflow-hidden divide-y divide-[var(--site-border)] bg-[var(--site-bg)]">
          {postResults.map((result) => (
            <PostSearchResult
              key={result.uri}
              result={result}
              onExternalPostClick={result.externalUrl ? setSelectedExternalPost : undefined}
            />
          ))}
        </div>
      )}

      {/* Author Results */}
      {activeTab === 'authors' && authorResults.length > 0 && (
        <div className="border border-[var(--site-border)] rounded-lg overflow-hidden divide-y divide-[var(--site-border)] bg-[var(--site-bg)]">
          {authorResults.map((result) => (
            <button
              key={result.post ? `${result.did}:${result.post.rkey}` : `${result.did}:${result.matchType}`}
              onClick={() => handleAuthorResultClick(result)}
              className="w-full px-4 py-4 flex items-center gap-4 text-left transition-colors bg-[var(--site-bg)] hover:bg-[var(--site-bg-secondary)]"
            >
              {/* Avatar or Post/Tag icon */}
              {result.matchType === 'postTitle' ? (
                <div className="w-12 h-12 rounded-lg bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              ) : result.matchType === 'tag' ? (
                <div className="w-12 h-12 rounded-lg bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
              ) : result.avatarUrl ? (
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
                    {(result.matchType === 'postTitle' || result.matchType === 'tag') && result.post
                      ? result.post.title
                      : result.displayName || result.handle}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${getMatchTypeColor(result.matchType)}`}>
                    {getMatchTypeLabel(result.matchType)}
                  </span>
                </div>
                <div className="text-sm text-[var(--site-text-secondary)] truncate mt-0.5">
                  @{result.handle}
                  {result.publication && (result.matchType === 'publicationName' || result.matchType === 'publicationUrl') && (
                    <span className="ml-2">
                      {result.matchType === 'publicationName' && (
                        <span className="text-[var(--site-accent)]">{result.publication.name}</span>
                      )}
                      {result.matchType === 'publicationUrl' && result.publication.url && (
                        <span className="text-[var(--site-accent)]">{result.publication.url}</span>
                      )}
                    </span>
                  )}
                  {result.matchType === 'tag' && result.tag && (
                    <span className="ml-2 text-[var(--site-accent)]">{result.tag}</span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-5 h-5 text-[var(--site-text-secondary)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {/* Empty State */}
      {searched && !loading && results.length === 0 && query.length >= MIN_QUERY_LENGTH && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-[var(--site-text-secondary)] opacity-50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-[var(--site-text-secondary)]">
            {activeTab === 'posts'
              ? 'No posts match your search and filters.'
              : 'No authors or publications match your search.'}
          </p>
        </div>
      )}

      {/* External Post Preview Panel */}
      <ExternalPreviewPanel
        post={selectedExternalPost}
        onClose={() => setSelectedExternalPost(null)}
      />
    </div>
  )
}
