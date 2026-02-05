import { DurableObject } from 'cloudflare:workers'
import {
  extractContent,
  hashContent,
  chunkByHeadings,
} from '../lib/content-extraction'
import {
  generateEmbeddings,
  upsertEmbeddings,
  deletePostEmbeddings,
  getVectorId,
  type Ai,
  type VectorizeIndex,
  type EmbeddingMetadata,
} from '../lib/embeddings'
import {
  extractLeafletContent,
  isLeafletContent,
} from '../lib/leaflet-parser'

interface Env {
  DB: D1Database
  CACHE: KVNamespace
  JETSTREAM_URL: string
  AI: Ai
  VECTORIZE: VectorizeIndex
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

// Author data fetched from Bluesky API (separated from DB operations for atomic batching)
interface AuthorData {
  did: string
  handle: string
  displayName: string | null
  description: string | null
  avatar: string | null
  banner: string | null
  pdsEndpoint: string | null
}

// Alarm interval - check connection every 30 seconds
const ALARM_INTERVAL_MS = 30 * 1000

// Timeout for external URL resolution fetches (3 seconds each)
const EXTERNAL_URL_TIMEOUT_MS = 3000

/**
 * Fetch with timeout using AbortController
 * Returns null on timeout instead of throwing, to avoid blocking firehose processing
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = EXTERNAL_URL_TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`Fetch timed out after ${timeoutMs}ms: ${url}`)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// Content labels that indicate sensitive images (should not be used for OG thumbnails)
const SENSITIVE_LABELS = ['nudity', 'sexual', 'porn', 'graphic-media']

// Handle patterns to block from indexing (spam sources)
// These are checked as suffix matches (e.g., '.brid.gy' matches 'user.brid.gy')
const BLOCKED_HANDLE_PATTERNS = [
  '.brid.gy',
]

// DID patterns to block from indexing (checked before any network calls)
// brid.gy uses did:web:brid.gy:... style DIDs
const BLOCKED_DID_PATTERNS = [
  'did:web:brid.gy',
]

// PDS endpoints to block (spam bridge services)
// Accounts may have various handles but all use the same PDS
const BLOCKED_PDS_PATTERNS = [
  'brid.gy',
  'atproto.brid.gy',
]

// External URL domains to block (spam aggregator sites)
const BLOCKED_EXTERNAL_DOMAINS = [
  'forums.socialmediagirls.com',
  'hijiribe.donmai.us',
  'donmai.us',
  'chaturbate.com',
  'brid.gy',
  'cults3d.com',
  'tokyomotion.net',
]

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
        version: '2026-02-05',  // Code version (date of last update)
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

    // Handle reindex requests for individual posts
    if (url.pathname === '/reindex' && request.method === 'POST') {
      try {
        const { uri } = await request.json() as { uri: string }

        // Parse URI: at://did/collection/rkey
        const match = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/)
        if (!match) {
          return new Response(JSON.stringify({ error: 'Invalid URI' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const [, did, collection, rkey] = match

        // Resolve PDS endpoint from DID document
        const pdsEndpoint = await this.resolvePdsEndpoint(did)
        if (!pdsEndpoint) {
          return new Response(JSON.stringify({ error: 'Could not resolve PDS endpoint' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Fetch the record from PDS
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (!response.ok) {
          return new Response(JSON.stringify({ error: 'Record not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const data = await response.json() as { value: Record<string, unknown> }

        // Re-index the post
        const source = collection === 'com.whtwnd.blog.entry' ? 'whitewind' : 'greengale'
        await this.indexPost(uri, did, rkey, source, data.value, collection)

        return new Response(JSON.stringify({ success: true, uri }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        console.error('Reindex error:', error)
        return new Response(JSON.stringify({ error: 'Reindex failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
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

    // Handle publication records
    // Only index app.greengale.publication - skip site.standard.publication to avoid
    // overwriting GreenGale publication data with site.standard data
    if (collection === 'app.greengale.publication') {
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
      // Check if DID matches blocked patterns (early exit before any network calls)
      const didLower = did.toLowerCase()
      for (const pattern of BLOCKED_DID_PATTERNS) {
        if (didLower.startsWith(pattern)) {
          console.log(`Skipping post from blocked DID pattern: ${did} (${uri})`)
          return
        }
      }

      // Determine document type
      const isV2Document = collection === 'app.greengale.document'
      const isSiteStandardDocument = collection === 'site.standard.document'

      // Skip indexing site.standard.document records that are GreenGale-originated
      // These are dual-published posts that already exist as app.greengale.document
      if (isSiteStandardDocument && record?.content) {
        const contentObj = record.content as Record<string, unknown>
        const contentUri = contentObj?.uri as string | undefined
        if (contentUri && contentUri.includes('/app.greengale.document/')) {
          console.log(`Skipping dual-published GreenGale post in site.standard: ${uri}`)
          return
        }
      }

      // Extract metadata from record (handle site.standard field differences)
      const title = (record?.title as string) || null
      // site.standard uses 'description' instead of 'subtitle'
      const subtitle = isSiteStandardDocument
        ? (record?.description as string) || null
        : (record?.subtitle as string) || null
      const visibility = (record?.visibility as string) || 'public'

      // Extract content based on document type
      let content = ''
      if (isSiteStandardDocument) {
        // Gather all possible content sources and use the longest one
        // Some platforms truncate textContent but have full content in other fields
        const candidates: string[] = []

        // 1. textContent (standard.site spec - plaintext for search)
        if (record?.textContent && typeof record.textContent === 'string') {
          candidates.push(record.textContent)
        }

        // 2. content as Leaflet format (pub.leaflet.content)
        if (record?.content && isLeafletContent(record.content)) {
          const leafletText = extractLeafletContent(record.content)
          if (leafletText) {
            candidates.push(leafletText)
          }
        }

        // 3. content as plain string (some platforms use this)
        if (record?.content && typeof record.content === 'string') {
          candidates.push(record.content)
        }

        // Use the longest available content
        content = candidates.reduce((longest, current) =>
          current.length > longest.length ? current : longest, '')
      } else {
        content = (record?.content as string) || ''
      }

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

      // For site.standard.document, resolve the publication to get external URL
      // But first check if this is a GreenGale-originated document
      let externalUrl: string | null = null
      if (isSiteStandardDocument && siteUri) {
        // Check if content indicates this is from an external platform
        // GreenGale docs have: content: { $type: "app.greengale.document#contentRef", uri: "at://..." }
        // External docs (Leaflet, etc.) have inline content: content: { $type: "pub.leaflet.content", ... }
        const contentObj = record?.content as Record<string, unknown> | undefined
        const contentType = contentObj?.$type as string | undefined
        const contentUri = contentObj?.uri as string | undefined

        // It's external if content has a $type that's NOT GreenGale's contentRef
        // (e.g., pub.leaflet.content, or any other platform's content type)
        const isExternalContent = contentType && !contentType.startsWith('app.greengale.')

        // It's GreenGale origin if content.uri points to a GreenGale document
        const isGreenGaleOrigin = contentUri && contentUri.includes('/app.greengale.document/')

        // Use documentPath if available, otherwise fall back to rkey
        // (some platforms like leaflet.pub use the rkey as the URL path)
        const pathForUrl = documentPath || `/${rkey}`

        // Handle both URL and AT-URI formats for the site field
        // Some posts use a direct URL (e.g., "https://example.com")
        // Others use an AT-URI (e.g., "at://did/site.standard.publication/rkey")
        let resolvedUrl: string | null = null
        if (siteUri.startsWith('http://') || siteUri.startsWith('https://')) {
          // Site is already a URL - construct external URL directly
          const baseUrl = siteUri.replace(/\/$/, '')
          const normalizedPath = pathForUrl.startsWith('/') ? pathForUrl : `/${pathForUrl}`
          resolvedUrl = `${baseUrl}${normalizedPath}`
        } else if (siteUri.startsWith('at://')) {
          // Site is an AT-URI - resolve it to get the publication URL
          resolvedUrl = await this.resolveExternalUrl(siteUri, pathForUrl)
        }

        // Only use the resolved URL if:
        // 1. It's a GreenGale-originated document, OR
        // 2. The URL doesn't point to greengale.app (i.e., it's a legitimate external platform), OR
        // 3. It's NOT explicitly external content (for backwards compat with old GreenGale posts without content field)
        if (resolvedUrl) {
          if (isExternalContent && resolvedUrl.includes('greengale.app')) {
            // This is an external document (e.g., Leaflet) that incorrectly references
            // a GreenGale publication. Don't use greengale.app URL for it.
            console.log(`Skipping greengale.app URL for external platform document: ${uri}`)
          } else if (isGreenGaleOrigin || !resolvedUrl.includes('greengale.app')) {
            externalUrl = resolvedUrl
          } else {
            // Ambiguous case: no content.$type and greengale.app URL
            // This could be an old GreenGale post without content field, so allow it
            externalUrl = resolvedUrl
          }
        }
      }

      // Check if external URL is from a blocked domain (spam filter)
      if (externalUrl) {
        try {
          const urlHost = new URL(externalUrl).hostname.toLowerCase()
          for (const blockedDomain of BLOCKED_EXTERNAL_DOMAINS) {
            if (urlHost === blockedDomain || urlHost.endsWith('.' + blockedDomain)) {
              console.log(`Skipping post with blocked external URL: ${externalUrl} (${uri})`)
              return
            }
          }
        } catch {
          // Invalid URL, continue with indexing
        }
      }

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

      // Extract tags from record (normalize: lowercase, trim, dedupe, limit to 100)
      const rawTags = record?.tags as string[] | undefined
      const tags = rawTags
        ? [...new Set(
            rawTags
              .filter(t => typeof t === 'string')
              .map(t => t.toLowerCase().trim())
              .filter(t => t.length > 0 && t.length <= 100)
          )].slice(0, 100)
        : []

      // Create content preview (first 3000 chars, strip markdown)
      const contentPreview = content
        .replace(/[#*`\[\]()!]/g, '')
        .replace(/\n+/g, ' ')
        .trim()
        .slice(0, 3000)

      // Create slug from title
      const slug = title
        ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : null

      // Phase 1: Network operations BEFORE database batch
      // Fetch author data separately so we can include it in the atomic batch
      const authorData = await this.fetchAuthorData(did)

      // Skip posts from authors with no handle (spam filter - legitimate accounts have handles)
      if (!authorData?.handle) {
        console.log(`Skipping post from author with no handle: ${did} (${uri})`)
        return
      }

      // Check if author is from a blocked domain (spam filter)
      // Check both suffix match AND contains match for brid.gy
      const handle = authorData.handle.toLowerCase()
      for (const pattern of BLOCKED_HANDLE_PATTERNS) {
        const stripped = pattern.replace(/^\./, '')
        if (handle.endsWith(pattern) || handle.includes(stripped)) {
          console.log(`Skipping post from blocked handle pattern: ${authorData.handle} (${uri})`)
          return
        }
      }

      // Check if author's PDS is blocked (spam bridge services like brid.gy)
      if (authorData.pdsEndpoint) {
        const pdsLower = authorData.pdsEndpoint.toLowerCase()
        for (const pattern of BLOCKED_PDS_PATTERNS) {
          if (pdsLower.includes(pattern)) {
            console.log(`Skipping post from blocked PDS: ${authorData.pdsEndpoint} (${uri})`)
            return
          }
        }
      } else if (isSiteStandardDocument) {
        // For site.standard.document posts, if we can't verify the PDS, be cautious
        // Check if handle looks suspicious (contains bridge-like patterns)
        if (handle.includes('brid.gy') || handle.includes('.ap.') || handle.includes('.web.')) {
          console.log(`Skipping site.standard post with suspicious handle and unknown PDS: ${authorData.handle} (${uri})`)
          return
        }
      }

      // Phase 2: Invalidate cache BEFORE DB write to prevent stale data
      // Note: Homepage uses limit=24, so we must include that key
      const cacheInvalidations = [
        this.env.CACHE.delete('recent_posts:12:'),
        this.env.CACHE.delete('recent_posts:24:'),
        this.env.CACHE.delete('recent_posts:50:'),
        this.env.CACHE.delete('recent_posts:100:'),
        // Invalidate popular tags cache when posts change
        this.env.CACHE.delete('popular_tags:20'),
        this.env.CACHE.delete('popular_tags:50'),
        this.env.CACHE.delete('popular_tags:100'),
        // Invalidate RSS feeds
        this.env.CACHE.delete('rss:recent'),
        // Invalidate network posts cache (site.standard.document posts)
        this.env.CACHE.delete('network_posts:v3:24:'),
        this.env.CACHE.delete('network_posts:v3:50:'),
        this.env.CACHE.delete('network_posts:v3:100:'),
      ]
      // Invalidate tag-specific caches for each tag
      for (const tag of tags) {
        cacheInvalidations.push(this.env.CACHE.delete(`tag_posts:${tag}:50:`))
      }
      // Invalidate author's RSS feed if we have their handle
      if (authorData?.handle) {
        cacheInvalidations.push(this.env.CACHE.delete(`rss:author:${authorData.handle}`))
      }
      await Promise.all(cacheInvalidations)

      // Phase 3: Atomic database batch - all operations succeed or all roll back
      const statements: D1PreparedStatement[] = []

      // Statement 1: Upsert post
      statements.push(
        this.env.DB.prepare(`
          INSERT INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, content_preview, has_latex, theme_preset, first_image_cid, url, path, site_uri, external_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            external_url = excluded.external_url,
            indexed_at = datetime('now')
        `).bind(
          uri, did, rkey, title, subtitle, slug, source, visibility,
          createdAt, contentPreview, hasLatex ? 1 : 0, themePreset, firstImageCid,
          documentUrl, documentPath, siteUri, externalUrl
        )
      )

      // Statement 2: Upsert author (using pre-fetched data)
      if (authorData) {
        statements.push(
          this.env.DB.prepare(`
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
            authorData.did,
            authorData.handle,
            authorData.displayName,
            authorData.description,
            authorData.avatar,
            authorData.banner,
            authorData.pdsEndpoint
          )
        )
      } else {
        // Fallback: minimal author record if profile fetch failed
        statements.push(
          this.env.DB.prepare('INSERT OR IGNORE INTO authors (did) VALUES (?)').bind(did)
        )
      }

      // Statement 3: Update author post count
      statements.push(
        this.env.DB.prepare(`
          UPDATE authors SET posts_count = (
            SELECT COUNT(*) FROM posts WHERE author_did = ? AND visibility = 'public'
          ), updated_at = datetime('now')
          WHERE did = ?
        `).bind(did, did)
      )

      // Statement 4: Delete old tags for this post
      statements.push(
        this.env.DB.prepare('DELETE FROM post_tags WHERE post_uri = ?').bind(uri)
      )

      // Statement 5+: Insert new tags
      for (const tag of tags) {
        statements.push(
          this.env.DB.prepare(
            'INSERT OR IGNORE INTO post_tags (post_uri, tag) VALUES (?, ?)'
          ).bind(uri, tag)
        )
      }

      // Execute all statements atomically
      await this.env.DB.batch(statements)

      // Phase 4: Invalidate OG image cache (after batch, needs author handle)
      // Note: authorData.handle is guaranteed to exist here (we return early if missing)
      await this.env.CACHE.delete(`og:${authorData.handle}:${rkey}`)

      console.log(`Indexed ${source} post: ${uri}`)

      // Phase 5: Handle embeddings for semantic search
      // Check if post was previously public (had embedding) but is now non-public
      const existingPost = await this.env.DB.prepare(
        'SELECT has_embedding, visibility FROM posts WHERE uri = ?'
      ).bind(uri).first()
      const hadEmbedding = existingPost?.has_embedding === 1

      if (visibility === 'public' && record) {
        // Delete old chunks first if this is an update (to handle re-chunking)
        if (hadEmbedding) {
          deletePostEmbeddings(this.env.VECTORIZE, uri)
            .catch(err => console.error(`Failed to delete old embeddings for ${uri}:`, err))
        }
        // Generate new embedding (async, don't block indexing)
        this.generateAndStoreEmbedding(uri, did, record, collection || '', title, createdAt)
          .catch(err => console.error(`Embedding failed for ${uri}:`, err))
      } else if (hadEmbedding) {
        // Visibility changed from public to non-public - delete embeddings
        deletePostEmbeddings(this.env.VECTORIZE, uri)
          .then(count => {
            if (count > 0) console.log(`Deleted ${count} embedding(s) for non-public ${uri}`)
          })
          .catch(err => console.error(`Failed to delete embeddings for ${uri}:`, err))
        // Mark as no longer embedded
        this.env.DB.prepare('UPDATE posts SET has_embedding = 0 WHERE uri = ?')
          .bind(uri).run()
          .catch(err => console.error(`Failed to update has_embedding for ${uri}:`, err))
      }
    } catch (error) {
      console.error(`Failed to index post ${uri}:`, error)
      throw error
    }
  }

  private async deletePost(uri: string) {
    try {
      // Get post data before deleting (for cache invalidation and author lookup)
      const post = await this.env.DB.prepare(
        'SELECT author_did, rkey FROM posts WHERE uri = ?'
      ).bind(uri).first()

      if (!post) {
        console.log(`Post not found for deletion: ${uri}`)
        return
      }

      const authorDid = post.author_did as string
      const rkey = post.rkey as string

      // Get author handle for OG cache invalidation
      const authorRow = await this.env.DB.prepare(
        'SELECT handle FROM authors WHERE did = ?'
      ).bind(authorDid).first()
      const handle = authorRow?.handle as string | undefined

      // Get tags for this post before deletion (for cache invalidation)
      const tagsResult = await this.env.DB.prepare(
        'SELECT tag FROM post_tags WHERE post_uri = ?'
      ).bind(uri).all()
      const postTags = (tagsResult.results || []).map(r => r.tag as string)

      // Phase 1: Invalidate cache BEFORE DB write to prevent stale data
      // Note: Homepage uses limit=24, so we must include that key
      const cacheInvalidations = [
        this.env.CACHE.delete('recent_posts:12:'),
        this.env.CACHE.delete('recent_posts:24:'),
        this.env.CACHE.delete('recent_posts:50:'),
        this.env.CACHE.delete('recent_posts:100:'),
        handle ? this.env.CACHE.delete(`og:${handle}:${rkey}`) : Promise.resolve(),
        // Invalidate popular tags cache when posts are deleted
        this.env.CACHE.delete('popular_tags:20'),
        this.env.CACHE.delete('popular_tags:50'),
        this.env.CACHE.delete('popular_tags:100'),
        // Invalidate RSS feeds
        this.env.CACHE.delete('rss:recent'),
        handle ? this.env.CACHE.delete(`rss:author:${handle}`) : Promise.resolve(),
        // Invalidate network posts cache (site.standard.document posts)
        this.env.CACHE.delete('network_posts:v3:24:'),
        this.env.CACHE.delete('network_posts:v3:50:'),
        this.env.CACHE.delete('network_posts:v3:100:'),
      ]
      // Invalidate tag-specific caches for each tag
      for (const tag of postTags) {
        cacheInvalidations.push(this.env.CACHE.delete(`tag_posts:${tag}:50:`))
      }
      await Promise.all(cacheInvalidations)

      // Phase 2: Atomic database batch - delete post AND update count together
      await this.env.DB.batch([
        this.env.DB.prepare('DELETE FROM posts WHERE uri = ?').bind(uri),
        this.env.DB.prepare(`
          UPDATE authors SET posts_count = (
            SELECT COUNT(*) FROM posts WHERE author_did = ? AND visibility = 'public'
          ), updated_at = datetime('now')
          WHERE did = ?
        `).bind(authorDid, authorDid),
      ])

      // Phase 3: Delete embeddings from Vectorize (async, don't block)
      deletePostEmbeddings(this.env.VECTORIZE, uri)
        .then(count => {
          if (count > 0) console.log(`Deleted ${count} embedding(s) for ${uri}`)
        })
        .catch(err => console.error(`Failed to delete embeddings for ${uri}:`, err))

      console.log(`Deleted post: ${uri}`)
    } catch (error) {
      console.error(`Failed to delete post ${uri}:`, error)
      throw error  // Rethrow to prevent cursor advancement on failure
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

  /**
   * Resolve a site.standard.publication AT-URI to get the external URL
   * Returns the full URL (publication.url + document.path) or null if resolution fails
   * Uses timeouts to prevent blocking firehose processing if external services are slow
   */
  private async resolveExternalUrl(siteUri: string, documentPath: string): Promise<string | null> {
    try {
      // Parse the AT-URI: at://did/collection/rkey
      const match = siteUri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
      if (!match) {
        console.error(`Invalid site AT-URI: ${siteUri}`)
        return null
      }

      const [, pubDid, collection, rkey] = match

      // Resolve the DID to find the PDS (supports did:plc and did:web)
      let didDocUrl: string
      if (pubDid.startsWith('did:web:')) {
        const parts = pubDid.slice('did:web:'.length).split(':')
        const host = decodeURIComponent(parts[0])
        const path = parts.length > 1 ? `/${parts.slice(1).map(decodeURIComponent).join('/')}` : '/.well-known'
        didDocUrl = `https://${host}${path}/did.json`
      } else {
        didDocUrl = `https://plc.directory/${pubDid}`
      }

      const didDocResponse = await fetchWithTimeout(didDocUrl)
      if (!didDocResponse || !didDocResponse.ok) {
        if (didDocResponse) {
          console.error(`Failed to resolve DID: ${pubDid}`)
        }
        return null
      }

      const didDoc = await didDocResponse.json() as {
        service?: Array<{ id: string; type: string; serviceEndpoint: string }>
      }

      const pdsService = didDoc.service?.find(
        s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
      )

      if (!pdsService?.serviceEndpoint) {
        console.error(`No PDS endpoint found for: ${pubDid}`)
        return null
      }

      // Fetch the publication record (with timeout to avoid blocking)
      const recordUrl = `${pdsService.serviceEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(pubDid)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
      const recordResponse = await fetchWithTimeout(recordUrl)

      if (!recordResponse || !recordResponse.ok) {
        if (recordResponse) {
          console.error(`Failed to fetch publication: ${recordUrl}`)
        }
        return null
      }

      const record = await recordResponse.json() as {
        value?: { url?: string }
      }

      const pubUrl = record.value?.url
      if (!pubUrl) {
        console.error(`Publication has no URL: ${siteUri}`)
        return null
      }

      // Construct the full external URL
      // Ensure there's exactly one slash between base URL and path
      const baseUrl = pubUrl.replace(/\/$/, '')
      const normalizedPath = documentPath.startsWith('/') ? documentPath : `/${documentPath}`
      return `${baseUrl}${normalizedPath}`
    } catch (error) {
      console.error(`Error resolving external URL for ${siteUri}:`, error)
      return null
    }
  }

  /**
   * Fetch author profile data from Bluesky API (network calls only, no DB operations)
   * Used to separate network calls from atomic DB batch operations
   */
  private async fetchAuthorData(did: string): Promise<AuthorData | null> {
    try {
      const response = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
      )

      if (!response.ok) return null

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
        let didDocUrl: string
        if (did.startsWith('did:web:')) {
          const parts = did.slice('did:web:'.length).split(':')
          const host = decodeURIComponent(parts[0])
          const path = parts.length > 1 ? `/${parts.slice(1).map(decodeURIComponent).join('/')}` : '/.well-known'
          didDocUrl = `https://${host}${path}/did.json`
        } else {
          didDocUrl = `https://plc.directory/${did}`
        }
        const didDocResponse = await fetch(didDocUrl)
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

      return {
        did: profile.did,
        handle: profile.handle,
        displayName: profile.displayName || null,
        description: profile.description || null,
        avatar: profile.avatar || null,
        banner: profile.banner || null,
        pdsEndpoint,
      }
    } catch {
      return null
    }
  }

  /**
   * Resolve PDS endpoint from DID document
   * Used for reindexing posts by fetching them from the author's PDS
   */
  private async resolvePdsEndpoint(did: string): Promise<string | null> {
    try {
      let didDocUrl: string
      if (did.startsWith('did:web:')) {
        const parts = did.slice('did:web:'.length).split(':')
        const host = decodeURIComponent(parts[0])
        const path = parts.length > 1 ? `/${parts.slice(1).map(decodeURIComponent).join('/')}` : '/.well-known'
        didDocUrl = `https://${host}${path}/did.json`
      } else {
        didDocUrl = `https://plc.directory/${did}`
      }

      const didDocResponse = await fetch(didDocUrl)
      if (!didDocResponse.ok) {
        console.error(`Failed to fetch DID document for ${did}`)
        return null
      }

      const didDoc = await didDocResponse.json() as {
        service?: Array<{ id: string; type: string; serviceEndpoint: string }>
      }

      const pdsService = didDoc.service?.find(
        s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
      )

      return pdsService?.serviceEndpoint || null
    } catch (error) {
      console.error(`Error resolving PDS endpoint for ${did}:`, error)
      return null
    }
  }

  private async indexPublication(did: string, record?: Record<string, unknown>, collection?: string) {
    try {
      // Check if DID matches blocked patterns (early exit before any network calls)
      const didLower = did.toLowerCase()
      for (const pattern of BLOCKED_DID_PATTERNS) {
        if (didLower.startsWith(pattern)) {
          console.log(`Skipping publication from blocked DID pattern: ${did}`)
          return
        }
      }

      const isSiteStandard = collection === 'site.standard.publication'

      const name = (record?.name as string) || null
      const description = (record?.description as string) || null
      const url = (record?.url as string) || null

      if (!name || !url) {
        console.error(`Publication missing required fields for ${did}`)
        return
      }

      // Extract showInDiscover - defaults to true if not set
      // site.standard stores it in preferences.showInDiscover, greengale stores it directly
      let showInDiscover = true
      if (isSiteStandard) {
        const preferences = record?.preferences as Record<string, unknown> | undefined
        showInDiscover = (preferences?.showInDiscover as boolean | undefined) !== false
      } else {
        showInDiscover = (record?.showInDiscover as boolean | undefined) !== false
      }

      // Store theme data - either preset name or JSON for custom themes
      // site.standard uses 'basicTheme' instead of 'theme'
      let themePreset: string | null = null
      const themeSource = isSiteStandard ? record?.basicTheme : record?.theme
      if (themeSource) {
        const themeData = themeSource as Record<string, unknown>
        if (isSiteStandard) {
          // site.standard.theme.basic uses RGB objects: foreground, background, accent, accentForeground
          // Each color is { r: number, g: number, b: number }
          const rgbToHex = (rgb: unknown): string | undefined => {
            if (!rgb || typeof rgb !== 'object') return undefined
            const { r, g, b } = rgb as { r?: number; g?: number; b?: number }
            if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return undefined
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          }
          themePreset = JSON.stringify({
            background: rgbToHex(themeData.background),
            text: rgbToHex(themeData.foreground),
            accent: rgbToHex(themeData.accent),
          })
        } else if (themeData.custom) {
          themePreset = JSON.stringify(themeData.custom)
        } else if (themeData.preset) {
          themePreset = themeData.preset as string
        }
      }

      // Phase 1: Fetch author data (network calls before DB batch)
      const authorData = await this.fetchAuthorData(did)

      // Skip publications from authors with no handle (spam filter)
      if (!authorData?.handle) {
        console.log(`Skipping publication from author with no handle: ${did}`)
        return
      }

      // Check if author is from a blocked domain (spam filter)
      // Check both suffix match AND contains match for brid.gy
      const handle = authorData.handle.toLowerCase()
      for (const pattern of BLOCKED_HANDLE_PATTERNS) {
        if (handle.endsWith(pattern) || handle.includes(pattern.replace(/^\./, ''))) {
          console.log(`Skipping publication from blocked handle pattern: ${authorData.handle}`)
          return
        }
      }

      // Check if author's PDS is blocked (spam bridge services like brid.gy)
      if (authorData.pdsEndpoint) {
        const pdsLower = authorData.pdsEndpoint.toLowerCase()
        for (const pattern of BLOCKED_PDS_PATTERNS) {
          if (pdsLower.includes(pattern)) {
            console.log(`Skipping publication from blocked PDS: ${authorData.pdsEndpoint}`)
            return
          }
        }
      } else if (isSiteStandard) {
        // For site.standard publications, if we can't verify the PDS, be cautious
        if (handle.includes('brid.gy') || handle.includes('.ap.') || handle.includes('.web.')) {
          console.log(`Skipping site.standard publication with suspicious handle and unknown PDS: ${authorData.handle}`)
          return
        }
      }

      // Phase 2: Invalidate OG cache BEFORE DB write
      // Invalidate profile OG image and all post OG images (since posts may inherit publication theme)
      if (authorData?.handle) {
        const cacheInvalidations: Promise<boolean>[] = [
          this.env.CACHE.delete(`og:profile:${authorData.handle}`),
        ]

        // Get all rkeys for this author's posts to invalidate their OG images
        const postsResult = await this.env.DB.prepare(
          'SELECT rkey FROM posts WHERE author_did = ?'
        ).bind(did).all()
        for (const row of postsResult.results || []) {
          cacheInvalidations.push(
            this.env.CACHE.delete(`og:${authorData.handle}:${row.rkey}`)
          )
        }

        await Promise.all(cacheInvalidations)
      }

      // Phase 3: Atomic database batch
      const statements: D1PreparedStatement[] = []

      // Statement 1: Upsert publication
      statements.push(
        this.env.DB.prepare(`
          INSERT INTO publications (author_did, name, description, theme_preset, url, show_in_discover)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(author_did) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            theme_preset = excluded.theme_preset,
            url = excluded.url,
            show_in_discover = excluded.show_in_discover,
            updated_at = datetime('now')
        `).bind(did, name, description, themePreset, url, showInDiscover ? 1 : 0)
      )

      // Statement 2: Upsert author
      if (authorData) {
        statements.push(
          this.env.DB.prepare(`
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
            authorData.did,
            authorData.handle,
            authorData.displayName,
            authorData.description,
            authorData.avatar,
            authorData.banner,
            authorData.pdsEndpoint
          )
        )
      } else {
        statements.push(
          this.env.DB.prepare('INSERT OR IGNORE INTO authors (did) VALUES (?)').bind(did)
        )
      }

      // Execute atomically
      await this.env.DB.batch(statements)

      console.log(`Indexed publication for ${did}: ${name}`)
    } catch (error) {
      console.error(`Failed to index publication for ${did}:`, error)
      throw error
    }
  }

  /**
   * Generate and store embedding for a post
   * This runs async after indexing to not block the firehose
   */
  private async generateAndStoreEmbedding(
    uri: string,
    did: string,
    record: Record<string, unknown>,
    collection: string,
    title: string | null,
    createdAt: string | null
  ): Promise<void> {
    try {
      // Extract content based on collection type
      const extracted = extractContent(record, collection)

      if (!extracted.success) {
        console.log(`Skipping embedding for ${uri}: content extraction failed`)
        await this.env.DB.prepare(
          'UPDATE posts SET has_embedding = -1 WHERE uri = ?'
        ).bind(uri).run()
        return
      }

      // Skip very short content (< 20 words)
      if (extracted.wordCount < 20) {
        console.log(`Skipping embedding for ${uri}: too short (${extracted.wordCount} words)`)
        await this.env.DB.prepare(
          'UPDATE posts SET has_embedding = -1 WHERE uri = ?'
        ).bind(uri).run()
        return
      }

      // Generate content hash for change detection
      const contentHash = await hashContent(extracted.text)

      // Check if content has changed (if we already have an embedding)
      const existing = await this.env.DB.prepare(
        'SELECT content_hash, has_embedding FROM posts WHERE uri = ?'
      ).bind(uri).first()

      if (existing?.has_embedding === 1 && existing?.content_hash === contentHash) {
        console.log(`Skipping embedding for ${uri}: content unchanged`)
        return
      }

      // Get subtitle for context
      const subtitle = collection === 'site.standard.document'
        ? (record?.description as string) || undefined
        : (record?.subtitle as string) || undefined

      // Chunk long content by headings
      const chunks = chunkByHeadings(extracted, title || undefined, subtitle)

      // Generate embeddings for all chunks
      const texts = chunks.map(c => c.text)
      const embeddings = await generateEmbeddings(this.env.AI, texts)

      // Prepare embeddings for Vectorize upsert (use hashed IDs to fit 64-byte limit)
      const vectorEmbeddings = await Promise.all(
        chunks.map(async (chunk, i) => {
          const id = await getVectorId(uri, chunk.chunkIndex)
          const metadata: EmbeddingMetadata = {
            uri,
            authorDid: did,
            title: title || undefined,
            createdAt: createdAt || undefined,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            isChunk: chunks.length > 1,
          }
          return {
            id,
            vector: embeddings[i],
            metadata,
          }
        })
      )

      // Upsert to Vectorize
      await upsertEmbeddings(this.env.VECTORIZE, vectorEmbeddings)

      // Update D1 with embedding status and content hash
      await this.env.DB.prepare(
        'UPDATE posts SET has_embedding = 1, content_hash = ? WHERE uri = ?'
      ).bind(contentHash, uri).run()

      console.log(`Generated ${chunks.length} embedding(s) for ${uri}`)
    } catch (error) {
      console.error(`Failed to generate embedding for ${uri}:`, error)
      // Mark as failed (-2) to distinguish from skipped (-1)
      await this.env.DB.prepare(
        'UPDATE posts SET has_embedding = -2 WHERE uri = ?'
      ).bind(uri).run()
    }
  }

  private async deletePublication(did: string) {
    try {
      // Get author handle for OG cache invalidation before deleting
      const authorRow = await this.env.DB.prepare(
        'SELECT handle FROM authors WHERE did = ?'
      ).bind(did).first()
      const handle = authorRow?.handle as string | undefined

      // Phase 1: Invalidate OG cache BEFORE DB write
      if (handle) {
        await this.env.CACHE.delete(`og:profile:${handle}`)
      }

      // Phase 2: Delete publication
      await this.env.DB.prepare('DELETE FROM publications WHERE author_did = ?').bind(did).run()

      console.log(`Deleted publication for ${did}`)
    } catch (error) {
      console.error(`Failed to delete publication for ${did}:`, error)
      throw error  // Rethrow to prevent cursor advancement on failure
    }
  }
}
