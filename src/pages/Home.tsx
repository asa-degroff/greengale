import { useEffect, useState, useCallback, useRef } from 'react'
import { BlogCard } from '@/components/BlogCard'
import { MasonryGrid } from '@/components/MasonryGrid'
import { CubeLogo } from '@/components/CubeLogo'
import { PublicationSearch } from '@/components/PublicationSearch'
import { InlineSearchResults } from '@/components/InlineSearchResults'
import { ExternalPreviewPanel } from '@/components/ExternalPreviewPanel'
import { LoadingCube } from '@/components/LoadingCube'
import {
  getRecentPosts,
  getNetworkPosts,
  getFollowingPosts,
  searchPosts,
  searchPublications,
  type AppViewPost,
  type PostSearchResult,
  type SearchMode,
  type UnifiedSearchResult,
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

export function HomePage() {
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

  // Check for cached feed data on initial render
  const cachedGreengale = getCachedGreengaleFeed()
  const cachedNetwork = getCachedNetworkFeed()
  const cachedFollowing = getCachedFollowingFeed()

  // GreenGale feed state - initialize from cache if available
  const [recentPosts, setRecentPosts] = useState<AppViewPost[]>(cachedGreengale?.posts ?? [])
  const [loading, setLoading] = useState(!cachedGreengale)
  const [appViewAvailable, setAppViewAvailable] = useState(!!cachedGreengale)
  const [cursor, setCursor] = useState<string | undefined>(cachedGreengale?.cursor)
  const [loadCount, setLoadCount] = useState(cachedGreengale?.loadCount ?? 1)
  const [loadingMore, setLoadingMore] = useState(false)

  // Network feed state - initialize from cache if available
  const [networkPosts, setNetworkPosts] = useState<AppViewPost[]>(cachedNetwork?.posts ?? [])
  const [networkLoading, setNetworkLoading] = useState(false)
  const [networkLoaded, setNetworkLoaded] = useState(!!cachedNetwork)
  const [networkCursor, setNetworkCursor] = useState<string | undefined>(cachedNetwork?.cursor)
  const [networkLoadCount, setNetworkLoadCount] = useState(cachedNetwork?.loadCount ?? 1)
  const [networkLoadingMore, setNetworkLoadingMore] = useState(false)

  // Following feed state - initialize from cache if available
  const [followingPosts, setFollowingPosts] = useState<AppViewPost[]>(cachedFollowing?.posts ?? [])
  const [followingLoading, setFollowingLoading] = useState(false)
  const [followingLoaded, setFollowingLoaded] = useState(!!cachedFollowing)
  const [followingCursor, setFollowingCursor] = useState<string | undefined>(cachedFollowing?.cursor)
  const [followingLoadCount, setFollowingLoadCount] = useState(cachedFollowing?.loadCount ?? 1)
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
  const [searchFallbackUsed, setSearchFallbackUsed] = useState(false)
  const [selectedExternalPost, setSelectedExternalPost] = useState<PostSearchResult | null>(null)

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
      if (cachedGreengale) {
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
    if (cachedNetwork) {
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
    if (cachedFollowing) {
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
  const performSearch = useCallback(async (query: string, mode: SearchMode, author: string, dateRange: DateRange, customDates: CustomDateRange) => {
    setSearchLoading(true)
    setSearchFallbackUsed(false)
    try {
      const dateParams = dateRangeToParams(dateRange, customDates)

      // Call both APIs in parallel
      const [pubResponse, postResponse] = await Promise.all([
        searchPublications(query, 5),  // Top 5 authors/publications
        searchPosts(query, {
          mode,
          limit: 25,
          author: author || undefined,
          after: dateParams.after,
          before: dateParams.before,
        })
      ])

      // Merge: authors first (excluding post/tag matches since posts are in main results), then posts
      const unified: UnifiedSearchResult[] = [
        ...pubResponse.results
          .filter(r => r.matchType !== 'postTitle' && r.matchType !== 'tag')
          .map(r => ({ type: 'author' as const, data: r })),
        ...postResponse.posts.map(p => ({ type: 'post' as const, data: p }))
      ]

      setSearchResults(unified)
      if (postResponse.fallback === 'keyword') {
        setSearchFallbackUsed(true)
      }
    } catch {
      setSearchResults([])
    } finally {
      setSearchLoading(false)
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
  }, [])

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchActive(true)
    setSearchQuery(query)
    performSearch(query, searchMode, searchAuthor, searchDateRange, searchCustomDates)
  }, [performSearch, searchMode, searchAuthor, searchDateRange, searchCustomDates])

  const handleSearchModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode)
    if (searchQuery) {
      performSearch(searchQuery, mode, searchAuthor, searchDateRange, searchCustomDates)
    }
  }, [performSearch, searchQuery, searchAuthor, searchDateRange, searchCustomDates])

  const handleSearchAuthorChange = useCallback((author: string) => {
    setSearchAuthor(author)
    if (searchQuery) {
      performSearch(searchQuery, searchMode, author, searchDateRange, searchCustomDates)
    }
  }, [performSearch, searchQuery, searchMode, searchDateRange, searchCustomDates])

  const handleSearchDateRangeChange = useCallback((dateRange: DateRange) => {
    setSearchDateRange(dateRange)
    if (searchQuery) {
      performSearch(searchQuery, searchMode, searchAuthor, dateRange, searchCustomDates)
    }
  }, [performSearch, searchQuery, searchMode, searchAuthor, searchCustomDates])

  const handleSearchCustomDatesChange = useCallback((customDates: CustomDateRange) => {
    setSearchCustomDates(customDates)
    if (searchQuery && searchDateRange === 'custom') {
      performSearch(searchQuery, searchMode, searchAuthor, searchDateRange, customDates)
    }
  }, [performSearch, searchQuery, searchMode, searchAuthor, searchDateRange])

  // Page-level Escape handler for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && searchActive && !selectedExternalPost) {
        handleClearSearch()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [searchActive, selectedExternalPost, handleClearSearch])

  return (
    <div>
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <CubeLogo className="h-8 md:h-10 mx-auto mb-4" />
          <h2><i>Beta</i></h2>
          <p className="text-lg text-[var(--site-text-secondary)] max-w-2xl mx-auto">
            Markdown blog platform powered by your <a href="https://internethandle.org/">internet handle</a>
          </p>
        </div>

        <div className="bg-[var(--site-bg-secondary)] rounded-lg p-8 mb-12 border border-[var(--site-border)]">
          <h2 className="text-xl font-bold mb-4 text-[var(--site-text)]">
            Find a Blog
          </h2>
          <p className="text-[var(--site-text-secondary)] mb-4">
            Search by handle, display name, publication name, title, tag, or URL:
          </p>
          <PublicationSearch
            className="w-full"
            onQueryChange={handleSearchQueryChange}
            onClear={handleClearSearch}
            disableDropdown={true}
          />
          {searchActive && (
            <div className="mt-4">
              <SearchFilters
                mode={searchMode}
                onModeChange={handleSearchModeChange}
                author={searchAuthor}
                onAuthorChange={handleSearchAuthorChange}
                dateRange={searchDateRange}
                onDateRangeChange={handleSearchDateRangeChange}
                customDates={searchCustomDates}
                onCustomDatesChange={handleSearchCustomDatesChange}
              />
            </div>
          )}
        </div>

        {/* Search Results or Posts Section with Tabs */}
        {searchActive ? (
          <div className="mb-12">
            <InlineSearchResults
              results={searchResults}
              loading={searchLoading}
              query={searchQuery}
              onClear={handleClearSearch}
              onExternalPostClick={setSelectedExternalPost}
              fallbackUsed={searchFallbackUsed}
            />
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

        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">Multi-Platform</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              WhiteWind, GreenGale, and Standard Site
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">Theme Selection</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              Customize themes for each post or across the site.
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">LaTeX Support</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              Write mathematical equations with KaTeX rendering.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-[var(--site-text-secondary)]">
          <p>
            Your data is owned by you and lives on AT Protocol.{' '}
            <a
              href="https://atproto.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--site-accent)] hover:underline"
            >
              Learn more about AT Protocol
            </a>
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
