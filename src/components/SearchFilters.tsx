import { useState, useEffect, useRef, useCallback } from 'react'
import type { SearchMode } from '@/lib/appview'

export type DateRange = 'any' | 'week' | 'month' | 'year'

interface SearchFiltersProps {
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  author: string
  onAuthorChange: (author: string) => void
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
}

interface BlueskyActor {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

export function SearchFilters({
  mode,
  onModeChange,
  author,
  onAuthorChange,
  dateRange,
  onDateRangeChange,
}: SearchFiltersProps) {
  const [authorInput, setAuthorInput] = useState(author)
  const [results, setResults] = useState<BlueskyActor[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external author changes to input
  useEffect(() => {
    setAuthorInput(author)
  }, [author])

  const searchActors = useCallback(async (query: string) => {
    const trimmed = query.replace(/^@/, '').trim()
    if (trimmed.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(trimmed)}&limit=8`
      )
      if (res.ok) {
        const data = await res.json()
        const actors: BlueskyActor[] = data.actors || []
        setResults(actors)
        setIsOpen(actors.length > 0)
        setSelectedIndex(-1)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setAuthorInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchActors(value), 300)
  }

  function selectActor(actor: BlueskyActor) {
    setAuthorInput(actor.handle)
    setIsOpen(false)
    setResults([])
    onAuthorChange(actor.handle)
  }

  function handleBlur() {
    // Delay to allow click on result
    setTimeout(() => {
      const trimmed = authorInput.replace(/^@/, '').trim()
      if (trimmed !== author) {
        onAuthorChange(trimmed)
      }
    }, 150)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && results[selectedIndex]) {
        selectActor(results[selectedIndex])
      } else {
        const trimmed = authorInput.replace(/^@/, '').trim()
        onAuthorChange(trimmed)
        setIsOpen(false)
      }
    } else if (isOpen && results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setIsOpen(false)
        setSelectedIndex(-1)
      }
    }
  }

  function clearAuthor() {
    setAuthorInput('')
    onAuthorChange('')
    inputRef.current?.focus()
  }

  // Click outside closes dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Mode selector */}
      <div className="flex rounded-lg border border-[var(--site-border)] overflow-hidden">
        {(['hybrid', 'semantic', 'keyword'] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m
                ? 'bg-[var(--site-accent)] text-white'
                : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Author filter */}
      <div ref={containerRef} className="relative">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={authorInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onFocus={() => results.length > 0 && setIsOpen(true)}
            placeholder="Filter by author..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="w-40 px-3 py-1.5 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)] pr-8"
          />
          {authorInput && (
            <button
              onClick={clearAuthor}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--site-text-secondary)] hover:text-[var(--site-text)]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {loading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-[var(--site-text-secondary)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        {isOpen && results.length > 0 && (
          <ul
            ref={listRef}
            className="absolute top-full mt-1 left-0 w-64 max-h-64 overflow-y-auto rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] shadow-lg z-50"
          >
            {results.map((actor, i) => (
              <li key={actor.did}>
                <button
                  type="button"
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--site-bg-secondary)] transition-colors ${
                    i === selectedIndex ? 'bg-[var(--site-bg-secondary)]' : ''
                  }`}
                  onClick={() => selectActor(actor)}
                  tabIndex={-1}
                >
                  {actor.avatar ? (
                    <img
                      src={actor.avatar}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-[var(--site-bg-secondary)] flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-[var(--site-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {actor.displayName && (
                      <div className="text-sm font-medium text-[var(--site-text)] truncate">
                        {actor.displayName}
                      </div>
                    )}
                    <div className="text-xs text-[var(--site-text-secondary)] truncate">
                      @{actor.handle}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Date range selector */}
      <div className="flex rounded-lg border border-[var(--site-border)] overflow-hidden">
        {([
          { value: 'any', label: 'Any time' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ] as const).map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onDateRangeChange(value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              dateRange === value
                ? 'bg-[var(--site-accent)] text-white'
                : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Convert date range to ISO date string for the API
 */
export function dateRangeToAfter(range: DateRange): string | undefined {
  if (range === 'any') return undefined

  const now = new Date()
  switch (range) {
    case 'week':
      now.setDate(now.getDate() - 7)
      break
    case 'month':
      now.setMonth(now.getMonth() - 1)
      break
    case 'year':
      now.setFullYear(now.getFullYear() - 1)
      break
  }
  return now.toISOString()
}
