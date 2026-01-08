import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Cloudflare Workers modules
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    constructor() {}
  },
}))

// Mock the og-image module to avoid font loading issues in tests
vi.mock('../lib/og-image', () => ({
  generateOGImage: vi.fn().mockResolvedValue(new Response(new ArrayBuffer(100), {
    headers: { 'Content-Type': 'image/png' },
  })),
  generateHomepageOGImage: vi.fn().mockResolvedValue(new Response(new ArrayBuffer(100), {
    headers: { 'Content-Type': 'image/png' },
  })),
  generateProfileOGImage: vi.fn().mockResolvedValue(new Response(new ArrayBuffer(100), {
    headers: { 'Content-Type': 'image/png' },
  })),
}))

// Import the REAL app after mocking dependencies
import api from '../api/index'

// Mock D1 Database
function createMockD1() {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ success: true }),
  }

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    _statement: mockStatement,
  }
}

// Mock KV Namespace
function createMockKV() {
  const store = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = store.get(key)
      if (type === 'json' && value) return JSON.parse(value as string)
      if (type === 'arrayBuffer' && value) return value
      return value ?? null
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    _store: store,
  }
}

// Mock Durable Object Namespace
function createMockFirehose() {
  return {
    idFromName: vi.fn().mockReturnValue('test-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }))),
    }),
  }
}

// Create test environment with all bindings
function createTestEnv() {
  return {
    DB: createMockD1(),
    CACHE: createMockKV(),
    FIREHOSE: createMockFirehose(),
    RELAY_URL: 'wss://test.relay',
    ADMIN_SECRET: 'test-admin-secret',
  }
}

// Helper to make requests to the real API
async function makeRequest(
  env: ReturnType<typeof createTestEnv>,
  path: string,
  options: RequestInit = {}
) {
  const url = `http://localhost${path}`
  const request = new Request(url, options)
  return api.fetch(request, env, {} as ExecutionContext)
}

describe('API Endpoints', () => {
  let env: ReturnType<typeof createTestEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    env = createTestEnv()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Health Check', () => {
    it('returns ok status', async () => {
      const res = await makeRequest(env, '/xrpc/_health')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data).toEqual({ status: 'ok', version: '0.1.0' })
    })
  })

  describe('Well-known Endpoints', () => {
    it('returns platform publication without handle', async () => {
      const res = await makeRequest(env, '/.well-known/site.standard.publication')
      expect(res.status).toBe(200)

      const text = await res.text()
      expect(text).toBe('at://did:plc:purpkfw7haimc4zu5a57slza/site.standard.publication/self')
    })

    it('returns user publication with handle', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:user123' })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=test.bsky.social')
      expect(res.status).toBe(200)

      const text = await res.text()
      expect(text).toBe('at://did:plc:user123/site.standard.publication/self')
    })

    it('returns 404 for unknown handle', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=unknown.bsky.social')
      expect(res.status).toBe(404)
    })
  })

  describe('getRecentPosts', () => {
    it('returns empty posts array when no posts exist', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toEqual([])
      expect(data.cursor).toBeUndefined()
    })

    it('returns posts with author data', async () => {
      const mockPosts = [
        {
          uri: 'at://did:plc:abc/app.greengale.document/123',
          author_did: 'did:plc:abc',
          rkey: '123',
          title: 'Test Post',
          subtitle: 'A test subtitle',
          source: 'greengale',
          visibility: 'public',
          created_at: '2024-01-01T00:00:00Z',
          indexed_at: '2024-01-01T00:00:00Z',
          handle: 'test.bsky.social',
          display_name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toHaveLength(1)
      expect(data.posts[0].uri).toBe('at://did:plc:abc/app.greengale.document/123')
      expect(data.posts[0].title).toBe('Test Post')
      expect(data.posts[0].author.handle).toBe('test.bsky.social')
    })

    it('respects limit parameter', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts?limit=10')

      expect(env.DB.prepare).toHaveBeenCalled()
      expect(env.DB._statement.bind).toHaveBeenCalledWith(11) // limit + 1 for hasMore check
    })

    it('caps limit at 100', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts?limit=500')

      expect(env.DB._statement.bind).toHaveBeenCalledWith(101) // 100 + 1
    })

    it('returns cursor when more posts available', async () => {
      const mockPosts = Array(51).fill(null).map((_, i) => ({
        uri: `at://did:plc:abc/app.greengale.document/${i}`,
        author_did: 'did:plc:abc',
        rkey: `${i}`,
        title: `Post ${i}`,
        source: 'greengale',
        visibility: 'public',
        indexed_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }))
      env.DB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')
      const data = await res.json()

      expect(data.posts).toHaveLength(50)
      expect(data.cursor).toBeDefined()
    })

    it('uses cursor for pagination', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts?cursor=2024-01-15T00:00:00Z')

      expect(env.DB._statement.bind).toHaveBeenCalledWith('2024-01-15T00:00:00Z', 51)
    })

    it('returns cached response when available', async () => {
      const cachedResponse = { posts: [{ uri: 'cached' }], cursor: undefined }
      env.CACHE.get.mockResolvedValueOnce(cachedResponse)

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')
      const data = await res.json()

      expect(data.posts[0].uri).toBe('cached')
      expect(env.DB.prepare).not.toHaveBeenCalled()
    })

    it('caches response after fetching from DB', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')

      expect(env.CACHE.put).toHaveBeenCalledWith(
        'recent_posts:50:',
        expect.any(String),
        expect.objectContaining({ expirationTtl: 1800 })
      )
    })
  })

  describe('getAuthorPosts', () => {
    it('returns 400 when author parameter is missing', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing author parameter')
    })

    it('returns empty posts for unknown author', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=unknown.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toEqual([])
    })

    it('resolves handle to DID before querying', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:resolved' })
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=test.bsky.social')

      // First call resolves handle
      expect(env.DB._statement.bind).toHaveBeenNthCalledWith(1, 'test.bsky.social')
      // Second call uses resolved DID
      expect(env.DB._statement.bind).toHaveBeenNthCalledWith(2, 'did:plc:resolved', 51)
    })

    it('uses DID directly when provided', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc123')

      // Should not call first() to resolve handle
      expect(env.DB._statement.first).not.toHaveBeenCalled()
      expect(env.DB._statement.bind).toHaveBeenCalledWith('did:plc:abc123', 51)
    })

    it('shows all visibility levels when viewer is the author', async () => {
      env.DB._statement.all.mockResolvedValueOnce({
        results: [
          { uri: 'public-post', visibility: 'public' },
          { uri: 'url-post', visibility: 'url' },
          { uri: 'author-post', visibility: 'author' },
        ],
      })

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc&viewer=did:plc:abc'
      )
      const data = await res.json()

      expect(data.posts).toHaveLength(3)
    })

    it('shows only public posts when viewer is not the author', async () => {
      env.DB._statement.all.mockResolvedValueOnce({
        results: [{ uri: 'public-post', visibility: 'public' }],
      })

      await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc&viewer=did:plc:other'
      )

      // The query should filter for public only
      const prepareCall = env.DB.prepare.mock.calls[0][0]
      expect(prepareCall).toContain("p.visibility = 'public'")
    })
  })

  describe('getPost', () => {
    it('returns 400 when author or rkey is missing', async () => {
      const res1 = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=test')
      expect(res1.status).toBe(400)

      const res2 = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?rkey=abc')
      expect(res2.status).toBe(400)
    })

    it('returns 404 when post not found', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz')
      expect(res.status).toBe(404)

      const data = await res.json()
      expect(data.error).toBe('Post not found')
    })

    it('returns post when found', async () => {
      const mockPost = {
        uri: 'at://did:plc:abc/app.greengale.document/xyz',
        author_did: 'did:plc:abc',
        rkey: 'xyz',
        title: 'Test Post',
        visibility: 'public',
      }
      env.DB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.post.title).toBe('Test Post')
    })

    it('returns 404 for private post when viewer is not author', async () => {
      const mockPost = {
        uri: 'at://did:plc:abc/app.greengale.document/xyz',
        author_did: 'did:plc:abc',
        rkey: 'xyz',
        title: 'Private Post',
        visibility: 'author',
      }
      env.DB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz&viewer=did:plc:other'
      )
      expect(res.status).toBe(404)
    })

    it('returns private post when viewer is the author', async () => {
      const mockPost = {
        uri: 'at://did:plc:abc/app.greengale.document/xyz',
        author_did: 'did:plc:abc',
        rkey: 'xyz',
        title: 'Private Post',
        visibility: 'author',
      }
      env.DB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz&viewer=did:plc:abc'
      )
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.post.title).toBe('Private Post')
    })

    it('allows URL-visible posts for any viewer', async () => {
      const mockPost = {
        uri: 'at://did:plc:abc/app.greengale.document/xyz',
        author_did: 'did:plc:abc',
        rkey: 'xyz',
        title: 'Unlisted Post',
        visibility: 'url',
      }
      env.DB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz'
      )
      expect(res.status).toBe(200)
    })

    it('resolves handle to DID', async () => {
      env.DB._statement.first
        .mockResolvedValueOnce({ did: 'did:plc:resolved' }) // Handle resolution
        .mockResolvedValueOnce({ // Post query
          uri: 'at://did:plc:resolved/app.greengale.document/xyz',
          author_did: 'did:plc:resolved',
          rkey: 'xyz',
          title: 'Test',
          visibility: 'public',
        })

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getPost?author=test.bsky.social&rkey=xyz'
      )
      expect(res.status).toBe(200)
    })
  })

  describe('getProfile', () => {
    it('returns 400 when author parameter is missing', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing author parameter')
    })

    it('returns 404 when author not found', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=unknown')
      expect(res.status).toBe(404)

      const data = await res.json()
      expect(data.error).toBe('Author not found')
    })

    it('returns author profile', async () => {
      const mockAuthor = {
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        display_name: 'Test User',
        avatar_url: 'https://example.com/avatar.jpg',
        description: 'A test user',
        posts_count: 42,
      }
      env.DB._statement.first.mockResolvedValueOnce(mockAuthor)

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=test.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.did).toBe('did:plc:abc')
      expect(data.handle).toBe('test.bsky.social')
      expect(data.displayName).toBe('Test User')
      expect(data.postsCount).toBe(42)
    })

    it('includes publication data when available', async () => {
      const mockAuthor = {
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        posts_count: 10,
        pub_name: 'My Blog',
        pub_description: 'A blog about things',
      }
      env.DB._statement.first.mockResolvedValueOnce(mockAuthor)

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=test.bsky.social')
      const data = await res.json()

      expect(data.publication).toBeDefined()
      expect(data.publication.name).toBe('My Blog')
      expect(data.publication.description).toBe('A blog about things')
    })

    it('handles DID as author parameter', async () => {
      env.DB._statement.first.mockResolvedValueOnce({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        posts_count: 0,
      })

      await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=did:plc:abc')

      const query = env.DB.prepare.mock.calls[0][0]
      expect(query).toContain('WHERE a.did = ?')
    })
  })

  describe('checkWhitelist', () => {
    it('returns 400 when did parameter is missing', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.auth.checkWhitelist')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing did parameter')
    })

    it('returns whitelisted: false when not found', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/xrpc/app.greengale.auth.checkWhitelist?did=did:plc:unknown')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.whitelisted).toBe(false)
    })

    it('returns whitelisted: true with user data when found', async () => {
      env.DB._statement.first.mockResolvedValueOnce({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
      })

      const res = await makeRequest(env, '/xrpc/app.greengale.auth.checkWhitelist?did=did:plc:abc')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.whitelisted).toBe(true)
      expect(data.did).toBe('did:plc:abc')
      expect(data.handle).toBe('test.bsky.social')
    })
  })

  describe('Admin Endpoints', () => {
    describe('Authentication', () => {
      it('returns 401 when no secret provided', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.listWhitelist')
        expect(res.status).toBe(401)

        const data = await res.json()
        expect(data.error).toBe('Unauthorized')
      })

      it('returns 401 when wrong secret provided', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'wrong-secret' },
        })
        expect(res.status).toBe(401)
      })

      it('allows access with correct secret', async () => {
        env.DB._statement.all.mockResolvedValueOnce({ results: [] })

        const res = await makeRequest(env, '/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'test-admin-secret' },
        })
        expect(res.status).toBe(200)
      })

      it('returns 503 when admin secret not configured', async () => {
        const envNoSecret = { ...env, ADMIN_SECRET: undefined }

        const res = await makeRequest(envNoSecret as unknown as ReturnType<typeof createTestEnv>, '/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'any-secret' },
        })
        expect(res.status).toBe(503)

        const data = await res.json()
        expect(data.error).toBe('Admin endpoints not configured')
      })
    })

    describe('addToWhitelist', () => {
      it('adds user to whitelist', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.addToWhitelist', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            did: 'did:plc:newuser',
            handle: 'new.bsky.social',
          }),
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.success).toBe(true)
        expect(data.did).toBe('did:plc:newuser')
        expect(env.DB._statement.run).toHaveBeenCalled()
      })

      it('returns 400 when did is missing', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.addToWhitelist', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ handle: 'no-did.bsky.social' }),
        })

        expect(res.status).toBe(400)
      })
    })

    describe('removeFromWhitelist', () => {
      it('removes user from whitelist', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.removeFromWhitelist', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ did: 'did:plc:toremove' }),
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.success).toBe(true)
        expect(env.DB._statement.run).toHaveBeenCalled()
      })
    })

    describe('listWhitelist', () => {
      it('returns list of whitelisted users', async () => {
        env.DB._statement.all.mockResolvedValueOnce({
          results: [
            { did: 'did:plc:user1', handle: 'user1.bsky.social', added_at: '2024-01-01' },
            { did: 'did:plc:user2', handle: 'user2.bsky.social', added_at: '2024-01-02' },
          ],
        })

        const res = await makeRequest(env, '/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'test-admin-secret' },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.users).toHaveLength(2)
      })
    })

    describe('invalidateOGCache', () => {
      it('invalidates post OG cache', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.invalidateOGCache', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ handle: 'test.bsky.social', rkey: 'abc123' }),
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.success).toBe(true)
        expect(data.cacheKey).toBe('og:test.bsky.social:abc123')
        expect(env.CACHE.delete).toHaveBeenCalledWith('og:test.bsky.social:abc123')
      })

      it('invalidates profile OG cache', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.invalidateOGCache', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ handle: 'test.bsky.social' }),
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.cacheKey).toBe('og:profile:test.bsky.social')
      })

      it('invalidates site OG cache', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.invalidateOGCache', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: 'site' }),
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.cacheKey).toBe('og:site')
      })

      it('returns 400 when no valid parameters', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.invalidateOGCache', {
          method: 'POST',
          headers: {
            'X-Admin-Secret': 'test-admin-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(400)
      })
    })

    describe('startFirehose', () => {
      it('starts the firehose', async () => {
        const res = await makeRequest(env, '/xrpc/app.greengale.admin.startFirehose', {
          method: 'POST',
          headers: { 'X-Admin-Secret': 'test-admin-secret' },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.status).toBe('started')
        expect(env.FIREHOSE.idFromName).toHaveBeenCalledWith('main')
      })
    })
  })

  describe('Error Handling', () => {
    it('returns 500 on database error in getRecentPosts', async () => {
      env.DB._statement.all.mockRejectedValueOnce(new Error('DB error'))

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')
      expect(res.status).toBe(500)

      const data = await res.json()
      expect(data.error).toBe('Failed to fetch posts')
    })

    it('returns 500 on database error in getProfile', async () => {
      env.DB._statement.first.mockRejectedValueOnce(new Error('DB error'))

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=test')
      expect(res.status).toBe(500)

      const data = await res.json()
      expect(data.error).toBe('Failed to fetch author')
    })
  })

  describe('OG Image Endpoints', () => {
    it('serves cached site OG image', async () => {
      const imageBuffer = new ArrayBuffer(100)
      env.CACHE.get.mockResolvedValueOnce(imageBuffer)

      const res = await makeRequest(env, '/og/site.png')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      expect(res.headers.get('X-Cache')).toBe('HIT')
    })

    it('returns 404 for profile OG when author not found', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/og/profile/unknown.png')
      expect(res.status).toBe(404)
    })

    it('returns 400 for post OG with invalid filename', async () => {
      const res = await makeRequest(env, '/og/test.bsky.social/invalid')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Invalid image format')
    })
  })

  describe('Bluesky Integration', () => {
    it('returns 400 when url parameter is missing for interactions', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getBlueskyInteractions')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing url parameter')
    })

    it('returns 400 when handle or rkey is missing for post', async () => {
      const res1 = await makeRequest(env, '/xrpc/app.greengale.feed.getBlueskyPost?handle=test')
      expect(res1.status).toBe(400)

      const res2 = await makeRequest(env, '/xrpc/app.greengale.feed.getBlueskyPost?rkey=abc')
      expect(res2.status).toBe(400)
    })
  })
})

describe('formatPost', () => {
  // The formatPost function is internal to the API module, but we can test its behavior
  // through the API responses. These tests verify the output format is correct.

  it('formats post with all fields via API response', async () => {
    const env = createTestEnv()
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: 'Title',
      subtitle: 'Subtitle',
      source: 'greengale',
      visibility: 'public',
      created_at: '2024-01-01T00:00:00Z',
      indexed_at: '2024-01-01T00:00:00Z',
      handle: 'test.bsky.social',
      display_name: 'Test User',
      avatar_url: 'https://avatar.url',
    }

    env.DB._statement.first.mockResolvedValueOnce(row)

    const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=rkey')
    const data = await res.json()

    expect(data.post.uri).toBe('at://did:plc:abc/collection/rkey')
    expect(data.post.authorDid).toBe('did:plc:abc')
    expect(data.post.title).toBe('Title')
    expect(data.post.author).toBeDefined()
    expect(data.post.author?.handle).toBe('test.bsky.social')
  })

  it('omits author when handle is missing via API response', async () => {
    const env = createTestEnv()
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: 'Title',
      visibility: 'public',
      // No handle
    }

    env.DB._statement.first.mockResolvedValueOnce(row)

    const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=rkey')
    const data = await res.json()

    expect(data.post.author).toBeUndefined()
  })
})
