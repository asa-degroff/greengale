import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  cachePost,
  getCachedPost,
  deleteCachedPost,
  cacheFeed,
  getCachedFeed,
  getCacheStats,
  clearAll,
} from '../offline-store'
import type { BlogEntry, AuthorProfile, Publication } from '../atproto'
import type { AppViewPost } from '../appview'

function makeEntry(overrides: Partial<BlogEntry> = {}): BlogEntry {
  return {
    uri: 'at://did:plc:test/app.greengale.document/abc123',
    cid: 'bafyreiabc123',
    authorDid: 'did:plc:test',
    rkey: 'abc123',
    content: '# Hello World\n\nThis is a test post.',
    title: 'Test Post',
    subtitle: 'A test',
    source: 'greengale',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeAuthor(overrides: Partial<AuthorProfile> = {}): AuthorProfile {
  return {
    did: 'did:plc:test',
    handle: 'test.bsky.social',
    displayName: 'Test User',
    avatar: 'https://cdn.bsky.app/img/avatar/test',
    ...overrides,
  }
}

function makePublication(overrides: Partial<Publication> = {}): Publication {
  return {
    name: 'Test Blog',
    url: 'https://greengale.app/test.bsky.social',
    ...overrides,
  }
}

function makeAppViewPost(i: number): AppViewPost {
  return {
    uri: `at://did:plc:test/app.greengale.document/post${i}`,
    authorDid: 'did:plc:test',
    rkey: `post${i}`,
    title: `Post ${i}`,
    subtitle: null,
    source: 'greengale',
    visibility: 'public',
    createdAt: '2024-01-01T00:00:00Z',
    indexedAt: '2024-01-01T00:00:01Z',
  }
}

// Reset IndexedDB between tests
beforeEach(async () => {
  await clearAll()
})

describe('offline-store', () => {
  describe('cachePost / getCachedPost', () => {
    it('stores and retrieves a post', async () => {
      const entry = makeEntry()
      const author = makeAuthor()
      const publication = makePublication()

      await cachePost('test.bsky.social', 'abc123', entry, author, publication, false)
      const cached = await getCachedPost('test.bsky.social', 'abc123')

      expect(cached).not.toBeNull()
      expect(cached!.entry.title).toBe('Test Post')
      expect(cached!.entry.content).toBe('# Hello World\n\nThis is a test post.')
      expect(cached!.author.handle).toBe('test.bsky.social')
      expect(cached!.publication?.name).toBe('Test Blog')
      expect(cached!.cid).toBe('bafyreiabc123')
      expect(cached!.isOwnPost).toBe(false)
    })

    it('stores own posts with isOwnPost flag', async () => {
      await cachePost('me.bsky.social', 'mypost', makeEntry(), makeAuthor(), null, true)
      const cached = await getCachedPost('me.bsky.social', 'mypost')

      expect(cached!.isOwnPost).toBe(true)
    })

    it('stores posts with null publication', async () => {
      await cachePost('test.bsky.social', 'abc123', makeEntry(), makeAuthor(), null, false)
      const cached = await getCachedPost('test.bsky.social', 'abc123')

      expect(cached!.publication).toBeNull()
    })

    it('returns null for non-existent posts', async () => {
      const cached = await getCachedPost('nonexistent.bsky.social', 'xyz')
      expect(cached).toBeNull()
    })

    it('upserts existing entries', async () => {
      const entry1 = makeEntry({ title: 'Original' })
      const entry2 = makeEntry({ title: 'Updated', cid: 'bafyreinew' })

      await cachePost('test.bsky.social', 'abc123', entry1, makeAuthor(), null, false)
      await cachePost('test.bsky.social', 'abc123', entry2, makeAuthor(), null, false)

      const cached = await getCachedPost('test.bsky.social', 'abc123')
      expect(cached!.entry.title).toBe('Updated')
      expect(cached!.cid).toBe('bafyreinew')
    })

    it('updates cachedAt on upsert', async () => {
      await cachePost('test.bsky.social', 'abc123', makeEntry(), makeAuthor(), null, false)
      const first = await getCachedPost('test.bsky.social', 'abc123')

      // Wait a tick to ensure different timestamp
      await new Promise(r => setTimeout(r, 10))

      await cachePost('test.bsky.social', 'abc123', makeEntry(), makeAuthor(), null, false)
      const second = await getCachedPost('test.bsky.social', 'abc123')

      expect(second!.cachedAt).toBeGreaterThanOrEqual(first!.cachedAt)
    })
  })

  describe('deleteCachedPost', () => {
    it('deletes a cached post', async () => {
      await cachePost('test.bsky.social', 'abc123', makeEntry(), makeAuthor(), null, false)
      await deleteCachedPost('test.bsky.social', 'abc123')

      const cached = await getCachedPost('test.bsky.social', 'abc123')
      expect(cached).toBeNull()
    })

    it('does not throw for non-existent posts', async () => {
      await expect(deleteCachedPost('nonexistent', 'xyz')).resolves.not.toThrow()
    })
  })

  describe('LRU eviction', () => {
    it('evicts oldest posts when exceeding max', async () => {
      // Cache 52 posts with incrementing timestamps to ensure order
      for (let i = 0; i < 52; i++) {
        const entry = makeEntry({ rkey: `post${i}`, cid: `cid${i}` })
        const author = makeAuthor({ handle: `author${i}.bsky.social` })
        await cachePost(`author${i}.bsky.social`, `post${i}`, entry, author, null, false)
      }

      const stats = await getCacheStats()
      expect(stats.postCount).toBe(50)

      // Oldest posts (0 and 1) should be evicted
      const evicted0 = await getCachedPost('author0.bsky.social', 'post0')
      const evicted1 = await getCachedPost('author1.bsky.social', 'post1')
      expect(evicted0).toBeNull()
      expect(evicted1).toBeNull()

      // Newest post should still exist
      const kept = await getCachedPost('author51.bsky.social', 'post51')
      expect(kept).not.toBeNull()
    }, 30000)
  })

  describe('cacheFeed / getCachedFeed', () => {
    it('stores and retrieves a feed', async () => {
      const posts = [makeAppViewPost(1), makeAppViewPost(2), makeAppViewPost(3)]
      await cacheFeed('recent', posts, 'cursor123')

      const cached = await getCachedFeed('recent')
      expect(cached).not.toBeNull()
      expect(cached!.posts).toHaveLength(3)
      expect(cached!.posts[0].title).toBe('Post 1')
      expect(cached!.cursor).toBe('cursor123')
    })

    it('stores feed without cursor', async () => {
      await cacheFeed('recent', [makeAppViewPost(1)])
      const cached = await getCachedFeed('recent')
      expect(cached!.cursor).toBeUndefined()
    })

    it('returns null for non-existent feeds', async () => {
      const cached = await getCachedFeed('nonexistent')
      expect(cached).toBeNull()
    })

    it('upserts feeds by key', async () => {
      await cacheFeed('recent', [makeAppViewPost(1)])
      await cacheFeed('recent', [makeAppViewPost(2), makeAppViewPost(3)])

      const cached = await getCachedFeed('recent')
      expect(cached!.posts).toHaveLength(2)
      expect(cached!.posts[0].title).toBe('Post 2')
    })

    it('stores multiple feeds with different keys', async () => {
      await cacheFeed('recent', [makeAppViewPost(1)])
      await cacheFeed('network', [makeAppViewPost(2)])
      await cacheFeed('author:test', [makeAppViewPost(3)])

      const recent = await getCachedFeed('recent')
      const network = await getCachedFeed('network')
      const author = await getCachedFeed('author:test')

      expect(recent!.posts[0].title).toBe('Post 1')
      expect(network!.posts[0].title).toBe('Post 2')
      expect(author!.posts[0].title).toBe('Post 3')
    })

    it('evicts oldest feeds when exceeding 10', async () => {
      for (let i = 0; i < 12; i++) {
        await cacheFeed(`feed${i}`, [makeAppViewPost(i)])
        await new Promise(r => setTimeout(r, 2))
      }

      const stats = await getCacheStats()
      expect(stats.feedCount).toBe(10)

      // Oldest should be evicted
      const evicted = await getCachedFeed('feed0')
      expect(evicted).toBeNull()

      // Newest should exist
      const kept = await getCachedFeed('feed11')
      expect(kept).not.toBeNull()
    })
  })

  describe('getCacheStats', () => {
    it('returns zero counts for empty cache', async () => {
      const stats = await getCacheStats()
      expect(stats.postCount).toBe(0)
      expect(stats.feedCount).toBe(0)
    })

    it('returns correct counts', async () => {
      await cachePost('a.bsky.social', 'p1', makeEntry(), makeAuthor(), null, false)
      await cachePost('b.bsky.social', 'p2', makeEntry(), makeAuthor(), null, false)
      await cacheFeed('recent', [makeAppViewPost(1)])

      const stats = await getCacheStats()
      expect(stats.postCount).toBe(2)
      expect(stats.feedCount).toBe(1)
    })
  })

  describe('clearAll', () => {
    it('clears all cached data', async () => {
      await cachePost('test.bsky.social', 'p1', makeEntry(), makeAuthor(), null, false)
      await cacheFeed('recent', [makeAppViewPost(1)])

      await clearAll()

      const stats = await getCacheStats()
      expect(stats.postCount).toBe(0)
      expect(stats.feedCount).toBe(0)
    })
  })
})
