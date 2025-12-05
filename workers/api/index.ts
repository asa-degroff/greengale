import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { FirehoseConsumer } from '../firehose'

export { FirehoseConsumer }

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  FIREHOSE: DurableObjectNamespace
  RELAY_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for frontend
app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://greengale.app'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// Health check
app.get('/xrpc/_health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0' })
})

// Get recent posts across all authors
app.get('/xrpc/app.greengale.feed.getRecentPosts', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')

  try {
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

    return c.json({
      posts: returnPosts.map(formatPost),
      cursor: hasMore ? returnPosts[returnPosts.length - 1].indexed_at : undefined,
    })
  } catch (error) {
    console.error('Error fetching recent posts:', error)
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// Get posts by author
app.get('/xrpc/app.greengale.feed.getAuthorPosts', async (c) => {
  const author = c.req.query('author')
  if (!author) {
    return c.json({ error: 'Missing author parameter' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')

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

    let query = `
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at,
        a.handle, a.display_name, a.avatar_url
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      WHERE p.author_did = ? AND p.visibility = 'public'
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
app.get('/xrpc/app.greengale.feed.getPost', async (c) => {
  const author = c.req.query('author')
  const rkey = c.req.query('rkey')

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

// Trigger firehose connection (admin endpoint)
app.post('/xrpc/app.greengale.admin.startFirehose', async (c) => {
  const id = c.env.FIREHOSE.idFromName('main')
  const stub = c.env.FIREHOSE.get(id)

  await stub.fetch(new Request('http://internal/start', { method: 'POST' }))

  return c.json({ status: 'started' })
})

// Get firehose status
app.get('/xrpc/app.greengale.admin.firehoseStatus', async (c) => {
  const id = c.env.FIREHOSE.idFromName('main')
  const stub = c.env.FIREHOSE.get(id)

  const response = await stub.fetch(new Request('http://internal/status'))
  return response
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
