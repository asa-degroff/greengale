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
  'app.greengale.document',
  'site.standard.document',  // site.standard dual-publish support
]

// Publication collections (separate from blog posts)
const PUBLICATION_COLLECTIONS = [
  'app.greengale.publication',
  'site.standard.publication',  // site.standard dual-publish support
]

// All collections to monitor
const ALL_COLLECTIONS = [...BLOG_COLLECTIONS, ...PUBLICATION_COLLECTIONS]

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

// Alarm interval - check connection every 30 seconds
const ALARM_INTERVAL_MS = 30 * 1000

// Content labels that indicate sensitive images (should not be used for OG thumbnails)
const SENSITIVE_LABELS = ['nudity', 'sexual', 'porn', 'graphic-media']

export class FirehoseConsumer extends DurableObject<Env> {
  private ws: WebSocket | null = null
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
      await this.stop()
      return new Response(JSON.stringify({ status: 'stopped' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/status') {
      const enabled = await this.ctx.storage.get<boolean>('enabled')
      const cursor = await this.ctx.storage.get<number>('cursor')
      const lastTimeUs = await this.ctx.storage.get<number>('lastTimeUs')
      const processedCount = await this.ctx.storage.get<number>('processedCount') || 0

      return new Response(JSON.stringify({
        enabled: enabled || false,
        connected: this.ws !== null && this.ws.readyState === WebSocket.OPEN,
        cursor: cursor || 0,
        lastTimeUs: lastTimeUs || 0,
        processedCount: processedCount + this.processedCount,
        errorCount: this.errorCount,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  }

  // Alarm handler - this survives hibernation!
  async alarm() {
    const enabled = await this.ctx.storage.get<boolean>('enabled')
    if (!enabled) {
      console.log('Firehose not enabled, skipping alarm')
      return
    }

    console.log('Alarm fired, checking connection...')

    // Check if WebSocket is connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected, reconnecting...')
      await this.connect()
    } else {
      console.log('WebSocket still connected')
    }

    // Schedule next alarm
    await this.scheduleAlarm()
  }

  private async scheduleAlarm() {
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS)
    }
  }

  private async start() {
    // Mark as enabled in storage (persists across hibernation)
    await this.ctx.storage.put('enabled', true)

    // Connect immediately
    await this.connect()

    // Schedule recurring alarm to maintain connection
    await this.scheduleAlarm()

    console.log('Firehose consumer started with alarm')
  }

  private async stop() {
    // Mark as disabled
    await this.ctx.storage.put('enabled', false)

    // Clear any pending alarm
    await this.ctx.storage.deleteAlarm()

    // Close WebSocket if open
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    // Persist counts before stopping
    const existingCount = await this.ctx.storage.get<number>('processedCount') || 0
    await this.ctx.storage.put('processedCount', existingCount + this.processedCount)
    this.processedCount = 0

    console.log('Firehose consumer stopped')
  }

  private async connect() {
    // Close existing connection if any
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore close errors
      }
      this.ws = null
    }

    // Use Jetstream - it provides JSON instead of CBOR
    const baseUrl = this.env.JETSTREAM_URL || 'wss://jetstream2.us-east.bsky.network'

    // Load cursor from storage
    const cursor = await this.ctx.storage.get<number>('cursor')

    // Build URL with wanted collections
    const params = new URLSearchParams()
    for (const collection of ALL_COLLECTIONS) {
      params.append('wantedCollections', collection)
    }
    if (cursor) {
      params.append('cursor', cursor.toString())
    }

    const wsUrl = `${baseUrl}/subscribe?${params.toString()}`

    console.log(`Connecting to Jetstream: ${wsUrl}`)

    try {
      const ws = new WebSocket(wsUrl)

      ws.addEventListener('open', () => {
        console.log('Connected to Jetstream')
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
        this.ws = null
        // Don't reconnect here - let the alarm handle it
      })

      ws.addEventListener('error', (error) => {
        console.error('Jetstream WebSocket error:', error)
        this.errorCount++
      })

      this.ws = ws
    } catch (error) {
      console.error('Failed to connect to Jetstream:', error)
      this.errorCount++
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

    // Handle publication records (including site.standard.publication)
    if (PUBLICATION_COLLECTIONS.includes(collection)) {
      console.log(`Processing ${operation} for publication (${collection}): ${did}`)
      if (operation === 'delete') {
        await this.deletePublication(did)
      } else if (operation === 'create' || operation === 'update') {
        await this.indexPublication(did, record, collection)
      }
    } else if (BLOG_COLLECTIONS.includes(collection)) {
      // Handle blog posts (including site.standard.document)
      const source = collection === 'com.whtwnd.blog.entry' ? 'whitewind' : 'greengale'
      const uri = `at://${did}/${collection}/${rkey}`

      console.log(`Processing ${operation} for ${source} post (${collection}): ${uri}`)

      if (operation === 'delete') {
        await this.deletePost(uri)
      } else if (operation === 'create' || operation === 'update') {
        await this.indexPost(uri, did, rkey, source, record, collection)
      }
    } else {
      return // Unknown collection
    }

    // Update cursor in storage (persists across hibernation)
    await this.ctx.storage.put('lastTimeUs', commit.time_us)
    this.processedCount++

    // Save cursor every event (since blog posts are rare)
    await this.ctx.storage.put('cursor', commit.time_us)
  }

  private async indexPost(
    uri: string,
    did: string,
    rkey: string,
    source: 'whitewind' | 'greengale',
    record?: Record<string, unknown>,
    collection?: string
  ) {
    try {
      // Determine document type
      const isV2Document = collection === 'app.greengale.document'
      const isSiteStandardDocument = collection === 'site.standard.document'

      // Extract metadata from record (handle site.standard field differences)
      const title = (record?.title as string) || null
      // site.standard uses 'description' instead of 'subtitle'
      const subtitle = isSiteStandardDocument
        ? (record?.description as string) || null
        : (record?.subtitle as string) || null
      const visibility = (record?.visibility as string) || 'public'
      // site.standard uses 'textContent' for plaintext, or content may be a ref object
      const content = isSiteStandardDocument
        ? (record?.textContent as string) || ''
        : (record?.content as string) || ''
      const hasLatex = source === 'greengale' && !isSiteStandardDocument && (record?.latex === true)

      // Handle date field - V2 and site.standard use publishedAt, V1/WhiteWind uses createdAt
      const createdAt = (isV2Document || isSiteStandardDocument)
        ? (record?.publishedAt as string) || null
        : (record?.createdAt as string) || null

      // Extract V2-specific fields (site.standard uses 'site' AT-URI instead of 'url')
      const documentUrl = isV2Document ? (record?.url as string) || null : null
      const documentPath = (isV2Document || isSiteStandardDocument) ? (record?.path as string) || null : null
      // Extract site AT-URI for site.standard.document (points to site.standard.publication)
      const siteUri = isSiteStandardDocument ? (record?.site as string) || null : null

      // Store theme data - either preset name or JSON for custom themes
      let themePreset: string | null = null
      if (record?.theme) {
        const themeData = record.theme as Record<string, unknown>
        if (themeData.custom) {
          // Custom theme - store as JSON
          themePreset = JSON.stringify(themeData.custom)
        } else if (themeData.preset) {
          // Preset theme - store the preset name
          themePreset = themeData.preset as string
        }
      }

      // Extract first image CID for OG thumbnail (GreenGale posts only)
      const firstImageCid = source === 'greengale' && record
        ? this.extractFirstImageCid(record)
        : null

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
        INSERT INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, content_preview, has_latex, theme_preset, first_image_cid, url, path, site_uri)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uri) DO UPDATE SET
          title = excluded.title,
          subtitle = excluded.subtitle,
          slug = excluded.slug,
          visibility = excluded.visibility,
          content_preview = excluded.content_preview,
          has_latex = excluded.has_latex,
          theme_preset = excluded.theme_preset,
          first_image_cid = excluded.first_image_cid,
          url = excluded.url,
          path = excluded.path,
          site_uri = excluded.site_uri,
          indexed_at = datetime('now')
      `).bind(
        uri, did, rkey, title, subtitle, slug, source, visibility,
        createdAt, contentPreview, hasLatex ? 1 : 0, themePreset, firstImageCid,
        documentUrl, documentPath, siteUri
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

      // Invalidate OG image cache for this post
      const authorRow = await this.env.DB.prepare(
        'SELECT handle FROM authors WHERE did = ?'
      ).bind(did).first()
      if (authorRow?.handle) {
        await this.env.CACHE.delete(`og:${authorRow.handle}:${rkey}`)
      }

      console.log(`Indexed ${source} post: ${uri}`)
    } catch (error) {
      console.error(`Failed to index post ${uri}:`, error)
      throw error
    }
  }

  private async deletePost(uri: string) {
    try {
      // Get post data before deleting (for cache invalidation)
      const post = await this.env.DB.prepare(
        'SELECT author_did, rkey FROM posts WHERE uri = ?'
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

        // Invalidate OG image cache for this post
        const authorRow = await this.env.DB.prepare(
          'SELECT handle FROM authors WHERE did = ?'
        ).bind(post.author_did).first()
        if (authorRow?.handle && post.rkey) {
          await this.env.CACHE.delete(`og:${authorRow.handle}:${post.rkey}`)
        }
      }

      // Invalidate cache for recent posts
      await this.env.CACHE.delete('recent_posts:12:')

      console.log(`Deleted post: ${uri}`)
    } catch (error) {
      console.error(`Failed to delete post ${uri}:`, error)
    }
  }

  /**
   * Check if a blob has sensitive content labels that should be excluded from OG thumbnails
   */
  private hasSensitiveLabels(blob: Record<string, unknown>): boolean {
    const labels = blob.labels as { values?: Array<{ val: string }> } | undefined
    if (!labels?.values) return false
    return labels.values.some(l => SENSITIVE_LABELS.includes(l.val))
  }

  /**
   * Extract CID from a blobref object (handles multiple AT Protocol formats)
   */
  private extractCidFromBlobref(blobref: unknown): string | null {
    if (!blobref) return null

    // Direct CID string
    if (typeof blobref === 'string') return blobref
    if (typeof blobref !== 'object') return null

    const ref = blobref as Record<string, unknown>

    // Structure: { ref: { $link: cid } } or { ref: CID instance }
    if (ref.ref && typeof ref.ref === 'object') {
      const innerRef = ref.ref as Record<string, unknown>
      if (typeof innerRef.$link === 'string') return innerRef.$link
      if (typeof innerRef.toString === 'function') {
        const cidStr = innerRef.toString()
        if (typeof cidStr === 'string' && cidStr.startsWith('baf')) return cidStr
      }
    }

    // Structure: { $link: cid }
    if (typeof ref.$link === 'string') return ref.$link

    // Structure: { cid: string }
    if (typeof ref.cid === 'string') return ref.cid

    return null
  }

  /**
   * Extract the first non-sensitive image CID from a post's blobs array
   */
  private extractFirstImageCid(record: Record<string, unknown>): string | null {
    const blobs = record?.blobs
    if (!blobs || !Array.isArray(blobs)) return null

    for (const blob of blobs) {
      if (typeof blob !== 'object' || blob === null) continue

      // Skip images with sensitive content labels
      if (this.hasSensitiveLabels(blob as Record<string, unknown>)) continue

      // Extract CID from blobref
      const blobRecord = blob as Record<string, unknown>
      const cid = this.extractCidFromBlobref(blobRecord.blobref)
      if (cid) return cid // Return the first valid, non-sensitive image
    }

    return null
  }

  private async ensureAuthor(did: string) {
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

        // Also fetch PDS endpoint from DID document (needed for OG image thumbnails)
        let pdsEndpoint: string | null = null
        try {
          const didDocResponse = await fetch(`https://plc.directory/${did}`)
          if (didDocResponse.ok) {
            const didDoc = await didDocResponse.json() as {
              service?: Array<{ id: string; type: string; serviceEndpoint: string }>
            }
            const pdsService = didDoc.service?.find(
              s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
            )
            pdsEndpoint = pdsService?.serviceEndpoint || null
          }
        } catch {
          // PDS lookup failed, continue without it
        }

        // Upsert author - always update profile data to keep it fresh
        await this.env.DB.prepare(`
          INSERT INTO authors (did, handle, display_name, description, avatar_url, banner_url, pds_endpoint)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(did) DO UPDATE SET
            handle = excluded.handle,
            display_name = excluded.display_name,
            description = excluded.description,
            avatar_url = excluded.avatar_url,
            banner_url = excluded.banner_url,
            pds_endpoint = COALESCE(excluded.pds_endpoint, authors.pds_endpoint),
            updated_at = datetime('now')
        `).bind(
          profile.did,
          profile.handle,
          profile.displayName || null,
          profile.description || null,
          profile.avatar || null,
          profile.banner || null,
          pdsEndpoint
        ).run()
      } else {
        // Insert minimal author record if we can't fetch profile
        await this.env.DB.prepare(
          'INSERT OR IGNORE INTO authors (did) VALUES (?)'
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

  private async indexPublication(did: string, record?: Record<string, unknown>, collection?: string) {
    try {
      const isSiteStandard = collection === 'site.standard.publication'

      const name = (record?.name as string) || null
      const description = (record?.description as string) || null
      const url = (record?.url as string) || null

      if (!name || !url) {
        console.error(`Publication missing required fields for ${did}`)
        return
      }

      // Store theme data - either preset name or JSON for custom themes
      // site.standard uses 'basicTheme' instead of 'theme'
      let themePreset: string | null = null
      const themeSource = isSiteStandard ? record?.basicTheme : record?.theme
      if (themeSource) {
        const themeData = themeSource as Record<string, unknown>
        if (isSiteStandard) {
          // site.standard basicTheme has primaryColor, backgroundColor, accentColor
          themePreset = JSON.stringify({
            background: themeData.backgroundColor,
            text: themeData.primaryColor,
            accent: themeData.accentColor,
          })
        } else if (themeData.custom) {
          themePreset = JSON.stringify(themeData.custom)
        } else if (themeData.preset) {
          themePreset = themeData.preset as string
        }
      }

      await this.env.DB.prepare(`
        INSERT INTO publications (author_did, name, description, theme_preset, url)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(author_did) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          theme_preset = excluded.theme_preset,
          url = excluded.url,
          updated_at = datetime('now')
      `).bind(did, name, description, themePreset, url).run()

      // Ensure author exists
      await this.ensureAuthor(did)

      // Invalidate author profile OG cache
      const authorRow = await this.env.DB.prepare(
        'SELECT handle FROM authors WHERE did = ?'
      ).bind(did).first()
      if (authorRow?.handle) {
        await this.env.CACHE.delete(`og:profile:${authorRow.handle}`)
      }

      console.log(`Indexed publication for ${did}: ${name}`)
    } catch (error) {
      console.error(`Failed to index publication for ${did}:`, error)
      throw error
    }
  }

  private async deletePublication(did: string) {
    try {
      await this.env.DB.prepare('DELETE FROM publications WHERE author_did = ?').bind(did).run()

      // Invalidate author profile OG cache
      const authorRow = await this.env.DB.prepare(
        'SELECT handle FROM authors WHERE did = ?'
      ).bind(did).first()
      if (authorRow?.handle) {
        await this.env.CACHE.delete(`og:profile:${authorRow.handle}`)
      }

      console.log(`Deleted publication for ${did}`)
    } catch (error) {
      console.error(`Failed to delete publication for ${did}:`, error)
    }
  }
}
