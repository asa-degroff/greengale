import { useState, useEffect, useRef, useCallback } from 'react'
import type { SearchMode, SearchField } from '@/lib/appview'

export type DateRange = 'any' | 'week' | 'month' | 'year' | 'custom'

export interface CustomDateRange {
  after?: string  // ISO date string
  before?: string // ISO date string
}

export type { SearchField }

interface SearchFiltersProps {
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  author: string
  onAuthorChange: (author: string) => void
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  customDates?: CustomDateRange
  onCustomDatesChange?: (dates: CustomDateRange) => void
  fields: SearchField[]
  onFieldsChange: (fields: SearchField[]) => void
}

const FIELD_OPTIONS: { value: SearchField; label: string }[] = [
  { value: 'handle', label: 'Handle' },
  { value: 'name', label: 'Name' },
  { value: 'pub', label: 'Publication' },
  { value: 'content', label: 'Content' },
]

interface BlueskyActor {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

const DATE_OPTIONS = [
  { value: 'any', label: 'Any time', shortLabel: 'Any' },
  { value: 'week', label: 'Past week', shortLabel: 'Week' },
  { value: 'month', label: 'Past month', shortLabel: 'Month' },
  { value: 'year', label: 'Past year', shortLabel: 'Year' },
  { value: 'custom', label: 'Custom range', shortLabel: 'Custom' },
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
  fields,
  onFieldsChange,
}: SearchFiltersProps) {
  const [authorInput, setAuthorInput] = useState(author)
  const [results, setResults] = useState<BlueskyActor[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(false)

  // Derive showCustomDates directly from prop (no state needed)
  const showCustomDates = dateRange === 'custom'

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Sync external author changes to input (e.g., when parent clears the filter)
  useEffect(() => {
    setAuthorInput(author)
  }, [author])

  // Cleanup pending requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const searchActors = useCallback(async (query: string) => {
    const trimmed = query.replace(/^@/, '').trim()
    if (trimmed.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setLoading(true)
    try {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(trimmed)}&limit=8`,
        { signal: abortControllerRef.current.signal }
      )
      if (res.ok) {
        const data = await res.json()
        const actors: BlueskyActor[] = data.actors || []
        setResults(actors)
        setIsOpen(actors.length > 0)
        setSelectedIndex(-1)
      }
    } catch (err) {
      // Ignore abort errors, silently fail others
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setAuthorInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchActors(value), 300)
  }, [searchActors])

  const selectActor = useCallback((actor: BlueskyActor) => {
    setAuthorInput(actor.handle)
    setIsOpen(false)
    setResults([])
    onAuthorChange(actor.handle)
  }, [onAuthorChange])

  const handleBlur = useCallback(() => {
    // Delay to allow click on result
    setTimeout(() => {
      setAuthorInput(current => {
        const trimmed = current.replace(/^@/, '').trim()
        if (trimmed !== author) {
          onAuthorChange(trimmed)
        }
        return current
      })
    }, 150)
  }, [author, onAuthorChange])

  // Note: handleKeyDown uses current state values directly. Since this is passed
  // to a native <input> element (not a memoized child component), recreating it
  // on state changes is acceptable and keeps the code readable.
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

  const clearAuthor = useCallback(() => {
    setAuthorInput('')
    onAuthorChange('')
    inputRef.current?.focus()
  }, [onAuthorChange])

  // Click outside closes the author autocomplete dropdown
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

  const handleCustomDateChange = useCallback((field: 'after' | 'before', value: string) => {
    if (onCustomDatesChange) {
      onCustomDatesChange({
        ...customDates,
        [field]: value || undefined,
      })
    }
  }, [customDates, onCustomDatesChange])

  // Check if "All" is effectively selected (no fields or all fields)
  const isAllSelected = fields.length === 0 || fields.length === FIELD_OPTIONS.length

  const handleFieldToggle = useCallback((field: SearchField) => {
    // If "All" is currently selected, clicking a field should select ONLY that field
    if (isAllSelected) {
      onFieldsChange([field])
      return
    }

    if (fields.includes(field)) {
      // Remove field - if this leaves only one field, keep it (don't allow empty via toggle)
      const newFields = fields.filter(f => f !== field)
      if (newFields.length === 0) {
        // Don't allow deselecting the last field - user should click "All" instead
        return
      }
      onFieldsChange(newFields)
    } else {
      // Add field
      onFieldsChange([...fields, field])
    }
  }, [isAllSelected, fields, onFieldsChange])

  const handleAllToggle = useCallback(() => {
    // Toggle to "All" mode (empty array = search all fields)
    onFieldsChange([])
  }, [onFieldsChange])

  // Check if any extra filters are active (for badge indicator)
  const hasActiveFilters = author !== '' || dateRange !== 'any'

  return (
    <div className="space-y-2">
      {/*
        Layout:
        Row 1: [Mode selector] [Field toggles] [More filters button]
        Dropdown: Author input + Date options
      */}

      {/* Main row: Mode + Fields + More filters dropdown */}
      <div className="flex gap-2 items-center">
        {/* Mode selector */}
        <div className="flex rounded-lg border border-[var(--site-border)] overflow-hidden">
          {(['hybrid', 'semantic', 'keyword'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`flex-1 px-3 md:px-4 py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-[var(--site-accent)] text-white'
                  : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Field filter toggles */}
        <div className="flex flex-1 rounded-lg border border-[var(--site-border)] overflow-hidden">
          <button
            onClick={handleAllToggle}
            className={`flex-1 px-2 md:px-3 py-1.5 text-sm font-medium transition-colors ${
              isAllSelected
                ? 'bg-[var(--site-accent)] text-white'
                : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
            }`}
          >
            All
          </button>
          {FIELD_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleFieldToggle(value)}
              className={`flex-1 px-2 md:px-3 py-1.5 text-sm font-medium transition-colors ${
                !isAllSelected && fields.includes(value)
                  ? 'bg-[var(--site-accent)] text-white'
                  : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* More filters toggle button */}
        <button
          onClick={() => setIsMoreFiltersOpen(!isMoreFiltersOpen)}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium rounded-lg border transition-colors flex-shrink-0 ${
            hasActiveFilters
              ? 'bg-[var(--site-accent)] text-white border-[var(--site-accent)]'
              : 'border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <svg className={`w-3 h-3 transition-transform ${isMoreFiltersOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Expanded filters row - animated with CSS grid */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isMoreFiltersOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end pt-2">
            {/* Author filter */}
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-[var(--site-text-secondary)] mb-1">
                Author
              </label>
              <div ref={containerRef} className="relative">
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
                {isOpen && results.length > 0 && (
                  <ul
                    ref={listRef}
                    className="absolute top-full mt-1 left-0 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] shadow-lg z-50"
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
            </div>

            {/* Date range */}
            <div className="flex-shrink-0">
              <label className="block text-xs font-medium text-[var(--site-text-secondary)] mb-1">
                Date
              </label>
              <div className="flex rounded-lg border border-[var(--site-border)] overflow-hidden">
                {DATE_OPTIONS.map(({ value, shortLabel }) => (
                  <button
                    key={value}
                    onClick={() => onDateRangeChange(value)}
                    className={`px-2.5 py-1.5 text-sm font-medium transition-colors ${
                      dateRange === value
                        ? 'bg-[var(--site-accent)] text-white'
                        : 'bg-[var(--site-bg)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
                    }`}
                  >
                    {shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom date inputs */}
            {showCustomDates && (
              <div className="flex gap-2 items-center flex-shrink-0">
                <input
                  type="date"
                  value={customDates?.after?.split('T')[0] || ''}
                  onChange={(e) => handleCustomDateChange('after', e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="px-2 py-1.5 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                />
                <span className="text-xs text-[var(--site-text-secondary)]">to</span>
                <input
                  type="date"
                  value={customDates?.before?.split('T')[0] || ''}
                  onChange={(e) => handleCustomDateChange('before', e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : '')}
                  className="px-2 py-1.5 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
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
