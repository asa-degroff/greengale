import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  checkAppViewHealth,
  getRecentPosts,
  getNetworkPosts,
  getAuthorPosts,
  getPost,
  getAuthorProfile,
  searchPublications,
  getPostsByTag,
  getPopularTags,
} from '../appview'

// Mock fetch globally
const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Helper to create a mock Response
function mockResponse(data: unknown, options: { status?: number; ok?: boolean; statusText?: string } = {}) {
  const { status = 200, ok = true, statusText = 'OK' } = options
  return {
    ok,
    status,
    statusText,
    json: () => Promise.resolve(data),
  } as Response
}

describe('AppView API Client', () => {
  describe('checkAppViewHealth', () => {
    it('returns true when health check succeeds', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ status: 'ok' }))

      const result = await checkAppViewHealth()

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/xrpc/_health'))
    })

    it('returns false when status is not ok', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ status: 'error' }))

      const result = await checkAppViewHealth()

      expect(result).toBe(false)
    })

    it('returns false when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false, status: 500 }))

      const result = await checkAppViewHealth()

      expect(result).toBe(false)
    })

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await checkAppViewHealth()

      expect(result).toBe(false)
    })
  })

  describe('getRecentPosts', () => {
    it('fetches recent posts with default limit', async () => {
      const posts = [{ uri: 'at://did:plc:abc/app.greengale.document/123' }]
      mockFetch.mockResolvedValueOnce(mockResponse({ posts }))

      const result = await getRecentPosts()

      expect(result.posts).toEqual(posts)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/getRecentPosts\?limit=50$/)
      )
    })

    it('fetches recent posts with custom limit', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getRecentPosts(25)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=25/)
      )
    })

    it('includes cursor when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [], cursor: 'next' }))

      await getRecentPosts(50, 'cursor123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/cursor=cursor123/)
      )
    })

    it('returns cursor for pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [], cursor: 'nextPage' }))

      const result = await getRecentPosts()

      expect(result.cursor).toBe('nextPage')
    })

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })
      )

      await expect(getRecentPosts()).rejects.toThrow('Failed to fetch recent posts')
    })
  })

  describe('getNetworkPosts', () => {
    it('fetches network posts with default limit', async () => {
      const posts = [{ uri: 'at://did:plc:xyz/site.standard.document/456' }]
      mockFetch.mockResolvedValueOnce(mockResponse({ posts }))

      const result = await getNetworkPosts()

      expect(result.posts).toEqual(posts)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/getNetworkPosts\?limit=50$/)
      )
    })

    it('fetches network posts with custom limit', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getNetworkPosts(10)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=10/)
      )
    })

    it('includes cursor when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getNetworkPosts(50, 'networkCursor')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/cursor=networkCursor/)
      )
    })

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 503, statusText: 'Service Unavailable' })
      )

      await expect(getNetworkPosts()).rejects.toThrow('Failed to fetch network posts')
    })
  })

  describe('getAuthorPosts', () => {
    it('fetches posts for an author', async () => {
      const posts = [{ uri: 'at://did:plc:author/app.greengale.document/post1' }]
      mockFetch.mockResolvedValueOnce(mockResponse({ posts }))

      const result = await getAuthorPosts('user.bsky.social')

      expect(result.posts).toEqual(posts)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/author=user\.bsky\.social/)
      )
    })

    it('includes limit parameter', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getAuthorPosts('user.bsky.social', 20)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=20/)
      )
    })

    it('includes cursor when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getAuthorPosts('user.bsky.social', 50, 'authorCursor')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/cursor=authorCursor/)
      )
    })

    it('includes viewer DID when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getAuthorPosts('user.bsky.social', 50, undefined, 'did:plc:viewer')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/viewer=did%3Aplc%3Aviewer/)
      )
    })

    it('handles author with special characters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getAuthorPosts('did:plc:abc123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/author=did%3Aplc%3Aabc123/)
      )
    })

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 404, statusText: 'Not Found' })
      )

      await expect(getAuthorPosts('unknown')).rejects.toThrow('Failed to fetch author posts')
    })
  })

  describe('getPost', () => {
    it('fetches a single post', async () => {
      const post = {
        uri: 'at://did:plc:author/app.greengale.document/post1',
        title: 'Test Post',
      }
      mockFetch.mockResolvedValueOnce(mockResponse({ post }))

      const result = await getPost('user.bsky.social', 'post1')

      expect(result).toEqual(post)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/author=user\.bsky\.social.*rkey=post1/)
      )
    })

    it('returns null for 404 response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 404, statusText: 'Not Found' })
      )

      const result = await getPost('user.bsky.social', 'nonexistent')

      expect(result).toBeNull()
    })

    it('includes viewer DID when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ post: null }))

      await getPost('user.bsky.social', 'post1', 'did:plc:viewer')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/viewer=did%3Aplc%3Aviewer/)
      )
    })

    it('throws error on non-404 failure', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })
      )

      await expect(getPost('user', 'post')).rejects.toThrow('Failed to fetch post')
    })

    it('handles rkey with special characters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ post: null }))

      await getPost('user.bsky.social', '3kp7xyz+123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/rkey=3kp7xyz%2B123/)
      )
    })
  })

  describe('getAuthorProfile', () => {
    it('fetches author profile', async () => {
      const profile = {
        did: 'did:plc:abc',
        handle: 'user.bsky.social',
        displayName: 'User Name',
        avatar: 'https://example.com/avatar.jpg',
        description: 'A test user',
        postsCount: 42,
      }
      mockFetch.mockResolvedValueOnce(mockResponse(profile))

      const result = await getAuthorProfile('user.bsky.social')

      expect(result).toEqual(profile)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/author=user\.bsky\.social/)
      )
    })

    it('returns null for 404 response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 404, statusText: 'Not Found' })
      )

      const result = await getAuthorProfile('unknown.user')

      expect(result).toBeNull()
    })

    it('includes publication info when present', async () => {
      const profile = {
        did: 'did:plc:abc',
        handle: 'user.bsky.social',
        displayName: 'User',
        avatar: null,
        description: null,
        postsCount: 5,
        publication: {
          name: 'My Blog',
          url: 'https://myblog.com',
          description: 'A blog about things',
        },
      }
      mockFetch.mockResolvedValueOnce(mockResponse(profile))

      const result = await getAuthorProfile('user.bsky.social')

      expect(result?.publication?.name).toBe('My Blog')
    })

    it('throws error on non-404 failure', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 500, statusText: 'Server Error' })
      )

      await expect(getAuthorProfile('user')).rejects.toThrow('Failed to fetch author')
    })

    it('handles DID as author parameter', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ did: 'did:plc:test' }))

      await getAuthorProfile('did:plc:test')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/author=did%3Aplc%3Atest/)
      )
    })
  })

  describe('searchPublications', () => {
    it('searches for publications with query', async () => {
      const results = [
        {
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          displayName: 'Test User',
          avatarUrl: 'https://example.com/avatar.jpg',
          publication: { name: 'My Blog', url: 'https://myblog.com' },
          matchType: 'handle',
        },
      ]
      mockFetch.mockResolvedValueOnce(mockResponse({ results }))

      const response = await searchPublications('test')

      expect(response.results).toEqual(results)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/search\.publications\?q=test/),
        expect.objectContaining({ signal: undefined })
      )
    })

    it('uses default limit of 10', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }))

      await searchPublications('query')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=10/),
        expect.objectContaining({ signal: undefined })
      )
    })

    it('accepts custom limit', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }))

      await searchPublications('query', 25)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=25/),
        expect.objectContaining({ signal: undefined })
      )
    })

    it('encodes query parameter', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }))

      await searchPublications('user+name')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/q=user%2Bname/),
        expect.objectContaining({ signal: undefined })
      )
    })

    it('returns empty results when no matches', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }))

      const response = await searchPublications('nonexistent')

      expect(response.results).toEqual([])
    })

    it('returns multiple results', async () => {
      const results = [
        { did: 'did:1', handle: 'user1', matchType: 'handle' },
        { did: 'did:2', handle: 'user2', matchType: 'displayName' },
        { did: 'did:3', handle: 'user3', matchType: 'publicationName' },
      ]
      mockFetch.mockResolvedValueOnce(mockResponse({ results }))

      const response = await searchPublications('query')

      expect(response.results).toHaveLength(3)
    })

    it('handles results with null publication', async () => {
      const results = [
        {
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          displayName: null,
          avatarUrl: null,
          publication: null,
          matchType: 'handle',
        },
      ]
      mockFetch.mockResolvedValueOnce(mockResponse({ results }))

      const response = await searchPublications('test')

      expect(response.results[0].publication).toBeNull()
    })

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })
      )

      await expect(searchPublications('query')).rejects.toThrow('Failed to search publications')
    })

    it('handles special characters in query', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }))

      await searchPublications('test@example.com')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/q=test%40example\.com/),
        expect.objectContaining({ signal: undefined })
      )
    })

    it('passes abort signal when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }))
      const controller = new AbortController()

      await searchPublications('query', 10, controller.signal)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/search\.publications/),
        expect.objectContaining({ signal: controller.signal })
      )
    })
  })

  describe('URL construction', () => {
    it('uses correct API base URL', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getRecentPosts()

      // Should use the configured API base (defaulting to dev or prod URL)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^https?:\/\/.*\/xrpc\/app\.greengale\.feed\.getRecentPosts/)
      )
    })

    it('properly encodes query parameters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ posts: [] }))

      await getAuthorPosts('user+special@example.com')

      // Should be URL encoded
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/author=user%2Bspecial%40example\.com/)
      )
    })
  })

  describe('getPostsByTag', () => {
    it('fetches posts by tag with default limit', async () => {
      const posts = [
        { uri: 'at://did:plc:abc/app.greengale.document/123', tags: ['javascript'] },
      ]
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'javascript', posts }))

      const result = await getPostsByTag('javascript')

      expect(result.posts).toEqual(posts)
      expect(result.tag).toBe('javascript')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/getPostsByTag\?tag=javascript.*limit=50/)
      )
    })

    it('fetches posts by tag with custom limit', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'typescript', posts: [] }))

      await getPostsByTag('typescript', 25)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=25/)
      )
    })

    it('includes cursor when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'react', posts: [], cursor: 'next' }))

      await getPostsByTag('react', 50, 'cursor123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/cursor=cursor123/)
      )
    })

    it('returns cursor for pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'vue', posts: [], cursor: 'nextPage' }))

      const result = await getPostsByTag('vue')

      expect(result.cursor).toBe('nextPage')
    })

    it('encodes tag with special characters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'c++', posts: [] }))

      await getPostsByTag('c++')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/tag=c%2B%2B/)
      )
    })

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })
      )

      await expect(getPostsByTag('invalid')).rejects.toThrow('Failed to fetch posts by tag')
    })

    it('handles tag with spaces', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'machine learning', posts: [] }))

      await getPostsByTag('machine learning')

      // URLSearchParams encodes spaces as + (standard URL encoding)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/tag=machine\+learning/)
      )
    })

    it('returns empty array when no posts match tag', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tag: 'obscure-tag', posts: [] }))

      const result = await getPostsByTag('obscure-tag')

      expect(result.posts).toEqual([])
    })
  })

  describe('getPopularTags', () => {
    it('fetches popular tags with default limit', async () => {
      const tags = [
        { tag: 'javascript', count: 100 },
        { tag: 'typescript', count: 75 },
      ]
      mockFetch.mockResolvedValueOnce(mockResponse({ tags }))

      const result = await getPopularTags()

      expect(result.tags).toEqual(tags)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/getPopularTags\?limit=20$/)
      )
    })

    it('fetches popular tags with custom limit', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tags: [] }))

      await getPopularTags(50)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=50/)
      )
    })

    it('returns tags sorted by count', async () => {
      const tags = [
        { tag: 'most-popular', count: 500 },
        { tag: 'second', count: 250 },
        { tag: 'third', count: 100 },
      ]
      mockFetch.mockResolvedValueOnce(mockResponse({ tags }))

      const result = await getPopularTags(3)

      expect(result.tags[0].count).toBeGreaterThanOrEqual(result.tags[1].count)
      expect(result.tags[1].count).toBeGreaterThanOrEqual(result.tags[2].count)
    })

    it('returns empty array when no tags exist', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ tags: [] }))

      const result = await getPopularTags()

      expect(result.tags).toEqual([])
    })

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })
      )

      await expect(getPopularTags()).rejects.toThrow('Failed to fetch popular tags')
    })

    it('handles tag with count of zero (edge case)', async () => {
      const tags = [{ tag: 'new-tag', count: 0 }]
      mockFetch.mockResolvedValueOnce(mockResponse({ tags }))

      const result = await getPopularTags()

      expect(result.tags[0].count).toBe(0)
    })
  })
})
