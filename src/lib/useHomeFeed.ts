import { useState, useCallback, useEffect } from 'react'
import {
  getRecentPosts,
  getNetworkPosts,
  getFollowingPosts,
  type AppViewPost,
} from '@/lib/appview'
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

interface FeedState {
  posts: AppViewPost[]
  loading: boolean
  loaded: boolean
  cursor: string | undefined
  loadCount: number
  loadingMore: boolean
}

interface UseFeedResult extends FeedState {
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  hasMore: boolean
  fromCache: boolean
}

const MAX_LOAD_COUNT = 12
const PAGE_SIZE = 24

/**
 * Hook for managing the GreenGale (recent posts) feed
 */
export function useGreengaleFeed(): UseFeedResult & { appViewAvailable: boolean } {
  // Lazy initialize from cache
  const [initialCache] = useState(() => getCachedGreengaleFeed())

  const [posts, setPosts] = useState<AppViewPost[]>(initialCache?.posts ?? [])
  const [loading, setLoading] = useState(!initialCache)
  const [loaded, setLoaded] = useState(!!initialCache)
  const [cursor, setCursor] = useState<string | undefined>(initialCache?.cursor)
  const [loadCount, setLoadCount] = useState(initialCache?.loadCount ?? 1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [appViewAvailable, setAppViewAvailable] = useState(!!initialCache)
  const [fromCache, setFromCache] = useState(false)

  // Initial load effect - only runs once on mount if no cache
  useEffect(() => {
    // Skip if we have cache data
    if (initialCache) return

    async function loadInitial() {
      try {
        const { posts: newPosts, cursor: nextCursor } = await getRecentPosts(PAGE_SIZE)
        setPosts(newPosts)
        setCursor(nextCursor)
        setAppViewAvailable(true)
        setFromCache(false)
        setLoaded(true)
        // Cache for offline access
        cacheFeed('recent', newPosts, nextCursor)
        setCachedGreengaleFeed(newPosts, nextCursor, 1)
      } catch {
        // Try offline cache if network fails
        if (!navigator.onLine) {
          const cached = await getCachedFeed('recent')
          if (cached) {
            setPosts(cached.posts)
            setCursor(cached.cursor)
            setAppViewAvailable(true)
            setFromCache(true)
            setLoaded(true)
            return
          }
        }
        setAppViewAvailable(false)
      } finally {
        setLoading(false)
      }
    }

    loadInitial()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loadCount >= MAX_LOAD_COUNT) return
    setLoadingMore(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getRecentPosts(PAGE_SIZE, cursor)
      const allPosts = [...posts, ...newPosts]
      const newLoadCount = loadCount + 1
      setPosts(allPosts)
      setCursor(nextCursor)
      setLoadCount(newLoadCount)
      setCachedGreengaleFeed(allPosts, nextCursor, newLoadCount)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, loadCount, posts])

  const refresh = useCallback(async () => {
    clearGreengaleFeedCache()
    const { posts: newPosts, cursor: nextCursor } = await getRecentPosts(PAGE_SIZE)
    setPosts(newPosts)
    setCursor(nextCursor)
    setLoadCount(1)
    setFromCache(false)
    setCachedGreengaleFeed(newPosts, nextCursor, 1)
  }, [])

  return {
    posts,
    loading,
    loaded,
    cursor,
    loadCount,
    loadingMore,
    loadMore,
    refresh,
    hasMore: !!cursor && loadCount < MAX_LOAD_COUNT,
    appViewAvailable,
    fromCache,
  }
}

/**
 * Hook for managing the Network feed
 */
export function useNetworkFeed(): UseFeedResult & { load: () => Promise<void> } {
  const [initialCache] = useState(() => getCachedNetworkFeed())

  const [posts, setPosts] = useState<AppViewPost[]>(initialCache?.posts ?? [])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(!!initialCache)
  const [cursor, setCursor] = useState<string | undefined>(initialCache?.cursor)
  const [loadCount, setLoadCount] = useState(initialCache?.loadCount ?? 1)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    if (loaded || loading) return
    setLoading(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getNetworkPosts(PAGE_SIZE)
      setPosts(newPosts)
      setCursor(nextCursor)
      setLoaded(true)
      setCachedNetworkFeed(newPosts, nextCursor, 1)
    } catch {
      // Network feed not available
    } finally {
      setLoading(false)
    }
  }, [loaded, loading])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loadCount >= MAX_LOAD_COUNT) return
    setLoadingMore(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getNetworkPosts(PAGE_SIZE, cursor)
      const allPosts = [...posts, ...newPosts]
      const newLoadCount = loadCount + 1
      setPosts(allPosts)
      setCursor(nextCursor)
      setLoadCount(newLoadCount)
      setCachedNetworkFeed(allPosts, nextCursor, newLoadCount)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, loadCount, posts])

  const refresh = useCallback(async () => {
    clearNetworkFeedCache()
    setLoading(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getNetworkPosts(PAGE_SIZE)
      setPosts(newPosts)
      setCursor(nextCursor)
      setLoadCount(1)
      setCachedNetworkFeed(newPosts, nextCursor, 1)
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    posts,
    loading,
    loaded,
    cursor,
    loadCount,
    loadingMore,
    loadMore,
    refresh,
    load,
    hasMore: !!cursor && loadCount < MAX_LOAD_COUNT,
    fromCache: false,
  }
}

/**
 * Hook for managing the Following feed
 */
export function useFollowingFeed(userDid: string | undefined): UseFeedResult & { load: () => Promise<void> } {
  const [initialCache] = useState(() => getCachedFollowingFeed())

  const [posts, setPosts] = useState<AppViewPost[]>(initialCache?.posts ?? [])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(!!initialCache)
  const [cursor, setCursor] = useState<string | undefined>(initialCache?.cursor)
  const [loadCount, setLoadCount] = useState(initialCache?.loadCount ?? 1)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    if (!userDid || loaded || loading) return
    setLoading(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getFollowingPosts(userDid, PAGE_SIZE)
      setPosts(newPosts)
      setCursor(nextCursor)
      setLoaded(true)
      setCachedFollowingFeed(newPosts, nextCursor, 1)
    } catch {
      // Following feed not available
    } finally {
      setLoading(false)
    }
  }, [userDid, loaded, loading])

  const loadMore = useCallback(async () => {
    if (!userDid || !cursor || loadingMore || loadCount >= MAX_LOAD_COUNT) return
    setLoadingMore(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getFollowingPosts(userDid, PAGE_SIZE, cursor)
      const allPosts = [...posts, ...newPosts]
      const newLoadCount = loadCount + 1
      setPosts(allPosts)
      setCursor(nextCursor)
      setLoadCount(newLoadCount)
      setCachedFollowingFeed(allPosts, nextCursor, newLoadCount)
    } finally {
      setLoadingMore(false)
    }
  }, [userDid, cursor, loadingMore, loadCount, posts])

  const refresh = useCallback(async () => {
    if (!userDid) return
    clearFollowingFeedCache()
    setLoading(true)
    try {
      const { posts: newPosts, cursor: nextCursor } = await getFollowingPosts(userDid, PAGE_SIZE)
      setPosts(newPosts)
      setCursor(nextCursor)
      setLoadCount(1)
      setCachedFollowingFeed(newPosts, nextCursor, 1)
    } finally {
      setLoading(false)
    }
  }, [userDid])

  return {
    posts,
    loading,
    loaded,
    cursor,
    loadCount,
    loadingMore,
    loadMore,
    refresh,
    load,
    hasMore: !!cursor && loadCount < MAX_LOAD_COUNT,
    fromCache: false,
  }
}
