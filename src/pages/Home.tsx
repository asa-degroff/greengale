import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BlogCard } from '@/components/BlogCard'
import { MasonryGrid } from '@/components/MasonryGrid'
import { CubeLogo } from '@/components/CubeLogo'
import { PublicationSearch } from '@/components/PublicationSearch'
import { PostSearchResult } from '@/components/PostSearchResult'
import { AuthorSearchResultRow } from '@/components/AuthorSearchResultRow'
import { ExternalPreviewPanel } from '@/components/ExternalPreviewPanel'
import { LoadingCube } from '@/components/LoadingCube'
import { CloudField } from '@/components/AnimatedCloud'
import {
  getRecentPosts,
  getNetworkPosts,
  getFollowingPosts,
  searchUnified,
  type AppViewPost,
  type UnifiedSearchResult,
  type UnifiedPostResult,
  type UnifiedAuthorResult,
  type SearchMode,
} from '@/lib/appview'
import { SearchFilters, dateRangeToParams, type DateRange, type CustomDateRange } from '@/components/SearchFilters'
import { cacheFeed, getCachedFeed } from '@/lib/offline-store'
import {
  getCachedGreengaleFeed,
  setCachedGreengaleFeed,
  clearGreengaleFeedCache,
  getCachedNetworkFeed,
  setCachedNetworkFeed,
  clearNetworkFeedCache,
  getCachedFollowingFeed,
  setCachedFollowingFeed,
  clearFollowingFeedCache,
} from '@/lib/feedCache'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { useAuth } from '@/lib/auth'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'
import {
  useDocumentMeta,
  buildHomeCanonical,
  buildHomeOgImage,
} from '@/lib/useDocumentMeta'

type FeedTab = 'greengale' | 'following' | 'network'

const HOME_TAB_STORAGE_KEY = 'greengale:home-tab'

function getStoredTab(): FeedTab {
  try {
    const stored = localStorage.getItem(HOME_TAB_STORAGE_KEY)
    if (stored === 'greengale' || stored === 'following' || stored === 'network') {
      return stored
    }
  } catch {
    // localStorage not available
  }
  return 'greengale'
}

// Convert AppView post to BlogEntry format for BlogCard
function toBlogEntry(post: AppViewPost): BlogEntry {
  return {
    uri: post.uri,
    cid: '', // AppView doesn't return CID
    authorDid: post.authorDid,
    rkey: post.rkey,
    title: post.title || undefined,
    subtitle: post.subtitle || undefined,
    content: '', // AppView doesn't return full content
    createdAt: post.createdAt || undefined,
    source: post.source,
    tags: post.tags,
  }
}

function toAuthorProfile(post: AppViewPost): AuthorProfile | undefined {
  if (!post.author) return undefined
  return {
    did: post.author.did,
    handle: post.author.handle,
    displayName: post.author.displayName || undefined,
    avatar: post.author.avatar || undefined,
  }
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

export function HomePage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<FeedTab>(getStoredTab)
  const { isAuthenticated, isLoading: authLoading, session } = useAuth()

  // Validate stored tab - fall back to 'greengale' if 'following' selected but not authenticated
  // Wait for auth to finish loading before validating
  useEffect(() => {
    if (!authLoading && activeTab === 'following' && !isAuthenticated) {
      setActiveTab('greengale')
    }
  }, [activeTab, isAuthenticated, authLoading])

  // Persist tab selection to localStorage
  const handleTabChange = useCallback((tab: FeedTab) => {
    setActiveTab(tab)
    try {
      localStorage.setItem(HOME_TAB_STORAGE_KEY, tab)
    } catch {
      // localStorage not available
    }
  }, [])

  // Check for cached feed data on initial render (lazy initialization to avoid re-reads)
  const [initialCache] = useState(() => ({
    greengale: getCachedGreengaleFeed(),
    network: getCachedNetworkFeed(),
    following: getCachedFollowingFeed(),
  }))

  // GreenGale feed state - initialize from cache if available
  const [recentPosts, setRecentPosts] = useState<AppViewPost[]>(initialCache.greengale?.posts ?? [])
  const [loading, setLoading] = useState(!initialCache.greengale)
  const [appViewAvailable, setAppViewAvailable] = useState(!!initialCache.greengale)
  const [cursor, setCursor] = useState<string | undefined>(initialCache.greengale?.cursor)
  const [loadCount, setLoadCount] = useState(initialCache.greengale?.loadCount ?? 1)
  const [loadingMore, setLoadingMore] = useState(false)

  // Network feed state - initialize from cache if available
  const [networkPosts, setNetworkPosts] = useState<AppViewPost[]>(initialCache.network?.posts ?? [])
  const [networkLoading, setNetworkLoading] = useState(false)
  const [networkLoaded, setNetworkLoaded] = useState(!!initialCache.network)
  const [networkCursor, setNetworkCursor] = useState<string | undefined>(initialCache.network?.cursor)
  const [networkLoadCount, setNetworkLoadCount] = useState(initialCache.network?.loadCount ?? 1)
  const [networkLoadingMore, setNetworkLoadingMore] = useState(false)

  // Following feed state - initialize from cache if available
  const [followingPosts, setFollowingPosts] = useState<AppViewPost[]>(initialCache.following?.posts ?? [])
  const [followingLoading, setFollowingLoading] = useState(false)
  const [followingLoaded, setFollowingLoaded] = useState(!!initialCache.following)
  const [followingCursor, setFollowingCursor] = useState<string | undefined>(initialCache.following?.cursor)
  const [followingLoadCount, setFollowingLoadCount] = useState(initialCache.following?.loadCount ?? 1)
  const [followingLoadingMore, setFollowingLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const spinStartRef = useRef<number>(0)

  const [feedFromCache, setFeedFromCache] = useState(false)
  const { isOnline } = useNetworkStatus()

  // Search state
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('hybrid')
  const [searchAuthor, setSearchAuthor] = useState('')
  const [searchDateRange, setSearchDateRange] = useState<DateRange>('any')
  const [searchCustomDates, setSearchCustomDates] = useState<CustomDateRange>({})
  const [searchFields, setSearchFields] = useState<import('@/lib/appview').SearchField[]>([])
  const [searchFallbackUsed, setSearchFallbackUsed] = useState(false)
  const [selectedExternalPost, setSelectedExternalPost] = useState<UnifiedPostResult | null>(null)
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(-1)
  // Pagination state for search
  const [searchOffset, setSearchOffset] = useState(0)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchLoadingMore, setSearchLoadingMore] = useState(false)
  const SEARCH_PAGE_SIZE = 25

  // AbortController for cancelling in-flight search requests
  const searchAbortControllerRef = useRef<AbortController | null>(null)
  // Debounce ref for filter changes
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Set document metadata (title, canonical URL, OG tags)
  useDocumentMeta({
    title: 'GreenGale',
    canonical: buildHomeCanonical(),
    description: 'Markdown blog platform powered by your internet handle.',
    ogImage: buildHomeOgImage(),
  })

  useEffect(() => {
    async function loadRecentPosts() {
      // If we have in-memory cached data, skip the fetch
      // (cache is already loaded into state on mount)
      if (initialCache.greengale) {
        return
      }

      try {
        const { posts, cursor: nextCursor } = await getRecentPosts(24)
        setRecentPosts(posts)
        setCursor(nextCursor)
        setAppViewAvailable(true)
        setFeedFromCache(false)
        // Cache for offline access
        cacheFeed('recent', posts, nextCursor)
        // Also cache in memory for navigation
        setCachedGreengaleFeed(posts, nextCursor, 1)
      } catch {
        // Try offline cache if network fails
        if (!navigator.onLine) {
          const cached = await getCachedFeed('recent')
          if (cached) {
            setRecentPosts(cached.posts)
            setCursor(cached.cursor)
            setAppViewAvailable(true)
            setFeedFromCache(true)
            return
          }
        }
        setAppViewAvailable(false)
      } finally {
        setLoading(false)
      }
    }

    loadRecentPosts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLoadMore() {
    if (!cursor || loadingMore || loadCount >= 12) return
    setLoadingMore(true)
    try {
      const { posts, cursor: nextCursor } = await getRecentPosts(24, cursor)
      const newPosts = [...recentPosts, ...posts]
      const newLoadCount = loadCount + 1
      setRecentPosts(newPosts)
      setCursor(nextCursor)
      setLoadCount(newLoadCount)
      // Update in-memory cache
      setCachedGreengaleFeed(newPosts, nextCursor, newLoadCount)
    } finally {
      setLoadingMore(false)
    }
  }

  // Lazy-load network posts when tab is switched
  useEffect(() => {
    if (activeTab === 'network' && !networkLoaded && !networkLoading) {
      loadNetworkPosts()
    }
  }, [activeTab, networkLoaded, networkLoading])

  async function loadNetworkPosts() {
    // If we have in-memory cached data, skip the fetch
    if (initialCache.network) {
      return
    }

    setNetworkLoading(true)
    try {
      const { posts, cursor: nextCursor } = await getNetworkPosts(24)
      setNetworkPosts(posts)
      setNetworkCursor(nextCursor)
      setNetworkLoaded(true)
      // Cache in memory for navigation
      setCachedNetworkFeed(posts, nextCursor, 1)
    } catch {
      // Network feed not available
    } finally {
      setNetworkLoading(false)
    }
  }

  async function handleLoadMoreNetwork() {
    if (!networkCursor || networkLoadingMore || networkLoadCount >= 12) return
    setNetworkLoadingMore(true)
    try {
      const { posts, cursor: nextCursor } = await getNetworkPosts(24, networkCursor)
      const newPosts = [...networkPosts, ...posts]
      const newLoadCount = networkLoadCount + 1
      setNetworkPosts(newPosts)
      setNetworkCursor(nextCursor)
      setNetworkLoadCount(newLoadCount)
      // Update in-memory cache
      setCachedNetworkFeed(newPosts, nextCursor, newLoadCount)
    } finally {
      setNetworkLoadingMore(false)
    }
  }

  // Lazy-load following posts when tab is switched
  useEffect(() => {
    if (activeTab === 'following' && !followingLoaded && !followingLoading && isAuthenticated && session?.did) {
      loadFollowingPosts()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, followingLoaded, followingLoading, isAuthenticated, session?.did])

  async function loadFollowingPosts() {
    if (!session?.did) return

    // If we have in-memory cached data, skip the fetch
    if (initialCache.following) {
      return
    }

    setFollowingLoading(true)
    try {
      const { posts, cursor: nextCursor } = await getFollowingPosts(session.did, 24)
      setFollowingPosts(posts)
      setFollowingCursor(nextCursor)
      setFollowingLoaded(true)
      // Cache in memory for navigation
      setCachedFollowingFeed(posts, nextCursor, 1)
    } catch {
      // Following feed not available
    } finally {
      setFollowingLoading(false)
    }
  }

  async function handleLoadMoreFollowing() {
    if (!followingCursor || followingLoadingMore || followingLoadCount >= 12 || !session?.did) return
    setFollowingLoadingMore(true)
    try {
      const { posts, cursor: nextCursor } = await getFollowingPosts(session.did, 24, followingCursor)
      const newPosts = [...followingPosts, ...posts]
      const newLoadCount = followingLoadCount + 1
      setFollowingPosts(newPosts)
      setFollowingCursor(nextCursor)
      setFollowingLoadCount(newLoadCount)
      // Update in-memory cache
      setCachedFollowingFeed(newPosts, nextCursor, newLoadCount)
    } finally {
      setFollowingLoadingMore(false)
    }
  }

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    setSpinning(true)
    spinStartRef.current = Date.now()

    const minDuration = 400
    const startTime = Date.now()

    try {
      if (activeTab === 'greengale') {
        clearGreengaleFeedCache()
        const { posts, cursor: nextCursor } = await getRecentPosts(24)
        setRecentPosts(posts)
        setCursor(nextCursor)
        setLoadCount(1)
        setFeedFromCache(false)
        setCachedGreengaleFeed(posts, nextCursor, 1)
      } else if (activeTab === 'network') {
        clearNetworkFeedCache()
        const { posts, cursor: nextCursor } = await getNetworkPosts(24)
        setNetworkPosts(posts)
        setNetworkCursor(nextCursor)
        setNetworkLoadCount(1)
        setCachedNetworkFeed(posts, nextCursor, 1)
      } else if (activeTab === 'following' && session?.did) {
        clearFollowingFeedCache()
        const { posts, cursor: nextCursor } = await getFollowingPosts(session.did, 24)
        setFollowingPosts(posts)
        setFollowingCursor(nextCursor)
        setFollowingLoadCount(1)
        setCachedFollowingFeed(posts, nextCursor, 1)
      }
    } catch {
      // Refresh failed silently
    } finally {
      // Ensure spinner is visible for at least minDuration
      const elapsed = Date.now() - startTime
      if (elapsed < minDuration) {
        await new Promise(resolve => setTimeout(resolve, minDuration - elapsed))
      }
      setRefreshing(false)
      // Wait for current spin animation cycle to complete before stopping
      const spinElapsed = Date.now() - spinStartRef.current
      const animationDuration = 1000 // animate-spin is 1s per rotation
      const remaining = animationDuration - (spinElapsed % animationDuration)
      setTimeout(() => setSpinning(false), remaining)
    }
  }

  // Search functions - wrapped in useCallback for stable references
  const performSearch = useCallback(async (
    query: string,
    mode: SearchMode,
    author: string,
    dateRange: DateRange,
    customDates: CustomDateRange,
    fields: import('@/lib/appview').SearchField[],
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
    }
    setSearchFallbackUsed(false)

    try {
      const dateParams = dateRangeToParams(dateRange, customDates)
      const newOffset = appendResults ? currentOffset + SEARCH_PAGE_SIZE : 0

      // Use unified search API (returns both posts and authors in a single paginated response)
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
        setSearchSelectedIndex(-1)  // Reset selection on new results
      }

      setSearchTotal(response.total)
      setSearchHasMore(response.hasMore)

      if (response.fallback === 'keyword') {
        setSearchFallbackUsed(true)
      }
    } catch (err) {
      // Silently ignore aborted requests
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
    }
  }, [SEARCH_PAGE_SIZE])

  const handleClearSearch = useCallback(() => {
    setSearchActive(false)
    setSearchQuery('')
    setSearchResults([])
    setSearchFallbackUsed(false)
    setSearchAuthor('')
    setSearchDateRange('any')
    setSearchCustomDates({})
    setSearchFields([])
    // Reset pagination
    setSearchOffset(0)
    setSearchTotal(0)
    setSearchHasMore(false)
  }, [])

  const handleLoadMoreSearch = useCallback(() => {
    if (!searchLoadingMore && searchHasMore && searchQuery) {
      performSearch(searchQuery, searchMode, searchAuthor, searchDateRange, searchCustomDates, searchFields, true, searchOffset)
    }
  }, [searchLoadingMore, searchHasMore, searchQuery, performSearch, searchMode, searchAuthor, searchDateRange, searchCustomDates, searchFields, searchOffset])

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchActive(true)
    setSearchQuery(query)
    setSelectedExternalPost(null)  // Close any open preview panel when search changes
    performSearch(query, searchMode, searchAuthor, searchDateRange, searchCustomDates, searchFields, false, 0)
  }, [performSearch, searchMode, searchAuthor, searchDateRange, searchCustomDates, searchFields])

  // Debounced search trigger for filter changes
  const triggerDebouncedSearch = useCallback((
    query: string,
    mode: SearchMode,
    author: string,
    dateRange: DateRange,
    customDates: CustomDateRange,
    fields: import('@/lib/appview').SearchField[]
  ) => {
    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current)
    }
    filterDebounceRef.current = setTimeout(() => {
      if (query) {
        performSearch(query, mode, author, dateRange, customDates, fields, false, 0)
      }
    }, 150)
  }, [performSearch])

  const handleSearchModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode)
    triggerDebouncedSearch(searchQuery, mode, searchAuthor, searchDateRange, searchCustomDates, searchFields)
  }, [triggerDebouncedSearch, searchQuery, searchAuthor, searchDateRange, searchCustomDates, searchFields])

  const handleSearchAuthorChange = useCallback((author: string) => {
    setSearchAuthor(author)
    triggerDebouncedSearch(searchQuery, searchMode, author, searchDateRange, searchCustomDates, searchFields)
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchDateRange, searchCustomDates, searchFields])

  const handleSearchDateRangeChange = useCallback((dateRange: DateRange) => {
    setSearchDateRange(dateRange)
    triggerDebouncedSearch(searchQuery, searchMode, searchAuthor, dateRange, searchCustomDates, searchFields)
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchAuthor, searchCustomDates, searchFields])

  const handleSearchCustomDatesChange = useCallback((customDates: CustomDateRange) => {
    setSearchCustomDates(customDates)
    if (searchDateRange === 'custom') {
      triggerDebouncedSearch(searchQuery, searchMode, searchAuthor, searchDateRange, customDates, searchFields)
    }
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchAuthor, searchDateRange, searchFields])

  const handleSearchFieldsChange = useCallback((fields: import('@/lib/appview').SearchField[]) => {
    setSearchFields(fields)
    triggerDebouncedSearch(searchQuery, searchMode, searchAuthor, searchDateRange, searchCustomDates, fields)
  }, [triggerDebouncedSearch, searchQuery, searchMode, searchAuthor, searchDateRange, searchCustomDates])

  // Handle search result selection via keyboard
  const handleSelectSearchResult = useCallback((index: number) => {
    const result = searchResults[index]
    if (!result) return

    if (result.type === 'author') {
      navigate(`/${result.handle}`)
    } else {
      // Post result
      if (result.externalUrl) {
        setSelectedExternalPost(result)
      } else {
        navigate(`/${result.handle}/${result.rkey}`)
      }
    }
  }, [searchResults, navigate])

  // Page-level keyboard handler for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!searchActive || selectedExternalPost) return

      switch (e.key) {
        case 'Escape':
          handleClearSearch()
          break
        case 'ArrowDown':
          if (searchResults.length > 0) {
            e.preventDefault()
            setSearchSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1))
          }
          break
        case 'ArrowUp':
          if (searchResults.length > 0) {
            e.preventDefault()
            setSearchSelectedIndex(prev => Math.max(prev - 1, -1))
          }
          break
        case 'Enter':
          if (searchSelectedIndex >= 0 && searchResults[searchSelectedIndex]) {
            e.preventDefault()
            handleSelectSearchResult(searchSelectedIndex)
          }
          break
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [searchActive, selectedExternalPost, searchResults, searchSelectedIndex, handleClearSearch, handleSelectSearchResult])

  return (
    <div>
      <div
        className="max-w-4xl mx-auto px-4 py-12 search-content-slide"
        data-panel-open={selectedExternalPost ? 'true' : 'false'}
        style={{ '--content-width': '896px' } as React.CSSProperties}
      >
        <div className="text-center mb-12">
          <CubeLogo className="h-8 md:h-10 mx-auto mb-4" />
          <h2><i>Beta</i></h2>
        </div>

        <div className={`relative bg-[var(--site-bg-secondary)] rounded-lg p-8 border border-[var(--site-border)] overflow-hidden min-h-[180px] ${searchActive ? 'mb-4' : 'mb-12'}`}>
          {/* Decorative floating clouds */}
          <CloudField className="text-[var(--site-text-secondary)]" />

          <h2 className="relative text-xl font-bold mb-4 text-[var(--site-text)]">
            Find a Blog
          </h2>
          <p className="relative text-[var(--site-text-secondary)] mb-4">
            Search the Atmosphere
          </p>
          <PublicationSearch
            className="relative w-full"
            onQueryChange={handleSearchQueryChange}
            onClear={handleClearSearch}
            disableDropdown={true}
            externalQuery={searchQuery}
          />
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: searchActive ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="relative pt-4">
                <SearchFilters
                  mode={searchMode}
                  onModeChange={handleSearchModeChange}
                  author={searchAuthor}
                  onAuthorChange={handleSearchAuthorChange}
                  dateRange={searchDateRange}
                  onDateRangeChange={handleSearchDateRangeChange}
                  customDates={searchCustomDates}
                  onCustomDatesChange={handleSearchCustomDatesChange}
                  fields={searchFields}
                  onFieldsChange={handleSearchFieldsChange}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Search Results or Posts Section with Tabs */}
        {searchActive ? (
          <div className="mb-12">
            {/* Results header */}
            <div className="flex items-center gap-2 mb-4 pb-4 border-b border-[var(--site-border)]">
              {!searchLoading && (
                <span className="text-sm text-[var(--site-text-secondary)]">
                  {searchTotal > searchResults.length
                    ? `Showing ${searchResults.length} of ${searchTotal} results`
                    : `${searchTotal} result${searchTotal !== 1 ? 's' : ''}`
                  } for "{searchQuery}"
                  {searchFallbackUsed && (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      (keyword fallback)
                    </span>
                  )}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={handleClearSearch}
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
            {searchLoading && (
              <div className="flex flex-col items-center py-12">
                <svg className="animate-spin h-8 w-8 text-[var(--site-accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="mt-4 text-sm text-[var(--site-text-secondary)]">
                  Searching for "{searchQuery}"...
                </p>
              </div>
            )}

            {/* Results list */}
            {!searchLoading && searchResults.length > 0 && (
              <div className="border border-[var(--site-border)] rounded-lg overflow-hidden divide-y divide-[var(--site-border)] bg-[var(--site-bg)]">
                {searchResults.map((result, index) => (
                  result.type === 'author' ? (
                    <AuthorSearchResultRow
                      key={`author-${result.did}`}
                      result={toSearchResult(result)}
                      isSelected={index === searchSelectedIndex}
                      onMouseEnter={() => setSearchSelectedIndex(index)}
                    />
                  ) : (
                    <PostSearchResult
                      key={result.uri}
                      result={result}
                      onExternalPostClick={result.externalUrl ? () => setSelectedExternalPost(result) : undefined}
                      isSelected={index === searchSelectedIndex}
                      onMouseEnter={() => setSearchSelectedIndex(index)}
                    />
                  )
                ))}
              </div>
            )}

            {/* Load More Button */}
            {searchHasMore && !searchLoading && (
              <div className="mt-6 text-center">
                <button
                  onClick={handleLoadMoreSearch}
                  disabled={searchLoadingMore}
                  className="px-6 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] transition-colors disabled:opacity-50"
                >
                  {searchLoadingMore ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Loading...
                    </span>
                  ) : (
                    `Load More (${searchTotal - searchResults.length} remaining)`
                  )}
                </button>
              </div>
            )}

            {/* Empty state */}
            {!searchLoading && searchResults.length === 0 && searchQuery && (
              <div className="text-center py-12">
                <svg className="w-16 h-16 mx-auto text-[var(--site-text-secondary)] opacity-50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-[var(--site-text-secondary)]">
                  No results for "{searchQuery}"
                </p>
                <p className="text-sm text-[var(--site-text-secondary)] mt-1">
                  Try a different search term or mode
                </p>
              </div>
            )}
          </div>
        ) : appViewAvailable && (
          <div className="mb-12 min-h-[400px]">
            {/* Tab navigation */}
            <div className="flex gap-1 mb-6 border-b border-[var(--site-border)]">
              <button
                onClick={() => handleTabChange('greengale')}
                className={`px-4 py-2 font-medium transition-colors relative ${
                  activeTab === 'greengale'
                    ? 'text-[var(--site-accent)]'
                    : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
                }`}
              >
                Recents
                {activeTab === 'greengale' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
                )}
              </button>
              {isAuthenticated && (
                <button
                  onClick={() => handleTabChange('following')}
                  className={`px-4 py-2 font-medium transition-colors relative ${
                    activeTab === 'following'
                      ? 'text-[var(--site-accent)]'
                      : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
                  }`}
                >
                  Following
                  {activeTab === 'following' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
                  )}
                </button>
              )}
              <button
                onClick={() => handleTabChange('network')}
                className={`px-4 py-2 font-medium transition-colors relative ${
                  activeTab === 'network'
                    ? 'text-[var(--site-accent)]'
                    : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
                }`}
              >
                Network
                {activeTab === 'network' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
                )}
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="ml-auto px-2 py-2 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors disabled:opacity-50"
                title="Refresh feed"
              >
                <svg
                  className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
              </button>
            </div>

            {/* Sliding feed panels */}
            <div className="overflow-hidden">
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{
                  transform: `translateX(-${
                    activeTab === 'greengale' ? 0 :
                    activeTab === 'following' ? 100 :
                    isAuthenticated ? 200 : 100
                  }%)`
                }}
              >
                {/* GreenGale feed panel */}
                <div className="w-full flex-shrink-0">
                  {feedFromCache && (
                    <div className="mb-4 text-xs text-[var(--site-text-secondary)] bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded px-3 py-1.5 inline-block">
                      Offline — showing cached feed
                    </div>
                  )}
                  {recentPosts.length > 0 ? (
                    <>
                      <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
                        {recentPosts.map((post) => (
                          <BlogCard
                            key={post.uri}
                            entry={toBlogEntry(post)}
                            author={toAuthorProfile(post)}
                            tags={post.tags}
                          />
                        ))}
                      </MasonryGrid>
                      {cursor && loadCount < 12 && isOnline && (
                        <div className="mt-8 text-center">
                          <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loadingMore ? 'Loading...' : 'More'}
                          </button>
                        </div>
                      )}
                    </>
                  ) : !loading && (
                    <p className="text-center text-[var(--site-text-secondary)] py-8">
                      No posts yet.
                    </p>
                  )}
                </div>

                {/* Following feed panel - only rendered when authenticated */}
                {isAuthenticated && (
                  <div className="w-full flex-shrink-0">
                    {followingLoading ? (
                      <div className="flex flex-col items-center py-12">
                        <LoadingCube size="md" />
                        <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                          Loading posts from accounts you follow...
                        </p>
                      </div>
                    ) : followingPosts.length > 0 ? (
                      <>
                        <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
                          {followingPosts.map((post) => (
                            <BlogCard
                              key={post.uri}
                              entry={toBlogEntry(post)}
                              author={toAuthorProfile(post)}
                              externalUrl={post.externalUrl}
                              tags={post.tags}
                            />
                          ))}
                        </MasonryGrid>
                        {followingCursor && followingLoadCount < 12 && (
                          <div className="mt-8 text-center">
                            <button
                              onClick={handleLoadMoreFollowing}
                              disabled={followingLoadingMore}
                              className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {followingLoadingMore ? 'Loading...' : 'More'}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-center text-[var(--site-text-secondary)] py-8">
                        None of the accounts you follow have blog posts yet.
                      </p>
                    )}
                  </div>
                )}

                {/* Network feed panel */}
                <div className="w-full flex-shrink-0">
                  {networkLoading ? (
                    <div className="flex flex-col items-center py-12">
                      <LoadingCube size="md" />
                      <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                        Loading network posts...
                      </p>
                    </div>
                  ) : networkPosts.length > 0 ? (
                    <>
                      <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
                        {networkPosts.map((post) => (
                          <BlogCard
                            key={post.uri}
                            entry={toBlogEntry(post)}
                            author={toAuthorProfile(post)}
                            externalUrl={post.externalUrl}
                            tags={post.tags}
                          />
                        ))}
                      </MasonryGrid>
                      {networkCursor && networkLoadCount < 12 && (
                        <div className="mt-8 text-center">
                          <button
                            onClick={handleLoadMoreNetwork}
                            disabled={networkLoadingMore}
                            className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {networkLoadingMore ? 'Loading...' : 'More'}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-center text-[var(--site-text-secondary)] py-8">
                      No network posts available yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && !searchActive && (
          <div className="mb-12 min-h-[400px]">
            <div className="flex gap-1 mb-6 border-b border-[var(--site-border)]">
              <div className="px-4 py-2 font-medium text-[var(--site-accent)] relative">
                Recents
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
              </div>
              {isAuthenticated && (
                <div className="px-4 py-2 font-medium text-[var(--site-text-secondary)]">
                  Following
                </div>
              )}
              <div className="px-4 py-2 font-medium text-[var(--site-text-secondary)]">
                From the Network
              </div>
            </div>
            <div className="flex flex-col items-center py-12">
              <LoadingCube size="lg" />
              <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                Loading recent posts...
              </p>
            </div>
          </div>
        )}


        <div className="mt-16 text-center text-sm text-[var(--site-text-secondary)]">
          <p>
            Markdown blog platform powered by your <a href="https://internethandle.org/"
            className="text-[var(--site-accent)] hover:underline"
            >internet handle</a>
          </p>
          <br />
          <p>
            WhiteWind and Standard Site compatible
          </p>
        </div>
      </div>

      {/* External Post Preview Panel */}
      <ExternalPreviewPanel
        post={selectedExternalPost}
        onClose={() => setSelectedExternalPost(null)}
      />
    </div>
  )
}
