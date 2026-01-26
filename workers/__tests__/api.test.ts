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
    const mockFetch = vi.fn()

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch)
      mockFetch.mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns platform publication without handle', async () => {
      // Mock DID document response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // Mock listRecords response with a valid TID rkey (13 chars, only 234567a-z)
      // Include preferences.greengale to identify as a GreenGale record
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [{
            uri: 'at://did:plc:purpkfw7haimc4zu5a57slza/site.standard.publication/3abcdefghijkl',
            value: { preferences: { greengale: {} } },
          }],
        }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication')
      expect(res.status).toBe(200)

      const text = await res.text()
      expect(text).toBe('at://did:plc:purpkfw7haimc4zu5a57slza/site.standard.publication/3abcdefghijkl')
    })

    it('returns user publication with handle', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:user123' })

      // Mock DID document response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // Mock listRecords response with a valid TID rkey
      // Include preferences.greengale to identify as a GreenGale record
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [{
            uri: 'at://did:plc:user123/site.standard.publication/3xyzabcdefghi',
            value: { preferences: { greengale: {} } },
          }],
        }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=test.bsky.social')
      expect(res.status).toBe(200)

      const text = await res.text()
      expect(text).toBe('at://did:plc:user123/site.standard.publication/3xyzabcdefghi')
    })

    it('returns 404 for unknown handle', async () => {
      env.DB._statement.first.mockResolvedValueOnce(null)

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=unknown.bsky.social')
      expect(res.status).toBe(404)
    })

    it('returns 404 when user has no publication', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:nopub' })

      // Mock DID document response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // Mock listRecords response with no records
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=nopub.bsky.social')
      expect(res.status).toBe(404)
    })

    it('skips publications with invalid TID rkeys', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:user123' })

      // Mock DID document response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // Mock listRecords with invalid TID (wrong length) first, then valid TID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [
            // Invalid: 'self' is not a valid TID
            { uri: 'at://did:plc:user123/site.standard.publication/self', value: { preferences: { greengale: {} } } },
            // Invalid: too short
            { uri: 'at://did:plc:user123/site.standard.publication/abc', value: { preferences: { greengale: {} } } },
            // Valid: exactly 13 base32-sortable chars
            { uri: 'at://did:plc:user123/site.standard.publication/3validtidhere', value: { preferences: { greengale: {} } } },
          ],
        }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=test.bsky.social')
      expect(res.status).toBe(200)

      const text = await res.text()
      // Should return the valid TID, skipping invalid ones
      expect(text).toBe('at://did:plc:user123/site.standard.publication/3validtidhere')
    })

    it('skips non-GreenGale publications (without preferences.greengale)', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:user123' })

      // Mock DID document response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // First record has no preferences.greengale, second one does
      // TIDs must be exactly 13 chars using only 234567a-z
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [
            // Not a GreenGale record (no preferences.greengale)
            { uri: 'at://did:plc:user123/site.standard.publication/3otherpubhere', value: { name: 'Other Site' } },
            // GreenGale record
            { uri: 'at://did:plc:user123/site.standard.publication/3greengalepub', value: { preferences: { greengale: {} } } },
          ],
        }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=test.bsky.social')
      expect(res.status).toBe(200)

      const text = await res.text()
      // Should return the GreenGale publication, not the other one
      expect(text).toBe('at://did:plc:user123/site.standard.publication/3greengalepub')
    })

    it('resolves did:web DID documents correctly', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:web:example.com' })

      // Mock DID document response - did:web resolves via /.well-known/did.json
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // Mock listRecords response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [{
            uri: 'at://did:web:example.com/site.standard.publication/3abcdefghijkl',
            value: { preferences: { greengale: {} } },
          }],
        }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=webuser.example.com')
      expect(res.status).toBe(200)

      // Verify the DID document was fetched from the correct did:web URL
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/.well-known/did.json')
    })

    it('resolves did:web with path segments correctly', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:web:example.com:user:alice' })

      // did:web:example.com:user:alice → https://example.com/user/alice/did.json
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [{
            uri: 'at://did:web:example.com:user:alice/site.standard.publication/3abcdefghijkl',
            value: { preferences: { greengale: {} } },
          }],
        }),
      })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=alice.example.com')
      expect(res.status).toBe(200)

      // Verify the correct path-based did:web URL
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/user/alice/did.json')
    })

    it('returns 404 when did:web resolution fails', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:web:offline.example.com' })

      // DID document fetch fails
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const res = await makeRequest(env, '/.well-known/site.standard.publication?handle=webuser.example.com')
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

    it('limits each author to 3 posts using window function', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')

      // Verify the query uses a CTE with ROW_NUMBER to limit per-author posts
      expect(env.DB.prepare).toHaveBeenCalled()
      const query = env.DB.prepare.mock.calls[0][0]
      expect(query).toContain('WITH ranked_posts AS')
      expect(query).toContain('ROW_NUMBER() OVER (PARTITION BY p.author_did ORDER BY p.indexed_at DESC) as author_rank')
      expect(query).toContain('WHERE author_rank <= 3')
    })
  })

  describe('getAuthorPosts', () => {
    it('returns 400 when author parameter is missing', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing author parameter')
    })

    it('returns empty posts for unknown author when discovery fails', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.first.mockResolvedValueOnce(null)
      // discoverAndIndexAuthor calls Bluesky API which returns 404
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=unknown.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toEqual([])

      vi.unstubAllGlobals()
    })

    it('discovers and indexes unknown author on first visit', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      // Handle resolution returns null (author not in DB)
      env.DB._statement.first.mockResolvedValueOnce(null)

      // discoverAndIndexAuthor: Bluesky profile lookup succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          did: 'did:plc:discovered',
          handle: 'discovered.bsky.social',
          displayName: 'Discovered User',
          avatar: 'https://example.com/avatar.jpg',
          description: 'A discovered user',
        }),
      })
      // fetchPdsEndpoint: DID document resolution
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // indexPostsFromPds: KV cache check already handled by mock (returns null)
      // indexPostsFromPds: DB lookup for pds_endpoint (use the second first() call)
      env.DB._statement.first.mockResolvedValueOnce(null)
      // indexPostsFromPds: fetchPdsEndpoint for the discovered DID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // indexPostsFromPds: fetch site.standard.publication records
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })
      // indexPostsFromPds: fetch app.greengale.document records
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [{
            uri: 'at://did:plc:discovered/app.greengale.document/post1',
            value: { title: 'First Post', content: 'Hello world', publishedAt: '2024-01-01T00:00:00Z' },
          }],
        }),
      })
      // indexPostsFromPds: fetch app.greengale.blog.entry records
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })
      // indexPostsFromPds: fetch com.whtwnd.blog.entry records
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })
      // indexPostsFromPds: fetch site.standard.document records
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })

      // After indexing, the re-query returns posts
      env.DB._statement.all.mockResolvedValueOnce({
        results: [{
          uri: 'at://did:plc:discovered/app.greengale.document/post1',
          author_did: 'did:plc:discovered',
          rkey: 'post1',
          title: 'First Post',
          handle: 'discovered.bsky.social',
        }],
      })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=discovered.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toHaveLength(1)
      expect(data.posts[0].title).toBe('First Post')

      // Verify Bluesky API was called with the handle
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('app.bsky.actor.getProfile?actor=discovered.bsky.social')
      )

      vi.unstubAllGlobals()
    })

    it('uses negative cache to skip repeated discovery attempts', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.first.mockResolvedValueOnce(null)
      // Negative cache hit
      await env.CACHE.put('discover-fail:unknown.bsky.social', '1')

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=unknown.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toEqual([])

      // Should not call Bluesky API
      expect(mockFetch).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })

    it('calls indexPostsFromPds on first page load (no cursor)', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      // Author exists in DB
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      // indexPostsFromPds: KV cache miss, DB lookup for pds_endpoint
      env.DB._statement.first.mockResolvedValueOnce({ pds_endpoint: 'https://pds.example.com' })
      // indexPostsFromPds: fetch publications
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })
      // indexPostsFromPds: fetch each collection (4 collections)
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        })
      }

      await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc')

      // Verify PDS was contacted (publications + 4 collections = 5 fetch calls)
      expect(mockFetch).toHaveBeenCalledTimes(5)

      vi.unstubAllGlobals()
    })

    it('skips indexPostsFromPds when KV cache exists', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.all.mockResolvedValueOnce({ results: [] })
      // Pre-populate KV cache
      await env.CACHE.put('posts-indexed:v2:did:plc:cached', '1')

      await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:cached')

      // Should not make any fetch calls since cache is populated
      expect(mockFetch).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })

    it('skips indexPostsFromPds when cursor is provided', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc&cursor=2024-01-01T00:00:00Z')

      // Should not call indexPostsFromPds since cursor is present
      expect(mockFetch).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
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
      // Pre-populate KV cache so indexPostsFromPds skips PDS lookup
      await env.CACHE.put('posts-indexed:v2:did:plc:abc123', '1')

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

    it('includes standalone site.standard.document posts', async () => {
      env.DB._statement.all.mockResolvedValueOnce({
        results: [
          {
            uri: 'at://did:plc:abc/app.greengale.document/post1',
            author_did: 'did:plc:abc',
            rkey: 'post1',
            title: 'GreenGale Post',
            source: 'greengale',
            external_url: null,
            handle: 'test.bsky.social',
          },
          {
            uri: 'at://did:plc:abc/site.standard.document/post2',
            author_did: 'did:plc:abc',
            rkey: 'post2',
            title: 'Standard Post',
            source: 'network',
            external_url: 'https://example.com/post2',
            handle: 'test.bsky.social',
          },
        ],
      })

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc'
      )
      const data = await res.json()

      expect(data.posts).toHaveLength(2)
      expect(data.posts[1].externalUrl).toBe('https://example.com/post2')
    })

    it('deduplicates dual-published site.standard.document posts', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc'
      )

      const query = env.DB.prepare.mock.calls[0][0]
      // Should NOT use the simple exclusion
      expect(query).not.toContain("p.uri NOT LIKE '%/site.standard.document/%'")
      // Should use deduplication: exclude site.standard.document posts that have a primary version
      expect(query).toContain("p.uri LIKE '%/site.standard.document/%'")
      expect(query).toContain("gg.uri LIKE '%/app.greengale.document/%'")
      expect(query).toContain("gg.uri LIKE '%/app.greengale.blog.entry/%'")
      expect(query).toContain("gg.uri LIKE '%/com.whtwnd.blog.entry/%'")
      // Should exclude site.standard posts without an external URL
      expect(query).toContain("p.external_url IS NULL")
    })

    it('includes externalUrl in response', async () => {
      env.DB._statement.all.mockResolvedValueOnce({
        results: [
          {
            uri: 'at://did:plc:abc/app.greengale.document/post1',
            author_did: 'did:plc:abc',
            rkey: 'post1',
            title: 'No External URL',
            external_url: null,
            handle: 'test.bsky.social',
          },
        ],
      })

      const res = await makeRequest(
        env,
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc'
      )
      const data = await res.json()

      expect(data.posts[0].externalUrl).toBeNull()
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

    it('returns 404 when author not found and discovery fails', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.first.mockResolvedValueOnce(null)
      // discoverAndIndexAuthor: Bluesky API returns 404
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=unknown')
      expect(res.status).toBe(404)

      const data = await res.json()
      expect(data.error).toBe('Author not found')

      vi.unstubAllGlobals()
    })

    it('discovers and returns profile for unknown author', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.first.mockResolvedValueOnce(null)

      // discoverAndIndexAuthor: Bluesky profile lookup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          did: 'did:plc:newuser',
          handle: 'newuser.bsky.social',
          displayName: 'New User',
          avatar: 'https://example.com/avatar.jpg',
          description: 'A new user',
        }),
      })
      // fetchPdsEndpoint: DID document
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // indexPostsFromPds: DB lookup for pds_endpoint
      env.DB._statement.first.mockResolvedValueOnce(null)
      // indexPostsFromPds: fetchPdsEndpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }],
        }),
      })
      // indexPostsFromPds: fetch publications
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      })
      // indexPostsFromPds: fetch app.greengale.document (has 1 post)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: [{
            uri: 'at://did:plc:newuser/app.greengale.document/post1',
            value: { title: 'Hello', content: 'World', publishedAt: '2024-01-01T00:00:00Z' },
          }],
        }),
      })
      // indexPostsFromPds: remaining collections empty
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ records: [] }) })
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ records: [] }) })
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ records: [] }) })

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=newuser.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.did).toBe('did:plc:newuser')
      expect(data.handle).toBe('newuser.bsky.social')
      expect(data.displayName).toBe('New User')
      expect(data.postsCount).toBe(1) // 1 post indexed from app.greengale.document

      vi.unstubAllGlobals()
    })

    it('uses negative cache for repeated profile discovery failures', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      env.DB._statement.first.mockResolvedValueOnce(null)
      await env.CACHE.put('discover-fail:cached-unknown', '1')

      const res = await makeRequest(env, '/xrpc/app.greengale.actor.getProfile?author=cached-unknown')
      expect(res.status).toBe(404)

      // Should not call Bluesky API
      expect(mockFetch).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
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

  describe('searchPublications', () => {
    it('returns 400 when q parameter is missing', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing or empty q parameter')
    })

    it('returns 400 when q parameter is empty', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing or empty q parameter')
    })

    it('returns 400 when q parameter is whitespace only', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=%20%20')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing or empty q parameter')
    })

    it('returns 400 when query is less than 2 characters', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=a')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Query must be at least 2 characters')
      expect(data.results).toEqual([])
    })

    it('returns empty results when no matches found', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=nonexistent')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.results).toEqual([])
    })

    it('returns search results with correct format', async () => {
      const mockResults = [
        {
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          display_name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
          pub_name: 'My Blog',
          pub_url: 'https://myblog.com',
          match_priority: 1,
          match_type: 'handle',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.results).toHaveLength(1)
      expect(data.results[0]).toEqual({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        publication: {
          name: 'My Blog',
          url: 'https://myblog.com',
        },
        matchType: 'handle',
      })
    })

    it('handles results without publication data', async () => {
      const mockResults = [
        {
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          display_name: null,
          avatar_url: null,
          pub_name: null,
          pub_url: null,
          match_priority: 2,
          match_type: 'handle',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      const data = await res.json()

      expect(data.results[0].displayName).toBeNull()
      expect(data.results[0].avatarUrl).toBeNull()
      expect(data.results[0].publication).toBeNull()
    })

    it('respects limit parameter', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test&limit=5')

      // Verify limit is passed to the query (as the 16th parameter)
      expect(env.DB._statement.bind).toHaveBeenCalled()
      const bindArgs = env.DB._statement.bind.mock.calls[0]
      expect(bindArgs[bindArgs.length - 1]).toBe(5)
    })

    it('caps limit at 25', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test&limit=100')

      const bindArgs = env.DB._statement.bind.mock.calls[0]
      expect(bindArgs[bindArgs.length - 1]).toBe(25)
    })

    it('uses default limit of 10', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')

      const bindArgs = env.DB._statement.bind.mock.calls[0]
      expect(bindArgs[bindArgs.length - 1]).toBe(10)
    })

    it('performs case-insensitive search', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=TEST')

      // Check that the search term is lowercased
      const bindArgs = env.DB._statement.bind.mock.calls[0]
      expect(bindArgs[0]).toBe('test')
    })

    it('creates correct search patterns', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=foo')

      const bindArgs = env.DB._statement.bind.mock.calls[0]
      // The query uses numbered parameters: ?1=exact, ?2=prefix, ?3=contains, ?4=limit
      expect(bindArgs[0]).toBe('foo')       // ?1 - exact match
      expect(bindArgs[1]).toBe('foo%')      // ?2 - prefix match
      expect(bindArgs[2]).toBe('%foo%')     // ?3 - contains
      expect(bindArgs[3]).toBe(10)          // ?4 - default limit
    })

    it('returns multiple results ordered by priority', async () => {
      const mockResults = [
        { did: 'did:1', handle: 'exact', match_priority: 1, match_type: 'handle' },
        { did: 'did:2', handle: 'prefix-match', match_priority: 2, match_type: 'handle' },
        { did: 'did:3', handle: 'other', display_name: 'Name Match', match_priority: 3, match_type: 'displayName' },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=match')
      const data = await res.json()

      expect(data.results).toHaveLength(3)
      expect(data.results[0].handle).toBe('exact')
      expect(data.results[1].handle).toBe('prefix-match')
      expect(data.results[2].handle).toBe('other')
    })

    it('handles different match types', async () => {
      const mockResults = [
        { did: 'did:1', handle: 'user1', match_type: 'handle' },
        { did: 'did:2', handle: 'user2', display_name: 'Display', match_type: 'displayName' },
        { did: 'did:3', handle: 'user3', pub_name: 'Blog Name', match_type: 'publicationName' },
        { did: 'did:4', handle: 'user4', pub_url: 'https://example.com', match_type: 'publicationUrl' },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      const data = await res.json()

      expect(data.results.map((r: { matchType: string }) => r.matchType)).toEqual([
        'handle',
        'displayName',
        'publicationName',
        'publicationUrl',
      ])
    })

    it('returns 500 on database error', async () => {
      env.DB._statement.all.mockRejectedValueOnce(new Error('DB error'))

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      expect(res.status).toBe(500)

      const data = await res.json()
      expect(data.error).toBe('Failed to search publications')
    })

    it('returns cached response when available', async () => {
      const cachedResponse = { results: [{ did: 'cached', handle: 'cached.user' }] }
      env.CACHE.get.mockResolvedValueOnce(cachedResponse)

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      const data = await res.json()

      expect(data.results[0].did).toBe('cached')
      expect(env.DB.prepare).not.toHaveBeenCalled()
    })

    it('caches response after fetching from DB', async () => {
      const mockResults = [{ did: 'did:plc:abc', handle: 'test.user', match_type: 'handle' }]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')

      expect(env.CACHE.put).toHaveBeenCalledWith(
        'search:test:10',
        expect.any(String),
        expect.objectContaining({ expirationTtl: 60 })
      )
    })

    it('uses correct cache key with limit', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.search.publications?q=hello&limit=5')

      expect(env.CACHE.put).toHaveBeenCalledWith(
        'search:hello:5',
        expect.any(String),
        expect.objectContaining({ expirationTtl: 60 })
      )
    })

    it('returns post title search results with correct format', async () => {
      const mockResults = [
        {
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          display_name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
          pub_name: null,
          pub_url: null,
          post_rkey: '3abc123',
          post_title: 'My Test Post Title',
          match_priority: 6,
          match_type: 'postTitle',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.results).toHaveLength(1)
      expect(data.results[0]).toEqual({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        publication: null,
        matchType: 'postTitle',
        post: {
          rkey: '3abc123',
          title: 'My Test Post Title',
        },
      })
    })

    it('handles mixed author and post results', async () => {
      const mockResults = [
        { did: 'did:1', handle: 'user1', match_type: 'handle', post_rkey: null, post_title: null },
        { did: 'did:2', handle: 'user2', match_type: 'displayName', post_rkey: null, post_title: null },
        { did: 'did:3', handle: 'user3', match_type: 'postTitle', post_rkey: 'post123', post_title: 'A Great Post' },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      const data = await res.json()

      expect(data.results).toHaveLength(3)
      expect(data.results[0].matchType).toBe('handle')
      expect(data.results[0].post).toBeUndefined()
      expect(data.results[1].matchType).toBe('displayName')
      expect(data.results[1].post).toBeUndefined()
      expect(data.results[2].matchType).toBe('postTitle')
      expect(data.results[2].post).toEqual({ rkey: 'post123', title: 'A Great Post' })
    })

    it('includes postTitle in match types', async () => {
      const mockResults = [
        { did: 'did:1', handle: 'user1', match_type: 'handle' },
        { did: 'did:2', handle: 'user2', display_name: 'Display', match_type: 'displayName' },
        { did: 'did:3', handle: 'user3', pub_name: 'Blog Name', match_type: 'publicationName' },
        { did: 'did:4', handle: 'user4', pub_url: 'https://example.com', match_type: 'publicationUrl' },
        { did: 'did:5', handle: 'user5', post_rkey: 'post1', post_title: 'Post Title', match_type: 'postTitle' },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      const data = await res.json()

      expect(data.results.map((r: { matchType: string }) => r.matchType)).toEqual([
        'handle',
        'displayName',
        'publicationName',
        'publicationUrl',
        'postTitle',
      ])
    })

    it('deduplicates posts that exist on both greengale and site.standard', async () => {
      // When a post exists on both app.greengale.document and site.standard.document,
      // the query uses GROUP BY author_did, rkey to return only one result.
      // MIN(uri) prefers 'app.greengale' over 'site.standard' alphabetically.
      const mockResults = [
        // This simulates the deduplicated result - only one post per author_did + rkey
        {
          did: 'did:plc:author',
          handle: 'author.bsky.social',
          display_name: 'Author',
          avatar_url: null,
          post_rkey: 'post123',
          post_title: 'My Dual-Published Post',
          match_type: 'postTitle',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=dual')
      const data = await res.json()

      // Should only return one result, not two
      expect(data.results).toHaveLength(1)
      expect(data.results[0].post.title).toBe('My Dual-Published Post')
    })

    it('returns tag search results with correct format', async () => {
      const mockResults = [
        {
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          display_name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
          pub_name: null,
          pub_url: null,
          post_rkey: '3abc123',
          post_title: 'Post About JavaScript',
          matched_tag: 'javascript',
          match_priority: 7,
          match_type: 'tag',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=javascript')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.results).toHaveLength(1)
      expect(data.results[0]).toEqual({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        publication: null,
        matchType: 'tag',
        post: {
          rkey: '3abc123',
          title: 'Post About JavaScript',
        },
        tag: 'javascript',
      })
    })

    it('handles mixed author, post, and tag results', async () => {
      const mockResults = [
        { did: 'did:1', handle: 'user1', match_type: 'handle', post_rkey: null, post_title: null, matched_tag: null },
        { did: 'did:2', handle: 'user2', match_type: 'postTitle', post_rkey: 'post123', post_title: 'A Great Post', matched_tag: null },
        { did: 'did:3', handle: 'user3', match_type: 'tag', post_rkey: 'post456', post_title: 'Tagged Post', matched_tag: 'react' },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=react')
      const data = await res.json()

      expect(data.results).toHaveLength(3)
      expect(data.results[0].matchType).toBe('handle')
      expect(data.results[0].tag).toBeUndefined()
      expect(data.results[1].matchType).toBe('postTitle')
      expect(data.results[1].tag).toBeUndefined()
      expect(data.results[2].matchType).toBe('tag')
      expect(data.results[2].tag).toBe('react')
      expect(data.results[2].post).toEqual({ rkey: 'post456', title: 'Tagged Post' })
    })

    it('includes tag in match types', async () => {
      const mockResults = [
        { did: 'did:1', handle: 'user1', match_type: 'handle' },
        { did: 'did:2', handle: 'user2', display_name: 'Display', match_type: 'displayName' },
        { did: 'did:3', handle: 'user3', pub_name: 'Blog Name', match_type: 'publicationName' },
        { did: 'did:4', handle: 'user4', pub_url: 'https://example.com', match_type: 'publicationUrl' },
        { did: 'did:5', handle: 'user5', post_rkey: 'post1', post_title: 'Post Title', match_type: 'postTitle' },
        { did: 'did:6', handle: 'user6', post_rkey: 'post2', post_title: 'Tagged Post', matched_tag: 'typescript', match_type: 'tag' },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockResults })

      const res = await makeRequest(env, '/xrpc/app.greengale.search.publications?q=test')
      const data = await res.json()

      expect(data.results.map((r: { matchType: string }) => r.matchType)).toEqual([
        'handle',
        'displayName',
        'publicationName',
        'publicationUrl',
        'postTitle',
        'tag',
      ])
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

  describe('getPostsByTag', () => {
    it('returns 400 when tag parameter is missing', async () => {
      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing tag parameter')
    })

    it('returns empty posts array when no posts have the tag', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=javascript')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toEqual([])
      expect(data.cursor).toBeUndefined()
    })

    it('returns posts with matching tag', async () => {
      const mockPosts = [
        {
          uri: 'at://did:plc:abc/app.greengale.document/123',
          author_did: 'did:plc:abc',
          rkey: '123',
          title: 'JavaScript Tutorial',
          source: 'greengale',
          visibility: 'public',
          created_at: '2024-01-01T00:00:00Z',
          indexed_at: '2024-01-01T00:00:00Z',
          handle: 'test.bsky.social',
          tags: 'javascript,tutorial',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=javascript')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toHaveLength(1)
      expect(data.posts[0].title).toBe('JavaScript Tutorial')
      expect(data.posts[0].tags).toEqual(['javascript', 'tutorial'])
    })

    it('normalizes tag to lowercase', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=JavaScript')

      // The query should use lowercase tag
      expect(env.DB._statement.bind).toHaveBeenCalledWith('javascript', 51)
    })

    it('respects limit parameter', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=test&limit=10')

      expect(env.DB._statement.bind).toHaveBeenCalledWith('test', 11) // limit + 1
    })

    it('caps limit at 100', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=test&limit=500')

      expect(env.DB._statement.bind).toHaveBeenCalledWith('test', 101) // 100 + 1
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
        tags: 'test',
      }))
      env.DB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=test')
      const data = await res.json()

      expect(data.posts).toHaveLength(50)
      expect(data.cursor).toBeDefined()
    })

    it('uses cursor for pagination', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=test&cursor=2024-01-15T00:00:00Z')

      expect(env.DB._statement.bind).toHaveBeenCalledWith('test', '2024-01-15T00:00:00Z', 51)
    })

    it('only returns public posts (not site.standard)', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=test')

      const query = env.DB.prepare.mock.calls[0][0]
      expect(query).toContain("p.visibility = 'public'")
      expect(query).toContain("p.uri NOT LIKE '%/site.standard.document/%'")
    })

    it('caches response for 5 minutes', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=javascript')

      expect(env.CACHE.put).toHaveBeenCalledWith(
        expect.stringContaining('tag_posts:javascript:'),
        expect.any(String),
        expect.objectContaining({ expirationTtl: 300 })
      )
    })

    it('returns cached response when available', async () => {
      const cachedResponse = { posts: [{ uri: 'cached', tags: ['javascript'] }], cursor: undefined }
      env.CACHE.get.mockResolvedValueOnce(cachedResponse)

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPostsByTag?tag=javascript')
      const data = await res.json()

      expect(data.posts[0].uri).toBe('cached')
      expect(env.DB.prepare).not.toHaveBeenCalled()
    })
  })

  describe('getPopularTags', () => {
    it('returns empty array when no tags exist', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.tags).toEqual([])
    })

    it('returns tags with counts', async () => {
      const mockTags = [
        { tag: 'javascript', count: 50 },
        { tag: 'typescript', count: 30 },
        { tag: 'react', count: 20 },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockTags })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.tags).toHaveLength(3)
      expect(data.tags[0]).toEqual({ tag: 'javascript', count: 50 })
      expect(data.tags[1]).toEqual({ tag: 'typescript', count: 30 })
      expect(data.tags[2]).toEqual({ tag: 'react', count: 20 })
    })

    it('respects limit parameter', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags?limit=5')

      expect(env.DB._statement.bind).toHaveBeenCalledWith(5)
    })

    it('uses default limit of 20', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags')

      expect(env.DB._statement.bind).toHaveBeenCalledWith(20)
    })

    it('caps limit at 100', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags?limit=500')

      expect(env.DB._statement.bind).toHaveBeenCalledWith(100)
    })

    it('only counts public posts (not site.standard)', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags')

      const query = env.DB.prepare.mock.calls[0][0]
      expect(query).toContain("p.visibility = 'public'")
      expect(query).toContain("p.uri NOT LIKE '%/site.standard.document/%'")
    })

    it('caches response for 30 minutes', async () => {
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags')

      expect(env.CACHE.put).toHaveBeenCalledWith(
        expect.stringContaining('popular_tags:'),
        expect.any(String),
        expect.objectContaining({ expirationTtl: 1800 })
      )
    })

    it('returns cached response when available', async () => {
      const cachedResponse = { tags: [{ tag: 'cached', count: 10 }] }
      env.CACHE.get.mockResolvedValueOnce(cachedResponse)

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPopularTags')
      const data = await res.json()

      expect(data.tags[0].tag).toBe('cached')
      expect(env.DB.prepare).not.toHaveBeenCalled()
    })
  })

  describe('Tags in post responses', () => {
    it('includes tags in getRecentPosts response', async () => {
      const mockPosts = [
        {
          uri: 'at://did:plc:abc/app.greengale.document/123',
          author_did: 'did:plc:abc',
          rkey: '123',
          title: 'Test Post',
          source: 'greengale',
          visibility: 'public',
          indexed_at: '2024-01-01T00:00:00Z',
          tags: 'javascript,react,typescript',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getRecentPosts')
      const data = await res.json()

      expect(data.posts[0].tags).toEqual(['javascript', 'react', 'typescript'])
    })

    it('includes tags in getAuthorPosts response', async () => {
      env.DB._statement.first.mockResolvedValueOnce({ did: 'did:plc:abc' })
      const mockPosts = [
        {
          uri: 'at://did:plc:abc/app.greengale.document/123',
          author_did: 'did:plc:abc',
          rkey: '123',
          title: 'Test Post',
          source: 'greengale',
          visibility: 'public',
          indexed_at: '2024-01-01T00:00:00Z',
          tags: 'tutorial',
        },
      ]
      env.DB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getAuthorPosts?author=test.bsky.social')
      const data = await res.json()

      expect(data.posts[0].tags).toEqual(['tutorial'])
    })

    it('includes tags in getPost response', async () => {
      const mockPost = {
        uri: 'at://did:plc:abc/app.greengale.document/xyz',
        author_did: 'did:plc:abc',
        rkey: 'xyz',
        title: 'Test Post',
        visibility: 'public',
      }
      // Mock post query
      env.DB._statement.first.mockResolvedValueOnce(mockPost)
      // Mock tags query
      env.DB._statement.all.mockResolvedValueOnce({
        results: [{ tag: 'featured' }, { tag: 'announcement' }]
      })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz')
      const data = await res.json()

      expect(data.post.tags).toEqual(['featured', 'announcement'])
    })

    it('returns undefined when post has no tags', async () => {
      const mockPost = {
        uri: 'at://did:plc:abc/app.greengale.document/xyz',
        author_did: 'did:plc:abc',
        rkey: 'xyz',
        title: 'Test Post',
        visibility: 'public',
      }
      // Mock post query
      env.DB._statement.first.mockResolvedValueOnce(mockPost)
      // Mock empty tags query
      env.DB._statement.all.mockResolvedValueOnce({ results: [] })

      const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz')
      const data = await res.json()

      expect(data.post.tags).toBeUndefined()
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

    describe('getBlueskyInteractions with nested replies', () => {
      const originalFetch = globalThis.fetch

      beforeEach(() => {
        // Reset cache for each test
        env.CACHE._store.clear()
      })

      afterEach(() => {
        globalThis.fetch = originalFetch
      })

      // Helper to create a mock Bluesky post
      function createBlueskyPost(id: string, likeCount: number = 0, replyCount: number = 0) {
        return {
          uri: `at://did:plc:${id}/app.bsky.feed.post/${id}`,
          cid: `cid${id}`,
          author: {
            did: `did:plc:${id}`,
            handle: `user${id}.bsky.social`,
            displayName: `User ${id}`,
            avatar: `https://avatar.url/${id}`,
          },
          record: {
            text: `Post text ${id}`,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          indexedAt: '2024-01-01T00:00:00.000Z',
          likeCount,
          repostCount: 0,
          replyCount,
          quoteCount: 0,
        }
      }

      // Helper to create a nested thread structure
      function createThreadViewPost(id: string, likeCount: number, replies: unknown[] = []) {
        return {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: createBlueskyPost(id, likeCount, replies.length),
          replies,
        }
      }

      it('transforms nested replies recursively', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        // Mock search response with one post that has replies
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            return new Response(JSON.stringify({
              posts: [createBlueskyPost('root', 10, 3)],
              hitsTotal: 1,
            }))
          }

          if (url.includes('getPostThread')) {
            // Return nested thread structure: root -> 3 replies -> 2 replies each -> 1 reply each
            return new Response(JSON.stringify({
              thread: {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: createBlueskyPost('root', 10, 3),
                replies: [
                  createThreadViewPost('reply1', 5, [
                    createThreadViewPost('reply1-1', 3, [
                      createThreadViewPost('reply1-1-1', 1, []),
                    ]),
                    createThreadViewPost('reply1-2', 2, []),
                  ]),
                  createThreadViewPost('reply2', 8, [
                    createThreadViewPost('reply2-1', 4, []),
                  ]),
                  createThreadViewPost('reply3', 1, []),
                ],
              },
            }))
          }

          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://example.com/post&includeReplies=true'
        )
        expect(res.status).toBe(200)

        const data = await res.json() as { posts: Array<{ replies?: unknown[] }> }
        expect(data.posts).toHaveLength(1)

        // Root post should have replies
        const rootPost = data.posts[0]
        expect(rootPost.replies).toBeDefined()
        expect(rootPost.replies!.length).toBeLessThanOrEqual(5) // max 5 at depth 0

        // Replies should be sorted by like count (descending)
        // reply2 (8 likes) should come before reply1 (5 likes)
        const replies = rootPost.replies as Array<{ text: string; replies?: unknown[] }>
        expect(replies[0].text).toBe('Post text reply2')
        expect(replies[1].text).toBe('Post text reply1')
        expect(replies[2].text).toBe('Post text reply3')

        // Check nested replies exist
        expect(replies[0].replies).toBeDefined()
        expect(replies[1].replies).toBeDefined()
      })

      it('limits replies per level based on depth', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        // Create a post with many replies at different levels
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            return new Response(JSON.stringify({
              posts: [createBlueskyPost('root', 10, 10)],
              hitsTotal: 1,
            }))
          }

          if (url.includes('getPostThread')) {
            // Create 10 replies at level 1, each with 5 replies at level 2, etc.
            const level2Replies = Array.from({ length: 5 }, (_, i) =>
              createThreadViewPost(`l2-${i}`, i, [])
            )
            const level1Replies = Array.from({ length: 10 }, (_, i) =>
              createThreadViewPost(`l1-${i}`, i, level2Replies)
            )

            return new Response(JSON.stringify({
              thread: {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: createBlueskyPost('root', 10, 10),
                replies: level1Replies,
              },
            }))
          }

          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://example.com/post&includeReplies=true'
        )
        const data = await res.json() as { posts: Array<{ replies?: Array<{ replies?: unknown[] }> }> }

        // Depth 0: max 5 replies
        expect(data.posts[0].replies!.length).toBe(5)

        // Depth 1: max 3 replies per post
        expect(data.posts[0].replies![0].replies!.length).toBe(3)
      })

      it('filters out invalid thread types', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            return new Response(JSON.stringify({
              posts: [createBlueskyPost('root', 10, 3)],
              hitsTotal: 1,
            }))
          }

          if (url.includes('getPostThread')) {
            return new Response(JSON.stringify({
              thread: {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: createBlueskyPost('root', 10, 3),
                replies: [
                  createThreadViewPost('valid', 5, []),
                  { $type: 'app.bsky.feed.defs#blockedPost' }, // Should be filtered
                  { $type: 'app.bsky.feed.defs#notFoundPost' }, // Should be filtered
                  createThreadViewPost('valid2', 3, []),
                ],
              },
            }))
          }

          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://example.com/post&includeReplies=true'
        )
        const data = await res.json() as { posts: Array<{ replies?: unknown[] }> }

        // Only valid threadViewPost types should be included
        expect(data.posts[0].replies!.length).toBe(2)
      })

      it('handles posts with no replies', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            return new Response(JSON.stringify({
              posts: [createBlueskyPost('root', 10, 0)], // replyCount = 0
              hitsTotal: 1,
            }))
          }

          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://example.com/post&includeReplies=true'
        )
        const data = await res.json() as { posts: Array<{ replies?: unknown[] }> }

        // Should not fetch thread for posts with no replies
        expect(mockFetch).toHaveBeenCalledTimes(1) // Only searchPosts call
        expect(data.posts[0].replies).toBeUndefined()
      })

      it('respects max depth of 10', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        // Create a deeply nested structure (15 levels)
        function createDeepThread(depth: number, currentDepth: number = 0): unknown {
          if (currentDepth >= depth) return createThreadViewPost(`d${currentDepth}`, 1, [])
          return createThreadViewPost(`d${currentDepth}`, 1, [
            createDeepThread(depth, currentDepth + 1),
          ])
        }

        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            return new Response(JSON.stringify({
              posts: [createBlueskyPost('root', 10, 1)],
              hitsTotal: 1,
            }))
          }

          if (url.includes('getPostThread')) {
            return new Response(JSON.stringify({
              thread: {
                $type: 'app.bsky.feed.defs#threadViewPost',
                post: createBlueskyPost('root', 10, 1),
                replies: [createDeepThread(15)],
              },
            }))
          }

          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://example.com/post&includeReplies=true'
        )
        const data = await res.json() as { posts: unknown[] }

        // Count actual depth by traversing the structure
        function countDepth(post: { replies?: unknown[] }): number {
          if (!post.replies || post.replies.length === 0) return 1
          return 1 + countDepth(post.replies[0] as { replies?: unknown[] })
        }

        // Should be capped at 11 total (root post + 10 levels of replies)
        // transformThreadReplies processes depths 0-9 (10 levels), so with the root that's 11
        const depth = countDepth(data.posts[0] as { replies?: unknown[] })
        expect(depth).toBeLessThanOrEqual(11)
      })
    })

    describe('getBlueskyInteractions with multiple URLs', () => {
      const originalFetch = globalThis.fetch

      beforeEach(() => {
        env.CACHE._store.clear()
      })

      afterEach(() => {
        globalThis.fetch = originalFetch
      })

      function createBlueskyPost(id: string, likeCount: number = 0, replyCount: number = 0) {
        return {
          uri: `at://did:plc:${id}/app.bsky.feed.post/${id}`,
          cid: `cid${id}`,
          author: {
            did: `did:plc:${id}`,
            handle: `user${id}.bsky.social`,
            displayName: `User ${id}`,
            avatar: `https://avatar.url/${id}`,
          },
          record: {
            text: `Post text ${id}`,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          indexedAt: '2024-01-01T00:00:00.000Z',
          likeCount,
          repostCount: 0,
          replyCount,
          quoteCount: 0,
        }
      }

      it('searches multiple URLs and combines results', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        // Return different posts for each URL
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            if (url.includes('greengale.com')) {
              return new Response(JSON.stringify({
                posts: [createBlueskyPost('greengale1', 10, 0)],
                hitsTotal: 1,
              }))
            }
            if (url.includes('whtwnd.com')) {
              return new Response(JSON.stringify({
                posts: [createBlueskyPost('whitewind1', 5, 0)],
                hitsTotal: 1,
              }))
            }
          }
          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://greengale.com/user/post,https://whtwnd.com/user/post&includeReplies=false'
        )
        const data = await res.json() as { posts: Array<{ uri: string }>, totalHits: number }

        // Should have combined posts from both URLs
        expect(data.posts).toHaveLength(2)
        expect(data.posts.map(p => p.uri)).toContain('at://did:plc:greengale1/app.bsky.feed.post/greengale1')
        expect(data.posts.map(p => p.uri)).toContain('at://did:plc:whitewind1/app.bsky.feed.post/whitewind1')
        expect(data.totalHits).toBe(2)
      })

      it('deduplicates posts that appear in both searches', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        // Return the same post for both URLs (user linked to both)
        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            return new Response(JSON.stringify({
              posts: [createBlueskyPost('shared', 10, 0)],
              hitsTotal: 1,
            }))
          }
          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://greengale.com/user/post,https://whtwnd.com/user/post&includeReplies=false'
        )
        const data = await res.json() as { posts: Array<{ uri: string }>, totalHits: number }

        // Should deduplicate - only one post even though both searches returned it
        expect(data.posts).toHaveLength(1)
        expect(data.posts[0].uri).toBe('at://did:plc:shared/app.bsky.feed.post/shared')
      })

      it('sorts combined results by engagement when sort=top', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            if (url.includes('greengale.com')) {
              return new Response(JSON.stringify({
                posts: [createBlueskyPost('low', 2, 0)],
                hitsTotal: 1,
              }))
            }
            if (url.includes('whtwnd.com')) {
              return new Response(JSON.stringify({
                posts: [createBlueskyPost('high', 20, 0)],
                hitsTotal: 1,
              }))
            }
          }
          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://greengale.com/user/post,https://whtwnd.com/user/post&sort=top&includeReplies=false'
        )
        const data = await res.json() as { posts: Array<{ uri: string, likeCount: number }> }

        // Higher engagement post should come first
        expect(data.posts[0].likeCount).toBe(20)
        expect(data.posts[1].likeCount).toBe(2)
      })

      it('handles one URL failing gracefully', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        mockFetch.mockImplementation(async (url: string) => {
          if (url.includes('searchPosts')) {
            if (url.includes('greengale.com')) {
              return new Response(JSON.stringify({
                posts: [createBlueskyPost('works', 10, 0)],
                hitsTotal: 1,
              }))
            }
            if (url.includes('whtwnd.com')) {
              return new Response('Server error', { status: 500 })
            }
          }
          return new Response('Not found', { status: 404 })
        })

        const res = await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://greengale.com/user/post,https://whtwnd.com/user/post&includeReplies=false'
        )
        expect(res.status).toBe(200)

        const data = await res.json() as { posts: Array<{ uri: string }> }

        // Should still return the successful results
        expect(data.posts).toHaveLength(1)
        expect(data.posts[0].uri).toBe('at://did:plc:works/app.bsky.feed.post/works')
      })

      it('caches with consistent key regardless of URL order', async () => {
        const mockFetch = vi.fn()
        globalThis.fetch = mockFetch

        mockFetch.mockImplementation(async () => {
          return new Response(JSON.stringify({
            posts: [createBlueskyPost('test', 10, 0)],
            hitsTotal: 1,
          }))
        })

        // First request with URLs in one order
        await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://a.com/post,https://b.com/post&includeReplies=false'
        )

        // Should have cached
        const callsBeforeSecond = mockFetch.mock.calls.length

        // Second request with URLs in reverse order
        await makeRequest(
          env,
          '/xrpc/app.greengale.feed.getBlueskyInteractions?url=https://b.com/post,https://a.com/post&includeReplies=false'
        )

        // Should hit cache - no new fetch calls
        expect(mockFetch.mock.calls.length).toBe(callsBeforeSecond)
      })
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

  it('includes contentPreview and firstImageCid when present', async () => {
    const env = createTestEnv()
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: 'Title',
      visibility: 'public',
      content_preview: 'This is a preview of the content...',
      first_image_cid: 'bafkreiexamplecid123',
      handle: 'test.bsky.social',
    }

    env.DB._statement.first.mockResolvedValueOnce(row)

    const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=rkey')
    const data = await res.json()

    expect(data.post.contentPreview).toBe('This is a preview of the content...')
    expect(data.post.firstImageCid).toBe('bafkreiexamplecid123')
  })

  it('includes pdsEndpoint in author object when present', async () => {
    const env = createTestEnv()
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: 'Title',
      visibility: 'public',
      handle: 'test.bsky.social',
      display_name: 'Test User',
      avatar_url: 'https://avatar.url',
      pds_endpoint: 'https://bsky.social',
    }

    env.DB._statement.first.mockResolvedValueOnce(row)

    const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=rkey')
    const data = await res.json()

    expect(data.post.author).toBeDefined()
    expect(data.post.author?.pdsEndpoint).toBe('https://bsky.social')
  })

  it('handles null contentPreview and firstImageCid', async () => {
    const env = createTestEnv()
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: 'Title',
      visibility: 'public',
      content_preview: null,
      first_image_cid: null,
      handle: 'test.bsky.social',
    }

    env.DB._statement.first.mockResolvedValueOnce(row)

    const res = await makeRequest(env, '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=rkey')
    const data = await res.json()

    expect(data.post.contentPreview).toBeNull()
    expect(data.post.firstImageCid).toBeNull()
  })
})
