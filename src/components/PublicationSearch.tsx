import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchPublications, type SearchResult } from '@/lib/appview'

interface PublicationSearchProps {
  placeholder?: string
  className?: string
  onQueryChange?: (query: string) => void  // Called when query changes (debounced, >= 2 chars)
  onClear?: () => void                      // Called when search is cleared or Escape pressed
  disableDropdown?: boolean                 // Don't show dropdown when true (for inline search mode)
}

export function PublicationSearch({ placeholder = 'Search posts, authors, or publications...', className = '', onQueryChange, onClear, disableDropdown = false }: PublicationSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Minimum query length before searching (must match API requirement)
  const MIN_QUERY_LENGTH = 2

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim()
    if (trimmed.length === 0 || trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setIsOpen(false)
      return
    }

    // Skip API call if dropdown is disabled (parent handles search)
    if (disableDropdown) {
      setResults([])
      setIsOpen(false)
      return
    }

    setLoading(true)
    try {
      const response = await searchPublications(searchQuery, 10)
      setResults(response.results)
      setIsOpen(response.results.length > 0)
      setSelectedIndex(-1)
    } catch {
      setResults([])
      setIsOpen(false)
    } finally {
      setLoading(false)
    }
  }, [disableDropdown])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query)
      // Notify parent of query change (only for meaningful queries)
      const trimmed = query.trim()
      if (trimmed.length >= MIN_QUERY_LENGTH) {
        onQueryChange?.(trimmed)
      } else if (trimmed.length === 0) {
        onClear?.()
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, performSearch, onQueryChange, onClear])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  // Handle result selection
  function selectResult(result: SearchResult) {
    setIsOpen(false)
    setQuery('')
    // Navigate to post page for post/tag results, author page otherwise
    if ((result.matchType === 'postTitle' || result.matchType === 'tag') && result.post) {
      navigate(`/${result.handle}/${result.post.rkey}`)
    } else {
      navigate(`/${result.handle}`)
    }
  }

  // Keyboard navigation
  function handleKeyDown(event: React.KeyboardEvent) {
    if (!isOpen) {
      if (event.key === 'Enter' && query.trim()) {
        // If using inline search (onQueryChange provided), don't navigate - let inline search handle it
        if (onQueryChange) {
          return
        }
        // Otherwise navigate to search page
        navigate(`/search?q=${encodeURIComponent(query.trim())}`)
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, -1))
        break
      case 'Enter':
        event.preventDefault()
        if (selectedIndex >= 0 && results[selectedIndex]) {
          selectResult(results[selectedIndex])
        } else if (query.trim()) {
          // If using inline search (onQueryChange provided), don't navigate
          if (onQueryChange) {
            setIsOpen(false)
            return
          }
          // Otherwise navigate to search page
          setIsOpen(false)
          setQuery('')
          navigate(`/search?q=${encodeURIComponent(query.trim())}`)
        }
        break
      case 'Escape':
        event.preventDefault()
        setIsOpen(false)
        // Also clear and notify parent
        if (query.trim()) {
          setQuery('')
          onClear?.()
        }
        break
    }
  }

  // Get match type label
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

  // Get match type color
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

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="w-full px-4 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] focus:border-transparent pr-10"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-5 w-5 text-[var(--site-text-secondary)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}
      </div>

      {/* Dropdown - hidden when disableDropdown is true */}
      {!disableDropdown && isOpen && results.length > 0 && (
        <div ref={listRef} className="search-dropdown absolute z-50 w-full mt-1 bg-[var(--site-bg)] border border-[var(--site-border)] rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {results.map((result, index) => (
            <button
              key={result.post ? `${result.did}:${result.post.rkey}` : result.did}
              onClick={() => selectResult(result)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-[var(--site-bg-secondary)]'
                  : 'hover:bg-[var(--site-bg-secondary)]'
              }`}
            >
              {/* Avatar or Post/Tag icon */}
              {result.matchType === 'postTitle' ? (
                <div className="w-10 h-10 rounded-lg bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              ) : result.matchType === 'tag' ? (
                <div className="w-10 h-10 rounded-lg bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
              ) : result.avatarUrl ? (
                <img
                  src={result.avatarUrl}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  loading="lazy"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[var(--site-border)] flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--site-text)] truncate">
                    {(result.matchType === 'postTitle' || result.matchType === 'tag') && result.post
                      ? result.post.title
                      : result.displayName || result.handle}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${getMatchTypeColor(result.matchType)}`}>
                    {getMatchTypeLabel(result.matchType)}
                  </span>
                </div>
                <div className="text-sm text-[var(--site-text-secondary)] truncate">
                  @{result.handle}
                  {result.publication && (
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
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
