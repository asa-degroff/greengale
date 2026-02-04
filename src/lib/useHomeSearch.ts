import { useState, useCallback, useRef, useEffect } from 'react'
import {
  searchUnified,
  type UnifiedSearchResult,
  type UnifiedPostResult,
  type SearchMode,
  type SearchField,
} from '@/lib/appview'
import { dateRangeToParams, type DateRange, type CustomDateRange } from '@/components/SearchFilters'

const SEARCH_PAGE_SIZE = 25
const LOADING_DELAY_MS = 200
const FILTER_DEBOUNCE_MS = 150
const SESSION_STORAGE_KEY = 'greengale:home-search'

// State that gets persisted to sessionStorage
interface PersistedSearchState {
  searchActive: boolean
  searchQuery: string
  searchResults: UnifiedSearchResult[]
  searchMode: SearchMode
  searchAuthor: string
  searchDateRange: DateRange
  searchCustomDates: CustomDateRange
  searchFields: SearchField[]
  searchTotal: number
  searchHasMore: boolean
  searchOffset: number
  searchFallbackUsed: boolean
  searchSelectedIndex: number
}

function saveSearchState(state: PersistedSearchState): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // sessionStorage not available or quota exceeded
  }
}

function loadSearchState(): PersistedSearchState | null {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as PersistedSearchState
    }
  } catch {
    // sessionStorage not available or invalid JSON
  }
  return null
}

function clearSearchState(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // sessionStorage not available
  }
}

interface UseHomeSearchResult {
  // State
  searchActive: boolean
  searchQuery: string
  searchResults: UnifiedSearchResult[]
  searchLoading: boolean
  searchLoadingVisible: boolean
  searchMode: SearchMode
  searchAuthor: string
  searchDateRange: DateRange
  searchCustomDates: CustomDateRange
  searchFields: SearchField[]
  searchFallbackUsed: boolean
  selectedExternalPost: UnifiedPostResult | null
  searchSelectedIndex: number
  searchTotal: number
  searchHasMore: boolean
  searchLoadingMore: boolean
  searchCountStale: boolean

  // Actions
  handleSearchQueryChange: (query: string) => void
  handleClearSearch: () => void
  handleLoadMoreSearch: () => void
  handleSearchModeChange: (mode: SearchMode) => void
  handleSearchAuthorChange: (author: string) => void
  handleSearchDateRangeChange: (dateRange: DateRange) => void
  handleSearchCustomDatesChange: (customDates: CustomDateRange) => void
  handleSearchFieldsChange: (fields: SearchField[]) => void
  setSelectedExternalPost: (post: UnifiedPostResult | null) => void
  setSearchSelectedIndex: (index: number) => void
  handleSelectSearchResult: (index: number) => void
}

export function useHomeSearch(
  navigate: (path: string) => void
): UseHomeSearchResult {
  // Load persisted state on initial mount
  const persistedState = useRef(loadSearchState()).current

  // Search state - initialize from persisted state if available
  const [searchActive, setSearchActive] = useState(persistedState?.searchActive ?? false)
  const [searchQuery, setSearchQuery] = useState(persistedState?.searchQuery ?? '')
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[]>(persistedState?.searchResults ?? [])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>(persistedState?.searchMode ?? 'hybrid')
  const [searchAuthor, setSearchAuthor] = useState(persistedState?.searchAuthor ?? '')
  const [searchDateRange, setSearchDateRange] = useState<DateRange>(persistedState?.searchDateRange ?? 'any')
  const [searchCustomDates, setSearchCustomDates] = useState<CustomDateRange>(persistedState?.searchCustomDates ?? {})
  const [searchFields, setSearchFields] = useState<SearchField[]>(persistedState?.searchFields ?? [])
  const [searchFallbackUsed, setSearchFallbackUsed] = useState(persistedState?.searchFallbackUsed ?? false)
  const [selectedExternalPost, setSelectedExternalPost] = useState<UnifiedPostResult | null>(null)
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(persistedState?.searchSelectedIndex ?? -1)

  // Pagination state - initialize from persisted state if available
  const [searchOffset, setSearchOffset] = useState(persistedState?.searchOffset ?? 0)
  const [searchTotal, setSearchTotal] = useState(persistedState?.searchTotal ?? 0)
  const [searchHasMore, setSearchHasMore] = useState(persistedState?.searchHasMore ?? false)
  const [searchLoadingMore, setSearchLoadingMore] = useState(false)
  const [searchCountStale, setSearchCountStale] = useState(false)
  const [searchLoadingVisible, setSearchLoadingVisible] = useState(false)

  // Refs
  const searchAbortControllerRef = useRef<AbortController | null>(null)
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current)
      if (loadingDelayRef.current) clearTimeout(loadingDelayRef.current)
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      if (searchAbortControllerRef.current) searchAbortControllerRef.current.abort()
    }
  }, [])

  // Persist search state to sessionStorage when it changes (debounced to reduce writes)
  useEffect(() => {
    if (!searchActive) return

    // Clear any pending save
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
    }

    // Debounce saves to avoid excessive writes during rapid state changes
    saveDebounceRef.current = setTimeout(() => {
      saveSearchState({
        searchActive,
        searchQuery,
        searchResults,
        searchMode,
        searchAuthor,
        searchDateRange,
        searchCustomDates,
        searchFields,
        searchTotal,
        searchHasMore,
        searchOffset,
        searchFallbackUsed,
        searchSelectedIndex,
      })
    }, 100)

    // Save immediately on unmount to preserve state before navigation
    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current)
      }
      if (searchActive) {
        saveSearchState({
          searchActive,
          searchQuery,
          searchResults,
          searchMode,
          searchAuthor,
          searchDateRange,
          searchCustomDates,
          searchFields,
          searchTotal,
          searchHasMore,
          searchOffset,
          searchFallbackUsed,
          searchSelectedIndex,
        })
      }
    }
  }, [
    searchActive,
    searchQuery,
    searchResults,
    searchMode,
    searchAuthor,
    searchDateRange,
    searchCustomDates,
    searchFields,
    searchTotal,
    searchHasMore,
    searchOffset,
    searchFallbackUsed,
    searchSelectedIndex,
  ])

  const performSearch = useCallback(async (
    query: string,
    mode: SearchMode,
    author: string,
    dateRange: DateRange,
    customDates: CustomDateRange,
    fields: SearchField[],
    appendResults = false,
    currentOffset = 0
  ) => {
    // Cancel any in-flight request
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort()
    }
    searchAbortControllerRef.current = new AbortController()
    const signal = searchAbortControllerRef.current.signal

    if (appendResults) {
      setSearchLoadingMore(true)
    } else {
      setSearchLoading(true)
      setSearchOffset(0)
      setSearchCountStale(true)
      // Delay showing loading indicator
      if (loadingDelayRef.current) {
        clearTimeout(loadingDelayRef.current)
      }
      loadingDelayRef.current = setTimeout(() => {
        setSearchLoadingVisible(true)
      }, LOADING_DELAY_MS)
    }
    setSearchFallbackUsed(false)

    try {
      const dateParams = dateRangeToParams(dateRange, customDates)
      const newOffset = appendResults ? currentOffset + SEARCH_PAGE_SIZE : 0

      const response = await searchUnified(query, {
        limit: SEARCH_PAGE_SIZE,
        offset: newOffset,
        mode,
        author: author || undefined,
        after: dateParams.after,
        before: dateParams.before,
        fields: fields.length > 0 ? fields : undefined,
        signal,
      })

      if (appendResults) {
        setSearchResults(prev => [...prev, ...response.results])
        setSearchOffset(newOffset)
      } else {
        setSearchResults(response.results)
        setSearchOffset(0)
        setSearchSelectedIndex(-1)
      }

      setSearchTotal(response.total)
      setSearchHasMore(response.hasMore)
      setSearchCountStale(false)

      if (response.fallback === 'keyword') {
        setSearchFallbackUsed(true)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (!appendResults) {
        setSearchResults([])
        setSearchTotal(0)
        setSearchHasMore(false)
      }
    } finally {
      setSearchLoading(false)
      setSearchLoadingMore(false)
      if (loadingDelayRef.current) {
        clearTimeout(loadingDelayRef.current)
        loadingDelayRef.current = null
      }
      setSearchLoadingVisible(false)
    }
  }, [])

  const handleClearSearch = useCallback(() => {
    setSearchActive(false)
    setSearchQuery('')
    setSearchResults([])
    setSearchFallbackUsed(false)
    setSearchAuthor('')
    setSearchDateRange('any')
    setSearchCustomDates({})
    setSearchFields([])
    setSearchOffset(0)
    setSearchTotal(0)
    setSearchHasMore(false)
    setSearchCountStale(false)
    if (loadingDelayRef.current) {
      clearTimeout(loadingDelayRef.current)
      loadingDelayRef.current = null
    }
    setSearchLoadingVisible(false)
    // Clear persisted state
    clearSearchState()
  }, [])

  const handleLoadMoreSearch = useCallback(() => {
    if (!searchLoadingMore && searchHasMore && searchQuery) {
      performSearch(
        searchQuery,
        searchMode,
        searchAuthor,
        searchDateRange,
        searchCustomDates,
        searchFields,
        true,
        searchOffset
      )
    }
  }, [
    searchLoadingMore,
    searchHasMore,
    searchQuery,
    performSearch,
    searchMode,
    searchAuthor,
    searchDateRange,
    searchCustomDates,
    searchFields,
    searchOffset,
  ])

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchActive(true)
    setSearchQuery(query)
    setSelectedExternalPost(null)
    performSearch(query, searchMode, searchAuthor, searchDateRange, searchCustomDates, searchFields, false, 0)
  }, [performSearch, searchMode, searchAuthor, searchDateRange, searchCustomDates, searchFields])

  // Debounced search trigger for filter changes
  const triggerDebouncedSearch = useCallback((
    query: string,
    mode: SearchMode,
    author: string,
    dateRange: DateRange,
    customDates: CustomDateRange,
    fields: SearchField[]
  ) => {
    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current)
    }
    filterDebounceRef.current = setTimeout(() => {
      if (query) {
        performSearch(query, mode, author, dateRange, customDates, fields, false, 0)
      }
    }, FILTER_DEBOUNCE_MS)
  }, [performSearch])

  const handleSearchModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode)
    if (searchQuery) setSearchCountStale(true)
    triggerDebouncedSearch(searchQuery, mode, searchAuthor, searchDateRange, searchCustomDates, searchFields)
  }, [triggerDebouncedSearch, searchQuery, searchAuthor, searchDateRange, searchCustomDates, searchFields])

  const handleSearchAuthorChange = useCallback((author: string) => {
    setSearchAuthor(author)
    if (searchQuery) setSearchCountStale(true)
    triggerDebouncedSearch(searchQuery, searchMode, author, searchDateRange, searchCustomDates, searchFields)
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchDateRange, searchCustomDates, searchFields])

  const handleSearchDateRangeChange = useCallback((dateRange: DateRange) => {
    setSearchDateRange(dateRange)
    if (searchQuery) setSearchCountStale(true)
    triggerDebouncedSearch(searchQuery, searchMode, searchAuthor, dateRange, searchCustomDates, searchFields)
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchAuthor, searchCustomDates, searchFields])

  const handleSearchCustomDatesChange = useCallback((customDates: CustomDateRange) => {
    setSearchCustomDates(customDates)
    if (searchDateRange === 'custom') {
      if (searchQuery) setSearchCountStale(true)
      triggerDebouncedSearch(searchQuery, searchMode, searchAuthor, searchDateRange, customDates, searchFields)
    }
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchAuthor, searchDateRange, searchFields])

  const handleSearchFieldsChange = useCallback((fields: SearchField[]) => {
    setSearchFields(fields)
    if (searchQuery) setSearchCountStale(true)
    triggerDebouncedSearch(searchQuery, searchMode, searchAuthor, searchDateRange, searchCustomDates, fields)
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchAuthor, searchDateRange, searchCustomDates])

  const handleSelectSearchResult = useCallback((index: number) => {
    const result = searchResults[index]
    if (!result) return

    if (result.type === 'author') {
      navigate(`/${result.handle}`)
    } else {
      if (result.externalUrl) {
        setSelectedExternalPost(result)
      } else {
        navigate(`/${result.handle}/${result.rkey}`)
      }
    }
  }, [searchResults, navigate])

  return {
    searchActive,
    searchQuery,
    searchResults,
    searchLoading,
    searchLoadingVisible,
    searchMode,
    searchAuthor,
    searchDateRange,
    searchCustomDates,
    searchFields,
    searchFallbackUsed,
    selectedExternalPost,
    searchSelectedIndex,
    searchTotal,
    searchHasMore,
    searchLoadingMore,
    searchCountStale,
    handleSearchQueryChange,
    handleClearSearch,
    handleLoadMoreSearch,
    handleSearchModeChange,
    handleSearchAuthorChange,
    handleSearchDateRangeChange,
    handleSearchCustomDatesChange,
    handleSearchFieldsChange,
    setSelectedExternalPost,
    setSearchSelectedIndex,
    handleSelectSearchResult,
  }
}
