import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getCachedGreengaleFeed,
  setCachedGreengaleFeed,
  getCachedNetworkFeed,
  setCachedNetworkFeed,
  getCachedFollowingFeed,
  setCachedFollowingFeed,
  clearGreengaleFeedCache,
  clearNetworkFeedCache,
  clearFollowingFeedCache,
  invalidateFeedCache,
} from '../feedCache'
import type { AppViewPost } from '../appview'

// Helper to create a mock post
function createMockPost(id: number): AppViewPost {
  return {
    uri: `at://did:plc:test/app.greengale.document/post${id}`,
    authorDid: 'did:plc:test',
    rkey: `post${id}`,
    title: `Test Post ${id}`,
    source: 'greengale',
    visibility: 'public',
    createdAt: new Date().toISOString(),
    indexedAt: new Date().toISOString(),
  }
}

describe('feedCache', () => {
  beforeEach(() => {
    // Clear all caches before each test
    invalidateFeedCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Greengale feed cache', () => {
    it('returns null when cache is empty', () => {
      expect(getCachedGreengaleFeed()).toBeNull()
    })

    it('stores and retrieves feed data', () => {
      const posts = [createMockPost(1), createMockPost(2)]
      const cursor = 'cursor-123'
      const loadCount = 2

      setCachedGreengaleFeed(posts, cursor, loadCount)
      const cached = getCachedGreengaleFeed()

      expect(cached).not.toBeNull()
      expect(cached?.posts).toHaveLength(2)
      expect(cached?.cursor).toBe('cursor-123')
      expect(cached?.loadCount).toBe(2)
    })

    it('stores feed with undefined cursor', () => {
      const posts = [createMockPost(1)]

      setCachedGreengaleFeed(posts, undefined, 1)
      const cached = getCachedGreengaleFeed()

      expect(cached?.cursor).toBeUndefined()
    })

    it('expires cache after 5 minutes', () => {
      const posts = [createMockPost(1)]
      setCachedGreengaleFeed(posts, undefined, 1)

      // Advance time by 4 minutes - should still be valid
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(getCachedGreengaleFeed()).not.toBeNull()

      // Advance by 2 more minutes (total 6 minutes) - should be expired
      vi.advanceTimersByTime(2 * 60 * 1000)
      expect(getCachedGreengaleFeed()).toBeNull()
    })

    it('clears cache with clearGreengaleFeedCache', () => {
      setCachedGreengaleFeed([createMockPost(1)], undefined, 1)
      expect(getCachedGreengaleFeed()).not.toBeNull()

      clearGreengaleFeedCache()
      expect(getCachedGreengaleFeed()).toBeNull()
    })

    it('overwrites previous cache when set again', () => {
      setCachedGreengaleFeed([createMockPost(1)], 'cursor1', 1)
      setCachedGreengaleFeed([createMockPost(2), createMockPost(3)], 'cursor2', 2)

      const cached = getCachedGreengaleFeed()
      expect(cached?.posts).toHaveLength(2)
      expect(cached?.cursor).toBe('cursor2')
      expect(cached?.loadCount).toBe(2)
    })
  })

  describe('Network feed cache', () => {
    it('returns null when cache is empty', () => {
      expect(getCachedNetworkFeed()).toBeNull()
    })

    it('stores and retrieves feed data', () => {
      const posts = [createMockPost(1)]
      setCachedNetworkFeed(posts, 'net-cursor', 5)

      const cached = getCachedNetworkFeed()
      expect(cached?.posts).toHaveLength(1)
      expect(cached?.cursor).toBe('net-cursor')
      expect(cached?.loadCount).toBe(5)
    })

    it('expires cache after 5 minutes', () => {
      setCachedNetworkFeed([createMockPost(1)], undefined, 1)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      expect(getCachedNetworkFeed()).toBeNull()
    })

    it('clears cache with clearNetworkFeedCache', () => {
      setCachedNetworkFeed([createMockPost(1)], undefined, 1)
      clearNetworkFeedCache()
      expect(getCachedNetworkFeed()).toBeNull()
    })
  })

  describe('Following feed cache', () => {
    it('returns null when cache is empty', () => {
      expect(getCachedFollowingFeed()).toBeNull()
    })

    it('stores and retrieves feed data', () => {
      const posts = [createMockPost(1), createMockPost(2), createMockPost(3)]
      setCachedFollowingFeed(posts, 'follow-cursor', 3)

      const cached = getCachedFollowingFeed()
      expect(cached?.posts).toHaveLength(3)
      expect(cached?.cursor).toBe('follow-cursor')
      expect(cached?.loadCount).toBe(3)
    })

    it('expires cache after 5 minutes', () => {
      setCachedFollowingFeed([createMockPost(1)], undefined, 1)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      expect(getCachedFollowingFeed()).toBeNull()
    })

    it('clears cache with clearFollowingFeedCache', () => {
      setCachedFollowingFeed([createMockPost(1)], undefined, 1)
      clearFollowingFeedCache()
      expect(getCachedFollowingFeed()).toBeNull()
    })
  })

  describe('invalidateFeedCache', () => {
    it('clears all feed caches at once', () => {
      setCachedGreengaleFeed([createMockPost(1)], undefined, 1)
      setCachedNetworkFeed([createMockPost(2)], undefined, 1)
      setCachedFollowingFeed([createMockPost(3)], undefined, 1)

      expect(getCachedGreengaleFeed()).not.toBeNull()
      expect(getCachedNetworkFeed()).not.toBeNull()
      expect(getCachedFollowingFeed()).not.toBeNull()

      invalidateFeedCache()

      expect(getCachedGreengaleFeed()).toBeNull()
      expect(getCachedNetworkFeed()).toBeNull()
      expect(getCachedFollowingFeed()).toBeNull()
    })
  })

  describe('Cache isolation', () => {
    it('greengale and network caches are independent', () => {
      setCachedGreengaleFeed([createMockPost(1)], 'greengale', 1)
      setCachedNetworkFeed([createMockPost(2)], 'network', 2)

      clearGreengaleFeedCache()

      expect(getCachedGreengaleFeed()).toBeNull()
      expect(getCachedNetworkFeed()).not.toBeNull()
      expect(getCachedNetworkFeed()?.cursor).toBe('network')
    })

    it('following and greengale caches are independent', () => {
      setCachedFollowingFeed([createMockPost(1)], 'following', 1)
      setCachedGreengaleFeed([createMockPost(2)], 'greengale', 2)

      clearFollowingFeedCache()

      expect(getCachedFollowingFeed()).toBeNull()
      expect(getCachedGreengaleFeed()).not.toBeNull()
    })

    it('all three caches are independent', () => {
      setCachedGreengaleFeed([createMockPost(1)], 'g', 1)
      setCachedNetworkFeed([createMockPost(2)], 'n', 1)
      setCachedFollowingFeed([createMockPost(3)], 'f', 1)

      clearNetworkFeedCache()

      expect(getCachedGreengaleFeed()?.cursor).toBe('g')
      expect(getCachedNetworkFeed()).toBeNull()
      expect(getCachedFollowingFeed()?.cursor).toBe('f')
    })
  })

  describe('Edge cases', () => {
    it('handles empty posts array', () => {
      setCachedGreengaleFeed([], undefined, 0)
      const cached = getCachedGreengaleFeed()

      expect(cached).not.toBeNull()
      expect(cached?.posts).toHaveLength(0)
      expect(cached?.loadCount).toBe(0)
    })

    it('handles large loadCount values', () => {
      setCachedNetworkFeed([createMockPost(1)], 'cursor', 1000)
      const cached = getCachedNetworkFeed()

      expect(cached?.loadCount).toBe(1000)
    })

    it('preserves post data integrity', () => {
      const post = createMockPost(1)
      post.subtitle = 'A subtitle'
      post.author = {
        handle: 'test.bsky.social',
        displayName: 'Test User',
      }

      setCachedGreengaleFeed([post], undefined, 1)
      const cached = getCachedGreengaleFeed()

      expect(cached?.posts[0].subtitle).toBe('A subtitle')
      expect(cached?.posts[0].author?.handle).toBe('test.bsky.social')
    })

    it('cache expires exactly at TTL boundary', () => {
      setCachedGreengaleFeed([createMockPost(1)], undefined, 1)

      // At exactly 5 minutes, should still be valid
      vi.advanceTimersByTime(5 * 60 * 1000)
      expect(getCachedGreengaleFeed()).not.toBeNull()

      // 1ms later, should be expired
      vi.advanceTimersByTime(1)
      expect(getCachedGreengaleFeed()).toBeNull()
    })

    it('setting cache resets expiration timer', () => {
      setCachedGreengaleFeed([createMockPost(1)], undefined, 1)

      // Advance 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(getCachedGreengaleFeed()).not.toBeNull()

      // Reset cache
      setCachedGreengaleFeed([createMockPost(2)], undefined, 1)

      // Advance another 4 minutes (would be 8 total from original)
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(getCachedGreengaleFeed()).not.toBeNull()

      // Advance 2 more minutes (6 from last set) - should expire
      vi.advanceTimersByTime(2 * 60 * 1000)
      expect(getCachedGreengaleFeed()).toBeNull()
    })
  })
})
