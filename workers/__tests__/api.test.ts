import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// We need to test the API by importing and calling the routes directly
// First, let's create mock implementations

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

// Helper to create a test app with mocked bindings
function createTestApp() {
  const mockDB = createMockD1()
  const mockCache = createMockKV()
  const mockFirehose = createMockFirehose()

  // Import the actual app structure - we'll recreate key routes for testing
  const app = new Hono<{
    Bindings: {
      DB: ReturnType<typeof createMockD1>
      CACHE: ReturnType<typeof createMockKV>
      FIREHOSE: ReturnType<typeof createMockFirehose>
      ADMIN_SECRET?: string
    }
  }>()

  // Bind mock env to all requests
  app.use('*', async (c, next) => {
    c.env = {
      DB: mockDB as unknown as ReturnType<typeof createMockD1>,
      CACHE: mockCache as unknown as ReturnType<typeof createMockKV>,
      FIREHOSE: mockFirehose as unknown as ReturnType<typeof createMockFirehose>,
      ADMIN_SECRET: 'test-admin-secret',
    }
    await next()
  })

  return { app, mockDB, mockCache, mockFirehose }
}

describe('API Endpoints', () => {
  let app: ReturnType<typeof createTestApp>['app']
  let mockDB: ReturnType<typeof createMockD1>
  let mockCache: ReturnType<typeof createMockKV>

  beforeEach(() => {
    vi.clearAllMocks()
    const testApp = createTestApp()
    app = testApp.app
    mockDB = testApp.mockDB
    mockCache = testApp.mockCache
    setupRoutes(app)
  })

  // Setup routes matching the actual API
  function setupRoutes(app: ReturnType<typeof createTestApp>['app']) {
    // Health check
    app.get('/xrpc/_health', (c) => {
      return c.json({ status: 'ok', version: '0.1.0' })
    })

    // Get recent posts
    app.get('/xrpc/app.greengale.feed.getRecentPosts', async (c) => {
      const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
      const cursor = c.req.query('cursor')

      const cacheKey = `recent_posts:${limit}:${cursor || ''}`

      try {
        const cached = await c.env.CACHE.get(cacheKey, 'json')
        if (cached) {
          return c.json(cached)
        }

        let query = `
          SELECT p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
                 p.visibility, p.created_at, p.indexed_at,
                 a.handle, a.display_name, a.avatar_url
          FROM posts p
          LEFT JOIN authors a ON p.author_did = a.did
          WHERE p.visibility = 'public'
            AND p.uri NOT LIKE '%/site.standard.document/%'
        `

        const params: (string | number)[] = []

        if (cursor) {
          query += ` AND p.indexed_at < ?`
          params.push(cursor)
        }

        query += ` ORDER BY p.indexed_at DESC LIMIT ?`
        params.push(limit + 1)

        const result = await c.env.DB.prepare(query).bind(...params).all()
        const posts = result.results || []

        const hasMore = posts.length > limit
        const returnPosts = hasMore ? posts.slice(0, limit) : posts

        const response = {
          posts: returnPosts.map(formatPost),
          cursor: hasMore ? (returnPosts[returnPosts.length - 1] as Record<string, unknown>).indexed_at : undefined,
        }

        await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
          expirationTtl: 30 * 60,
        })

        return c.json(response)
      } catch (error) {
        console.error('Error fetching recent posts:', error)
        return c.json({ error: 'Failed to fetch posts' }, 500)
      }
    })

    // Get author posts
    app.get('/xrpc/app.greengale.feed.getAuthorPosts', async (c) => {
      const author = c.req.query('author')
      if (!author) {
        return c.json({ error: 'Missing author parameter' }, 400)
      }

      const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
      const cursor = c.req.query('cursor')
      const viewer = c.req.query('viewer')

      try {
        let authorDid = author
        if (!author.startsWith('did:')) {
          const authorRow = await c.env.DB.prepare(
            'SELECT did FROM authors WHERE handle = ?'
          ).bind(author).first()

          if (!authorRow) {
            return c.json({ posts: [], cursor: undefined })
          }
          authorDid = authorRow.did as string
        }

        const isOwnProfile = viewer && viewer === authorDid
        let visibilityFilter: string
        if (isOwnProfile) {
          visibilityFilter = `p.visibility IN ('public', 'url', 'author')`
        } else {
          visibilityFilter = `p.visibility = 'public'`
        }

        let query = `
          SELECT p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
                 p.visibility, p.created_at, p.indexed_at,
                 a.handle, a.display_name, a.avatar_url
          FROM posts p
          LEFT JOIN authors a ON p.author_did = a.did
          WHERE p.author_did = ? AND ${visibilityFilter}
            AND p.uri NOT LIKE '%/site.standard.document/%'
        `

        const params: (string | number)[] = [authorDid]

        if (cursor) {
          query += ` AND p.indexed_at < ?`
          params.push(cursor)
        }

        query += ` ORDER BY p.created_at DESC LIMIT ?`
        params.push(limit + 1)

        const result = await c.env.DB.prepare(query).bind(...params).all()
        const posts = result.results || []

        const hasMore = posts.length > limit
        const returnPosts = hasMore ? posts.slice(0, limit) : posts

        return c.json({
          posts: returnPosts.map(formatPost),
          cursor: hasMore ? (returnPosts[returnPosts.length - 1] as Record<string, unknown>).indexed_at : undefined,
        })
      } catch (error) {
        console.error('Error fetching author posts:', error)
        return c.json({ error: 'Failed to fetch posts' }, 500)
      }
    })

    // Get single post
    app.get('/xrpc/app.greengale.feed.getPost', async (c) => {
      const author = c.req.query('author')
      const rkey = c.req.query('rkey')
      const viewer = c.req.query('viewer')

      if (!author || !rkey) {
        return c.json({ error: 'Missing author or rkey parameter' }, 400)
      }

      try {
        let authorDid = author
        if (!author.startsWith('did:')) {
          const authorRow = await c.env.DB.prepare(
            'SELECT did FROM authors WHERE handle = ?'
          ).bind(author).first()

          if (authorRow) {
            authorDid = authorRow.did as string
          }
        }

        const post = await c.env.DB.prepare(`
          SELECT p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
                 p.visibility, p.created_at, p.indexed_at,
                 a.handle, a.display_name, a.avatar_url
          FROM posts p
          LEFT JOIN authors a ON p.author_did = a.did
          WHERE p.author_did = ? AND p.rkey = ?
            AND p.uri NOT LIKE '%/site.standard.document/%'
        `).bind(authorDid, rkey).first()

        if (!post) {
          return c.json({ error: 'Post not found' }, 404)
        }

        const visibility = post.visibility as string
        const isAuthor = viewer && viewer === authorDid

        if (visibility === 'author' && !isAuthor) {
          return c.json({ error: 'Post not found' }, 404)
        }

        return c.json({ post: formatPost(post as Record<string, unknown>) })
      } catch (error) {
        console.error('Error fetching post:', error)
        return c.json({ error: 'Failed to fetch post' }, 500)
      }
    })

    // Get author profile
    app.get('/xrpc/app.greengale.actor.getProfile', async (c) => {
      const author = c.req.query('author')
      if (!author) {
        return c.json({ error: 'Missing author parameter' }, 400)
      }

      try {
        const query = author.startsWith('did:')
          ? `SELECT a.*, p.name as pub_name, p.description as pub_description
             FROM authors a
             LEFT JOIN publications p ON a.did = p.author_did
             WHERE a.did = ?`
          : `SELECT a.*, p.name as pub_name, p.description as pub_description
             FROM authors a
             LEFT JOIN publications p ON a.did = p.author_did
             WHERE a.handle = ?`

        const authorRow = await c.env.DB.prepare(query).bind(author).first()

        if (!authorRow) {
          return c.json({ error: 'Author not found' }, 404)
        }

        const publication = authorRow.pub_name ? {
          name: authorRow.pub_name,
          description: authorRow.pub_description || undefined,
        } : undefined

        return c.json({
          did: authorRow.did,
          handle: authorRow.handle,
          displayName: authorRow.display_name,
          avatar: authorRow.avatar_url,
          description: authorRow.description,
          postsCount: authorRow.posts_count || 0,
          publication,
        })
      } catch (error) {
        console.error('Error fetching author:', error)
        return c.json({ error: 'Failed to fetch author' }, 500)
      }
    })

    // Check whitelist
    app.get('/xrpc/app.greengale.auth.checkWhitelist', async (c) => {
      const did = c.req.query('did')
      if (!did) {
        return c.json({ error: 'Missing did parameter' }, 400)
      }

      try {
        const row = await c.env.DB.prepare(
          'SELECT did, handle FROM whitelist WHERE did = ?'
        ).bind(did).first()

        return c.json({
          whitelisted: !!row,
          did: row?.did,
          handle: row?.handle,
        })
      } catch (error) {
        console.error('Error checking whitelist:', error)
        return c.json({ error: 'Failed to check whitelist' }, 500)
      }
    })

    // Admin: Add to whitelist
    app.post('/xrpc/app.greengale.admin.addToWhitelist', async (c) => {
      const adminSecret = c.env.ADMIN_SECRET
      if (!adminSecret) {
        return c.json({ error: 'Admin endpoints not configured' }, 503)
      }

      const providedSecret = c.req.header('X-Admin-Secret')
      if (!providedSecret || providedSecret !== adminSecret) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      try {
        const body = await c.req.json() as { did: string; handle?: string; notes?: string }
        const { did, handle, notes } = body

        if (!did) {
          return c.json({ error: 'Missing did parameter' }, 400)
        }

        await c.env.DB.prepare(`
          INSERT INTO whitelist (did, handle, notes)
          VALUES (?, ?, ?)
          ON CONFLICT(did) DO UPDATE SET handle = excluded.handle, notes = excluded.notes
        `).bind(did, handle || null, notes || null).run()

        return c.json({ success: true, did, handle })
      } catch (error) {
        console.error('Error adding to whitelist:', error)
        return c.json({ error: 'Failed to add to whitelist' }, 500)
      }
    })

    // Admin: Remove from whitelist
    app.post('/xrpc/app.greengale.admin.removeFromWhitelist', async (c) => {
      const adminSecret = c.env.ADMIN_SECRET
      if (!adminSecret) {
        return c.json({ error: 'Admin endpoints not configured' }, 503)
      }

      const providedSecret = c.req.header('X-Admin-Secret')
      if (!providedSecret || providedSecret !== adminSecret) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      try {
        const body = await c.req.json() as { did: string }
        const { did } = body

        if (!did) {
          return c.json({ error: 'Missing did parameter' }, 400)
        }

        await c.env.DB.prepare('DELETE FROM whitelist WHERE did = ?').bind(did).run()

        return c.json({ success: true, did })
      } catch (error) {
        console.error('Error removing from whitelist:', error)
        return c.json({ error: 'Failed to remove from whitelist' }, 500)
      }
    })

    // Admin: List whitelist
    app.get('/xrpc/app.greengale.admin.listWhitelist', async (c) => {
      const adminSecret = c.env.ADMIN_SECRET
      if (!adminSecret) {
        return c.json({ error: 'Admin endpoints not configured' }, 503)
      }

      const providedSecret = c.req.header('X-Admin-Secret')
      if (!providedSecret || providedSecret !== adminSecret) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      try {
        const result = await c.env.DB.prepare(
          'SELECT did, handle, added_at, notes FROM whitelist ORDER BY added_at DESC'
        ).all()

        return c.json({ users: result.results || [] })
      } catch (error) {
        console.error('Error listing whitelist:', error)
        return c.json({ error: 'Failed to list whitelist' }, 500)
      }
    })

    // Admin: Invalidate OG cache
    app.post('/xrpc/app.greengale.admin.invalidateOGCache', async (c) => {
      const adminSecret = c.env.ADMIN_SECRET
      if (!adminSecret) {
        return c.json({ error: 'Admin endpoints not configured' }, 503)
      }

      const providedSecret = c.req.header('X-Admin-Secret')
      if (!providedSecret || providedSecret !== adminSecret) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      try {
        const body = await c.req.json() as { handle?: string; rkey?: string; type?: string }
        const { handle, rkey, type } = body

        let cacheKey: string
        if (type === 'site') {
          cacheKey = 'og:site'
        } else if (handle && rkey) {
          cacheKey = `og:${handle}:${rkey}`
        } else if (handle) {
          cacheKey = `og:profile:${handle}`
        } else {
          return c.json({ error: 'Missing parameters: need handle+rkey, handle, or type=site' }, 400)
        }

        await c.env.CACHE.delete(cacheKey)

        return c.json({ success: true, cacheKey, message: `Invalidated cache for ${cacheKey}` })
      } catch (error) {
        console.error('Error invalidating OG cache:', error)
        return c.json({ error: 'Failed to invalidate cache' }, 500)
      }
    })
  }

  // Helper function matching the API
  function formatPost(row: Record<string, unknown>) {
    return {
      uri: row.uri,
      authorDid: row.author_did,
      rkey: row.rkey,
      title: row.title,
      subtitle: row.subtitle,
      source: row.source,
      visibility: row.visibility,
      createdAt: row.created_at,
      indexedAt: row.indexed_at,
      author: row.handle ? {
        did: row.author_did,
        handle: row.handle,
        displayName: row.display_name,
        avatar: row.avatar_url,
      } : undefined,
    }
  }

  describe('Health Check', () => {
    it('returns ok status', async () => {
      const res = await app.request('/xrpc/_health')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data).toEqual({ status: 'ok', version: '0.1.0' })
    })
  })

  describe('getRecentPosts', () => {
    it('returns empty posts array when no posts exist', async () => {
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      const res = await app.request('/xrpc/app.greengale.feed.getRecentPosts')
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
      mockDB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await app.request('/xrpc/app.greengale.feed.getRecentPosts')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toHaveLength(1)
      expect(data.posts[0].uri).toBe('at://did:plc:abc/app.greengale.document/123')
      expect(data.posts[0].title).toBe('Test Post')
      expect(data.posts[0].author.handle).toBe('test.bsky.social')
    })

    it('respects limit parameter', async () => {
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      await app.request('/xrpc/app.greengale.feed.getRecentPosts?limit=10')

      expect(mockDB.prepare).toHaveBeenCalled()
      expect(mockDB._statement.bind).toHaveBeenCalledWith(11) // limit + 1 for hasMore check
    })

    it('caps limit at 100', async () => {
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      await app.request('/xrpc/app.greengale.feed.getRecentPosts?limit=500')

      expect(mockDB._statement.bind).toHaveBeenCalledWith(101) // 100 + 1
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
      mockDB._statement.all.mockResolvedValueOnce({ results: mockPosts })

      const res = await app.request('/xrpc/app.greengale.feed.getRecentPosts')
      const data = await res.json()

      expect(data.posts).toHaveLength(50)
      expect(data.cursor).toBeDefined()
    })

    it('uses cursor for pagination', async () => {
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      await app.request('/xrpc/app.greengale.feed.getRecentPosts?cursor=2024-01-15T00:00:00Z')

      expect(mockDB._statement.bind).toHaveBeenCalledWith('2024-01-15T00:00:00Z', 51)
    })

    it('returns cached response when available', async () => {
      const cachedResponse = { posts: [{ uri: 'cached' }], cursor: undefined }
      mockCache.get.mockResolvedValueOnce(cachedResponse)

      const res = await app.request('/xrpc/app.greengale.feed.getRecentPosts')
      const data = await res.json()

      expect(data.posts[0].uri).toBe('cached')
      expect(mockDB.prepare).not.toHaveBeenCalled()
    })

    it('caches response after fetching from DB', async () => {
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      await app.request('/xrpc/app.greengale.feed.getRecentPosts')

      expect(mockCache.put).toHaveBeenCalledWith(
        'recent_posts:50:',
        expect.any(String),
        expect.objectContaining({ expirationTtl: 1800 })
      )
    })
  })

  describe('getAuthorPosts', () => {
    it('returns 400 when author parameter is missing', async () => {
      const res = await app.request('/xrpc/app.greengale.feed.getAuthorPosts')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing author parameter')
    })

    it('returns empty posts for unknown author', async () => {
      mockDB._statement.first.mockResolvedValueOnce(null)

      const res = await app.request('/xrpc/app.greengale.feed.getAuthorPosts?author=unknown.bsky.social')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.posts).toEqual([])
    })

    it('resolves handle to DID before querying', async () => {
      mockDB._statement.first.mockResolvedValueOnce({ did: 'did:plc:resolved' })
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      await app.request('/xrpc/app.greengale.feed.getAuthorPosts?author=test.bsky.social')

      // First call resolves handle
      expect(mockDB._statement.bind).toHaveBeenNthCalledWith(1, 'test.bsky.social')
      // Second call uses resolved DID
      expect(mockDB._statement.bind).toHaveBeenNthCalledWith(2, 'did:plc:resolved', 51)
    })

    it('uses DID directly when provided', async () => {
      mockDB._statement.all.mockResolvedValueOnce({ results: [] })

      await app.request('/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc123')

      // Should not call first() to resolve handle
      expect(mockDB._statement.first).not.toHaveBeenCalled()
      expect(mockDB._statement.bind).toHaveBeenCalledWith('did:plc:abc123', 51)
    })

    it('shows all visibility levels when viewer is the author', async () => {
      mockDB._statement.all.mockResolvedValueOnce({
        results: [
          { uri: 'public-post', visibility: 'public' },
          { uri: 'url-post', visibility: 'url' },
          { uri: 'author-post', visibility: 'author' },
        ],
      })

      const res = await app.request(
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc&viewer=did:plc:abc'
      )
      const data = await res.json()

      expect(data.posts).toHaveLength(3)
    })

    it('shows only public posts when viewer is not the author', async () => {
      mockDB._statement.all.mockResolvedValueOnce({
        results: [{ uri: 'public-post', visibility: 'public' }],
      })

      const res = await app.request(
        '/xrpc/app.greengale.feed.getAuthorPosts?author=did:plc:abc&viewer=did:plc:other'
      )

      // The query should filter for public only
      const prepareCall = mockDB.prepare.mock.calls[0][0]
      expect(prepareCall).toContain("p.visibility = 'public'")
    })
  })

  describe('getPost', () => {
    it('returns 400 when author or rkey is missing', async () => {
      const res1 = await app.request('/xrpc/app.greengale.feed.getPost?author=test')
      expect(res1.status).toBe(400)

      const res2 = await app.request('/xrpc/app.greengale.feed.getPost?rkey=abc')
      expect(res2.status).toBe(400)
    })

    it('returns 404 when post not found', async () => {
      mockDB._statement.first.mockResolvedValueOnce(null)

      const res = await app.request('/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz')
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
      mockDB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await app.request('/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz')
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
      mockDB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await app.request(
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
      mockDB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await app.request(
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
      mockDB._statement.first.mockResolvedValueOnce(mockPost)

      const res = await app.request(
        '/xrpc/app.greengale.feed.getPost?author=did:plc:abc&rkey=xyz'
      )
      expect(res.status).toBe(200)
    })

    it('resolves handle to DID', async () => {
      mockDB._statement.first
        .mockResolvedValueOnce({ did: 'did:plc:resolved' }) // Handle resolution
        .mockResolvedValueOnce({ // Post query
          uri: 'at://did:plc:resolved/app.greengale.document/xyz',
          author_did: 'did:plc:resolved',
          rkey: 'xyz',
          title: 'Test',
          visibility: 'public',
        })

      const res = await app.request(
        '/xrpc/app.greengale.feed.getPost?author=test.bsky.social&rkey=xyz'
      )
      expect(res.status).toBe(200)
    })
  })

  describe('getProfile', () => {
    it('returns 400 when author parameter is missing', async () => {
      const res = await app.request('/xrpc/app.greengale.actor.getProfile')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing author parameter')
    })

    it('returns 404 when author not found', async () => {
      mockDB._statement.first.mockResolvedValueOnce(null)

      const res = await app.request('/xrpc/app.greengale.actor.getProfile?author=unknown')
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
      mockDB._statement.first.mockResolvedValueOnce(mockAuthor)

      const res = await app.request('/xrpc/app.greengale.actor.getProfile?author=test.bsky.social')
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
      mockDB._statement.first.mockResolvedValueOnce(mockAuthor)

      const res = await app.request('/xrpc/app.greengale.actor.getProfile?author=test.bsky.social')
      const data = await res.json()

      expect(data.publication).toBeDefined()
      expect(data.publication.name).toBe('My Blog')
      expect(data.publication.description).toBe('A blog about things')
    })

    it('handles DID as author parameter', async () => {
      mockDB._statement.first.mockResolvedValueOnce({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
        posts_count: 0,
      })

      await app.request('/xrpc/app.greengale.actor.getProfile?author=did:plc:abc')

      const query = mockDB.prepare.mock.calls[0][0]
      expect(query).toContain('WHERE a.did = ?')
    })
  })

  describe('checkWhitelist', () => {
    it('returns 400 when did parameter is missing', async () => {
      const res = await app.request('/xrpc/app.greengale.auth.checkWhitelist')
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.error).toBe('Missing did parameter')
    })

    it('returns whitelisted: false when not found', async () => {
      mockDB._statement.first.mockResolvedValueOnce(null)

      const res = await app.request('/xrpc/app.greengale.auth.checkWhitelist?did=did:plc:unknown')
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.whitelisted).toBe(false)
    })

    it('returns whitelisted: true with user data when found', async () => {
      mockDB._statement.first.mockResolvedValueOnce({
        did: 'did:plc:abc',
        handle: 'test.bsky.social',
      })

      const res = await app.request('/xrpc/app.greengale.auth.checkWhitelist?did=did:plc:abc')
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
        const res = await app.request('/xrpc/app.greengale.admin.listWhitelist')
        expect(res.status).toBe(401)

        const data = await res.json()
        expect(data.error).toBe('Unauthorized')
      })

      it('returns 401 when wrong secret provided', async () => {
        const res = await app.request('/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'wrong-secret' },
        })
        expect(res.status).toBe(401)
      })

      it('allows access with correct secret', async () => {
        mockDB._statement.all.mockResolvedValueOnce({ results: [] })

        const res = await app.request('/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'test-admin-secret' },
        })
        expect(res.status).toBe(200)
      })
    })

    describe('addToWhitelist', () => {
      it('adds user to whitelist', async () => {
        const res = await app.request('/xrpc/app.greengale.admin.addToWhitelist', {
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
        expect(mockDB._statement.run).toHaveBeenCalled()
      })

      it('returns 400 when did is missing', async () => {
        const res = await app.request('/xrpc/app.greengale.admin.addToWhitelist', {
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
        const res = await app.request('/xrpc/app.greengale.admin.removeFromWhitelist', {
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
        expect(mockDB._statement.run).toHaveBeenCalled()
      })
    })

    describe('listWhitelist', () => {
      it('returns list of whitelisted users', async () => {
        mockDB._statement.all.mockResolvedValueOnce({
          results: [
            { did: 'did:plc:user1', handle: 'user1.bsky.social', added_at: '2024-01-01' },
            { did: 'did:plc:user2', handle: 'user2.bsky.social', added_at: '2024-01-02' },
          ],
        })

        const res = await app.request('/xrpc/app.greengale.admin.listWhitelist', {
          headers: { 'X-Admin-Secret': 'test-admin-secret' },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.users).toHaveLength(2)
      })
    })

    describe('invalidateOGCache', () => {
      it('invalidates post OG cache', async () => {
        const res = await app.request('/xrpc/app.greengale.admin.invalidateOGCache', {
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
        expect(mockCache.delete).toHaveBeenCalledWith('og:test.bsky.social:abc123')
      })

      it('invalidates profile OG cache', async () => {
        const res = await app.request('/xrpc/app.greengale.admin.invalidateOGCache', {
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
        const res = await app.request('/xrpc/app.greengale.admin.invalidateOGCache', {
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
        const res = await app.request('/xrpc/app.greengale.admin.invalidateOGCache', {
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
  })

  describe('Error Handling', () => {
    it('returns 500 on database error in getRecentPosts', async () => {
      mockDB._statement.all.mockRejectedValueOnce(new Error('DB error'))

      const res = await app.request('/xrpc/app.greengale.feed.getRecentPosts')
      expect(res.status).toBe(500)

      const data = await res.json()
      expect(data.error).toBe('Failed to fetch posts')
    })

    it('returns 500 on database error in getProfile', async () => {
      mockDB._statement.first.mockRejectedValueOnce(new Error('DB error'))

      const res = await app.request('/xrpc/app.greengale.actor.getProfile?author=test')
      expect(res.status).toBe(500)

      const data = await res.json()
      expect(data.error).toBe('Failed to fetch author')
    })
  })
})

describe('formatPost', () => {
  function formatPost(row: Record<string, unknown>) {
    return {
      uri: row.uri,
      authorDid: row.author_did,
      rkey: row.rkey,
      title: row.title,
      subtitle: row.subtitle,
      source: row.source,
      visibility: row.visibility,
      createdAt: row.created_at,
      indexedAt: row.indexed_at,
      author: row.handle ? {
        did: row.author_did,
        handle: row.handle,
        displayName: row.display_name,
        avatar: row.avatar_url,
      } : undefined,
    }
  }

  it('formats post with all fields', () => {
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

    const formatted = formatPost(row)

    expect(formatted.uri).toBe('at://did:plc:abc/collection/rkey')
    expect(formatted.authorDid).toBe('did:plc:abc')
    expect(formatted.title).toBe('Title')
    expect(formatted.author).toBeDefined()
    expect(formatted.author?.handle).toBe('test.bsky.social')
  })

  it('omits author when handle is missing', () => {
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: 'Title',
      visibility: 'public',
      // No handle
    }

    const formatted = formatPost(row)

    expect(formatted.author).toBeUndefined()
  })

  it('preserves null values', () => {
    const row = {
      uri: 'at://did:plc:abc/collection/rkey',
      author_did: 'did:plc:abc',
      rkey: 'rkey',
      title: null,
      subtitle: null,
      visibility: 'public',
    }

    const formatted = formatPost(row)

    expect(formatted.title).toBeNull()
    expect(formatted.subtitle).toBeNull()
  })
})
