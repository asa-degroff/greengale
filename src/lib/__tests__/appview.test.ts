import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  checkAppViewHealth,
  getRecentPosts,
  getNetworkPosts,
  getAuthorPosts,
  getPost,
  getAuthorProfile,
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
})
