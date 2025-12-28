import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { FirehoseConsumer } from '../firehose'
import { generateOGImage, generateHomepageOGImage, generateProfileOGImage } from '../lib/og-image'

export { FirehoseConsumer }

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  FIREHOSE: DurableObjectNamespace
  RELAY_URL: string
  ADMIN_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for frontend
app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://greengale.app', 'https://greengale-app.pages.dev'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check
app.get('/xrpc/_health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0' })
})

// OG image cache TTL (7 days)
const OG_IMAGE_CACHE_TTL = 7 * 24 * 60 * 60

// Test endpoint for OG image generation (no database required)
// Usage: /og/test?title=Hello&subtitle=World&author=Test&theme=default
// Custom colors: /og/test?title=Hello&bg=%23282a36&text=%23f8f8f2&accent=%23bd93f9
app.get('/og/test', async (c) => {
  const title = c.req.query('title') || 'Test Post Title'
  const subtitle = c.req.query('subtitle') || null
  const authorName = c.req.query('author') || 'Test Author'
  const authorHandle = c.req.query('handle') || 'test.bsky.social'
  const authorAvatar = c.req.query('avatar') || null
  const themePreset = c.req.query('theme') || null

  // Support custom colors via query params
  const bg = c.req.query('bg')
  const text = c.req.query('text')
  const accent = c.req.query('accent')
  const customColors = bg && text && accent ? { background: bg, text, accent } : null

  try {
    const imageResponse = await generateOGImage({
      title,
      subtitle,
      authorName,
      authorHandle,
      authorAvatar,
      themePreset,
      customColors,
    })

    return new Response(await imageResponse.arrayBuffer(), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Error generating test OG image:', error)
    return c.json({ error: 'Failed to generate image', details: String(error) }, 500)
  }
})

// Generate OpenGraph image for the site homepage
app.get('/og/site.png', async (c) => {
  const cacheKey = 'og:site'

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(cacheKey, 'arrayBuffer')
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, s-maxage=604800',
          'X-Cache': 'HIT',
        },
      })
    }

    const imageResponse = await generateHomepageOGImage()
    const imageBuffer = await imageResponse.arrayBuffer()

    // Cache for 7 days
    await c.env.CACHE.put(cacheKey, imageBuffer, {
      expirationTtl: OG_IMAGE_CACHE_TTL,
    })

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('Error generating site OG image:', error)
    return c.json({ error: 'Failed to generate image' }, 500)
  }
})

// Generate OpenGraph image for a user profile
app.get('/og/profile/:handle.png', async (c) => {
  const handle = c.req.param('handle')
  const cacheKey = `og:profile:${handle}`

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(cacheKey, 'arrayBuffer')
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, s-maxage=604800',
          'X-Cache': 'HIT',
        },
      })
    }

    // Fetch author data from D1
    const author = await c.env.DB.prepare(`
      SELECT handle, display_name, description, avatar_url, posts_count
      FROM authors
      WHERE handle = ?
    `).bind(handle).first()

    if (!author) {
      return c.json({ error: 'Author not found' }, 404)
    }

    const imageResponse = await generateProfileOGImage({
      displayName: (author.display_name as string) || handle,
      handle: (author.handle as string) || handle,
      avatarUrl: author.avatar_url as string | null,
      description: author.description as string | null,
      postsCount: author.posts_count as number | undefined,
    })

    const imageBuffer = await imageResponse.arrayBuffer()

    // Cache for 7 days
    await c.env.CACHE.put(cacheKey, imageBuffer, {
      expirationTtl: OG_IMAGE_CACHE_TTL,
    })

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('Error generating profile OG image:', error)
    return c.json({ error: 'Failed to generate image' }, 500)
  }
})

// Generate OpenGraph image for a post
app.get('/og/:handle/:filename', async (c) => {
  const handle = c.req.param('handle')
  const filename = c.req.param('filename')

  // Validate filename format (rkey.png)
  if (!filename || !filename.endsWith('.png')) {
    return c.json({ error: 'Invalid image format' }, 400)
  }
  const rkey = filename.slice(0, -4) // Remove .png extension

  const cacheKey = `og:${handle}:${rkey}`

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(cacheKey, 'arrayBuffer')
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, s-maxage=604800',
          'X-Cache': 'HIT',
        },
      })
    }

    // Resolve handle to DID
    let authorDid = handle
    if (!handle.startsWith('did:')) {
      const authorRow = await c.env.DB.prepare(
        'SELECT did FROM authors WHERE handle = ?'
      ).bind(handle).first()

      if (!authorRow) {
        return c.json({ error: 'Author not found' }, 404)
      }
      authorDid = authorRow.did as string
    }

    // Fetch post + author data from D1
    const post = await c.env.DB.prepare(`
      SELECT p.title, p.subtitle, p.theme_preset,
             a.handle, a.display_name, a.avatar_url
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      WHERE p.author_did = ? AND p.rkey = ?
    `).bind(authorDid, rkey).first()

    if (!post) {
      return c.json({ error: 'Post not found' }, 404)
    }

    // Parse theme data - could be preset name or JSON custom colors
    let themePreset: string | null = null
    let customColors: { background?: string; text?: string; accent?: string } | null = null

    const themeData = post.theme_preset as string | null
    if (themeData) {
      if (themeData.startsWith('{')) {
        // JSON custom colors
        try {
          customColors = JSON.parse(themeData)
        } catch {
          // Invalid JSON, ignore
        }
      } else {
        // Preset name
        themePreset = themeData
      }
    }

    // Generate OG image
    const imageResponse = await generateOGImage({
      title: (post.title as string) || 'Untitled',
      subtitle: post.subtitle as string | null,
      authorName: (post.display_name as string) || (post.handle as string) || handle,
      authorHandle: (post.handle as string) || handle,
      authorAvatar: post.avatar_url as string | null,
      themePreset,
      customColors,
    })

    const imageBuffer = await imageResponse.arrayBuffer()

    // Cache for 7 days
    await c.env.CACHE.put(cacheKey, imageBuffer, {
      expirationTtl: OG_IMAGE_CACHE_TTL,
    })

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('Error generating OG image:', error)
    return c.json({ error: 'Failed to generate image' }, 500)
  }
})

// Cache TTL for recent posts (30 minutes)
const RECENT_POSTS_CACHE_TTL = 30 * 60

// Cache TTL for Bluesky interactions (10 minutes)
const BLUESKY_INTERACTIONS_CACHE_TTL = 10 * 60

// Bluesky API base URL (api.bsky.app works better than public.api.bsky.app which has aggressive rate limiting)
const BLUESKY_API = 'https://api.bsky.app'

// Get Bluesky posts that link to a GreenGale blog post URL
app.get('/xrpc/app.greengale.feed.getBlueskyInteractions', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25)
  const sort = c.req.query('sort') || 'top'
  const includeReplies = c.req.query('includeReplies') !== 'false'

  // Build cache key
  const cacheKey = `bluesky:${url}:${limit}:${sort}:${includeReplies}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    // Search for posts linking to this URL
    // Note: We use '*' as the query since empty query may be rejected
    const searchUrl = new URL(`${BLUESKY_API}/xrpc/app.bsky.feed.searchPosts`)
    searchUrl.searchParams.set('q', '*')
    searchUrl.searchParams.set('url', url)
    searchUrl.searchParams.set('limit', limit.toString())
    searchUrl.searchParams.set('sort', sort)

    const searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GreenGale/1.0',
      },
    })

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text()
      console.error('Bluesky search failed:', searchResponse.status, errorText)
      return c.json({ error: 'Failed to search Bluesky', posts: [] }, searchResponse.status)
    }

    const searchData = await searchResponse.json() as {
      posts: BlueskyPostView[]
      cursor?: string
      hitsTotal?: number
    }

    // Transform posts to our format
    let posts = searchData.posts.map(transformBlueskyPost)

    // Optionally fetch replies for each post
    if (includeReplies) {
      posts = await Promise.all(
        posts.map(async (post) => {
          if (post.replyCount === 0) return post

          try {
            const threadUrl = new URL(`${BLUESKY_API}/xrpc/app.bsky.feed.getPostThread`)
            threadUrl.searchParams.set('uri', post.uri)
            threadUrl.searchParams.set('depth', '2')
            threadUrl.searchParams.set('parentHeight', '0')

            const threadResponse = await fetch(threadUrl.toString(), {
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'GreenGale/1.0',
              },
            })

            if (!threadResponse.ok) return post

            const threadData = await threadResponse.json() as {
              thread: BlueskyThreadViewPost
            }

            if (threadData.thread && threadData.thread.replies) {
              post.replies = threadData.thread.replies
                .filter((r): r is BlueskyThreadViewPost => r.$type === 'app.bsky.feed.defs#threadViewPost')
                .slice(0, 3)
                .map((reply) => transformBlueskyPost(reply.post))
                .sort((a, b) => b.likeCount - a.likeCount)
            }
          } catch (err) {
            console.error('Failed to fetch thread:', err)
          }
          return post
        })
      )
    }

    const response = {
      posts,
      totalHits: searchData.hitsTotal,
      cursor: searchData.cursor,
    }

    // Cache the response
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: BLUESKY_INTERACTIONS_CACHE_TTL,
    })

    return c.json(response)
  } catch (error) {
    console.error('Error fetching Bluesky interactions:', error)
    return c.json({ error: 'Failed to fetch Bluesky interactions', posts: [] }, 500)
  }
})

// Bluesky API types
interface BlueskyPostView {
  uri: string
  cid: string
  author: {
    did: string
    handle: string
    displayName?: string
    avatar?: string
  }
  record: {
    text?: string
    createdAt?: string
  }
  indexedAt: string
  likeCount?: number
  repostCount?: number
  replyCount?: number
  quoteCount?: number
}

interface BlueskyThreadViewPost {
  $type: string
  post: BlueskyPostView
  replies?: BlueskyThreadViewPost[]
}

interface TransformedPost {
  uri: string
  cid: string
  author: {
    did: string
    handle: string
    displayName?: string
    avatar?: string
  }
  text: string
  createdAt: string
  indexedAt: string
  likeCount: number
  repostCount: number
  replyCount: number
  quoteCount: number
  replies?: TransformedPost[]
}

function transformBlueskyPost(post: BlueskyPostView): TransformedPost {
  return {
    uri: post.uri,
    cid: post.cid,
    author: {
      did: post.author.did,
      handle: post.author.handle,
      displayName: post.author.displayName,
      avatar: post.author.avatar,
    },
    text: post.record?.text || '',
    createdAt: post.record?.createdAt || post.indexedAt,
    indexedAt: post.indexedAt,
    likeCount: post.likeCount || 0,
    repostCount: post.repostCount || 0,
    replyCount: post.replyCount || 0,
    quoteCount: post.quoteCount || 0,
  }
}

// Get recent posts across all authors
// Note: Recent posts feed only shows public posts (no viewer parameter needed)
app.get('/xrpc/app.greengale.feed.getRecentPosts', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')

  // Build cache key
  const cacheKey = `recent_posts:${limit}:${cursor || ''}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    // Cache miss - query database
    let query = `
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at,
        a.handle, a.display_name, a.avatar_url
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      WHERE p.visibility = 'public'
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
      cursor: hasMore ? returnPosts[returnPosts.length - 1].indexed_at : undefined,
    }

    // Store in cache with TTL
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: RECENT_POSTS_CACHE_TTL,
    })

    return c.json(response)
  } catch (error) {
    console.error('Error fetching recent posts:', error)
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// Get posts by author
// Optional viewer parameter: if viewer DID matches author DID, includes private posts
app.get('/xrpc/app.greengale.feed.getAuthorPosts', async (c) => {
  const author = c.req.query('author')
  if (!author) {
    return c.json({ error: 'Missing author parameter' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')
  const viewer = c.req.query('viewer') // Optional: viewer's DID for visibility filtering

  try {
    // First resolve handle to DID if needed
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

    // Determine visibility filter based on whether viewer is the author
    const isOwnProfile = viewer && viewer === authorDid
    let visibilityFilter: string
    if (isOwnProfile) {
      // Author viewing own profile: show all posts (public, unlisted, private)
      visibilityFilter = `p.visibility IN ('public', 'url', 'author')`
    } else {
      // Others viewing profile: show only public posts
      visibilityFilter = `p.visibility = 'public'`
    }

    let query = `
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at,
        a.handle, a.display_name, a.avatar_url
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      WHERE p.author_did = ? AND ${visibilityFilter}
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
      cursor: hasMore ? returnPosts[returnPosts.length - 1].indexed_at : undefined,
    })
  } catch (error) {
    console.error('Error fetching author posts:', error)
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// Get a single post by author and rkey
// Optional viewer parameter: required to view private posts (author-only)
app.get('/xrpc/app.greengale.feed.getPost', async (c) => {
  const author = c.req.query('author')
  const rkey = c.req.query('rkey')
  const viewer = c.req.query('viewer') // Optional: viewer's DID for visibility check

  if (!author || !rkey) {
    return c.json({ error: 'Missing author or rkey parameter' }, 400)
  }

  try {
    // Resolve handle to DID if needed
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
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at,
        a.handle, a.display_name, a.avatar_url
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      WHERE p.author_did = ? AND p.rkey = ?
    `).bind(authorDid, rkey).first()

    if (!post) {
      return c.json({ error: 'Post not found' }, 404)
    }

    // Check visibility permissions
    const visibility = post.visibility as string
    const isAuthor = viewer && viewer === authorDid

    if (visibility === 'author' && !isAuthor) {
      // Private post - only the author can view
      return c.json({ error: 'Post not found' }, 404)
    }
    // 'url' visibility allows anyone with the link, 'public' is open to all

    return c.json({ post: formatPost(post) })
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
      ? 'SELECT * FROM authors WHERE did = ?'
      : 'SELECT * FROM authors WHERE handle = ?'

    const authorRow = await c.env.DB.prepare(query).bind(author).first()

    if (!authorRow) {
      return c.json({ error: 'Author not found' }, 404)
    }

    return c.json({
      did: authorRow.did,
      handle: authorRow.handle,
      displayName: authorRow.display_name,
      avatar: authorRow.avatar_url,
      description: authorRow.description,
      postsCount: authorRow.posts_count || 0,
    })
  } catch (error) {
    console.error('Error fetching author:', error)
    return c.json({ error: 'Failed to fetch author' }, 500)
  }
})

// Admin authentication middleware
function requireAdmin(c: { env: Bindings; req: { header: (name: string) => string | undefined } }) {
  const adminSecret = c.env.ADMIN_SECRET
  if (!adminSecret) {
    return { error: 'Admin endpoints not configured', status: 503 as const }
  }

  const providedSecret = c.req.header('X-Admin-Secret')
  if (!providedSecret || providedSecret !== adminSecret) {
    return { error: 'Unauthorized', status: 401 as const }
  }

  return null
}

// Trigger firehose connection (admin endpoint)
app.post('/xrpc/app.greengale.admin.startFirehose', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }
  const id = c.env.FIREHOSE.idFromName('main')
  const stub = c.env.FIREHOSE.get(id)

  await stub.fetch(new Request('http://internal/start', { method: 'POST' }))

  return c.json({ status: 'started' })
})

// Get firehose status
app.get('/xrpc/app.greengale.admin.firehoseStatus', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const id = c.env.FIREHOSE.idFromName('main')
  const stub = c.env.FIREHOSE.get(id)

  const response = await stub.fetch(new Request('http://internal/status'))
  return response
})

// Check if a user is on the beta whitelist
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

// Add user to whitelist (admin only)
app.post('/xrpc/app.greengale.admin.addToWhitelist', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
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

// Remove user from whitelist (admin only)
app.post('/xrpc/app.greengale.admin.removeFromWhitelist', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
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

// List all whitelisted users (admin only)
app.get('/xrpc/app.greengale.admin.listWhitelist', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
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

// Refresh all author profiles from Bluesky (admin only)
// This updates avatar_url and other profile data for all authors in the database
app.post('/xrpc/app.greengale.admin.refreshAuthorProfiles', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    // Get all authors
    const result = await c.env.DB.prepare('SELECT did FROM authors').all()
    const authors = result.results || []

    let updated = 0
    let failed = 0

    for (const author of authors) {
      try {
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(author.did as string)}`
        )

        if (response.ok) {
          const profile = await response.json() as {
            did: string
            handle: string
            displayName?: string
            description?: string
            avatar?: string
            banner?: string
          }

          await c.env.DB.prepare(`
            UPDATE authors SET
              handle = ?,
              display_name = ?,
              description = ?,
              avatar_url = ?,
              banner_url = ?,
              updated_at = datetime('now')
            WHERE did = ?
          `).bind(
            profile.handle,
            profile.displayName || null,
            profile.description || null,
            profile.avatar || null,
            profile.banner || null,
            author.did
          ).run()

          updated++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }

    // Invalidate recent posts cache
    await c.env.CACHE.delete('recent_posts:12:')

    return c.json({
      success: true,
      total: authors.length,
      updated,
      failed,
    })
  } catch (error) {
    console.error('Error refreshing author profiles:', error)
    return c.json({ error: 'Failed to refresh profiles' }, 500)
  }
})

// Invalidate OG image cache (admin only)
// Usage: POST /xrpc/app.greengale.admin.invalidateOGCache
// Body: { "handle": "user.bsky.social", "rkey": "abc123" } for post OG
// Or: { "handle": "user.bsky.social" } for profile OG
// Or: { "type": "site" } for site OG
app.post('/xrpc/app.greengale.admin.invalidateOGCache', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
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

// Format post from DB row to API response
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

export default app
