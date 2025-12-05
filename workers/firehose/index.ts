import { DurableObject } from 'cloudflare:workers'

interface Env {
  DB: D1Database
  CACHE: KVNamespace
  JETSTREAM_URL: string
}

// Collections we're interested in
const BLOG_COLLECTIONS = [
  'com.whtwnd.blog.entry',
  'app.greengale.blog.entry',
]

// Jetstream event types
interface JetstreamCommit {
  did: string
  time_us: number
  kind: 'commit'
  commit: {
    rev: string
    operation: 'create' | 'update' | 'delete'
    collection: string
    rkey: string
    record?: Record<string, unknown>
    cid?: string
  }
}

interface JetstreamIdentity {
  did: string
  time_us: number
  kind: 'identity'
  identity: {
    did: string
    handle: string
    seq: number
    time: string
  }
}

interface JetstreamAccount {
  did: string
  time_us: number
  kind: 'account'
  account: {
    active: boolean
    did: string
    seq: number
    time: string
  }
}

type JetstreamEvent = JetstreamCommit | JetstreamIdentity | JetstreamAccount

export class FirehoseConsumer extends DurableObject<Env> {
  private ws: WebSocket | null = null
  private connected = false
  private cursor: number = 0
  private reconnectTimeout: number | null = null
  private lastTimeUs: number = 0
  private processedCount = 0
  private errorCount = 0

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/start' && request.method === 'POST') {
      await this.start()
      return new Response(JSON.stringify({ status: 'starting' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/stop' && request.method === 'POST') {
      this.stop()
      return new Response(JSON.stringify({ status: 'stopped' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/status') {
      return new Response(JSON.stringify({
        connected: this.connected,
        cursor: this.cursor,
        lastTimeUs: this.lastTimeUs,
        processedCount: this.processedCount,
        errorCount: this.errorCount,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  private async start() {
    if (this.connected) {
      console.log('Already connected to Jetstream')
      return
    }

    // Load cursor from storage
    const stored = await this.ctx.storage.get<number>('cursor')
    if (stored) {
      this.cursor = stored
    }

    await this.connect()
  }

  private stop() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }

  private async connect() {
    // Use Jetstream - it provides JSON instead of CBOR
    const baseUrl = this.env.JETSTREAM_URL || 'wss://jetstream2.us-east.bsky.network'

    // Build URL with wanted collections
    const params = new URLSearchParams()
    for (const collection of BLOG_COLLECTIONS) {
      params.append('wantedCollections', collection)
    }
    if (this.cursor) {
      params.append('cursor', this.cursor.toString())
    }

    const wsUrl = `${baseUrl}/subscribe?${params.toString()}`

    console.log(`Connecting to Jetstream: ${wsUrl}`)

    try {
      const ws = new WebSocket(wsUrl)

      ws.addEventListener('open', () => {
        console.log('Connected to Jetstream')
        this.connected = true
      })

      ws.addEventListener('message', async (event) => {
        try {
          await this.handleMessage(event.data as string)
        } catch (error) {
          console.error('Error handling message:', error)
          this.errorCount++
        }
      })

      ws.addEventListener('close', (event) => {
        console.log(`Jetstream connection closed: ${event.code} ${event.reason}`)
        this.connected = false
        this.ws = null

        // Reconnect after delay
        this.reconnectTimeout = setTimeout(() => {
          this.connect()
        }, 5000) as unknown as number
      })

      ws.addEventListener('error', (error) => {
        console.error('Jetstream WebSocket error:', error)
        this.errorCount++
      })

      this.ws = ws
    } catch (error) {
      console.error('Failed to connect to Jetstream:', error)
      this.errorCount++

      // Retry after delay
      this.reconnectTimeout = setTimeout(() => {
        this.connect()
      }, 10000) as unknown as number
    }
  }

  private async handleMessage(data: string) {
    // Jetstream sends JSON - much simpler than CBOR!
    const event = JSON.parse(data) as JetstreamEvent

    // Only process commit events
    if (event.kind !== 'commit') {
      return
    }

    const commit = event as JetstreamCommit
    const { did, commit: { operation, collection, rkey, record } } = commit

    // Double-check collection is one we care about
    if (!BLOG_COLLECTIONS.includes(collection)) {
      return
    }

    const source = collection === 'com.whtwnd.blog.entry' ? 'whitewind' : 'greengale'
    const uri = `at://${did}/${collection}/${rkey}`

    console.log(`Processing ${operation} for ${source} post: ${uri}`)

    if (operation === 'delete') {
      await this.deletePost(uri)
    } else if (operation === 'create' || operation === 'update') {
      await this.indexPost(uri, did, rkey, source, record)
    }

    this.lastTimeUs = commit.time_us
    this.processedCount++

    // Periodically save cursor (every 100 events)
    if (this.processedCount % 100 === 0) {
      this.cursor = commit.time_us
      await this.ctx.storage.put('cursor', commit.time_us)
    }
  }

  private async indexPost(
    uri: string,
    did: string,
    rkey: string,
    source: 'whitewind' | 'greengale',
    record?: Record<string, unknown>
  ) {
    try {
      // Extract metadata from record
      const title = (record?.title as string) || null
      const subtitle = (record?.subtitle as string) || null
      const visibility = (record?.visibility as string) || 'public'
      const createdAt = (record?.createdAt as string) || null
      const content = (record?.content as string) || ''
      const hasLatex = source === 'greengale' && (record?.latex === true)
      const themePreset = typeof record?.theme === 'object' && record.theme !== null
        ? (record.theme as Record<string, unknown>).preset as string
        : (record?.theme as string) || null

      // Create content preview (first 300 chars, strip markdown)
      const contentPreview = content
        .replace(/[#*`\[\]()!]/g, '')
        .replace(/\n+/g, ' ')
        .slice(0, 300)

      // Create slug from title
      const slug = title
        ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : null

      await this.env.DB.prepare(`
        INSERT INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, content_preview, has_latex, theme_preset)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uri) DO UPDATE SET
          title = excluded.title,
          subtitle = excluded.subtitle,
          slug = excluded.slug,
          visibility = excluded.visibility,
          content_preview = excluded.content_preview,
          has_latex = excluded.has_latex,
          theme_preset = excluded.theme_preset,
          indexed_at = datetime('now')
      `).bind(
        uri, did, rkey, title, subtitle, slug, source, visibility,
        createdAt, contentPreview, hasLatex ? 1 : 0, themePreset
      ).run()

      // Ensure author exists
      await this.ensureAuthor(did)

      // Update author post count
      await this.env.DB.prepare(`
        UPDATE authors SET posts_count = (
          SELECT COUNT(*) FROM posts WHERE author_did = ? AND visibility = 'public'
        ), updated_at = datetime('now')
        WHERE did = ?
      `).bind(did, did).run()

      // Invalidate cache for recent posts
      await this.env.CACHE.delete('recent_posts:12:')

      console.log(`Indexed ${source} post: ${uri}`)
    } catch (error) {
      console.error(`Failed to index post ${uri}:`, error)
      throw error
    }
  }

  private async deletePost(uri: string) {
    try {
      // Get author DID before deleting
      const post = await this.env.DB.prepare(
        'SELECT author_did FROM posts WHERE uri = ?'
      ).bind(uri).first()

      await this.env.DB.prepare('DELETE FROM posts WHERE uri = ?').bind(uri).run()

      // Update author post count if we found the post
      if (post) {
        await this.env.DB.prepare(`
          UPDATE authors SET posts_count = (
            SELECT COUNT(*) FROM posts WHERE author_did = ? AND visibility = 'public'
          ), updated_at = datetime('now')
          WHERE did = ?
        `).bind(post.author_did, post.author_did).run()
      }

      // Invalidate cache for recent posts
      await this.env.CACHE.delete('recent_posts:12:')

      console.log(`Deleted post: ${uri}`)
    } catch (error) {
      console.error(`Failed to delete post ${uri}:`, error)
    }
  }

  private async ensureAuthor(did: string) {
    const existing = await this.env.DB.prepare(
      'SELECT did FROM authors WHERE did = ?'
    ).bind(did).first()

    if (!existing) {
      // Fetch profile from Bluesky public API
      try {
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
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

          await this.env.DB.prepare(`
            INSERT INTO authors (did, handle, display_name, description, avatar_url, banner_url)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            profile.did,
            profile.handle,
            profile.displayName || null,
            profile.description || null,
            profile.avatar || null,
            profile.banner || null
          ).run()
        } else {
          // Insert minimal author record
          await this.env.DB.prepare(
            'INSERT INTO authors (did) VALUES (?)'
          ).bind(did).run()
        }
      } catch (error) {
        console.error(`Failed to fetch author profile for ${did}:`, error)
        // Insert minimal author record
        await this.env.DB.prepare(
          'INSERT OR IGNORE INTO authors (did) VALUES (?)'
        ).bind(did).run()
      }
    }
  }
}
