import type { AppViewPost } from './appview'

interface FeedCache {
  posts: AppViewPost[]
  cursor: string | undefined
  loadCount: number
  timestamp: number
}

interface FeedCacheStore {
  greengale: FeedCache | null
  network: FeedCache | null
  following: FeedCache | null
}

// Module-level cache that persists across component mounts
const cache: FeedCacheStore = {
  greengale: null,
  network: null,
  following: null,
}

// Cache expires after 5 minutes
const CACHE_TTL = 5 * 60 * 1000

export function getCachedGreengaleFeed(): FeedCache | null {
  const cached = cache.greengale
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.greengale = null
    return null
  }
  return cached
}

export function setCachedGreengaleFeed(posts: AppViewPost[], cursor: string | undefined, loadCount: number): void {
  cache.greengale = {
    posts,
    cursor,
    loadCount,
    timestamp: Date.now(),
  }
}

export function getCachedNetworkFeed(): FeedCache | null {
  const cached = cache.network
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.network = null
    return null
  }
  return cached
}

export function setCachedNetworkFeed(posts: AppViewPost[], cursor: string | undefined, loadCount: number): void {
  cache.network = {
    posts,
    cursor,
    loadCount,
    timestamp: Date.now(),
  }
}

export function getCachedFollowingFeed(): FeedCache | null {
  const cached = cache.following
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.following = null
    return null
  }
  return cached
}

export function setCachedFollowingFeed(posts: AppViewPost[], cursor: string | undefined, loadCount: number): void {
  cache.following = {
    posts,
    cursor,
    loadCount,
    timestamp: Date.now(),
  }
}

export function clearGreengaleFeedCache(): void {
  cache.greengale = null
}

export function clearNetworkFeedCache(): void {
  cache.network = null
}

export function clearFollowingFeedCache(): void {
  cache.following = null
}

export function invalidateFeedCache(): void {
  cache.greengale = null
  cache.network = null
  cache.following = null
}
