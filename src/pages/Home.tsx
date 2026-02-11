import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { BlogCard } from '@/components/BlogCard'
import { MasonryGrid } from '@/components/MasonryGrid'
import { CubeLogo } from '@/components/CubeLogo'
import { PublicationSearch } from '@/components/PublicationSearch'
import { PostSearchResult } from '@/components/PostSearchResult'
import { AuthorSearchResultRow } from '@/components/AuthorSearchResultRow'
import { LoadingCube } from '@/components/LoadingCube'
import { CloudField } from '@/components/AnimatedCloud'
import { Spinner } from '@/components/Spinner'

// Lazy load ExternalPreviewPanel - only needed when user clicks external post
const ExternalPreviewPanel = lazy(() =>
  import('@/components/ExternalPreviewPanel').then(m => ({ default: m.ExternalPreviewPanel }))
)
import {
  type AppViewPost,
  type UnifiedAuthorResult,
} from '@/lib/appview'
import { SearchFilters, type CustomDateRange } from '@/components/SearchFilters'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { useAuth } from '@/lib/auth'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'
import {
  useDocumentMeta,
  buildHomeCanonical,
  buildHomeOgImage,
} from '@/lib/useDocumentMeta'
import { useGreengaleFeed, useNetworkFeed, useFollowingFeed } from '@/lib/useHomeFeed'
import { useHomeSearch } from '@/lib/useHomeSearch'

type FeedTab = 'greengale' | 'following' | 'network'

const HOME_TAB_STORAGE_KEY = 'greengale:home-tab'

// Calculate scroll position index for a given tab
function getTabScrollPosition(tab: FeedTab, isAuthenticated: boolean): number {
  if (tab === 'greengale') return 0
  if (tab === 'following') return 1
  // Network tab is at index 2 if authenticated, 1 if not (following panel hidden)
  return isAuthenticated ? 2 : 1
}

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
    cid: '',
    authorDid: post.authorDid,
    rkey: post.rkey,
    title: post.title || undefined,
    subtitle: post.subtitle || undefined,
    content: '',
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
    postsCount: author.postsCount,
  }
}

export function HomePage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<FeedTab>(getStoredTab)
  const { isAuthenticated, isLoading: authLoading, session } = useAuth()
  const { isOnline } = useNetworkStatus()

  // Feed hooks
  const greengaleFeed = useGreengaleFeed()
  const networkFeed = useNetworkFeed()
  const followingFeed = useFollowingFeed(session?.did)

  // Search hook
  const search = useHomeSearch(navigate)

  // Refresh state
  const [refreshing, setRefreshing] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const spinStartRef = useRef<number>(0)

  // Set document metadata
  useDocumentMeta({
    title: 'GreenGale',
    canonical: buildHomeCanonical(),
    description: 'Markdown blog platform powered by your internet handle.',
    ogImage: buildHomeOgImage(),
  })

  // Validate stored tab - fall back to 'greengale' if 'following' selected but not authenticated
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

  // Lazy-load network posts when tab is switched
  useEffect(() => {
    if (activeTab === 'network' && !networkFeed.loaded && !networkFeed.loading) {
      networkFeed.load()
    }
  }, [activeTab, networkFeed.loaded, networkFeed.loading, networkFeed.load])

  // Lazy-load following posts when tab is switched
  useEffect(() => {
    if (activeTab === 'following' && !followingFeed.loaded && !followingFeed.loading && isAuthenticated && session?.did) {
      followingFeed.load()
    }
  }, [activeTab, followingFeed.loaded, followingFeed.loading, followingFeed.load, isAuthenticated, session?.did])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setSpinning(true)
    spinStartRef.current = Date.now()

    const minDuration = 400
    const startTime = Date.now()

    try {
      if (activeTab === 'greengale') {
        await greengaleFeed.refresh()
      } else if (activeTab === 'network') {
        await networkFeed.refresh()
      } else if (activeTab === 'following') {
        await followingFeed.refresh()
      }
    } catch {
      // Refresh failed silently
    } finally {
      const elapsed = Date.now() - startTime
      if (elapsed < minDuration) {
        await new Promise(resolve => setTimeout(resolve, minDuration - elapsed))
      }
      setRefreshing(false)
      const spinElapsed = Date.now() - spinStartRef.current
      const animationDuration = 1000
      const remaining = animationDuration - (spinElapsed % animationDuration)
      setTimeout(() => setSpinning(false), remaining)
    }
  }, [refreshing, activeTab, greengaleFeed, networkFeed, followingFeed])

  // Memoize processed posts to avoid recreating on every render
  const processedGreengalePosts = useMemo(() =>
    greengaleFeed.posts.map(post => ({
      key: post.uri,
      entry: toBlogEntry(post),
      author: toAuthorProfile(post),
      tags: post.tags,
    })),
    [greengaleFeed.posts]
  )

  const processedNetworkPosts = useMemo(() =>
    networkFeed.posts.map(post => ({
      key: post.uri,
      entry: toBlogEntry(post),
      author: toAuthorProfile(post),
      externalUrl: post.externalUrl,
      tags: post.tags,
    })),
    [networkFeed.posts]
  )

  const processedFollowingPosts = useMemo(() =>
    followingFeed.posts.map(post => ({
      key: post.uri,
      entry: toBlogEntry(post),
      author: toAuthorProfile(post),
      externalUrl: post.externalUrl,
      tags: post.tags,
    })),
    [followingFeed.posts]
  )

  // Destructure stable functions and primitive values for effect dependencies
  const {
    searchActive,
    selectedExternalPost,
    searchResults,
    searchSelectedIndex,
    handleClearSearch,
    setSearchSelectedIndex,
    handleSelectSearchResult,
  } = search

  // Page-level keyboard handler for search
  // Uses primitive dependencies to avoid recreating on every search object change
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
            setSearchSelectedIndex(
              Math.min(searchSelectedIndex + 1, searchResults.length - 1)
            )
          }
          break
        case 'ArrowUp':
          if (searchResults.length > 0) {
            e.preventDefault()
            setSearchSelectedIndex(Math.max(searchSelectedIndex - 1, -1))
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
  }, [
    searchActive,
    selectedExternalPost,
    searchResults,
    searchSelectedIndex,
    handleClearSearch,
    setSearchSelectedIndex,
    handleSelectSearchResult,
  ])

  // Memoized handler for mouse enter on search results
  // setSearchSelectedIndex is stable (from useState)
  const handleSearchResultMouseEnter = useCallback((index: number) => {
    setSearchSelectedIndex(index)
  }, [setSearchSelectedIndex])

  return (
    <div>
      <div
        className="max-w-4xl mx-auto px-4 py-12 search-content-slide"
        data-panel-open={search.selectedExternalPost ? 'true' : 'false'}
        style={{ '--content-width': '896px' } as React.CSSProperties}
      >
        <div className="text-center mb-12">
          <CubeLogo className="h-8 md:h-10 mx-auto mb-4" />
          <h2><i>Beta</i></h2>
        </div>

        <div className={`relative bg-[var(--site-bg-secondary)] rounded-lg p-8 border border-[var(--site-border)] overflow-hidden min-h-[180px] ${search.searchActive ? 'mb-4' : 'mb-12'}`}>
          <CloudField className="text-[var(--site-text-secondary)]" />

          <h2 className="relative text-xl font-bold mb-4 text-[var(--site-text)]">
            Find a Blog
          </h2>
          <p className="relative text-[var(--site-text-secondary)] mb-4">
            Search the Atmosphere
          </p>
          <PublicationSearch
            className="relative w-full"
            onQueryChange={search.handleSearchQueryChange}
            onClear={search.handleClearSearch}
            disableDropdown={true}
            externalQuery={search.searchQuery}
          />
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out"
            style={{ gridTemplateRows: search.searchActive ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="relative pt-4">
                <SearchFilters
                  mode={search.searchMode}
                  onModeChange={search.handleSearchModeChange}
                  author={search.searchAuthor}
                  onAuthorChange={search.handleSearchAuthorChange}
                  dateRange={search.searchDateRange}
                  onDateRangeChange={search.handleSearchDateRangeChange}
                  customDates={search.searchCustomDates as CustomDateRange}
                  onCustomDatesChange={search.handleSearchCustomDatesChange as (dates: CustomDateRange) => void}
                  fields={search.searchFields}
                  onFieldsChange={search.handleSearchFieldsChange}
                  aiAgent={search.searchAiAgent}
                  onAiAgentChange={search.handleSearchAiAgentChange}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Search Results or Posts Section with Tabs */}
        {search.searchActive ? (
          <SearchResultsSection
            search={search}
            onMouseEnter={handleSearchResultMouseEnter}
          />
        ) : greengaleFeed.appViewAvailable && (
          <FeedSection
            activeTab={activeTab}
            isAuthenticated={isAuthenticated}
            isOnline={isOnline}
            spinning={spinning}
            refreshing={refreshing}
            greengaleFeed={greengaleFeed}
            networkFeed={networkFeed}
            followingFeed={followingFeed}
            processedGreengalePosts={processedGreengalePosts}
            processedNetworkPosts={processedNetworkPosts}
            processedFollowingPosts={processedFollowingPosts}
            onTabChange={handleTabChange}
            onRefresh={handleRefresh}
          />
        )}

        {greengaleFeed.loading && !search.searchActive && (
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

      <Suspense fallback={null}>
        <ExternalPreviewPanel
          post={search.selectedExternalPost}
          onClose={() => search.setSelectedExternalPost(null)}
        />
      </Suspense>
    </div>
  )
}

// Extracted Search Results Section Component
interface SearchResultsSectionProps {
  search: ReturnType<typeof useHomeSearch>
  onMouseEnter: (index: number) => void
}

function SearchResultsSection({ search, onMouseEnter }: SearchResultsSectionProps) {
  return (
    <div className="mb-12 animate-section-fade-in">
      {/* Results header */}
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-[var(--site-border)]">
        <span className="text-sm text-[var(--site-text-secondary)]">
          {search.searchTotal > search.searchResults.length
            ? `Showing ${search.searchResults.length} of ${search.searchTotal} results`
            : `${search.searchTotal} result${search.searchTotal !== 1 ? 's' : ''}`
          } for "{search.searchQuery}"
          {search.searchFallbackUsed && (
            <span className="ml-1 text-amber-600 dark:text-amber-400">
              (keyword fallback)
            </span>
          )}
        </span>
        {(search.searchLoadingVisible || search.searchCountStale) && search.searchResults.length > 0 && (
          <Spinner size="sm" className="text-[var(--site-text-secondary)]" />
        )}
        <div className="flex-1" />
        <button
          onClick={search.handleClearSearch}
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
      {search.searchLoadingVisible && search.searchResults.length === 0 && (
        <div className="flex flex-col items-center py-12">
          <Spinner size="lg" className="text-[var(--site-accent)]" />
          <p className="mt-4 text-sm text-[var(--site-text-secondary)]">
            Searching for "{search.searchQuery}"...
          </p>
        </div>
      )}

      {/* Results list */}
      {search.searchResults.length > 0 && (
        <div className="border border-[var(--site-border)] rounded-lg overflow-hidden divide-y divide-[var(--site-border)] bg-[var(--site-bg)]">
          {search.searchResults.map((result, index) => (
            result.type === 'author' ? (
              <AuthorSearchResultRow
                key={`author-${result.did}`}
                result={toSearchResult(result)}
                isSelected={index === search.searchSelectedIndex}
                onMouseEnter={() => onMouseEnter(index)}
              />
            ) : (
              <PostSearchResult
                key={result.uri}
                result={result}
                onExternalPostClick={result.externalUrl ? () => search.setSelectedExternalPost(result) : undefined}
                isSelected={index === search.searchSelectedIndex}
                onMouseEnter={() => onMouseEnter(index)}
              />
            )
          ))}
        </div>
      )}

      {/* Load More Button */}
      {search.searchHasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={search.handleLoadMoreSearch}
            disabled={search.searchLoadingMore || search.searchLoading || search.searchCountStale}
            className="px-6 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] transition-colors disabled:opacity-50"
          >
            {search.searchLoadingMore ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" />
                Loading...
              </span>
            ) : (
              `Load More (${search.searchTotal - search.searchResults.length} remaining)`
            )}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!search.searchLoading && !search.searchCountStale && search.searchResults.length === 0 && search.searchQuery && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-[var(--site-text-secondary)] opacity-50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-[var(--site-text-secondary)]">
            No results for "{search.searchQuery}"
          </p>
          <p className="text-sm text-[var(--site-text-secondary)] mt-1">
            Try a different search term or mode
          </p>
        </div>
      )}
    </div>
  )
}

// Extracted Feed Section Component
interface ProcessedPost {
  key: string
  entry: BlogEntry
  author: AuthorProfile | undefined
  externalUrl?: string | null
  tags?: string[]
}

interface FeedSectionProps {
  activeTab: FeedTab
  isAuthenticated: boolean
  isOnline: boolean
  spinning: boolean
  refreshing: boolean
  greengaleFeed: ReturnType<typeof useGreengaleFeed>
  networkFeed: ReturnType<typeof useNetworkFeed>
  followingFeed: ReturnType<typeof useFollowingFeed>
  processedGreengalePosts: ProcessedPost[]
  processedNetworkPosts: ProcessedPost[]
  processedFollowingPosts: ProcessedPost[]
  onTabChange: (tab: FeedTab) => void
  onRefresh: () => void
}

function FeedSection({
  activeTab,
  isAuthenticated,
  isOnline,
  spinning,
  refreshing,
  greengaleFeed,
  networkFeed,
  followingFeed,
  processedGreengalePosts,
  processedNetworkPosts,
  processedFollowingPosts,
  onTabChange,
  onRefresh,
}: FeedSectionProps) {
  // Ref for native scroll-snap based tab switching
  const feedScrollRef = useRef<HTMLDivElement>(null)
  // Track if we're programmatically scrolling to avoid feedback loops
  const isScrollingProgrammatically = useRef(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs for tab buttons and indicator (direct DOM manipulation for performance)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const recentsTabRef = useRef<HTMLButtonElement>(null)
  const followingTabRef = useRef<HTMLButtonElement>(null)
  const networkTabRef = useRef<HTMLButtonElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)

  // Cached tab positions to avoid layout thrashing during scroll
  // Updated on mount, resize, and auth state change
  const tabPositionsRef = useRef<{ left: number; width: number }[]>([])

  // Track if this is the initial mount (for setting initial indicator position)
  const isInitialMountRef = useRef(true)

  // Measure and cache tab positions (avoids getBoundingClientRect during scroll)
  // Note: Does NOT update indicator position - that's handled by scroll or initial mount
  const measureTabPositions = useCallback(() => {
    const tabBar = tabBarRef.current
    if (!tabBar) return

    const positions: { left: number; width: number }[] = []
    const barRect = tabBar.getBoundingClientRect()

    // Recents tab (always present)
    if (recentsTabRef.current) {
      const rect = recentsTabRef.current.getBoundingClientRect()
      positions.push({ left: rect.left - barRect.left, width: rect.width })
    }

    // Following tab (only if authenticated)
    if (isAuthenticated && followingTabRef.current) {
      const rect = followingTabRef.current.getBoundingClientRect()
      positions.push({ left: rect.left - barRect.left, width: rect.width })
    }

    // Network tab
    if (networkTabRef.current) {
      const rect = networkTabRef.current.getBoundingClientRect()
      positions.push({ left: rect.left - barRect.left, width: rect.width })
    }

    tabPositionsRef.current = positions
  }, [isAuthenticated])

  // Update indicator position directly via DOM (no React re-render)
  const updateIndicatorPosition = useCallback((progress: number) => {
    const indicator = indicatorRef.current
    const tabs = tabPositionsRef.current
    if (!indicator || tabs.length === 0) return

    // Clamp progress to valid range
    const clampedProgress = Math.max(0, Math.min(progress, tabs.length - 1))

    // Find the two tabs we're interpolating between
    const fromIndex = Math.floor(clampedProgress)
    const toIndex = Math.min(fromIndex + 1, tabs.length - 1)
    const t = clampedProgress - fromIndex // Interpolation factor (0 to 1)

    const fromTab = tabs[fromIndex]
    const toTab = tabs[toIndex]

    // Interpolate position and width
    const left = fromTab.left + (toTab.left - fromTab.left) * t
    const width = fromTab.width + (toTab.width - fromTab.width) * t

    // Direct DOM update - no React state, no re-render
    indicator.style.left = `${left}px`
    indicator.style.width = `${width}px`
  }, [])

  // Measure tab positions on mount, resize, and auth change
  useEffect(() => {
    measureTabPositions()

    // Set initial indicator position only on first mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        updateIndicatorPosition(getTabScrollPosition(activeTab, isAuthenticated))
      })
    }

    // On resize, update indicator based on current scroll position
    const handleResize = () => {
      measureTabPositions()
      // Update indicator to match current scroll position
      const container = feedScrollRef.current
      if (container) {
        const panelWidth = container.firstElementChild?.clientWidth || container.clientWidth
        const gap = 24
        const progress = container.scrollLeft / (panelWidth + gap)
        updateIndicatorPosition(progress)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [measureTabPositions, activeTab, isAuthenticated, updateIndicatorPosition])

  // Scroll to the correct panel when tab changes (from button click)
  useEffect(() => {
    if (feedScrollRef.current) {
      const container = feedScrollRef.current
      const panelWidth = container.firstElementChild?.clientWidth || container.clientWidth
      const gap = 24 // Same as gap-6
      const position = getTabScrollPosition(activeTab, isAuthenticated)
      const targetScroll = position * (panelWidth + gap)

      // Only scroll if we're not already at the target (avoids loop with scroll listener)
      if (Math.abs(container.scrollLeft - targetScroll) > 10) {
        isScrollingProgrammatically.current = true
        container.scrollTo({
          left: targetScroll,
          behavior: 'smooth',
        })
        // Reset flag after animation completes
        setTimeout(() => {
          isScrollingProgrammatically.current = false
        }, 350)
      }
    }
  }, [activeTab, isAuthenticated])

  // Track scroll position for smooth indicator animation and tab sync
  useEffect(() => {
    const container = feedScrollRef.current
    if (!container) return

    const handleScroll = () => {
      const panelWidth = container.firstElementChild?.clientWidth || container.clientWidth
      const gap = 24
      const scrollPosition = container.scrollLeft

      // Calculate continuous scroll progress (0 to numTabs-1)
      const progress = scrollPosition / (panelWidth + gap)

      // Update indicator position directly (no state, no re-render)
      updateIndicatorPosition(progress)

      // Skip tab sync if this scroll was triggered programmatically
      if (isScrollingProgrammatically.current) return

      // Debounce: wait for scroll to settle before updating activeTab
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      scrollTimeoutRef.current = setTimeout(() => {
        // Determine which panel is most visible
        const panelIndex = Math.round(progress)

        // Convert panel index back to tab
        let newTab: FeedTab
        if (panelIndex === 0) {
          newTab = 'greengale'
        } else if (isAuthenticated && panelIndex === 1) {
          newTab = 'following'
        } else {
          newTab = 'network'
        }

        // Only update if tab actually changed
        if (newTab !== activeTab) {
          onTabChange(newTab)
        }
      }, 100) // Wait 100ms after scroll stops
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [activeTab, isAuthenticated, onTabChange, updateIndicatorPosition])

  return (
    <div className="mb-12 min-h-[400px] animate-section-fade-in">
      {/* Tab navigation */}
      <div ref={tabBarRef} className="flex gap-1 mb-6 border-b border-[var(--site-border)] relative">
        {/* Sliding indicator - position updated via direct DOM manipulation for performance */}
        <div
          ref={indicatorRef}
          className="absolute bottom-0 h-0.5 bg-[var(--site-accent)]"
        />
        <button
          ref={recentsTabRef}
          onClick={() => onTabChange('greengale')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'greengale'
              ? 'text-[var(--site-accent)]'
              : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
          }`}
        >
          Recents
        </button>
        {isAuthenticated && (
          <button
            ref={followingTabRef}
            onClick={() => onTabChange('following')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'following'
                ? 'text-[var(--site-accent)]'
                : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
            }`}
          >
            Following
          </button>
        )}
        <button
          ref={networkTabRef}
          onClick={() => onTabChange('network')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'network'
              ? 'text-[var(--site-accent)]'
              : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
          }`}
        >
          Network
        </button>
        <button
          onClick={onRefresh}
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

      {/* Sliding feed panels - using scroll-snap for native performance */}
      <div
        ref={feedScrollRef}
        className="flex gap-6 overflow-x-auto snap-x snap-mandatory scrollbar-none"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
          {/* GreenGale feed panel */}
          <div className="w-full flex-shrink-0 snap-start snap-always">
            {greengaleFeed.fromCache && (
              <div className="mb-4 text-xs text-[var(--site-text-secondary)] bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded px-3 py-1.5 inline-block">
                Offline — showing cached feed
              </div>
            )}
            {processedGreengalePosts.length > 0 ? (
              <>
                <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
                  {processedGreengalePosts.map(({ key, entry, author, tags }) => (
                    <BlogCard key={key} entry={entry} author={author} tags={tags} />
                  ))}
                </MasonryGrid>
                {greengaleFeed.hasMore && isOnline && (
                  <div className="mt-8 text-center">
                    <button
                      onClick={greengaleFeed.loadMore}
                      disabled={greengaleFeed.loadingMore}
                      className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {greengaleFeed.loadingMore ? 'Loading...' : 'More'}
                    </button>
                  </div>
                )}
              </>
            ) : !greengaleFeed.loading && (
              <p className="text-center text-[var(--site-text-secondary)] py-8">
                No posts yet.
              </p>
            )}
          </div>

          {/* Following feed panel */}
          {isAuthenticated && (
            <div className="w-full flex-shrink-0 snap-start snap-always">
              {followingFeed.loading ? (
                <div className="flex flex-col items-center py-12">
                  <LoadingCube size="md" />
                  <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                    Loading posts from accounts you follow...
                  </p>
                </div>
              ) : processedFollowingPosts.length > 0 ? (
                <>
                  <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
                    {processedFollowingPosts.map(({ key, entry, author, externalUrl, tags }) => (
                      <BlogCard key={key} entry={entry} author={author} externalUrl={externalUrl} tags={tags} />
                    ))}
                  </MasonryGrid>
                  {followingFeed.hasMore && (
                    <div className="mt-8 text-center">
                      <button
                        onClick={followingFeed.loadMore}
                        disabled={followingFeed.loadingMore}
                        className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {followingFeed.loadingMore ? 'Loading...' : 'More'}
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
          <div className="w-full flex-shrink-0 snap-start snap-always">
            {networkFeed.loading ? (
              <div className="flex flex-col items-center py-12">
                <LoadingCube size="md" />
                <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                  Loading network posts...
                </p>
              </div>
            ) : processedNetworkPosts.length > 0 ? (
              <>
                <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
                  {processedNetworkPosts.map(({ key, entry, author, externalUrl, tags }) => (
                    <BlogCard key={key} entry={entry} author={author} externalUrl={externalUrl} tags={tags} />
                  ))}
                </MasonryGrid>
                {networkFeed.hasMore && (
                  <div className="mt-8 text-center">
                    <button
                      onClick={networkFeed.loadMore}
                      disabled={networkFeed.loadingMore}
                      className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {networkFeed.loadingMore ? 'Loading...' : 'More'}
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
  )
}
