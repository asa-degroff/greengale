import { useState, useEffect, useRef, useCallback } from 'react'
import type { SearchMode } from '@/lib/appview'

export type DateRange = 'any' | 'week' | 'month' | 'year' | 'custom'

export interface CustomDateRange {
  after?: string  // ISO date string
  before?: string // ISO date string
}

interface SearchFiltersProps {
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  author: string
  onAuthorChange: (author: string) => void
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  customDates?: CustomDateRange
  onCustomDatesChange?: (dates: CustomDateRange) => void
}

interface BlueskyActor {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

const DATE_OPTIONS = [
  { value: 'any', label: 'Any time' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
  { value: 'year', label: 'Past year' },
  { value: 'custom', label: 'Custom range' },
] as const

export function SearchFilters({
  mode,
  onModeChange,
  author,
  onAuthorChange,
  dateRange,
  onDateRangeChange,
  customDates,
  onCustomDatesChange,
}: SearchFiltersProps) {
  const [authorInput, setAuthorInput] = useState(author)
  const [results, setResults] = useState<BlueskyActor[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showCustomDates, setShowCustomDates] = useState(dateRange === 'custom')
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dateDropdownRef = useRef<HTMLDivElement>(null)

  // Sync showCustomDates with dateRange
  useEffect(() => {
    setShowCustomDates(dateRange === 'custom')
  }, [dateRange])

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

  // Click outside closes dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setIsDateDropdownOpen(false)
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

  function handleCustomDateChange(field: 'after' | 'before', value: string) {
    if (onCustomDatesChange) {
      onCustomDatesChange({
        ...customDates,
        [field]: value || undefined,
      })
    }
  }

  return (
    <div className="space-y-3">
      {/* Main filters row */}
      <div className="flex gap-3 items-center">
        {/* Mode selector */}
        <div className="flex rounded-lg border border-[var(--site-border)] overflow-hidden flex-shrink-0">
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

        {/* Author filter - grows to fill space */}
        <div ref={containerRef} className="relative flex-1 min-w-0">
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
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)] pr-8"
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

        {/* Date range selector - dropdown on mobile, inline buttons on desktop */}
        {/* Mobile dropdown */}
        <div ref={dateDropdownRef} className="relative md:hidden flex-shrink-0">
          <button
            onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--site-border)] transition-colors ${
              dateRange !== 'any'
                ? 'bg-[var(--site-accent)] text-white border-[var(--site-accent)]'
                : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>{dateRange === 'any' ? 'Date' : DATE_OPTIONS.find(o => o.value === dateRange)?.label.replace('Past ', '')}</span>
            <svg className={`w-3 h-3 transition-transform ${isDateDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isDateDropdownOpen && (
            <div className="absolute top-full mt-1 right-0 w-40 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] shadow-lg z-50 overflow-hidden">
              {DATE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    onDateRangeChange(value)
                    setIsDateDropdownOpen(false)
                  }}
                  className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                    dateRange === value
                      ? 'bg-[var(--site-accent)] text-white'
                      : 'text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Desktop inline buttons */}
        <div className="hidden md:flex rounded-lg border border-[var(--site-border)] overflow-hidden flex-shrink-0">
          {([
            { value: 'any', label: 'Any' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
            { value: 'custom', label: 'Custom' },
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

      {/* Custom date range inputs */}
      {showCustomDates && (
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--site-text-secondary)] w-12 sm:w-auto">From:</span>
            <input
              type="date"
              value={customDates?.after?.split('T')[0] || ''}
              onChange={(e) => handleCustomDateChange('after', e.target.value ? new Date(e.target.value).toISOString() : '')}
              className="flex-1 sm:flex-none px-3 py-1.5 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--site-text-secondary)] w-12 sm:w-auto">To:</span>
            <input
              type="date"
              value={customDates?.before?.split('T')[0] || ''}
              onChange={(e) => handleCustomDateChange('before', e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : '')}
              className="flex-1 sm:flex-none px-3 py-1.5 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Convert date range to ISO date strings for the API
 */
export function dateRangeToParams(range: DateRange, customDates?: CustomDateRange): { after?: string; before?: string } {
  if (range === 'any') return {}

  if (range === 'custom') {
    return {
      after: customDates?.after,
      before: customDates?.before,
    }
  }

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
  return { after: now.toISOString() }
}

/**
 * Convert date range to ISO date string for the API (legacy, for backward compatibility)
 * @deprecated Use dateRangeToParams instead
 */
export function dateRangeToAfter(range: DateRange): string | undefined {
  if (range === 'any' || range === 'custom') return undefined

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
