import { DurableObject } from 'cloudflare:workers'

interface Env {
  DB: D1Database
  CACHE: KVNamespace
  RELAY_URL: string
}

// Collections we're interested in
const BLOG_COLLECTIONS = [
  'com.whtwnd.blog.entry',
  'app.greengale.blog.entry',
]

interface CommitEvent {
  did: string
  seq: number
  commit: {
    ops: Array<{
      action: 'create' | 'update' | 'delete'
      path: string
      cid?: string
    }>
    blobs: unknown[]
    record?: Record<string, unknown>
  }
  time: string
}

export class FirehoseConsumer extends DurableObject<Env> {
  private ws: WebSocket | null = null
  private connected = false
  private cursor: number = 0
  private reconnectTimeout: number | null = null
  private lastSeq: number = 0
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
        lastSeq: this.lastSeq,
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
      console.log('Already connected to firehose')
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
    const relayUrl = this.env.RELAY_URL || 'wss://bsky.network'
    const wsUrl = `${relayUrl}/xrpc/com.atproto.sync.subscribeRepos${this.cursor ? `?cursor=${this.cursor}` : ''}`

    console.log(`Connecting to firehose: ${wsUrl}`)

    try {
      const ws = new WebSocket(wsUrl)

      ws.addEventListener('open', () => {
        console.log('Connected to firehose')
        this.connected = true
      })

      ws.addEventListener('message', async (event) => {
        try {
          await this.handleMessage(event.data)
        } catch (error) {
          console.error('Error handling message:', error)
          this.errorCount++
        }
      })

      ws.addEventListener('close', (event) => {
        console.log(`Firehose connection closed: ${event.code} ${event.reason}`)
        this.connected = false
        this.ws = null

        // Reconnect after delay
        this.reconnectTimeout = setTimeout(() => {
          this.connect()
        }, 5000) as unknown as number
      })

      ws.addEventListener('error', (error) => {
        console.error('Firehose WebSocket error:', error)
        this.errorCount++
      })

      this.ws = ws
    } catch (error) {
      console.error('Failed to connect to firehose:', error)
      this.errorCount++

      // Retry after delay
      this.reconnectTimeout = setTimeout(() => {
        this.connect()
      }, 10000) as unknown as number
    }
  }

  private async handleMessage(data: ArrayBuffer | string) {
    // The firehose sends CBOR-encoded messages
    // For now, we'll use a simplified approach - in production you'd use
    // @atproto/repo or cbor libraries to properly decode

    // This is a placeholder - real implementation needs CBOR decoding
    // The actual implementation would look like:
    //
    // import { decodeMultiple } from 'cbor-x'
    // import { readCar } from '@atproto/repo'
    //
    // const frames = decodeMultiple(new Uint8Array(data as ArrayBuffer))
    // for (const frame of frames) {
    //   if (frame.$type === 'com.atproto.sync.subscribeRepos#commit') {
    //     await this.handleCommit(frame)
    //   }
    // }

    // For development, we'll process events from a simplified JSON format
    // Real firehose uses CBOR + CAR files
    if (typeof data === 'string') {
      try {
        const event = JSON.parse(data) as CommitEvent
        await this.handleCommit(event)
      } catch {
        // Not JSON, skip
      }
    }
  }

  private async handleCommit(event: CommitEvent) {
    const { did, seq, commit } = event

    this.lastSeq = seq

    for (const op of commit.ops) {
      const [collection, rkey] = op.path.split('/')

      // Only process blog entries
      if (!BLOG_COLLECTIONS.includes(collection)) {
        continue
      }

      const source = collection === 'com.whtwnd.blog.entry' ? 'whitewind' : 'greengale'
      const uri = `at://${did}/${collection}/${rkey}`

      if (op.action === 'delete') {
        await this.deletePost(uri)
      } else if (op.action === 'create' || op.action === 'update') {
        // For create/update, we need to fetch the record content
        // In a real implementation, the record is included in the commit CAR
        await this.indexPost(uri, did, rkey, source, commit.record)
      }
    }

    // Periodically save cursor
    if (seq % 1000 === 0) {
      this.cursor = seq
      await this.ctx.storage.put('cursor', seq)
    }

    this.processedCount++
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
