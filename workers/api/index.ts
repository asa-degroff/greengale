import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { FirehoseConsumer } from '../firehose'
import { generateOGImage, generateHomepageOGImage, generateProfileOGImage } from '../lib/og-image'
import { buildRSSFeed, fetchPostContent, markdownToHtml, type RSSChannel, type RSSItem } from '../lib/rss'
import { buildSitemap, type SitemapUrl } from '../lib/sitemap'

export { FirehoseConsumer }

import {
  generateEmbedding,
  generateEmbeddings,
  upsertEmbeddings,
  querySimilar,
  getPostEmbeddings,
  getVectorId,
  reciprocalRankFusion,
  type Ai,
  type VectorizeIndex,
  type EmbeddingMetadata,
} from '../lib/embeddings'
import {
  extractContent,
  hashContent,
  chunkByHeadings,
} from '../lib/content-extraction'

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  FIREHOSE: DurableObjectNamespace
  RELAY_URL: string
  ADMIN_SECRET?: string
  AI: Ai
  VECTORIZE: VectorizeIndex
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for frontend
app.use('/*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'https://greengale.app',
      'https://greengale-app.pages.dev',
    ]
    if (allowed.includes(origin)) return origin
    // Allow preview branch deployments (e.g., pwa.greengale-app.pages.dev)
    if (origin.endsWith('.greengale-app.pages.dev')) return origin
    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// =============================================================================
// Cache Control Headers
// =============================================================================
// Add browser caching for feed endpoints to reduce redundant requests.
// Uses stale-while-revalidate for better UX during back/forward navigation.

// Cache TTLs (in seconds)
const FEED_CACHE_MAX_AGE = 60 // 1 minute fresh
const FEED_CACHE_SWR = 300 // 5 minutes stale-while-revalidate
const PROFILE_CACHE_MAX_AGE = 120 // 2 minutes fresh
const PROFILE_CACHE_SWR = 600 // 10 minutes stale-while-revalidate

/**
 * Create a JSON response with cache headers
 */
function jsonWithCache<T>(c: { json: (data: T, status?: number) => Response }, data: T, maxAge: number, swr: number): Response {
  const response = c.json(data)
  response.headers.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swr}`)
  return response
}

/**
 * Escape special characters in LIKE patterns
 * SQLite LIKE uses % and _ as wildcards, and \ as escape
 */
function escapeLikePattern(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

// Health check
app.get('/xrpc/_health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0' })
})

/**
 * Check if an rkey is a valid TID format (13 base32-sortable characters)
 */
function isValidTid(rkey: string): boolean {
  if (rkey.length !== 13) return false
  return /^[234567a-z]{13}$/.test(rkey)
}

/**
 * Get the rkey of a user's GreenGale site.standard.publication from their PDS
 * Returns null if no GreenGale publication with valid TID exists
 * Only considers records that have preferences.greengale (belong to GreenGale)
 */
async function getSiteStandardPublicationRkey(did: string): Promise<string | null> {
  try {
    // Resolve DID to find PDS endpoint (supports did:plc and did:web)
    const pdsEndpoint = await fetchPdsEndpoint(did)
    if (!pdsEndpoint) return null

    // List site.standard.publication records
    const listUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=site.standard.publication&limit=50`
    const listRes = await fetch(listUrl)
    if (!listRes.ok) return null

    const listData = await listRes.json() as { records?: Array<{ uri: string; value: Record<string, unknown> }> }
    if (!listData.records || listData.records.length === 0) return null

    // Find a GreenGale record with a valid TID rkey
    for (const record of listData.records) {
      // Only consider records that belong to GreenGale (have preferences.greengale)
      const preferences = record.value?.preferences as Record<string, unknown> | undefined
      if (!preferences?.greengale) {
        continue
      }

      const rkey = record.uri.split('/').pop() || ''
      if (isValidTid(rkey)) {
        return rkey
      }
    }

    return null
  } catch {
    return null
  }
}

// site.standard publication verification
// Returns the AT-URI of a publication record
// Without ?handle param: returns GreenGale's platform publication
// With ?handle=user.bsky.social: returns that user's site.standard.publication
// See: https://standard.site
app.get('/.well-known/site.standard.publication', async (c) => {
  const handle = c.req.query('handle')

  // GreenGale platform account DID
  const GREENGALE_PLATFORM_DID = 'did:plc:purpkfw7haimc4zu5a57slza'

  if (!handle) {
    // Return platform publication
    const rkey = await getSiteStandardPublicationRkey(GREENGALE_PLATFORM_DID)
    if (!rkey) {
      return c.text('', 404)
    }
    return c.text(`at://${GREENGALE_PLATFORM_DID}/site.standard.publication/${rkey}`)
  }

  // Look up user's DID from handle
  try {
    const author = await c.env.DB.prepare(
      'SELECT did FROM authors WHERE handle = ?'
    ).bind(handle).first<{ did: string }>()

    if (!author) {
      return c.text('', 404)
    }

    // Get user's site.standard.publication rkey
    const rkey = await getSiteStandardPublicationRkey(author.did)
    if (!rkey) {
      return c.text('', 404)
    }

    return c.text(`at://${author.did}/site.standard.publication/${rkey}`)
  } catch {
    return c.text('', 500)
  }
})

// OG image cache TTL (7 days)
const OG_IMAGE_CACHE_TTL = 7 * 24 * 60 * 60

// Test endpoint for OG image generation (no database required)
// Usage: /og/test?title=Hello&subtitle=World&author=Test&theme=default
// Custom colors: /og/test?title=Hello&bg=%23282a36&text=%23f8f8f2&accent=%23bd93f9
// Tags: /og/test?title=Hello&tags=javascript,react,web
app.get('/og/test', async (c) => {
  const title = c.req.query('title') || 'Test Post Title'
  const subtitle = c.req.query('subtitle') || null
  const authorName = c.req.query('author') || 'Test Author'
  const authorHandle = c.req.query('handle') || 'test.bsky.social'
  const authorAvatar = c.req.query('avatar') || null
  const themePreset = c.req.query('theme') || null
  const tagsParam = c.req.query('tags')
  const tags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : null

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
      tags,
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
      SELECT a.handle, a.display_name, a.description, a.avatar_url, a.posts_count,
             a.pds_endpoint, a.did as author_did, pub.icon_cid,
             pub.theme_preset as publication_theme_preset,
             pub.description as publication_description,
             pub.name as publication_name
      FROM authors a
      LEFT JOIN publications pub ON a.did = pub.author_did
      WHERE a.handle = ?
    `).bind(handle).first()

    if (!author) {
      return c.json({ error: 'Author not found' }, 404)
    }

    // Parse publication theme data - could be preset name or JSON custom colors
    let themePreset: string | null = null
    let customColors: { background?: string; text?: string; accent?: string } | null = null
    const themeData = author.publication_theme_preset as string | null
    if (themeData) {
      if (themeData.startsWith('{')) {
        try { customColors = JSON.parse(themeData) } catch { /* Invalid JSON, ignore */ }
      } else {
        themePreset = themeData
      }
    }

    // Resolve avatar, proxying PDS blob URLs (likely AVIF) through wsrv.nl for format conversion
    let avatarUrl = resolveAvatar(author as Record<string, unknown>)
    if (avatarUrl && avatarUrl.includes('com.atproto.sync.getBlob')) {
      const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(avatarUrl)}&w=240&h=240&fit=cover&output=jpeg&q=85`
      try {
        const resp = await fetch(proxyUrl)
        if (resp.ok) {
          const buf = await resp.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          avatarUrl = `data:image/jpeg;base64,${btoa(binary)}`
        }
      } catch { /* Avatar proxy failed, use raw URL */ }
    }

    const imageResponse = await generateProfileOGImage({
      displayName: (author.display_name as string) || handle,
      handle: (author.handle as string) || handle,
      avatarUrl,
      description: (author.publication_description as string) || (author.description as string) || null,
      postsCount: author.posts_count as number | undefined,
      themePreset,
      customColors,
      publicationName: (author.publication_name as string) || null,
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

    // Fetch post + author + publication data from D1 (including first_image_cid and pds_endpoint for OG thumbnails)
    // Exclude site.standard.document posts since they don't have theme data
    // (dual-published posts share the same rkey, so we want the GreenGale version)
    const post = await c.env.DB.prepare(`
      SELECT p.uri, p.title, p.subtitle, p.theme_preset, p.first_image_cid,
             p.author_did, a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
             pub.theme_preset AS publication_theme_preset, pub.icon_cid
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.author_did = ? AND p.rkey = ?
        AND p.uri NOT LIKE '%/site.standard.document/%'
    `).bind(authorDid, rkey).first()

    if (!post) {
      return c.json({ error: 'Post not found' }, 404)
    }

    // Fetch tags for this post
    const tagsResult = await c.env.DB.prepare(
      'SELECT tag FROM post_tags WHERE post_uri = ? ORDER BY tag LIMIT 10'
    ).bind(post.uri as string).all()
    const tags = (tagsResult.results || []).map(r => r.tag as string)

    // Parse theme data - could be preset name or JSON custom colors
    // Falls back to publication theme if post doesn't have its own theme
    let themePreset: string | null = null
    let customColors: { background?: string; text?: string; accent?: string } | null = null

    const themeData = post.theme_preset as string | null
    const publicationThemeData = post.publication_theme_preset as string | null
    const effectiveThemeData = themeData || publicationThemeData

    if (effectiveThemeData) {
      if (effectiveThemeData.startsWith('{')) {
        // JSON custom colors
        try {
          customColors = JSON.parse(effectiveThemeData)
        } catch {
          // Invalid JSON, ignore
        }
      } else {
        // Preset name
        themePreset = effectiveThemeData
      }
    }

    // Fetch thumbnail image if available
    // Images are stored as AVIF which Satori/resvg doesn't support, so we use
    // wsrv.nl (images.weserv.nl) to convert to JPEG on the fly
    let thumbnailUrl: string | null = null
    if (post.first_image_cid && post.pds_endpoint) {
      try {
        const blobUrl = `${post.pds_endpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(authorDid)}&cid=${encodeURIComponent(post.first_image_cid as string)}`

        // Use wsrv.nl to convert AVIF to JPEG and resize to 560x560 (2x for 280x280 display)
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(blobUrl)}&w=560&h=560&fit=cover&output=jpeg&q=85`

        const imageResponse = await fetch(proxyUrl)

        if (imageResponse.ok) {
          const imageBuffer = await imageResponse.arrayBuffer()

          // Convert to base64 data URL
          const bytes = new Uint8Array(imageBuffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          const base64 = btoa(binary)
          thumbnailUrl = `data:image/jpeg;base64,${base64}`
        }
      } catch (err) {
        // Image fetch/conversion failed, continue without thumbnail
        console.error('Failed to fetch thumbnail:', err)
      }
    }

    // Generate OG image
    const imageResponse = await generateOGImage({
      title: (post.title as string) || 'Untitled',
      subtitle: post.subtitle as string | null,
      authorName: (post.display_name as string) || (post.handle as string) || handle,
      authorHandle: (post.handle as string) || handle,
      authorAvatar: resolveAvatar(post as Record<string, unknown>),
      themePreset,
      customColors,
      thumbnailUrl,
      tags: tags.length > 0 ? tags : null,
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

// =============================================================================
// RSS Feeds
// =============================================================================

// Cache TTL for RSS feeds (30 minutes)
const RSS_CACHE_TTL = 30 * 60

// RSS response cache headers (5 minutes browser cache, 30 minutes CDN cache)
const RSS_CACHE_CONTROL = 'public, max-age=300, s-maxage=1800'

const BASE_URL = 'https://greengale.app'

/**
 * Generate RSS feed for site-wide recent posts
 * NOTE: This route must be defined BEFORE /feed/:handle.xml to prevent "recent" being matched as a handle
 */
app.get('/feed/recent.xml', async (c) => {
  const cacheKey = 'rss:recent'

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(cacheKey)
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': RSS_CACHE_CONTROL,
          'X-Cache': 'HIT',
        },
      })
    }

    // Use same query pattern as getRecentPosts (limit authors to 3 posts each)
    const postsResult = await c.env.DB.prepare(`
      WITH ranked_posts AS (
        SELECT
          p.rkey, p.title, p.subtitle, p.created_at, p.content_preview, p.first_image_cid,
          p.author_did,
          a.handle, a.display_name, a.pds_endpoint,
          (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags,
          ROW_NUMBER() OVER (PARTITION BY p.author_did ORDER BY p.created_at DESC) as author_rank
        FROM posts p
        LEFT JOIN authors a ON p.author_did = a.did
        LEFT JOIN publications pub ON p.author_did = pub.author_did
        WHERE p.visibility = 'public'
          AND p.uri NOT LIKE '%/site.standard.document/%'
          AND COALESCE(pub.show_in_discover, 1) = 1
      )
      SELECT rkey, title, subtitle, created_at, content_preview, first_image_cid,
             author_did, handle, display_name, pds_endpoint, tags
      FROM ranked_posts
      WHERE author_rank <= 3
      ORDER BY created_at DESC
      LIMIT 50
    `).all()

    const posts = postsResult.results || []

    // Build channel metadata
    const channel: RSSChannel = {
      title: 'GreenGale - Recent Posts',
      link: BASE_URL,
      description: 'Recent blog posts from the GreenGale community',
      selfLink: `${BASE_URL}/rss`,
      lastBuildDate: posts.length > 0 ? (posts[0].created_at as string) : undefined,
    }

    // Fetch full content for all posts in parallel
    const contentPromises = posts.map(async (p) => {
      const pdsEndpoint = p.pds_endpoint as string | null
      const authorDid = p.author_did as string
      const rkey = p.rkey as string

      if (!pdsEndpoint) return null

      try {
        return await fetchPostContent(pdsEndpoint, authorDid, rkey)
      } catch {
        return null
      }
    })

    const fullContents = await Promise.all(contentPromises)

    // Build items with full content
    const items: RSSItem[] = posts.map((p, index) => {
      const postHandle = p.handle as string
      const postTitle = (p.title as string) || 'Untitled'
      const postLink = `${BASE_URL}/${postHandle}/${p.rkey}`
      const authorDid = p.author_did as string

      // Parse tags from GROUP_CONCAT result
      const tagsStr = p.tags as string | null
      const categories = tagsStr
        ? tagsStr.split(',').filter(t => t.length > 0)
        : undefined

      // Build image URL if first_image_cid is available
      let enclosureUrl: string | undefined
      if (p.first_image_cid && p.pds_endpoint) {
        enclosureUrl = `${p.pds_endpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(authorDid)}&cid=${encodeURIComponent(p.first_image_cid as string)}`
      }

      // Use full content converted to HTML, fall back to preview
      const fullContent = fullContents[index]
      const description = fullContent
        ? markdownToHtml(fullContent)
        : (p.content_preview as string) || (p.subtitle as string) || ''

      return {
        title: postTitle,
        link: postLink,
        guid: postLink,
        pubDate: p.created_at as string,
        description,
        creator: (p.display_name as string) || postHandle,
        categories,
        enclosureUrl,
        enclosureType: enclosureUrl ? 'image/avif' : undefined,
      }
    })

    // Build RSS feed
    const xml = buildRSSFeed(channel, items)

    // Cache for 30 minutes
    await c.env.CACHE.put(cacheKey, xml, {
      expirationTtl: RSS_CACHE_TTL,
    })

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': RSS_CACHE_CONTROL,
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('Error generating recent posts RSS feed:', error)
    return c.json({ error: 'Failed to generate feed' }, 500)
  }
})

/**
 * Generate RSS feed for an author's posts
 */
app.get('/feed/:filename', async (c) => {
  const filename = c.req.param('filename')

  // Validate filename format (handle.xml)
  if (!filename || !filename.endsWith('.xml')) {
    return c.json({ error: 'Invalid feed format' }, 400)
  }

  // Extract handle from filename (remove .xml extension)
  const handle = filename.slice(0, -4)

  const cacheKey = `rss:author:${handle}`

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(cacheKey)
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': RSS_CACHE_CONTROL,
          'X-Cache': 'HIT',
        },
      })
    }

    // Resolve handle to DID
    const authorRow = await c.env.DB.prepare(`
      SELECT a.did, a.did as author_did, a.display_name, a.description, a.avatar_url,
             a.pds_endpoint, pub.name as pub_name, pub.description as pub_description, pub.icon_cid
      FROM authors a
      LEFT JOIN publications pub ON a.did = pub.author_did
      WHERE a.handle = ?
    `).bind(handle).first()

    if (!authorRow) {
      return c.json({ error: 'Author not found' }, 404)
    }

    const authorDid = authorRow.did as string
    const authorName = (authorRow.display_name as string) || handle
    const authorDescription = (authorRow.description as string) || `Blog posts by ${authorName}`
    const authorAvatar = resolveAvatar(authorRow as Record<string, unknown>)

    const pubName = authorRow.pub_name as string | null
    const pubDescription = authorRow.pub_description as string | null

    // Fetch recent posts (limit 50 for RSS)
    const postsResult = await c.env.DB.prepare(`
      SELECT
        p.rkey, p.title, p.subtitle, p.created_at, p.content_preview, p.first_image_cid,
        a.handle, a.display_name, a.pds_endpoint,
        (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      WHERE p.author_did = ? AND p.visibility = 'public'
        AND p.uri NOT LIKE '%/site.standard.document/%'
      ORDER BY p.created_at DESC
      LIMIT 50
    `).bind(authorDid).all()

    const posts = postsResult.results || []

    // Build channel metadata
    const channel: RSSChannel = {
      title: pubName || `${authorName}'s Blog`,
      link: `${BASE_URL}/${handle}`,
      description: pubDescription || authorDescription,
      selfLink: `${BASE_URL}/${handle}/rss`,
      lastBuildDate: posts.length > 0 ? (posts[0].created_at as string) : undefined,
      imageUrl: authorAvatar || undefined,
      imageTitle: authorName,
    }

    // Fetch full content for all posts in parallel
    const contentPromises = posts.map(async (p) => {
      const pdsEndpoint = p.pds_endpoint as string | null
      const rkey = p.rkey as string

      if (!pdsEndpoint) return null

      try {
        return await fetchPostContent(pdsEndpoint, authorDid, rkey)
      } catch {
        return null
      }
    })

    const fullContents = await Promise.all(contentPromises)

    // Build items with full content
    const items: RSSItem[] = posts.map((p, index) => {
      const postHandle = (p.handle as string) || handle
      const postTitle = (p.title as string) || 'Untitled'
      const postLink = `${BASE_URL}/${postHandle}/${p.rkey}`

      // Parse tags from GROUP_CONCAT result
      const tagsStr = p.tags as string | null
      const categories = tagsStr
        ? tagsStr.split(',').filter(t => t.length > 0)
        : undefined

      // Build image URL if first_image_cid is available
      let enclosureUrl: string | undefined
      if (p.first_image_cid && p.pds_endpoint) {
        enclosureUrl = `${p.pds_endpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(authorDid)}&cid=${encodeURIComponent(p.first_image_cid as string)}`
      }

      // Use full content converted to HTML, fall back to preview
      const fullContent = fullContents[index]
      const description = fullContent
        ? markdownToHtml(fullContent)
        : (p.content_preview as string) || (p.subtitle as string) || ''

      return {
        title: postTitle,
        link: postLink,
        guid: postLink,
        pubDate: p.created_at as string,
        description,
        creator: (p.display_name as string) || postHandle,
        categories,
        enclosureUrl,
        enclosureType: enclosureUrl ? 'image/avif' : undefined,
      }
    })

    // Build RSS feed
    const xml = buildRSSFeed(channel, items)

    // Cache for 30 minutes
    await c.env.CACHE.put(cacheKey, xml, {
      expirationTtl: RSS_CACHE_TTL,
    })

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': RSS_CACHE_CONTROL,
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('Error generating author RSS feed:', error)
    return c.json({ error: 'Failed to generate feed' }, 500)
  }
})

// =============================================================================
// Sitemap
// =============================================================================

// Cache TTL for sitemap (1 hour - search engines don't need real-time updates)
const SITEMAP_CACHE_TTL = 60 * 60

// Sitemap response cache headers (10 minutes browser cache, 1 hour CDN cache)
const SITEMAP_CACHE_CONTROL = 'public, max-age=600, s-maxage=3600'

/**
 * Generate sitemap.xml for search engine indexing
 * Includes homepage, all author pages, and all public posts
 */
app.get('/sitemap.xml', async (c) => {
  const cacheKey = 'sitemap'

  try {
    // Check KV cache first
    const cached = await c.env.CACHE.get(cacheKey)
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': SITEMAP_CACHE_CONTROL,
          'X-Cache': 'HIT',
        },
      })
    }

    const urls: SitemapUrl[] = []

    // Add homepage
    urls.push({
      loc: BASE_URL,
      changefreq: 'daily',
      priority: 1.0,
    })

    // Get all authors with posts
    const authorsResult = await c.env.DB.prepare(`
      SELECT DISTINCT a.handle, MAX(p.created_at) as last_post
      FROM authors a
      INNER JOIN posts p ON a.did = p.author_did
      WHERE p.visibility = 'public'
        AND p.uri NOT LIKE '%/site.standard.document/%'
      GROUP BY a.handle
      ORDER BY last_post DESC
    `).all()

    // Add author pages
    for (const author of authorsResult.results || []) {
      const handle = author.handle as string
      const lastPost = author.last_post as string | null

      urls.push({
        loc: `${BASE_URL}/${handle}`,
        lastmod: lastPost || undefined,
        changefreq: 'weekly',
        priority: 0.8,
      })
    }

    // Get all public posts
    const postsResult = await c.env.DB.prepare(`
      SELECT a.handle, p.rkey, p.created_at
      FROM posts p
      INNER JOIN authors a ON p.author_did = a.did
      WHERE p.visibility = 'public'
        AND p.uri NOT LIKE '%/site.standard.document/%'
      ORDER BY p.created_at DESC
      LIMIT 50000
    `).all()

    // Add post pages
    for (const post of postsResult.results || []) {
      const handle = post.handle as string
      const rkey = post.rkey as string
      const createdAt = post.created_at as string

      urls.push({
        loc: `${BASE_URL}/${handle}/${rkey}`,
        lastmod: createdAt,
        changefreq: 'monthly',
        priority: 0.6,
      })
    }

    // Build sitemap
    const xml = buildSitemap(urls)

    // Cache for 1 hour
    await c.env.CACHE.put(cacheKey, xml, {
      expirationTtl: SITEMAP_CACHE_TTL,
    })

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': SITEMAP_CACHE_CONTROL,
        'X-Cache': 'MISS',
      },
    })
  } catch (error) {
    console.error('Error generating sitemap:', error)
    return c.json({ error: 'Failed to generate sitemap' }, 500)
  }
})

// Cache TTL for recent posts (30 minutes)
const RECENT_POSTS_CACHE_TTL = 30 * 60

// Cache TTL for Bluesky interactions (10 minutes)
const BLUESKY_INTERACTIONS_CACHE_TTL = 10 * 60

// Bluesky API base URL (api.bsky.app works better than public.api.bsky.app which has aggressive rate limiting)
const BLUESKY_API = 'https://api.bsky.app'

// Get Bluesky posts that link to a GreenGale blog post URL
// Supports multiple URLs (comma-separated) to also find WhiteWind links
app.get('/xrpc/app.greengale.feed.getBlueskyInteractions', async (c) => {
  const urlParam = c.req.query('url')
  if (!urlParam) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  // Support comma-separated URLs (e.g., GreenGale URL + WhiteWind URL)
  const urls = urlParam.split(',').map(u => u.trim()).filter(u => u.length > 0)
  if (urls.length === 0) {
    return c.json({ error: 'No valid URLs provided' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25)
  const sort = c.req.query('sort') || 'top'
  const includeReplies = c.req.query('includeReplies') !== 'false'

  // Build cache key (sort URLs for consistent caching)
  const sortedUrls = [...urls].sort().join(',')
  const cacheKey = `bluesky:${sortedUrls}:${limit}:${sort}:${includeReplies}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    // Search for posts linking to each URL in parallel
    const searchResults = await Promise.all(
      urls.map(async (url) => {
        try {
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
            console.error(`Bluesky search failed for ${url}:`, searchResponse.status)
            return { posts: [] as BlueskyPostView[], hitsTotal: 0 }
          }

          const data = await searchResponse.json() as {
            posts: BlueskyPostView[]
            cursor?: string
            hitsTotal?: number
          }
          return { posts: data.posts, hitsTotal: data.hitsTotal || 0 }
        } catch (err) {
          console.error(`Error searching Bluesky for ${url}:`, err)
          return { posts: [] as BlueskyPostView[], hitsTotal: 0 }
        }
      })
    )

    // Combine and deduplicate posts by URI
    const seenUris = new Set<string>()
    const combinedPosts: BlueskyPostView[] = []
    let totalHits = 0

    for (const result of searchResults) {
      totalHits += result.hitsTotal
      for (const post of result.posts) {
        if (!seenUris.has(post.uri)) {
          seenUris.add(post.uri)
          combinedPosts.push(post)
        }
      }
    }

    // Sort combined posts
    if (sort === 'top') {
      // Sort by engagement (likes + reposts + replies)
      combinedPosts.sort((a, b) => {
        const scoreA = (a.likeCount || 0) + (a.repostCount || 0) + (a.replyCount || 0)
        const scoreB = (b.likeCount || 0) + (b.repostCount || 0) + (b.replyCount || 0)
        return scoreB - scoreA
      })
    } else {
      // Sort by date (latest first)
      combinedPosts.sort((a, b) => {
        return new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime()
      })
    }

    // Limit to requested number after combining
    const limitedPosts = combinedPosts.slice(0, limit)

    // Transform posts to our format
    let posts = limitedPosts.map(transformBlueskyPost)

    // Optionally fetch replies for each post
    if (includeReplies) {
      posts = await Promise.all(
        posts.map(async (post) => {
          if (post.replyCount === 0) return post

          try {
            const threadUrl = new URL(`${BLUESKY_API}/xrpc/app.bsky.feed.getPostThread`)
            threadUrl.searchParams.set('uri', post.uri)
            threadUrl.searchParams.set('depth', '10')
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
              // Use recursive transformation to get full nested thread
              post.replies = transformThreadReplies(threadData.thread.replies, 0, 10)
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
      totalHits,
      // No cursor for multi-URL searches (pagination would be complex)
      cursor: urls.length === 1 ? undefined : undefined,
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

// Cache TTL for single Bluesky post embeds (5 minutes)
const BLUESKY_POST_CACHE_TTL = 5 * 60

// Get a single Bluesky post for embedding
app.get('/xrpc/app.greengale.feed.getBlueskyPost', async (c) => {
  const handle = c.req.query('handle')
  const rkey = c.req.query('rkey')

  if (!handle || !rkey) {
    return c.json({ error: 'Missing handle or rkey parameter' }, 400)
  }

  // Build cache key
  const cacheKey = `bluesky:post:${handle}:${rkey}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    // Construct AT URI - handle could be a handle or DID
    const atUri = `at://${handle}/app.bsky.feed.post/${rkey}`

    // Fetch the post thread (depth=0 to just get the post itself)
    const threadUrl = new URL(`${BLUESKY_API}/xrpc/app.bsky.feed.getPostThread`)
    threadUrl.searchParams.set('uri', atUri)
    threadUrl.searchParams.set('depth', '0')
    threadUrl.searchParams.set('parentHeight', '0')

    const threadResponse = await fetch(threadUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GreenGale/1.0',
      },
    })

    if (!threadResponse.ok) {
      const errorText = await threadResponse.text()
      console.error('Bluesky getPostThread failed:', threadResponse.status, errorText)

      // Return a specific error for not found posts
      if (threadResponse.status === 400 || threadResponse.status === 404) {
        return c.json({ error: 'Post not found', post: null }, 404)
      }

      return c.json({ error: 'Failed to fetch post', post: null }, threadResponse.status)
    }

    const threadData = await threadResponse.json() as {
      thread: {
        $type: string
        post?: BlueskyPostView
        notFound?: boolean
        blocked?: boolean
      }
    }

    // Handle blocked or not found posts
    if (threadData.thread.notFound || threadData.thread.blocked || !threadData.thread.post) {
      return c.json({ error: 'Post not found or unavailable', post: null }, 404)
    }

    // Extract images from the resolved embed view (has CDN URLs)
    const extractImages = (embed: BlueskyPostView['embed']): BlueskyEmbedImage[] | null => {
      if (!embed) return null

      // Direct images embed
      if (embed.$type === 'app.bsky.embed.images#view' && embed.images) {
        return embed.images.map(img => ({
          alt: img.alt || '',
          thumb: img.thumb,
          fullsize: img.fullsize,
          aspectRatio: img.aspectRatio,
        }))
      }

      // Record with media (quote post + images/video)
      if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
        // Check if media contains images
        if (embed.media.$type === 'app.bsky.embed.images#view' && embed.media.images) {
          return embed.media.images.map(img => ({
            alt: img.alt || '',
            thumb: img.thumb,
            fullsize: img.fullsize,
            aspectRatio: img.aspectRatio,
          }))
        }
      }

      // External link with thumbnail
      if (embed.$type === 'app.bsky.embed.external#view' && embed.external?.thumb) {
        return [{
          alt: embed.external.title || embed.external.description || '',
          thumb: embed.external.thumb,
          fullsize: embed.external.thumb, // External embeds only have thumb
          aspectRatio: undefined,
        }]
      }

      return null
    }

    // Transform to our minimal format (no engagement stats)
    const post = {
      uri: threadData.thread.post.uri,
      cid: threadData.thread.post.cid,
      author: {
        did: threadData.thread.post.author.did,
        handle: threadData.thread.post.author.handle,
        displayName: threadData.thread.post.author.displayName,
        avatar: threadData.thread.post.author.avatar,
      },
      text: threadData.thread.post.record?.text || '',
      createdAt: threadData.thread.post.record?.createdAt || threadData.thread.post.indexedAt,
      // Include facets for rich text (links, mentions, hashtags)
      facets: threadData.thread.post.record?.facets || null,
      // Include resolved images from embed
      images: extractImages(threadData.thread.post.embed),
    }

    const response = { post }

    // Cache the response
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: BLUESKY_POST_CACHE_TTL,
    })

    return c.json(response)
  } catch (error) {
    console.error('Error fetching Bluesky post:', error)
    return c.json({ error: 'Failed to fetch Bluesky post', post: null }, 500)
  }
})

// Bluesky API types
interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number }
  features: Array<{
    $type: string
    uri?: string   // for links
    did?: string   // for mentions
    tag?: string   // for hashtags
  }>
}

interface BlueskyEmbedImage {
  alt: string
  thumb: string
  fullsize: string
  aspectRatio?: { width: number; height: number }
}

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
    facets?: BlueskyFacet[]
  }
  // Resolved embed from the view (has CDN URLs for images)
  embed?: {
    $type: string
    // app.bsky.embed.images#view
    images?: Array<{
      alt: string
      thumb: string
      fullsize: string
      aspectRatio?: { width: number; height: number }
    }>
    // app.bsky.embed.recordWithMedia#view
    media?: {
      $type: string
      images?: Array<{
        alt: string
        thumb: string
        fullsize: string
        aspectRatio?: { width: number; height: number }
      }>
    }
    // app.bsky.embed.external#view
    external?: {
      uri: string
      title?: string
      description?: string
      thumb?: string
    }
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

/**
 * Recursively transform thread replies into nested TransformedPost structure.
 * Limits replies per level and respects max depth to prevent excessive data.
 */
function transformThreadReplies(
  replies: BlueskyThreadViewPost[] | undefined,
  currentDepth: number = 0,
  maxDepth: number = 10
): TransformedPost[] {
  if (!replies || replies.length === 0 || currentDepth >= maxDepth) {
    return []
  }

  // Determine max replies based on depth
  // depth 0: 5 replies, depth 1-3: 3 replies, depth 4+: 2 replies
  const maxRepliesForDepth = currentDepth === 0 ? 5 : currentDepth <= 3 ? 3 : 2

  return replies
    .filter((r): r is BlueskyThreadViewPost =>
      r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post != null
    )
    .sort((a, b) => (b.post.likeCount || 0) - (a.post.likeCount || 0))
    .slice(0, maxRepliesForDepth)
    .map((reply) => {
      const post = transformBlueskyPost(reply.post)
      post.replies = transformThreadReplies(reply.replies, currentDepth + 1, maxDepth)
      return post
    })
}

// Cache TTL for tag queries (5 minutes)
const TAG_CACHE_TTL = 5 * 60

// Get posts by tag
app.get('/xrpc/app.greengale.feed.getPostsByTag', async (c) => {
  const tag = c.req.query('tag')
  if (!tag) {
    return c.json({ error: 'Missing tag parameter' }, 400)
  }

  const normalizedTag = tag.toLowerCase().trim()
  if (normalizedTag.length === 0) {
    return c.json({ error: 'Invalid tag parameter' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')

  const cacheKey = `tag_posts:${normalizedTag}:${limit}:${cursor || ''}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    let query = `
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at,
        a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
        pub.icon_cid,
        (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags
      FROM posts p
      INNER JOIN post_tags pt ON p.uri = pt.post_uri
      LEFT JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE pt.tag = ?
        AND p.visibility = 'public'
        AND p.uri NOT LIKE '%/site.standard.document/%'
        AND COALESCE(pub.show_in_discover, 1) = 1
    `

    const params: (string | number)[] = [normalizedTag]

    if (cursor) {
      query += ` AND p.created_at < ?`
      params.push(cursor)
    }

    query += ` ORDER BY p.created_at DESC LIMIT ?`
    params.push(limit + 1)

    const result = await c.env.DB.prepare(query).bind(...params).all()
    const posts = result.results || []

    const hasMore = posts.length > limit
    const returnPosts = hasMore ? posts.slice(0, limit) : posts

    const response = {
      tag: normalizedTag,
      posts: returnPosts.map(p => formatPost(p)),
      cursor: hasMore ? returnPosts[returnPosts.length - 1].created_at : undefined,
    }

    // Cache for 5 minutes
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: TAG_CACHE_TTL,
    })

    return c.json(response)
  } catch (error) {
    console.error('Error fetching posts by tag:', error)
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// Get popular tags with post counts
app.get('/xrpc/app.greengale.feed.getPopularTags', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)

  const cacheKey = `popular_tags:${limit}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    // Aggregate post counts per tag
    // Only count public posts that are visible in discover
    const result = await c.env.DB.prepare(`
      SELECT pt.tag, COUNT(*) as count
      FROM post_tags pt
      INNER JOIN posts p ON pt.post_uri = p.uri
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.visibility = 'public'
        AND p.uri NOT LIKE '%/site.standard.document/%'
        AND COALESCE(pub.show_in_discover, 1) = 1
      GROUP BY pt.tag
      ORDER BY count DESC
      LIMIT ?
    `).bind(limit).all()

    const tags = (result.results || []).map((row) => ({
      tag: row.tag as string,
      count: row.count as number,
    }))

    const response = { tags }

    // Cache for 30 minutes
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: 30 * 60,
    })

    return c.json(response)
  } catch (error) {
    console.error('Error fetching popular tags:', error)
    return c.json({ error: 'Failed to fetch tags' }, 500)
  }
})

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
      return jsonWithCache(c, cached, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
    }

    // Cache miss - query database
    // Use a CTE with window function to limit each author to 3 posts max
    // This prevents very active users from dominating the recents feed
    // Order by created_at (original publish date) so editing old posts doesn't push them to top
    const cursorClause = cursor ? 'AND p.created_at < ?' : ''
    const query = `
      WITH ranked_posts AS (
        SELECT
          p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
          p.visibility, p.created_at, p.indexed_at,
          a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
          pub.icon_cid,
          (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags,
          ROW_NUMBER() OVER (PARTITION BY p.author_did ORDER BY p.created_at DESC) as author_rank
        FROM posts p
        LEFT JOIN authors a ON p.author_did = a.did
        LEFT JOIN publications pub ON p.author_did = pub.author_did
        WHERE p.visibility = 'public'
          AND p.uri NOT LIKE '%/site.standard.document/%'
          AND COALESCE(pub.show_in_discover, 1) = 1
          ${cursorClause}
      )
      SELECT uri, author_did, rkey, title, subtitle, source,
             visibility, created_at, indexed_at,
             handle, display_name, avatar_url, pds_endpoint, icon_cid, tags
      FROM ranked_posts
      WHERE author_rank <= 3
      ORDER BY created_at DESC
      LIMIT ?
    `

    const params: (string | number)[] = []
    if (cursor) {
      params.push(cursor)
    }
    params.push(limit + 1)

    const result = await c.env.DB.prepare(query).bind(...params).all()
    const posts = result.results || []

    const hasMore = posts.length > limit
    const returnPosts = hasMore ? posts.slice(0, limit) : posts

    const response = {
      posts: returnPosts.map(p => formatPost(p)),
      cursor: hasMore ? returnPosts[returnPosts.length - 1].created_at : undefined,
    }

    // Store in cache with TTL
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: RECENT_POSTS_CACHE_TTL,
    })

    return jsonWithCache(c, response, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
  } catch (error) {
    console.error('Error fetching recent posts:', error)
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// Cache TTL for following DIDs (1 hour)
const FOLLOWING_DIDS_CACHE_TTL = 60 * 60

// Cache TTL for following feed results (5 minutes)
const FOLLOWING_FEED_CACHE_TTL = 5 * 60

// Maximum follows to paginate through (5000 = 50 API calls max)
const MAX_FOLLOWS_TO_FETCH = 5000

/**
 * Fetch all accounts a user follows from Bluesky API.
 * Paginates through all follows up to MAX_FOLLOWS_TO_FETCH.
 * Returns array of DIDs.
 */
async function fetchBlueskyFollows(did: string): Promise<string[]> {
  const follows: string[] = []
  let cursor: string | undefined

  while (follows.length < MAX_FOLLOWS_TO_FETCH) {
    const url = new URL(`${BLUESKY_API}/xrpc/app.bsky.graph.getFollows`)
    url.searchParams.set('actor', did)
    url.searchParams.set('limit', '100')
    if (cursor) {
      url.searchParams.set('cursor', cursor)
    }

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'GreenGale/1.0',
        },
      })

      if (!response.ok) {
        console.error(`Bluesky getFollows failed: ${response.status}`)
        break
      }

      const data = await response.json() as {
        follows: Array<{ did: string }>
        cursor?: string
      }

      for (const follow of data.follows) {
        follows.push(follow.did)
      }

      if (!data.cursor || data.follows.length === 0) {
        break
      }

      cursor = data.cursor
    } catch (err) {
      console.error('Error fetching Bluesky follows:', err)
      break
    }
  }

  return follows
}

/**
 * Get following DIDs that have blog posts, with caching.
 * Fetches following list from Bluesky, then filters to only include
 * DIDs that exist in our authors table.
 */
async function getFollowingDidsWithPosts(
  viewerDid: string,
  env: { DB: D1Database; CACHE: KVNamespace }
): Promise<string[]> {
  const cacheKey = `following:dids:${viewerDid}`

  // Check cache first
  const cached = await env.CACHE.get(cacheKey, 'json')
  if (cached) {
    return cached as string[]
  }

  // Fetch all follows from Bluesky
  const allFollows = await fetchBlueskyFollows(viewerDid)

  if (allFollows.length === 0) {
    // Cache empty result for shorter time (10 min)
    await env.CACHE.put(cacheKey, JSON.stringify([]), {
      expirationTtl: 10 * 60,
    })
    return []
  }

  // Filter to only DIDs that exist in our authors table (have posts)
  // Use batches to avoid query limits
  const batchSize = 100
  const didsWithPosts: string[] = []

  for (let i = 0; i < allFollows.length; i += batchSize) {
    const batch = allFollows.slice(i, i + batchSize)
    const placeholders = batch.map(() => '?').join(',')

    const result = await env.DB.prepare(`
      SELECT did FROM authors WHERE did IN (${placeholders})
    `).bind(...batch).all()

    for (const row of result.results || []) {
      didsWithPosts.push(row.did as string)
    }
  }

  // Cache for 1 hour
  await env.CACHE.put(cacheKey, JSON.stringify(didsWithPosts), {
    expirationTtl: FOLLOWING_DIDS_CACHE_TTL,
  })

  return didsWithPosts
}

// Get posts from accounts the viewer follows
app.get('/xrpc/app.greengale.feed.getFollowingPosts', async (c) => {
  const viewer = c.req.query('viewer')
  if (!viewer) {
    return c.json({ error: 'Missing viewer parameter' }, 400)
  }

  // Validate viewer is a DID
  if (!viewer.startsWith('did:')) {
    return c.json({ error: 'Invalid viewer parameter - must be a DID' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')

  // Build cache key for feed results
  const feedCacheKey = `following:feed:${viewer}:${limit}:${cursor || ''}`

  try {
    // Check feed cache first
    const cached = await c.env.CACHE.get(feedCacheKey, 'json')
    if (cached) {
      return jsonWithCache(c, cached, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
    }

    // Get following DIDs with posts (cached)
    const followingDids = await getFollowingDidsWithPosts(viewer, c.env)

    if (followingDids.length === 0) {
      const emptyResponse = { posts: [], cursor: undefined }
      return jsonWithCache(c, emptyResponse, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
    }

    // Build SQL query with dynamic IN clause
    const placeholders = followingDids.map(() => '?').join(',')
    // Order by created_at (original publish date) so editing old posts doesn't push them to top
    const cursorClause = cursor ? 'AND p.created_at < ?' : ''

    // Use CTE with window function to limit 3 posts per author
    const query = `
      WITH ranked_posts AS (
        SELECT
          p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
          p.visibility, p.created_at, p.indexed_at, p.external_url,
          p.content_preview,
          a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
          pub.icon_cid,
          (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags,
          ROW_NUMBER() OVER (PARTITION BY p.author_did ORDER BY p.created_at DESC) as author_rank
        FROM posts p
        LEFT JOIN authors a ON p.author_did = a.did
        LEFT JOIN publications pub ON p.author_did = pub.author_did
        WHERE p.author_did IN (${placeholders})
          AND p.visibility = 'public'
          AND NOT (
            p.uri LIKE '%/site.standard.document/%'
            AND (
              p.external_url IS NULL
              OR EXISTS (
                SELECT 1 FROM posts gg
                WHERE gg.author_did = p.author_did
                  AND gg.rkey = p.rkey
                  AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                    OR gg.uri LIKE '%/app.greengale.document/%'
                    OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
              )
            )
          )
          ${cursorClause}
      )
      SELECT uri, author_did, rkey, title, subtitle, source,
             visibility, created_at, indexed_at, external_url,
             content_preview,
             handle, display_name, avatar_url, pds_endpoint, icon_cid, tags
      FROM ranked_posts
      WHERE author_rank <= 3
      ORDER BY created_at DESC
      LIMIT ?
    `

    const params: (string | number)[] = [...followingDids]
    if (cursor) {
      params.push(cursor)
    }
    params.push(limit + 1)

    const result = await c.env.DB.prepare(query).bind(...params).all()
    const posts = result.results || []

    const hasMore = posts.length > limit
    const returnPosts = hasMore ? posts.slice(0, limit) : posts

    const response = {
      posts: returnPosts.map(p => {
        const formatted = formatPost(p)
        // Override source to 'network' for external site.standard posts
        if (formatted.externalUrl) {
          formatted.source = 'network'
        }
        return formatted
      }),
      cursor: hasMore ? returnPosts[returnPosts.length - 1].created_at : undefined,
    }

    // Cache feed results for 5 minutes
    await c.env.CACHE.put(feedCacheKey, JSON.stringify(response), {
      expirationTtl: FOLLOWING_FEED_CACHE_TTL,
    })

    return jsonWithCache(c, response, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
  } catch (error) {
    console.error('Error fetching following posts:', error)
    return c.json({ error: 'Failed to fetch posts' }, 500)
  }
})

// Get recent posts from the network (site.standard.document posts with external URLs)
app.get('/xrpc/app.greengale.feed.getNetworkPosts', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const cursor = c.req.query('cursor')

  // Build cache key (v3: fixes avatar field name)
  const cacheKey = `network_posts:v3:${limit}:${cursor || ''}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return jsonWithCache(c, cached, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
    }

    // Cache miss - query database
    // Use external_url column (pre-computed during indexing)
    // Exclude posts that also have a GreenGale version (dual-published from GreenGale)
    // Filter out posts with invalid/missing dates (must start with valid year like 19xx or 20xx)
    let query = `
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at, p.external_url,
        p.content_preview,
        a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
        pub.icon_cid,
        (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.visibility = 'public'
        AND p.uri LIKE '%/site.standard.document/%'
        AND p.external_url IS NOT NULL
        AND p.created_at IS NOT NULL
        AND p.created_at GLOB '[12][0-9][0-9][0-9]-*'
        AND COALESCE(pub.show_in_discover, 1) = 1
        AND NOT EXISTS (
          SELECT 1 FROM posts gg
          WHERE gg.author_did = p.author_did
            AND gg.rkey = p.rkey
            AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
              OR gg.uri LIKE '%/app.greengale.document/%')
        )
    `

    const params: (string | number)[] = []

    if (cursor) {
      query += ` AND p.created_at < ?`
      params.push(cursor)
    }

    query += ` ORDER BY p.created_at DESC LIMIT ?`
    params.push(limit + 1)

    const result = await c.env.DB.prepare(query).bind(...params).all()
    const posts = result.results || []

    const hasMore = posts.length > limit
    const returnPosts = hasMore ? posts.slice(0, limit) : posts

    // Format posts
    const formattedPosts = returnPosts.map((row) => ({
      uri: row.uri,
      author: {
        did: row.author_did,
        handle: row.handle || '',
        displayName: row.display_name || null,
        avatar: resolveAvatar(row as Record<string, unknown>),
      },
      rkey: row.rkey,
      title: row.title || null,
      subtitle: row.subtitle || null,
      source: 'network',
      visibility: row.visibility,
      createdAt: row.created_at,
      indexedAt: row.indexed_at,
      externalUrl: row.external_url,
      contentPreview: row.content_preview || null,
    }))

    const response = {
      posts: formattedPosts,
      cursor: hasMore ? (returnPosts[returnPosts.length - 1] as Record<string, unknown>).created_at : undefined,
    }

    // Store in cache with TTL
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: RECENT_POSTS_CACHE_TTL,
    })

    return jsonWithCache(c, response, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
  } catch (error) {
    console.error('Error fetching network posts:', error)
    return c.json({ error: 'Failed to fetch network posts' }, 500)
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
        // Author not in DB - try to discover and index them
        const discovered = await discoverAndIndexAuthor(author, c.env)
        if (!discovered) {
          return c.json({ posts: [], cursor: undefined })
        }
        authorDid = discovered.did
      } else {
        authorDid = authorRow.did as string
      }
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
        p.content_preview, p.first_image_cid, p.external_url,
        a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
        pub.icon_cid,
        (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.author_did = ? AND ${visibilityFilter}
        AND NOT (
          p.uri LIKE '%/site.standard.document/%'
          AND (
            p.external_url IS NULL
            OR EXISTS (
              SELECT 1 FROM posts gg
              WHERE gg.author_did = p.author_did
                AND gg.rkey = p.rkey
                AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                  OR gg.uri LIKE '%/app.greengale.document/%'
                  OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
            )
          )
        )
    `

    const params: (string | number)[] = [authorDid]

    if (cursor) {
      query += ` AND p.created_at < ?`
      params.push(cursor)
    }

    query += ` ORDER BY p.created_at DESC LIMIT ?`
    params.push(limit + 1)

    let result = await c.env.DB.prepare(query).bind(...params).all()
    let posts = result.results || []

    // On first page load, try indexing any missing posts from PDS
    // (KV cache makes this a single fast GET for already-indexed authors)
    if (!cursor) {
      const indexed = await indexPostsFromPds(authorDid, c.env)
      if (indexed > 0) {
        // Re-query now that posts are indexed
        result = await c.env.DB.prepare(query).bind(...params).all()
        posts = result.results || []
      }
    }

    const hasMore = posts.length > limit
    const returnPosts = hasMore ? posts.slice(0, limit) : posts

    const response = {
      posts: returnPosts.map(p => formatPost(p)),
      cursor: hasMore ? returnPosts[returnPosts.length - 1].created_at : undefined,
    }

    // Only cache for public views (not when author is viewing their own profile)
    if (!isOwnProfile) {
      return jsonWithCache(c, response, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
    }
    return c.json(response)
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

    // Exclude dual-published site.standard.document posts (where a GreenGale/WhiteWind
    // version exists), but allow external-only site.standard posts (e.g. Leaflet)
    const post = await c.env.DB.prepare(`
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
        p.visibility, p.created_at, p.indexed_at, p.external_url,
        a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
        pub.icon_cid
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.author_did = ? AND p.rkey = ?
        AND NOT (
          p.uri LIKE '%/site.standard.document/%'
          AND (
            p.external_url IS NULL
            OR EXISTS (
              SELECT 1 FROM posts gg
              WHERE gg.author_did = p.author_did
                AND gg.rkey = p.rkey
                AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                  OR gg.uri LIKE '%/app.greengale.document/%'
                  OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
            )
          )
        )
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

    // Fetch tags for this post
    const tagsResult = await c.env.DB.prepare(
      'SELECT tag FROM post_tags WHERE post_uri = ? ORDER BY tag'
    ).bind(post.uri).all()
    const tags = (tagsResult.results || []).map(r => r.tag as string)

    const response = { post: formatPost(post, tags) }

    // Only cache for public views (not when author is viewing their own post)
    if (!isAuthor) {
      return jsonWithCache(c, response, FEED_CACHE_MAX_AGE, FEED_CACHE_SWR)
    }
    return c.json(response)
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
    // Fetch author with LEFT JOIN to publications
    const query = author.startsWith('did:')
      ? `SELECT a.*, a.did as author_did, p.name as pub_name, p.description as pub_description, p.theme_preset as pub_theme, p.url as pub_url, p.icon_cid
         FROM authors a
         LEFT JOIN publications p ON a.did = p.author_did
         WHERE a.did = ?`
      : `SELECT a.*, a.did as author_did, p.name as pub_name, p.description as pub_description, p.theme_preset as pub_theme, p.url as pub_url, p.icon_cid
         FROM authors a
         LEFT JOIN publications p ON a.did = p.author_did
         WHERE a.handle = ?`

    const authorRow = await c.env.DB.prepare(query).bind(author).first()

    if (!authorRow) {
      // Author not in DB - try to discover and index them
      const discovered = await discoverAndIndexAuthor(author, c.env)
      if (!discovered) {
        return c.json({ error: 'Author not found' }, 404)
      }
      const response = {
        did: discovered.did,
        handle: discovered.handle,
        displayName: discovered.displayName,
        avatar: discovered.avatar,
        description: discovered.description,
        postsCount: discovered.postsCount,
        publication: undefined,
      }
      return jsonWithCache(c, response, PROFILE_CACHE_MAX_AGE, PROFILE_CACHE_SWR)
    }

    // Build publication object if it exists
    let publicationTheme: string | undefined = undefined
    if (authorRow.pub_theme) {
      // Check if it's JSON (custom colors) or a preset name
      try {
        const parsed = JSON.parse(authorRow.pub_theme as string)
        // It's custom colors - stringify back for frontend
        publicationTheme = JSON.stringify({ custom: parsed })
      } catch {
        // It's a preset name
        publicationTheme = authorRow.pub_theme as string
      }
    }

    const publication = authorRow.pub_name ? {
      name: authorRow.pub_name,
      description: authorRow.pub_description || undefined,
      theme: publicationTheme,
      url: authorRow.pub_url,
    } : undefined

    const response = {
      did: authorRow.did,
      handle: authorRow.handle,
      displayName: authorRow.display_name,
      avatar: resolveAvatar(authorRow as Record<string, unknown>),
      description: authorRow.description,
      postsCount: authorRow.posts_count || 0,
      publication,
    }

    return jsonWithCache(c, response, PROFILE_CACHE_MAX_AGE, PROFILE_CACHE_SWR)
  } catch (error) {
    console.error('Error fetching author:', error)
    return c.json({ error: 'Failed to fetch author' }, 500)
  }
})

// Cache TTL for search results (60 seconds)
const SEARCH_CACHE_TTL = 60

// Search publications by handle, display name, publication name, URL, or post title
app.get('/xrpc/app.greengale.search.publications', async (c) => {
  const query = c.req.query('q')
  if (!query || query.trim().length === 0) {
    return c.json({ error: 'Missing or empty q parameter' }, 400)
  }

  const searchTerm = query.trim().toLowerCase()

  // Require minimum 2 characters to prevent expensive single-char searches
  if (searchTerm.length < 2) {
    return c.json({ error: 'Query must be at least 2 characters', results: [] }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 25)
  const cacheKey = `search:${searchTerm}:${limit}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    const escapedTerm = escapeLikePattern(searchTerm)
    const prefixPattern = `${escapedTerm}%`
    const containsPattern = `%${escapedTerm}%`

    // Search with priority ranking using UNION:
    // 1. Exact handle match
    // 2. Handle prefix match
    // 3. Display name contains
    // 4. Publication name contains
    // 5. Publication URL contains
    // 6. Post title contains
    // 7. Post tag matches
    const result = await c.env.DB.prepare(`
      SELECT * FROM (
        -- Part 1: Author/publication matches
        SELECT DISTINCT
          a.did,
          a.handle,
          a.display_name,
          a.avatar_url,
          a.pds_endpoint,
          p.icon_cid,
          p.name as pub_name,
          p.url as pub_url,
          NULL as post_rkey,
          NULL as post_title,
          NULL as matched_tag,
          CASE
            WHEN LOWER(a.handle) = ?1 THEN 1
            WHEN LOWER(a.handle) LIKE ?2 ESCAPE '\\' THEN 2
            WHEN LOWER(a.display_name) LIKE ?3 ESCAPE '\\' THEN 3
            WHEN LOWER(p.name) LIKE ?3 ESCAPE '\\' THEN 4
            WHEN LOWER(p.url) LIKE ?3 ESCAPE '\\' THEN 5
          END as match_priority,
          CASE
            WHEN LOWER(a.handle) = ?1 THEN 'handle'
            WHEN LOWER(a.handle) LIKE ?2 ESCAPE '\\' THEN 'handle'
            WHEN LOWER(a.display_name) LIKE ?3 ESCAPE '\\' THEN 'displayName'
            WHEN LOWER(p.name) LIKE ?3 ESCAPE '\\' THEN 'publicationName'
            WHEN LOWER(p.url) LIKE ?3 ESCAPE '\\' THEN 'publicationUrl'
          END as match_type,
          a.posts_count
        FROM authors a
        LEFT JOIN publications p ON a.did = p.author_did
        WHERE
          LOWER(a.handle) = ?1
          OR LOWER(a.handle) LIKE ?2 ESCAPE '\\'
          OR LOWER(a.display_name) LIKE ?3 ESCAPE '\\'
          OR LOWER(p.name) LIKE ?3 ESCAPE '\\'
          OR LOWER(p.url) LIKE ?3 ESCAPE '\\'

        UNION ALL

        -- Part 2: Post title matches (deduplicated by author_did + rkey)
        -- When both app.greengale.document and site.standard.document exist for the same post,
        -- we pick just one using GROUP BY. MIN(uri) prefers 'app.greengale' over 'site.standard' alphabetically.
        SELECT
          a.did,
          a.handle,
          a.display_name,
          a.avatar_url,
          a.pds_endpoint,
          pub2.icon_cid,
          NULL as pub_name,
          NULL as pub_url,
          posts.rkey as post_rkey,
          posts.title as post_title,
          NULL as matched_tag,
          6 as match_priority,
          'postTitle' as match_type,
          a.posts_count
        FROM (
          SELECT author_did, rkey, MIN(uri) as uri, title
          FROM posts
          WHERE visibility = 'public'
            AND LOWER(title) LIKE ?3 ESCAPE '\\'
          GROUP BY author_did, rkey
        ) posts
        JOIN authors a ON posts.author_did = a.did
        LEFT JOIN publications pub2 ON a.did = pub2.author_did

        UNION ALL

        -- Part 3: Tag matches - find posts with matching tags
        SELECT
          a.did,
          a.handle,
          a.display_name,
          a.avatar_url,
          a.pds_endpoint,
          pub3.icon_cid,
          NULL as pub_name,
          NULL as pub_url,
          tagged_posts.rkey as post_rkey,
          tagged_posts.title as post_title,
          tagged_posts.tag as matched_tag,
          7 as match_priority,
          'tag' as match_type,
          a.posts_count
        FROM (
          SELECT p.author_did, p.rkey, MIN(p.uri) as uri, p.title, pt.tag
          FROM posts p
          JOIN post_tags pt ON p.uri = pt.post_uri
          WHERE p.visibility = 'public'
            AND p.uri NOT LIKE '%/site.standard.document/%'
            AND LOWER(pt.tag) LIKE ?3 ESCAPE '\\'
          GROUP BY p.author_did, p.rkey, pt.tag
        ) tagged_posts
        JOIN authors a ON tagged_posts.author_did = a.did
        LEFT JOIN publications pub3 ON a.did = pub3.author_did
      )
      ORDER BY match_priority ASC, posts_count DESC
      LIMIT ?4
    `).bind(
      searchTerm,      // ?1 - exact match
      prefixPattern,   // ?2 - prefix pattern
      containsPattern, // ?3 - contains pattern
      limit            // ?4 - limit
    ).all()

    type SearchResultRow = {
      did: string
      handle: string
      display_name: string | null
      avatar_url: string | null
      pds_endpoint: string | null
      icon_cid: string | null
      pub_name: string | null
      pub_url: string | null
      post_rkey: string | null
      post_title: string | null
      matched_tag: string | null
      match_type: string
    }

    // Helper to determine if a publication URL is external (not GreenGale)
    const isExternalPublication = (url: string | null): boolean => {
      if (!url) return false
      try {
        const hostname = new URL(url).hostname.toLowerCase()
        // GreenGale URLs are not external
        return !hostname.includes('greengale')
      } catch {
        return false
      }
    }

    const results = (result.results as SearchResultRow[] || []).map((row) => ({
      did: row.did,
      handle: row.handle,
      displayName: row.display_name || null,
      avatarUrl: resolveAvatar({ ...row, author_did: row.did }),
      publication: row.pub_name ? {
        name: row.pub_name,
        url: row.pub_url || null,
        isExternal: isExternalPublication(row.pub_url),
      } : null,
      matchType: row.match_type as 'handle' | 'displayName' | 'publicationName' | 'publicationUrl' | 'postTitle' | 'tag',
      post: row.post_rkey ? {
        rkey: row.post_rkey,
        title: row.post_title || '',
      } : undefined,
      tag: row.matched_tag || undefined,
    }))

    const response = { results }

    // Cache the response
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
      expirationTtl: SEARCH_CACHE_TTL,
    })

    return c.json(response)
  } catch (error) {
    console.error('Error searching publications:', error)
    return c.json({ error: 'Failed to search publications' }, 500)
  }
})

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Semantic search for posts
 * Supports keyword, semantic, or hybrid (default) search modes
 */
app.get('/xrpc/app.greengale.search.posts', async (c) => {
  const query = c.req.query('q')
  if (!query || query.trim().length === 0) {
    return c.json({ error: 'Missing or empty q parameter' }, 400)
  }

  const searchTerm = query.trim()
  if (searchTerm.length < 2) {
    return c.json({ error: 'Query must be at least 2 characters' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50)
  const mode = (c.req.query('mode') || 'hybrid') as 'keyword' | 'semantic' | 'hybrid'

  // Filter parameters
  const authorFilter = c.req.query('author')?.trim() || undefined
  const afterFilter = c.req.query('after')?.trim() || undefined
  const beforeFilter = c.req.query('before')?.trim() || undefined

  // Field filter: comma-separated list of fields to search
  // Valid fields: handle, name, pub, content
  // 'content' searches title, subtitle, content_preview, and tags
  // If omitted or empty, search all fields
  const fieldsParam = c.req.query('fields')?.trim() || undefined
  const validFields = ['handle', 'name', 'pub', 'content']
  const fields = fieldsParam
    ? fieldsParam.split(',').filter(f => validFields.includes(f))
    : undefined

  // AI agent filter: 'and' (only agents), 'not' (exclude agents), or omitted (no filter)
  const aiAgentFilter = c.req.query('aiAgent')?.trim() || undefined

  // Determine if we should run semantic search
  // Semantic search only works on content fields
  const hasContentFields = !fields || fields.includes('content')

  // Cache key includes mode and filters
  const fieldsKey = fields ? fields.sort().join(',') : ''
  const cacheKey = `search_posts:${searchTerm.toLowerCase()}:${limit}:${mode}:${authorFilter || ''}:${afterFilter || ''}:${beforeFilter || ''}:${fieldsKey}:${aiAgentFilter || ''}`

  try {
    // Check cache first
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    const results: Array<{
      uri: string
      authorDid: string
      handle: string
      displayName: string | null
      avatarUrl: string | null
      rkey: string
      title: string
      subtitle: string | null
      createdAt: string | null
      contentPreview: string | null
      score: number
      matchType: 'semantic' | 'keyword' | 'both'
      source: 'whitewind' | 'greengale' | 'network'
      externalUrl: string | null
    }> = []

    const semanticResults: Array<{ id: string; score: number }> = []
    const keywordResults: Array<{ id: string; score: number }> = []
    let semanticFailed = false

    // Semantic search
    // Only run semantic search if content fields are being searched
    if ((mode === 'semantic' || mode === 'hybrid') && hasContentFields) {
      try {
        const queryEmbedding = await generateEmbedding(c.env.AI, searchTerm)
        // Vectorize has a topK limit of 50
        const topK = Math.min(limit * 2, 50)
        const vectorResults = await querySimilar(c.env.VECTORIZE, queryEmbedding, {
          topK,
        })

        for (const match of vectorResults) {
          // Get URI from metadata (IDs are hashed for Vectorize's 64-byte limit)
          const uri = match.metadata.uri as string
          if (!uri) continue

          // Deduplicate by URI (multiple chunks may match for the same post)
          if (!semanticResults.some(r => r.id === uri)) {
            semanticResults.push({ id: uri, score: match.score })
          }
        }
      } catch (error) {
        console.error('Semantic search failed:', error)
        semanticFailed = true
        // Fall back to keyword search if semantic-only mode
      }
    }

    // Keyword search (also runs as fallback if semantic-only mode failed)
    // Also runs when semantic mode is selected but no content fields are in the filter
    const shouldRunKeyword = mode === 'keyword' || mode === 'hybrid' ||
      (mode === 'semantic' && (semanticFailed || !hasContentFields))

    if (shouldRunKeyword) {
      const escapedTerm = escapeLikePattern(searchTerm.toLowerCase())
      const containsPattern = `%${escapedTerm}%`

      // Determine which fields to search
      // If no fields specified, search all
      const searchHandle = !fields || fields.includes('handle')
      const searchName = !fields || fields.includes('name')
      const searchPub = !fields || fields.includes('pub')
      const searchContent = !fields || fields.includes('content')

      // Build score CASE expression based on selected fields
      const scoreCases: string[] = []
      const scoreBindings: string[] = []

      // Content field searches title, subtitle, content_preview, and tags
      if (searchContent) {
        scoreCases.push("WHEN LOWER(p.title) LIKE ? ESCAPE '\\' THEN 1.0")
        scoreBindings.push(containsPattern)
        scoreCases.push("WHEN LOWER(p.subtitle) LIKE ? ESCAPE '\\' THEN 0.9")
        scoreBindings.push(containsPattern)
        scoreCases.push("WHEN EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_uri = p.uri AND LOWER(pt.tag) LIKE ? ESCAPE '\\') THEN 0.85")
        scoreBindings.push(containsPattern)
        scoreCases.push("WHEN LOWER(p.content_preview) LIKE ? ESCAPE '\\' THEN 0.8")
        scoreBindings.push(containsPattern)
      }
      if (searchHandle) {
        scoreCases.push("WHEN LOWER(a.handle) LIKE ? ESCAPE '\\' THEN 0.7")
        scoreBindings.push(containsPattern)
      }
      if (searchName) {
        scoreCases.push("WHEN LOWER(a.display_name) LIKE ? ESCAPE '\\' THEN 0.7")
        scoreBindings.push(containsPattern)
      }
      if (searchPub) {
        scoreCases.push("WHEN LOWER(pub.name) LIKE ? ESCAPE '\\' THEN 0.6")
        scoreBindings.push(containsPattern)
        scoreCases.push("WHEN LOWER(pub.url) LIKE ? ESCAPE '\\' THEN 0.5")
        scoreBindings.push(containsPattern)
      }

      // Build WHERE conditions based on selected fields
      const whereConditions: string[] = []
      const whereBindings: string[] = []

      // Content field searches title, subtitle, content_preview, and tags
      if (searchContent) {
        whereConditions.push("LOWER(p.title) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
        whereConditions.push("LOWER(p.subtitle) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
        whereConditions.push("LOWER(p.content_preview) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
        whereConditions.push("EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_uri = p.uri AND LOWER(pt.tag) LIKE ? ESCAPE '\\')")
        whereBindings.push(containsPattern)
      }
      if (searchHandle) {
        whereConditions.push("LOWER(a.handle) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
      }
      if (searchName) {
        whereConditions.push("LOWER(a.display_name) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
      }
      if (searchPub) {
        whereConditions.push("LOWER(pub.name) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
        whereConditions.push("LOWER(pub.url) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
      }

      // Need at least one condition
      if (whereConditions.length === 0) {
        // Shouldn't happen, but fallback to searching everything
        whereConditions.push("LOWER(p.title) LIKE ? ESCAPE '\\'")
        whereBindings.push(containsPattern)
      }

      // Build dynamic query with filters
      const scoreExpr = scoreCases.length > 0
        ? `CASE ${scoreCases.join(' ')} ELSE 0.5 END`
        : '0.5'

      let keywordSql = `
        SELECT DISTINCT
          p.uri,
          p.title,
          ${scoreExpr} as score
        FROM posts p
        JOIN authors a ON p.author_did = a.did
        LEFT JOIN publications pub ON p.author_did = pub.author_did
        WHERE p.visibility = 'public'
          AND p.deleted_at IS NULL
          AND (${whereConditions.join(' OR ')})
          -- Exclude site.standard duplicates when a GreenGale/WhiteWind version exists
          AND NOT (
            p.uri LIKE '%/site.standard.document/%'
            AND EXISTS (
              SELECT 1 FROM posts gg
              WHERE gg.author_did = p.author_did
                AND gg.rkey = p.rkey
                AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                  OR gg.uri LIKE '%/app.greengale.document/%'
                  OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
            )
          )`

      const keywordBindings: (string | number)[] = [...scoreBindings, ...whereBindings]

      // Author filter (handle or DID)
      if (authorFilter) {
        if (authorFilter.startsWith('did:')) {
          keywordSql += ` AND p.author_did = ?`
          keywordBindings.push(authorFilter)
        } else {
          keywordSql += ` AND a.handle = ?`
          keywordBindings.push(authorFilter.replace(/^@/, ''))
        }
      }

      // Date filters
      if (afterFilter) {
        keywordSql += ` AND p.created_at >= ?`
        keywordBindings.push(afterFilter)
      }
      if (beforeFilter) {
        keywordSql += ` AND p.created_at <= ?`
        keywordBindings.push(beforeFilter)
      }

      // AI agent filter
      if (aiAgentFilter === 'and') {
        keywordSql += ` AND a.is_ai_agent = 1`
      } else if (aiAgentFilter === 'not') {
        keywordSql += ` AND (a.is_ai_agent IS NULL OR a.is_ai_agent = 0)`
      }

      keywordSql += ` ORDER BY score DESC LIMIT ?`
      keywordBindings.push(500) // Fixed limit to allow more results for author/handle matches

      const keywordQuery = await c.env.DB.prepare(keywordSql).bind(...keywordBindings).all()

      for (const row of keywordQuery.results || []) {
        keywordResults.push({
          id: row.uri as string,
          score: row.score as number,
        })
      }
    }

    // Combine results based on mode
    let finalIds: string[] = []

    if (mode === 'hybrid' && semanticResults.length > 0 && keywordResults.length > 0) {
      // Reciprocal Rank Fusion for hybrid
      const fused = reciprocalRankFusion([semanticResults, keywordResults])
      finalIds = fused.slice(0, limit).map(r => r.id)
    } else if (mode === 'semantic' || (mode === 'hybrid' && semanticResults.length > 0)) {
      finalIds = semanticResults.slice(0, limit).map(r => r.id)
    } else {
      finalIds = keywordResults.slice(0, limit).map(r => r.id)
    }

    if (finalIds.length === 0) {
      const response = {
        posts: [],
        query: searchTerm,
        mode,
        ...((semanticFailed || !hasContentFields) && mode === 'semantic' && { fallback: 'keyword' }),
      }
      await c.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 300 })
      return c.json(response)
    }

    // Fetch post details from D1 with filters
    const placeholders = finalIds.map(() => '?').join(',')

    let postsSql = `
      SELECT
        p.uri,
        p.author_did,
        p.rkey,
        p.title,
        p.subtitle,
        p.created_at,
        p.content_preview,
        p.source,
        p.external_url,
        a.handle,
        a.display_name,
        a.avatar_url,
        a.pds_endpoint,
        pub.icon_cid
      FROM posts p
      JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.uri IN (${placeholders})
        AND p.visibility = 'public'
        AND p.deleted_at IS NULL
        -- Exclude site.standard duplicates when a GreenGale/WhiteWind version exists
        AND NOT (
          p.uri LIKE '%/site.standard.document/%'
          AND EXISTS (
            SELECT 1 FROM posts gg
            WHERE gg.author_did = p.author_did
              AND gg.rkey = p.rkey
              AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                OR gg.uri LIKE '%/app.greengale.document/%'
                OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
          )
        )`

    const postsBindings: (string | number)[] = [...finalIds]

    // Author filter (handle or DID)
    if (authorFilter) {
      if (authorFilter.startsWith('did:')) {
        postsSql += ` AND p.author_did = ?`
        postsBindings.push(authorFilter)
      } else {
        postsSql += ` AND a.handle = ?`
        postsBindings.push(authorFilter.replace(/^@/, ''))
      }
    }

    // Date filters
    if (afterFilter) {
      postsSql += ` AND p.created_at >= ?`
      postsBindings.push(afterFilter)
    }
    if (beforeFilter) {
      postsSql += ` AND p.created_at <= ?`
      postsBindings.push(beforeFilter)
    }

    // AI agent filter
    if (aiAgentFilter === 'and') {
      postsSql += ` AND a.is_ai_agent = 1`
    } else if (aiAgentFilter === 'not') {
      postsSql += ` AND (a.is_ai_agent IS NULL OR a.is_ai_agent = 0)`
    }

    const postsResult = await c.env.DB.prepare(postsSql).bind(...postsBindings).all()

    // Build result map for ordering
    const postMap = new Map<string, typeof results[0]>()
    for (const row of postsResult.results || []) {
      const uri = row.uri as string
      const inSemantic = semanticResults.some(r => r.id === uri)
      const inKeyword = keywordResults.some(r => r.id === uri)

      postMap.set(uri, {
        uri,
        authorDid: row.author_did as string,
        handle: row.handle as string,
        displayName: row.display_name as string | null,
        avatarUrl: resolveAvatar(row as Record<string, unknown>),
        rkey: row.rkey as string,
        title: row.title as string,
        subtitle: row.subtitle as string | null,
        createdAt: row.created_at as string | null,
        contentPreview: row.content_preview as string | null,
        score: semanticResults.find(r => r.id === uri)?.score ||
               keywordResults.find(r => r.id === uri)?.score || 0,
        matchType: inSemantic && inKeyword ? 'both' : inSemantic ? 'semantic' : 'keyword',
        source: (row.source as 'whitewind' | 'greengale' | 'network') || 'greengale',
        externalUrl: row.external_url as string | null,
      })
    }

    // Order by finalIds
    for (const id of finalIds) {
      const post = postMap.get(id)
      if (post) results.push(post)
    }

    // Deduplicate posts by title + author (keep first/highest scoring)
    const seenPostKeys = new Set<string>()
    const dedupedResults = results.filter(post => {
      if (!post.title || !post.handle) return true
      const key = `${post.handle}:${post.title.toLowerCase().trim()}`
      if (seenPostKeys.has(key)) return false
      seenPostKeys.add(key)
      return true
    })

    const response = {
      posts: dedupedResults,
      query: searchTerm,
      mode,
      ...((semanticFailed || !hasContentFields) && mode === 'semantic' && { fallback: 'keyword' }),
    }
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 300 })
    return c.json(response)
  } catch (error) {
    console.error('Error searching posts:', error)
    return c.json({ error: 'Failed to search posts' }, 500)
  }
})

// =============================================================================
// Unified Search
// =============================================================================

/**
 * Unified search combining posts and authors
 * Returns both result types in a single paginated response
 *
 * Key features:
 * - Always searches ALL fields, then post-filters by selected fields
 * - This ensures expanding field selection only ADDS results (additive filtering)
 * - Supports offset-based pagination with higher limits (up to 100)
 * - Tracks which fields matched per result for UI display
 */
app.get('/xrpc/app.greengale.search.unified', async (c) => {
  const query = c.req.query('q')
  if (!query || query.trim().length === 0) {
    return c.json({ error: 'Missing or empty q parameter' }, 400)
  }

  const searchTerm = query.trim()
  if (searchTerm.length < 2) {
    return c.json({ error: 'Query must be at least 2 characters' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 100)
  const offset = parseInt(c.req.query('offset') || '0')
  const mode = (c.req.query('mode') || 'hybrid') as 'keyword' | 'semantic' | 'hybrid'

  // Filter parameters
  const authorFilter = c.req.query('author')?.trim() || undefined
  const afterFilter = c.req.query('after')?.trim() || undefined
  const beforeFilter = c.req.query('before')?.trim() || undefined

  // Field filter for post-filtering (not pre-filtering)
  // Valid fields: handle, name, pub, content
  // 'content' includes title, subtitle, content_preview, and tags
  const fieldsParam = c.req.query('fields')?.trim() || undefined
  const validFields = ['handle', 'name', 'pub', 'content']
  const selectedFields = fieldsParam
    ? fieldsParam.split(',').filter(f => validFields.includes(f))
    : []

  // Type filter: comma-separated list of result types to include
  // Valid types: post, author
  const typesParam = c.req.query('types')?.trim() || undefined
  const includeTypes = typesParam
    ? typesParam.split(',').filter(t => ['post', 'author'].includes(t))
    : ['post', 'author'] // Default to both

  // AI agent filter: 'and' (only agents), 'not' (exclude agents), or omitted (no filter)
  const aiAgentFilter = c.req.query('aiAgent')?.trim() || undefined

  // Cache key includes all parameters
  const fieldsKey = selectedFields.length > 0 ? selectedFields.sort().join(',') : 'all'
  const typesKey = includeTypes.sort().join(',')
  const cacheKey = `unified_search:${searchTerm.toLowerCase()}:${mode}:${authorFilter || ''}:${afterFilter || ''}:${beforeFilter || ''}:${fieldsKey}:${typesKey}:${aiAgentFilter || ''}`

  try {
    // Check cache for full result set
    let fullResults: Array<{
      type: 'post' | 'author'
      id: string // URI for posts, DID for authors
      score: number
      matchedFields: string[]
      data: unknown
    }> | null = null

    const cached = await c.env.CACHE.get(cacheKey, 'json') as typeof fullResults | null
    if (cached) {
      fullResults = cached
    } else {
      // Build full result set from scratch
      fullResults = []

      const escapedTerm = escapeLikePattern(searchTerm.toLowerCase())
      const prefixPattern = `${escapedTerm}%`
      const containsPattern = `%${escapedTerm}%`

      // ========================================
      // AUTHOR SEARCH (if included in types)
      // ========================================
      if (includeTypes.includes('author')) {
        const authorSql = `
          SELECT DISTINCT
            a.did,
            a.handle,
            a.display_name,
            a.avatar_url,
            a.pds_endpoint,
            p.icon_cid,
            p.name as pub_name,
            p.url as pub_url,
            a.posts_count,
            CASE
              WHEN LOWER(a.handle) = ?1 THEN 1.0
              WHEN LOWER(a.handle) LIKE ?2 ESCAPE '\\' THEN 0.9
              WHEN LOWER(a.display_name) LIKE ?3 ESCAPE '\\' THEN 0.8
              WHEN LOWER(p.name) LIKE ?3 ESCAPE '\\' THEN 0.7
              WHEN LOWER(p.url) LIKE ?3 ESCAPE '\\' THEN 0.6
              ELSE 0.5
            END as score,
            CASE WHEN LOWER(a.handle) = ?1 OR LOWER(a.handle) LIKE ?2 ESCAPE '\\' THEN 1 ELSE 0 END as match_handle,
            CASE WHEN LOWER(a.display_name) LIKE ?3 ESCAPE '\\' THEN 1 ELSE 0 END as match_name,
            CASE WHEN LOWER(p.name) LIKE ?3 ESCAPE '\\' OR LOWER(p.url) LIKE ?3 ESCAPE '\\' THEN 1 ELSE 0 END as match_pub
          FROM authors a
          LEFT JOIN publications p ON a.did = p.author_did
          WHERE (
            LOWER(a.handle) = ?1
            OR LOWER(a.handle) LIKE ?2 ESCAPE '\\'
            OR LOWER(a.display_name) LIKE ?3 ESCAPE '\\'
            OR LOWER(p.name) LIKE ?3 ESCAPE '\\'
            OR LOWER(p.url) LIKE ?3 ESCAPE '\\'
          )
          ${aiAgentFilter === 'and' ? 'AND a.is_ai_agent = 1' : ''}
          ${aiAgentFilter === 'not' ? 'AND (a.is_ai_agent IS NULL OR a.is_ai_agent = 0)' : ''}
          ORDER BY score DESC, posts_count DESC
          LIMIT 100
        `

        const authorResult = await c.env.DB.prepare(authorSql).bind(
          searchTerm.toLowerCase(),
          prefixPattern,
          containsPattern,
        ).all()

        // Helper to determine if a publication URL is external
        const isExternalPublication = (url: string | null): boolean => {
          if (!url) return false
          try {
            const hostname = new URL(url).hostname.toLowerCase()
            return !hostname.includes('greengale')
          } catch {
            return false
          }
        }

        for (const row of authorResult.results || []) {
          const matchedFields: string[] = []
          if (row.match_handle) matchedFields.push('handle')
          if (row.match_name) matchedFields.push('name')
          if (row.match_pub) matchedFields.push('pub')

          fullResults.push({
            type: 'author',
            id: row.did as string,
            score: row.score as number,
            matchedFields,
            data: {
              did: row.did,
              handle: row.handle,
              displayName: row.display_name || null,
              avatarUrl: resolveAvatar({ ...row, author_did: row.did } as Record<string, unknown>),
              publication: row.pub_name ? {
                name: row.pub_name,
                url: row.pub_url || null,
                isExternal: isExternalPublication(row.pub_url as string | null),
              } : null,
              postsCount: row.posts_count as number,
            },
          })
        }
      }

      // ========================================
      // POST SEARCH (if included in types)
      // ========================================
      if (includeTypes.includes('post')) {
        // Always search ALL fields for keyword search (to support additive post-filtering)
        const semanticResults: Array<{ id: string; score: number }> = []
        const keywordResults: Array<{ id: string; score: number; matchedFields: string[] }> = []
        let semanticFailed = false

        // Semantic search (always runs for hybrid/semantic modes)
        if (mode === 'semantic' || mode === 'hybrid') {
          try {
            const queryEmbedding = await generateEmbedding(c.env.AI, searchTerm)
            const vectorResults = await querySimilar(c.env.VECTORIZE, queryEmbedding, {
              topK: 50, // Vectorize limit is 50
            })

            for (const match of vectorResults) {
              const uri = match.metadata.uri as string
              if (!uri) continue

              if (!semanticResults.some(r => r.id === uri)) {
                semanticResults.push({ id: uri, score: match.score })
              }
            }
          } catch (error) {
            console.error('Semantic search failed:', error)
            semanticFailed = true
          }
        }

        // Keyword search - always search ALL fields
        const shouldRunKeyword = mode === 'keyword' || mode === 'hybrid' ||
          (mode === 'semantic' && semanticFailed)

        if (shouldRunKeyword) {
          // Use the same approach as the existing search.posts endpoint
          // Build score CASE expression and WHERE conditions dynamically
          // Important: bindings must be in SQL order - score bindings first, then where bindings
          const scoreCases: string[] = []
          const scoreBindings: string[] = []
          const whereConditions: string[] = []
          const whereBindings: string[] = []

          // Title matches (score 1.0)
          scoreCases.push("WHEN LOWER(p.title) LIKE ? ESCAPE '\\' THEN 1.0")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(p.title) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Subtitle matches (score 0.9)
          scoreCases.push("WHEN LOWER(p.subtitle) LIKE ? ESCAPE '\\' THEN 0.9")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(p.subtitle) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Tag matches (score 0.85)
          scoreCases.push("WHEN EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_uri = p.uri AND LOWER(pt.tag) LIKE ? ESCAPE '\\') THEN 0.85")
          scoreBindings.push(containsPattern)

          // Content matches (score 0.8)
          scoreCases.push("WHEN LOWER(p.content_preview) LIKE ? ESCAPE '\\' THEN 0.8")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(p.content_preview) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Handle matches (score 0.7)
          scoreCases.push("WHEN LOWER(a.handle) LIKE ? ESCAPE '\\' THEN 0.7")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(a.handle) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Display name matches (score 0.7)
          scoreCases.push("WHEN LOWER(a.display_name) LIKE ? ESCAPE '\\' THEN 0.7")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(a.display_name) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Publication name matches (score 0.6)
          scoreCases.push("WHEN LOWER(pub.name) LIKE ? ESCAPE '\\' THEN 0.6")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(pub.name) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Publication URL matches (score 0.5)
          scoreCases.push("WHEN LOWER(pub.url) LIKE ? ESCAPE '\\' THEN 0.5")
          scoreBindings.push(containsPattern)
          whereConditions.push("LOWER(pub.url) LIKE ? ESCAPE '\\'")
          whereBindings.push(containsPattern)

          // Tags (also in WHERE for filtering)
          whereConditions.push("EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_uri = p.uri AND LOWER(pt.tag) LIKE ? ESCAPE '\\')")
          whereBindings.push(containsPattern)

          const scoreExpr = `CASE ${scoreCases.join(' ')} ELSE 0.5 END`

          const keywordSql = `
            SELECT DISTINCT
              p.uri,
              p.title,
              ${scoreExpr} as score
            FROM posts p
            JOIN authors a ON p.author_did = a.did
            LEFT JOIN publications pub ON p.author_did = pub.author_did
            WHERE p.visibility = 'public'
              AND p.deleted_at IS NULL
              AND (${whereConditions.join(' OR ')})
              -- Exclude site.standard duplicates when a GreenGale/WhiteWind version exists
              AND NOT (
                p.uri LIKE '%/site.standard.document/%'
                AND EXISTS (
                  SELECT 1 FROM posts gg
                  WHERE gg.author_did = p.author_did
                    AND gg.rkey = p.rkey
                    AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                      OR gg.uri LIKE '%/app.greengale.document/%'
                      OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
                )
              )
              ${aiAgentFilter === 'and' ? 'AND a.is_ai_agent = 1' : ''}
              ${aiAgentFilter === 'not' ? 'AND (a.is_ai_agent IS NULL OR a.is_ai_agent = 0)' : ''}
            ORDER BY score DESC
            LIMIT 500
          `

          // Bindings must be in SQL order: score bindings first, then where bindings
          try {
            const keywordQuery = await c.env.DB.prepare(keywordSql).bind(...scoreBindings, ...whereBindings).all()

            for (const row of keywordQuery.results || []) {
              // For now, we'll infer matchedFields later when building the response
              // This simplified query doesn't track individual field matches
              keywordResults.push({
                id: row.uri as string,
                score: row.score as number,
                matchedFields: ['content'], // Default - includes title, subtitle, content_preview
              })
            }
          } catch (error) {
            console.error('Keyword query failed:', error)
            throw new Error(`Keyword query failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        // Combine results with RRF
        let postIds: Array<{ id: string; score: number; matchType: 'semantic' | 'keyword' | 'both' }> = []

        if (mode === 'hybrid' && semanticResults.length > 0 && keywordResults.length > 0) {
          const fused = reciprocalRankFusion([semanticResults, keywordResults])
          postIds = fused.map(r => {
            const inSemantic = semanticResults.some(s => s.id === r.id)
            const inKeyword = keywordResults.some(k => k.id === r.id)
            return {
              id: r.id,
              score: r.score,
              matchType: inSemantic && inKeyword ? 'both' : inSemantic ? 'semantic' : 'keyword',
            }
          })
        } else if (mode === 'semantic' || (mode === 'hybrid' && semanticResults.length > 0)) {
          postIds = semanticResults.map(r => ({ id: r.id, score: r.score, matchType: 'semantic' as const }))
        } else {
          postIds = keywordResults.map(r => ({ id: r.id, score: r.score, matchType: 'keyword' as const }))
        }

        if (postIds.length > 0) {
          // Build result map for ordering - fetch in batches to avoid D1 binding limits
          const postMap = new Map<string, {
            uri: string
            authorDid: string
            handle: string
            displayName: string | null
            avatarUrl: string | null
            rkey: string
            title: string
            subtitle: string | null
            createdAt: string | null
            contentPreview: string | null
            matchType: 'semantic' | 'keyword' | 'both'
            source: 'whitewind' | 'greengale' | 'network'
            externalUrl: string | null
          }>()

          // Batch fetch posts in parallel (50 at a time to stay under D1's ~100 binding limit)
          const BATCH_SIZE = 50
          const batches: Array<typeof postIds> = []
          for (let i = 0; i < postIds.length; i += BATCH_SIZE) {
            batches.push(postIds.slice(i, i + BATCH_SIZE))
          }

          // Fetch all batches in parallel
          const batchResults = await Promise.all(batches.map(async (batch) => {
            const placeholders = batch.map(() => '?').join(',')

            let postsSql = `
              SELECT
                p.uri,
                p.author_did,
                p.rkey,
                p.title,
                p.subtitle,
                p.created_at,
                p.content_preview,
                p.source,
                p.external_url,
                a.handle,
                a.display_name,
                a.avatar_url,
                a.pds_endpoint,
                pub.icon_cid
              FROM posts p
              JOIN authors a ON p.author_did = a.did
              LEFT JOIN publications pub ON p.author_did = pub.author_did
              WHERE p.uri IN (${placeholders})
                AND p.visibility = 'public'
                AND p.deleted_at IS NULL
                AND NOT (
                  p.uri LIKE '%/site.standard.document/%'
                  AND EXISTS (
                    SELECT 1 FROM posts gg
                    WHERE gg.author_did = p.author_did
                      AND gg.rkey = p.rkey
                      AND (gg.uri LIKE '%/app.greengale.blog.entry/%'
                        OR gg.uri LIKE '%/app.greengale.document/%'
                        OR gg.uri LIKE '%/com.whtwnd.blog.entry/%')
                  )
                )`

            const postsBindings: (string | number)[] = batch.map(p => p.id)

            // Author filter (handle or DID)
            if (authorFilter) {
              if (authorFilter.startsWith('did:')) {
                postsSql += ` AND p.author_did = ?`
                postsBindings.push(authorFilter)
              } else {
                postsSql += ` AND a.handle = ?`
                postsBindings.push(authorFilter.replace(/^@/, ''))
              }
            }

            // Date filters
            if (afterFilter) {
              postsSql += ` AND p.created_at >= ?`
              postsBindings.push(afterFilter)
            }
            if (beforeFilter) {
              postsSql += ` AND p.created_at <= ?`
              postsBindings.push(beforeFilter)
            }

            // AI agent filter
            if (aiAgentFilter === 'and') {
              postsSql += ` AND a.is_ai_agent = 1`
            } else if (aiAgentFilter === 'not') {
              postsSql += ` AND (a.is_ai_agent IS NULL OR a.is_ai_agent = 0)`
            }

            const postsResult = await c.env.DB.prepare(postsSql).bind(...postsBindings).all()
            return { batch, results: postsResult.results || [] }
          }))

          // Process all batch results
          for (const { batch, results } of batchResults) {
            for (const row of results) {
              const uri = row.uri as string
              const postMeta = batch.find(p => p.id === uri)

              postMap.set(uri, {
                uri,
                authorDid: row.author_did as string,
                handle: row.handle as string,
                displayName: row.display_name as string | null,
                avatarUrl: resolveAvatar(row as Record<string, unknown>),
                rkey: row.rkey as string,
                title: row.title as string,
                subtitle: row.subtitle as string | null,
                createdAt: row.created_at as string | null,
                contentPreview: row.content_preview as string | null,
                matchType: postMeta?.matchType || 'keyword',
                source: (row.source as 'whitewind' | 'greengale' | 'network') || 'greengale',
                externalUrl: row.external_url as string | null,
              })
            }
          }

          // Add posts to results maintaining order
          for (const postMeta of postIds) {
            const post = postMap.get(postMeta.id)
            if (!post) continue

            // Get matched fields from keyword results (semantic matches get content)
            const keywordMatch = keywordResults.find(k => k.id === postMeta.id)
            const matchedFields = keywordMatch?.matchedFields || ['content']

            fullResults.push({
              type: 'post',
              id: post.uri,
              score: postMeta.score,
              matchedFields,
              data: post,
            })
          }
        }
      }

      // Sort combined results by score
      fullResults.sort((a, b) => b.score - a.score)

      // Cache the full result set
      await c.env.CACHE.put(cacheKey, JSON.stringify(fullResults), { expirationTtl: 300 })
    }

    // ========================================
    // POST-FILTER by selected fields (additive)
    // ========================================
    let filteredResults = fullResults!

    if (selectedFields.length > 0) {
      filteredResults = filteredResults.filter(result =>
        result.matchedFields.some(f => selectedFields.includes(f))
      )
    }

    // ========================================
    // DEDUPLICATE posts by title + author
    // ========================================
    // Some authors (especially external site imports) have duplicate posts
    // Keep only the first (highest scoring) occurrence per title+author
    const seenPostKeys = new Set<string>()
    filteredResults = filteredResults.filter(result => {
      if (result.type !== 'post') return true
      const post = result.data as { title?: string; handle?: string }
      if (!post.title || !post.handle) return true
      const key = `${post.handle}:${post.title.toLowerCase().trim()}`
      if (seenPostKeys.has(key)) return false
      seenPostKeys.add(key)
      return true
    })

    // ========================================
    // PAGINATION
    // ========================================
    const total = filteredResults.length
    const paginatedResults = filteredResults.slice(offset, offset + limit)
    const hasMore = offset + limit < total

    // Build response
    const response = {
      results: paginatedResults.map(r => ({
        type: r.type,
        score: r.score,
        matchedFields: r.matchedFields,
        ...r.data,
      })),
      query: searchTerm,
      mode,
      total,
      offset,
      limit,
      hasMore,
      ...(mode === 'semantic' && fullResults!.every(r => r.type === 'author' || r.matchedFields.includes('content')) && { fallback: undefined }),
    }

    return c.json(response)
  } catch (error) {
    console.error('Error in unified search:', error)
    return c.json({ error: 'Failed to search' }, 500)
  }
})

/**
 * Get similar posts (recommendations)
 */
app.get('/xrpc/app.greengale.feed.getSimilarPosts', async (c) => {
  const uri = c.req.query('uri')
  if (!uri) {
    return c.json({ error: 'Missing uri parameter' }, 400)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '5'), 20)
  const cacheKey = `similar_posts:${uri}:${limit}`

  try {
    // Check cache first (1 hour TTL for recommendations)
    const cached = await c.env.CACHE.get(cacheKey, 'json')
    if (cached) {
      return c.json(cached)
    }

    // Get the post's embedding
    const postEmbeddings = await getPostEmbeddings(c.env.VECTORIZE, uri)
    if (postEmbeddings.length === 0) {
      return c.json({ posts: [], message: 'Post has no embedding' })
    }

    // Get the post's author DID to exclude same-author results
    const postRow = await c.env.DB.prepare(
      'SELECT author_did FROM posts WHERE uri = ?'
    ).bind(uri).first()
    const authorDid = postRow?.author_did as string | undefined

    // Use first chunk/embedding for similarity query
    const queryVector = postEmbeddings[0].values

    // Query for similar posts (get extra to filter out same author and self)
    const similarResults = await querySimilar(c.env.VECTORIZE, queryVector, {
      topK: limit * 3,
    })

    // Filter and deduplicate results
    const seenUris = new Set<string>([uri])
    const filteredIds: string[] = []

    for (const match of similarResults) {
      // Extract URI from chunk ID
      const matchUri = match.id.includes(':chunk')
        ? match.id.replace(/:chunk\d+$/, '')
        : match.id

      // Skip self and duplicates
      if (seenUris.has(matchUri)) continue
      seenUris.add(matchUri)

      // Check if same author (exclude)
      if (match.metadata?.authorDid === authorDid) continue

      filteredIds.push(matchUri)
      if (filteredIds.length >= limit) break
    }

    if (filteredIds.length === 0) {
      const response = { posts: [] }
      await c.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 })
      return c.json(response)
    }

    // Fetch post details from D1
    const placeholders = filteredIds.map(() => '?').join(',')
    const postsResult = await c.env.DB.prepare(`
      SELECT
        p.uri,
        p.author_did,
        p.rkey,
        p.title,
        p.subtitle,
        p.created_at,
        a.handle,
        a.display_name,
        a.avatar_url,
        a.pds_endpoint,
        pub.icon_cid
      FROM posts p
      JOIN authors a ON p.author_did = a.did
      LEFT JOIN publications pub ON p.author_did = pub.author_did
      WHERE p.uri IN (${placeholders})
        AND p.visibility = 'public'
        AND p.deleted_at IS NULL
    `).bind(...filteredIds).all()

    // Build ordered results
    const postMap = new Map<string, {
      uri: string
      authorDid: string
      handle: string
      displayName: string | null
      avatarUrl: string | null
      rkey: string
      title: string
      subtitle: string | null
      createdAt: string | null
    }>()

    for (const row of postsResult.results || []) {
      postMap.set(row.uri as string, {
        uri: row.uri as string,
        authorDid: row.author_did as string,
        handle: row.handle as string,
        displayName: row.display_name as string | null,
        avatarUrl: resolveAvatar(row as Record<string, unknown>),
        rkey: row.rkey as string,
        title: row.title as string,
        subtitle: row.subtitle as string | null,
        createdAt: row.created_at as string | null,
      })
    }

    const posts = filteredIds
      .map(id => postMap.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)

    const response = { posts }
    await c.env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 })
    return c.json(response)
  } catch (error) {
    console.error('Error getting similar posts:', error)
    return c.json({ error: 'Failed to get similar posts' }, 500)
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

// Stop firehose connection (admin endpoint)
app.post('/xrpc/app.greengale.admin.stopFirehose', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }
  const id = c.env.FIREHOSE.idFromName('main')
  const stub = c.env.FIREHOSE.get(id)

  await stub.fetch(new Request('http://internal/stop', { method: 'POST' }))

  return c.json({ status: 'stopped' })
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
// This updates avatar_url, pds_endpoint, and other profile data for all authors in the database
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
        const did = author.did as string
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

          // Also fetch PDS endpoint from DID document (supports did:plc and did:web)
          const pdsEndpoint = await fetchPdsEndpoint(did)

          await c.env.DB.prepare(`
            UPDATE authors SET
              handle = ?,
              display_name = ?,
              description = ?,
              avatar_url = ?,
              banner_url = ?,
              pds_endpoint = COALESCE(?, pds_endpoint),
              updated_at = datetime('now')
            WHERE did = ?
          `).bind(
            profile.handle,
            profile.displayName || null,
            profile.description || null,
            profile.avatar || null,
            profile.banner || null,
            pdsEndpoint,
            did
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
    await c.env.CACHE.delete('recent_posts:24:')

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

// Refresh AI agent labels for all authors (admin only)
// Queries the labeler API to update is_ai_agent column
// Usage: POST /xrpc/app.greengale.admin.refreshAiAgentLabels
app.post('/xrpc/app.greengale.admin.refreshAiAgentLabels', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const labelerDid = 'did:plc:saslbwamakedc4h6c5bmshvz'

    // Get all author DIDs
    const result = await c.env.DB.prepare('SELECT did FROM authors').all()
    const authors = result.results || []

    // Query labels in batches (keep batches small to avoid URL length limits)
    const BATCH_SIZE = 10
    const aiAgentDids = new Set<string>()
    let batchesFailed = 0

    for (let i = 0; i < authors.length; i += BATCH_SIZE) {
      const batch = authors.slice(i, i + BATCH_SIZE)
      const params = new URLSearchParams()
      for (const author of batch) {
        params.append('uriPatterns', author.did as string)
      }
      params.set('sources', labelerDid)

      try {
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/com.atproto.label.queryLabels?${params}`
        )
        if (response.ok) {
          const data = await response.json() as {
            labels?: Array<{ uri: string; val: string; neg?: boolean }>
          }
          for (const label of data.labels || []) {
            if (label.val === 'ai-agent' && !label.neg) {
              aiAgentDids.add(label.uri)
            }
          }
        } else {
          console.error(`Label query failed for batch ${i / BATCH_SIZE}: ${response.status} ${response.statusText}`)
          batchesFailed++
        }
      } catch (err) {
        console.error(`Label query error for batch ${i / BATCH_SIZE}:`, err)
        batchesFailed++
      }
    }

    // Reset all to 0
    await c.env.DB.prepare('UPDATE authors SET is_ai_agent = 0').run()

    // Set matching authors to 1 (batch in groups to avoid D1 limits)
    const aiAgentArray = [...aiAgentDids]
    for (let i = 0; i < aiAgentArray.length; i += 50) {
      const batch = aiAgentArray.slice(i, i + 50)
      const statements = batch.map(did =>
        c.env.DB.prepare('UPDATE authors SET is_ai_agent = 1 WHERE did = ?').bind(did)
      )
      await c.env.DB.batch(statements)
    }

    return c.json({
      success: true,
      total: authors.length,
      aiAgentCount: aiAgentDids.size,
      batchesFailed,
      aiAgentDids: aiAgentArray,
    })
  } catch (error) {
    console.error('Error refreshing AI agent labels:', error)
    return c.json({
      error: 'Failed to refresh AI agent labels',
      details: error instanceof Error ? error.message : String(error),
    }, 500)
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

// Invalidate RSS feed cache (admin only)
// Usage: POST /xrpc/app.greengale.admin.invalidateRSSCache
// Body: { "handle": "user.bsky.social" } for author feed
// Or: { "type": "recent" } for recent posts feed
// Or: { "type": "all" } to clear all RSS caches
app.post('/xrpc/app.greengale.admin.invalidateRSSCache', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const body = await c.req.json() as { handle?: string; type?: string }
    const { handle, type } = body

    const invalidated: string[] = []

    if (type === 'all') {
      // Clear recent feed cache
      await c.env.CACHE.delete('rss:recent')
      invalidated.push('rss:recent')

      // Get all author handles and clear their caches
      const authors = await c.env.DB.prepare('SELECT handle FROM authors').all()
      for (const author of authors.results || []) {
        const authorHandle = author.handle as string
        const cacheKey = `rss:author:${authorHandle}`
        await c.env.CACHE.delete(cacheKey)
        invalidated.push(cacheKey)
      }
    } else if (type === 'recent') {
      await c.env.CACHE.delete('rss:recent')
      invalidated.push('rss:recent')
    } else if (handle) {
      const cacheKey = `rss:author:${handle}`
      await c.env.CACHE.delete(cacheKey)
      invalidated.push(cacheKey)
    } else {
      return c.json({ error: 'Missing parameters: need handle, type=recent, or type=all' }, 400)
    }

    return c.json({ success: true, invalidated, message: `Invalidated ${invalidated.length} RSS cache(s)` })
  } catch (error) {
    console.error('Error invalidating RSS cache:', error)
    return c.json({ error: 'Failed to invalidate cache' }, 500)
  }
})

// Re-index a specific post from PDS (admin only)
// This fetches fresh data including theme, external URLs, and updates the database
// Uses the firehose DO for complete reindexing logic
// Usage: POST /xrpc/app.greengale.admin.reindexPost
// Body: { "handle": "user.bsky.social", "rkey": "abc123" } or { "did": "did:plc:...", "rkey": "abc123" }
app.post('/xrpc/app.greengale.admin.reindexPost', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const body = await c.req.json() as { handle?: string; rkey?: string; did?: string }
    const { handle, rkey } = body
    let { did } = body

    if (!rkey) {
      return c.json({ error: 'Missing rkey parameter' }, 400)
    }

    // Resolve handle to DID if needed
    if (!did && handle) {
      const authorRow = await c.env.DB.prepare(
        'SELECT did FROM authors WHERE handle = ?'
      ).bind(handle).first()

      if (!authorRow) {
        return c.json({ error: 'Author not found' }, 404)
      }
      did = authorRow.did as string
    }

    if (!did) {
      return c.json({ error: 'Missing did or handle parameter' }, 400)
    }

    // Get PDS endpoint
    const pdsEndpoint = await fetchPdsEndpoint(did)
    if (!pdsEndpoint) {
      return c.json({ error: 'Could not determine PDS endpoint' }, 500)
    }

    // Try each collection to find the post
    const collections = [
      'app.greengale.document',
      'app.greengale.blog.entry',
      'com.whtwnd.blog.entry',
      'site.standard.document',
    ]

    let foundUri: string | null = null
    let foundCollection: string | null = null

    for (const collection of collections) {
      try {
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (response.ok) {
          foundUri = `at://${did}/${collection}/${rkey}`
          foundCollection = collection
          break
        }
      } catch {
        continue
      }
    }

    if (!foundUri || !foundCollection) {
      return c.json({ error: 'Post not found in any collection' }, 404)
    }

    // Use the firehose DO for complete reindexing (includes external URL resolution)
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    const reindexResponse = await firehose.fetch('http://internal/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: foundUri }),
    })

    if (!reindexResponse.ok) {
      const errorData = await reindexResponse.json().catch(() => ({ error: 'Unknown' })) as { error?: string }
      return c.json({ error: errorData.error || 'Reindex failed' }, 500)
    }

    // Invalidate caches
    const authorRow = await c.env.DB.prepare(
      'SELECT handle FROM authors WHERE did = ?'
    ).bind(did).first()
    const authorHandle = authorRow?.handle as string | undefined
    if (authorHandle) {
      await c.env.CACHE.delete(`og:${authorHandle}:${rkey}`)
    }
    await Promise.all([
      c.env.CACHE.delete('recent_posts:24:'),
      c.env.CACHE.delete('rss:recent'),
      authorHandle ? c.env.CACHE.delete(`rss:author:${authorHandle}`) : Promise.resolve(),
    ])

    // Get the updated post info
    const updatedPost = await c.env.DB.prepare(`
      SELECT title, content_preview, external_url FROM posts WHERE uri = ?
    `).bind(foundUri).first()

    return c.json({
      success: true,
      uri: foundUri,
      collection: foundCollection,
      title: updatedPost?.title,
      contentPreviewLength: (updatedPost?.content_preview as string)?.length || 0,
      externalUrl: updatedPost?.external_url,
      message: 'Re-indexed post via firehose DO',
    })
  } catch (error) {
    console.error('Error re-indexing post:', error)
    return c.json({ error: 'Failed to re-index post', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Fix site.standard.document posts missing external URLs (admin only)
// These are external platform posts (Leaflet, etc.) that were indexed before external URL resolution
// Usage: POST /xrpc/app.greengale.admin.fixMissingExternalUrls?limit=100&concurrency=20
app.post('/xrpc/app.greengale.admin.fixMissingExternalUrls', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)
  const concurrency = Math.min(parseInt(c.req.query('concurrency') || '20'), 50)

  try {
    // Get total count of affected posts
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM posts
      WHERE uri LIKE '%/site.standard.document/%'
        AND external_url IS NULL
        AND deleted_at IS NULL
    `).first()
    const totalRemaining = (countResult?.total as number) || 0

    // Find site.standard.document posts without external_url
    const posts = await c.env.DB.prepare(`
      SELECT uri, author_did, rkey, title
      FROM posts
      WHERE uri LIKE '%/site.standard.document/%'
        AND external_url IS NULL
        AND deleted_at IS NULL
      ORDER BY indexed_at ASC
      LIMIT ?
    `).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({
        message: 'No posts with missing external URLs found',
        processed: 0,
        remaining: 0,
      })
    }

    // Get the firehose DO to trigger re-indexing
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    let processed = 0
    let failed = 0
    let fixed = 0
    const errors: string[] = []

    // Process in parallel batches
    const reindexPost = async (post: { uri: unknown; title: unknown }) => {
      try {
        const response = await firehose.fetch('http://internal/reindex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: post.uri }),
        })

        if (response.ok) {
          // Check if external_url was set
          const updated = await c.env.DB.prepare(
            'SELECT external_url FROM posts WHERE uri = ?'
          ).bind(post.uri).first()

          return {
            success: true,
            fixed: !!updated?.external_url,
          }
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown' })) as { error?: string }
          return { success: false, error: `${post.title}: ${errorData.error || response.statusText}` }
        }
      } catch (err) {
        return { success: false, error: `${post.title}: ${err instanceof Error ? err.message : 'Unknown error'}` }
      }
    }

    // Process in batches
    for (let i = 0; i < posts.results.length; i += concurrency) {
      const batch = posts.results.slice(i, i + concurrency)
      const results = await Promise.all(batch.map(reindexPost))

      for (const result of results) {
        if (result.success) {
          processed++
          if (result.fixed) fixed++
        } else {
          failed++
          if (result.error) errors.push(result.error)
        }
      }
    }

    return c.json({
      success: true,
      total: posts.results.length,
      processed,
      fixed,
      failed,
      remaining: Math.max(0, totalRemaining - processed),
      concurrency,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    console.error('Error fixing missing external URLs:', error)
    return c.json({ error: 'Failed to fix external URLs', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Re-index posts with empty content previews (admin only)
// This is useful for Leaflet posts that weren't properly indexed initially
// Usage: POST /xrpc/app.greengale.admin.reindexEmptyPreviews?limit=50
app.post('/xrpc/app.greengale.admin.reindexEmptyPreviews', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)

  try {
    // Find posts with empty content_preview (mainly site.standard.document from Leaflet)
    const posts = await c.env.DB.prepare(`
      SELECT uri, author_did, rkey
      FROM posts
      WHERE (content_preview IS NULL OR content_preview = '')
        AND deleted_at IS NULL
      ORDER BY indexed_at DESC
      LIMIT ?
    `).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({ message: 'No posts with empty previews found', processed: 0 })
    }

    // Get the firehose DO to trigger re-indexing
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    let processed = 0
    let failed = 0
    const errors: string[] = []

    for (const post of posts.results) {
      try {
        const response = await firehose.fetch('http://internal/reindex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: post.uri }),
        })

        if (response.ok) {
          processed++
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown' })) as { error?: string }
          failed++
          errors.push(`${post.uri}: ${errorData.error || response.statusText}`)
        }
      } catch (err) {
        failed++
        errors.push(`${post.uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json({
      success: true,
      total: posts.results.length,
      processed,
      failed,
      errors: errors.slice(0, 10), // Only return first 10 errors
    })
  } catch (error) {
    console.error('Error reindexing empty previews:', error)
    return c.json({ error: 'Failed to reindex', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Re-index posts with short content previews (admin only)
// This expands previews that were truncated at the old 1000-char limit to the new 3000-char limit
// Usage: POST /xrpc/app.greengale.admin.expandContentPreviews?limit=50&concurrency=20
app.post('/xrpc/app.greengale.admin.expandContentPreviews', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 500)
  // Default threshold is 1000 (old limit) - posts at exactly this length were likely truncated
  const threshold = Math.min(parseInt(c.req.query('threshold') || '1000'), 2999)
  // Minimum length to consider (default 250 to catch 300-char truncated posts)
  const minLength = Math.max(parseInt(c.req.query('minLength') || '250'), 100)
  // Concurrency for parallel processing (default 20, max 50)
  const concurrency = Math.min(parseInt(c.req.query('concurrency') || '20'), 50)
  // Skip posts indexed within the last N minutes (to avoid re-processing recently expanded posts)
  const skipRecentMinutes = parseInt(c.req.query('skipRecentMinutes') || '0')

  try {
    // Build query with optional recent skip
    let whereClause = `
      WHERE content_preview IS NOT NULL
        AND LENGTH(content_preview) >= ?
        AND LENGTH(content_preview) <= ?
        AND deleted_at IS NULL
    `
    const params: (number | string)[] = [minLength, threshold]

    if (skipRecentMinutes > 0) {
      whereClause += ` AND indexed_at < datetime('now', '-${skipRecentMinutes} minutes')`
    }

    // Get total count of matching posts
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM posts ${whereClause}
    `).bind(...params).first()
    const totalRemaining = (countResult?.total as number) || 0

    // Find posts where content_preview is between minLength and threshold chars
    // These are likely truncated at an old limit
    // Order by oldest indexed first to prioritize posts that haven't been touched
    const posts = await c.env.DB.prepare(`
      SELECT uri, author_did, rkey, LENGTH(content_preview) as preview_length
      FROM posts
      ${whereClause}
      ORDER BY indexed_at ASC
      LIMIT ?
    `).bind(...params, limit).all()

    if (!posts.results?.length) {
      return c.json({ message: 'No posts with short previews found', processed: 0, remaining: 0, minLength, threshold })
    }

    // Get the firehose DO to trigger re-indexing
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    let processed = 0
    let failed = 0
    const errors: string[] = []

    // Process in parallel batches
    const reindexPost = async (post: { uri: unknown }) => {
      try {
        const response = await firehose.fetch('http://internal/reindex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: post.uri }),
        })

        if (response.ok) {
          return { success: true }
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown' })) as { error?: string }
          return { success: false, error: `${post.uri}: ${errorData.error || response.statusText}` }
        }
      } catch (err) {
        return { success: false, error: `${post.uri}: ${err instanceof Error ? err.message : 'Unknown error'}` }
      }
    }

    // Process in batches of `concurrency` posts at a time
    for (let i = 0; i < posts.results.length; i += concurrency) {
      const batch = posts.results.slice(i, i + concurrency)
      const results = await Promise.all(batch.map(reindexPost))

      for (const result of results) {
        if (result.success) {
          processed++
        } else {
          failed++
          if (result.error) errors.push(result.error)
        }
      }
    }

    return c.json({
      success: true,
      total: posts.results.length,
      processed,
      failed,
      remaining: Math.max(0, totalRemaining - processed),
      minLength,
      threshold,
      concurrency,
      errors: errors.slice(0, 10), // Only return first 10 errors
    })
  } catch (error) {
    console.error('Error expanding content previews:', error)
    return c.json({ error: 'Failed to expand previews', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Helper function to fetch PDS endpoint from DID document
// Resolve a DID document for both did:plc and did:web methods
async function resolveDidDocument(did: string): Promise<{ service?: Array<{ id: string; type: string; serviceEndpoint: string }> } | null> {
  try {
    let url: string
    if (did.startsWith('did:web:')) {
      // did:web:example.com → https://example.com/.well-known/did.json
      // did:web:example.com:path:to → https://example.com/path/to/did.json
      const parts = did.slice('did:web:'.length).split(':')
      const host = decodeURIComponent(parts[0])
      const path = parts.length > 1 ? `/${parts.slice(1).map(decodeURIComponent).join('/')}` : '/.well-known'
      url = `https://${host}${path}/did.json`
    } else {
      url = `https://plc.directory/${did}`
    }
    const response = await fetch(url)
    if (response.ok) {
      return await response.json() as { service?: Array<{ id: string; type: string; serviceEndpoint: string }> }
    }
  } catch {
    // DID resolution failed
  }
  return null
}

async function fetchPdsEndpoint(did: string): Promise<string | null> {
  const didDoc = await resolveDidDocument(did)
  if (didDoc) {
    const pdsService = didDoc.service?.find(
      s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
    )
    return pdsService?.serviceEndpoint || null
  }
  return null
}

/**
 * Resolve a site.standard.publication AT-URI to get the external URL
 * This fetches the publication record directly for more robust resolution
 * @param siteUri AT-URI like at://did/site.standard.publication/rkey
 * @param documentPath Path component from the document (e.g., "/posts/my-post")
 * @returns Full external URL or null if resolution fails
 */
async function resolveExternalUrl(siteUri: string, documentPath: string): Promise<string | null> {
  try {
    // Parse AT-URI: at://did/collection/rkey
    const match = siteUri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
    if (!match) return null

    const [, pubDid, collection, rkey] = match

    // Get PDS endpoint for the publication owner
    const pdsEndpoint = await fetchPdsEndpoint(pubDid)
    if (!pdsEndpoint) return null

    // Fetch the publication record
    const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(pubDid)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
    const response = await fetch(recordUrl)
    if (!response.ok) return null

    const record = await response.json() as { value?: { url?: string } }
    const pubUrl = record.value?.url
    if (!pubUrl) return null

    // Construct full URL
    const baseUrl = pubUrl.replace(/\/$/, '')
    const normalizedPath = documentPath.startsWith('/') ? documentPath : `/${documentPath}`
    return `${baseUrl}${normalizedPath}`
  } catch {
    return null
  }
}

// Fetch blog posts from an author's PDS and index them in D1.
// Returns the number of posts indexed. Uses KV cache to avoid repeated PDS calls.
async function indexPostsFromPds(
  did: string,
  env: { DB: D1Database; CACHE: KVNamespace }
): Promise<number> {
  // Check if we've already indexed this author's posts recently
  // Version the key so adding new collections invalidates old cache entries
  // v3: improved external URL resolution with fallback for site.standard.document
  // v4: fixed ON CONFLICT to actually update existing records (was DO NOTHING)
  // v5: fall back to rkey when documentPath is missing for external URL construction
  const cacheKey = `posts-indexed:v5:${did}`
  const cached = await env.CACHE.get(cacheKey)
  if (cached) return 0

  // Get PDS endpoint - check DB first, then resolve from DID document
  let pdsEndpoint: string | null = null
  const authorRow = await env.DB.prepare('SELECT pds_endpoint FROM authors WHERE did = ?').bind(did).first()
  if (authorRow?.pds_endpoint) {
    pdsEndpoint = authorRow.pds_endpoint as string
  } else {
    pdsEndpoint = await fetchPdsEndpoint(did)
    if (pdsEndpoint) {
      // Cache the PDS endpoint in the authors table
      await env.DB.prepare('UPDATE authors SET pds_endpoint = ? WHERE did = ?').bind(pdsEndpoint, did).run()
    }
  }

  if (!pdsEndpoint) return 0

  const collections = [
    { name: 'app.greengale.document', source: 'greengale' as const, isV2: true, isSiteStandard: false },
    { name: 'app.greengale.blog.entry', source: 'greengale' as const, isV2: false, isSiteStandard: false },
    { name: 'com.whtwnd.blog.entry', source: 'whitewind' as const, isV2: false, isSiteStandard: false },
    { name: 'site.standard.document', source: 'greengale' as const, isV2: false, isSiteStandard: true },
  ]

  // For site.standard.document, fetch all publication records from the user's PDS
  // to build a map of publication AT-URI → base URL.
  // Users can have multiple publications (e.g., GreenGale + external sites).
  const publicationUrlMap = new Map<string, string>()
  try {
    const pubListUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=site.standard.publication&limit=100`
    const pubResponse = await fetch(pubListUrl)
    if (pubResponse.ok) {
      const pubData = await pubResponse.json() as {
        records?: Array<{ uri: string; value: { url?: string } }>
      }
      if (pubData.records) {
        for (const rec of pubData.records) {
          const url = rec.value?.url
          if (url) {
            publicationUrlMap.set(rec.uri, url.replace(/\/$/, ''))
          }
        }
      }
    }
  } catch {
    // Continue without publication URLs - external_url will be null
  }

  let totalPosts = 0

  for (const col of collections) {
    try {
      const listUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(col.name)}&limit=100`
      const response = await fetch(listUrl)
      if (!response.ok) continue

      const data = await response.json() as {
        records?: Array<{ uri: string; value: Record<string, unknown> }>
      }
      if (!data.records?.length) continue

      for (const record of data.records) {
        const uri = record.uri
        const rkey = uri.split('/').pop()!
        const value = record.value

        const title = (value.title as string) || null
        // site.standard uses 'description' instead of 'subtitle'
        const subtitle = col.isSiteStandard
          ? (value.description as string) || null
          : (value.subtitle as string) || null
        // site.standard uses 'textContent' for plaintext
        const content = col.isSiteStandard
          ? (value.textContent as string) || ''
          : (value.content as string) || ''
        const visibility = (value.visibility as string) || 'public'
        // V2 and site.standard use publishedAt, V1/WhiteWind uses createdAt
        const createdAt = (col.isV2 || col.isSiteStandard)
          ? (value.publishedAt as string) || null
          : (value.createdAt as string) || null
        const hasLatex = col.source === 'greengale' && !col.isSiteStandard && value.latex === true
        const documentPath = (col.isV2 || col.isSiteStandard) ? (value.path as string) || null : null

        // site.standard fields
        const siteUri = col.isSiteStandard ? (value.site as string) || null : null
        let externalUrl: string | null = null
        if (col.isSiteStandard && siteUri) {
          // Check if content indicates this is from an external platform
          // GreenGale docs have: content: { $type: "app.greengale.document#contentRef", uri: "at://..." }
          // External docs (Leaflet, etc.) have inline content: content: { $type: "pub.leaflet.content", ... }
          const contentObj = value.content as Record<string, unknown> | undefined
          const contentType = contentObj?.$type as string | undefined
          const contentUri = contentObj?.uri as string | undefined

          // It's external if content has a $type that's NOT GreenGale's contentRef
          const isExternalContent = contentType && !contentType.startsWith('app.greengale.')

          // It's GreenGale origin if content.uri points to a GreenGale document
          const isGreenGaleOrigin = contentUri && contentUri.includes('/app.greengale.document/')

          // Use documentPath if available, otherwise fall back to rkey
          // (some platforms like leaflet.pub use the rkey as the URL path)
          const pathForUrl = documentPath || `/${rkey}`

          // Resolve the URL
          let resolvedUrl: string | null = null

          // First try the pre-fetched publication map (fast path)
          const pubBaseUrl = publicationUrlMap.get(siteUri)
          if (pubBaseUrl) {
            const normalizedPath = pathForUrl.startsWith('/') ? pathForUrl : `/${pathForUrl}`
            resolvedUrl = `${pubBaseUrl}${normalizedPath}`
          } else {
            // Fallback: resolve publication directly from PDS
            // This handles cases where the publication is in a different repo
            // or wasn't listed properly
            resolvedUrl = await resolveExternalUrl(siteUri, pathForUrl)
          }

          // Only use the resolved URL if it's appropriate
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

        // Theme
        let themePreset: string | null = null
        if (value.theme) {
          const themeData = value.theme as Record<string, unknown>
          if (themeData.custom) {
            themePreset = JSON.stringify(themeData.custom)
          } else if (themeData.preset) {
            themePreset = themeData.preset as string
          }
        }

        // First image CID (not for site.standard)
        let firstImageCid: string | null = null
        if (!col.isSiteStandard) {
          const blobs = value.blobs as Array<Record<string, unknown>> | undefined
          if (blobs?.length) {
            for (const blob of blobs) {
              // Skip blobs with sensitive labels
              const labels = blob.labels as { values?: Array<{ val: string }> } | undefined
              if (labels?.values?.some(l =>
                ['nudity', 'sexual', 'porn', 'graphic-media'].includes(l.val)
              )) continue

              const blobref = blob.blobref as Record<string, unknown> | undefined
              if (blobref?.ref) {
                const ref = blobref.ref as Record<string, unknown>
                if (typeof ref.$link === 'string') {
                  firstImageCid = ref.$link
                  break
                }
              }
            }
          }
        }

        // Content preview
        const contentPreview = content
          .replace(/[#*`\[\]()!]/g, '')
          .replace(/\n+/g, ' ')
          .slice(0, 3000)

        // Slug
        const slug = title
          ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          : null

        await env.DB.prepare(`
          INSERT INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, indexed_at, content_preview, has_latex, theme_preset, first_image_cid, path, site_uri, external_url)
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
            path = excluded.path,
            site_uri = excluded.site_uri,
            external_url = excluded.external_url,
            indexed_at = datetime('now')
        `).bind(
          uri, did, rkey, title, subtitle, slug, col.source, visibility,
          createdAt, createdAt, contentPreview, hasLatex ? 1 : 0, themePreset, firstImageCid, documentPath,
          siteUri, externalUrl
        ).run()

        totalPosts++
      }
    } catch {
      // Skip failed collections
    }
  }

  // Mark as indexed (24-hour TTL) to avoid repeated PDS calls
  await env.CACHE.put(cacheKey, '1', { expirationTtl: 86400 })

  return totalPosts
}

// Discover and index an author who isn't in the DB yet.
// Resolves their identity via Bluesky public API, fetches blog posts from their PDS, and indexes them.
async function discoverAndIndexAuthor(
  handle: string,
  env: { DB: D1Database; CACHE: KVNamespace }
): Promise<{ did: string; handle: string; displayName: string | null; avatar: string | null; description: string | null; postsCount: number } | null> {
  // Check negative cache to avoid repeated lookups for non-existent handles
  const negCacheKey = `discover-fail:${handle}`
  const cached = await env.CACHE.get(negCacheKey)
  if (cached) return null

  try {
    // Resolve handle via Bluesky public API
    const profileResponse = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
    )
    if (!profileResponse.ok) {
      await env.CACHE.put(negCacheKey, '1', { expirationTtl: 3600 })
      return null
    }

    const profile = await profileResponse.json() as {
      did: string
      handle: string
      displayName?: string
      avatar?: string
      description?: string
    }

    const did = profile.did

    // Fetch PDS endpoint
    const pdsEndpoint = await fetchPdsEndpoint(did)
    if (!pdsEndpoint) {
      await env.CACHE.put(negCacheKey, '1', { expirationTtl: 3600 })
      return null
    }

    // Index posts from PDS
    const totalPosts = await indexPostsFromPds(did, env)

    if (totalPosts === 0) {
      await env.CACHE.put(negCacheKey, '1', { expirationTtl: 3600 })
      return null
    }

    // Upsert author record
    await env.DB.prepare(`
      INSERT INTO authors (did, handle, display_name, description, avatar_url, pds_endpoint, posts_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(did) DO UPDATE SET
        handle = excluded.handle,
        display_name = excluded.display_name,
        description = excluded.description,
        avatar_url = excluded.avatar_url,
        pds_endpoint = excluded.pds_endpoint,
        posts_count = excluded.posts_count
    `).bind(
      did, profile.handle, profile.displayName || null, profile.description || null,
      profile.avatar || null, pdsEndpoint, totalPosts
    ).run()

    return {
      did,
      handle: profile.handle,
      displayName: profile.displayName || null,
      avatar: profile.avatar || null,
      description: profile.description || null,
      postsCount: totalPosts,
    }
  } catch {
    // Don't cache on network errors - they may be transient
    return null
  }
}

// Backfill first_image_cid for existing posts (admin only)
// Usage: POST /xrpc/app.greengale.admin.backfillFirstImageCid
// Optional body: { "limit": 100 } - default 50 posts per call
app.post('/xrpc/app.greengale.admin.backfillFirstImageCid', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const body = await c.req.json().catch(() => ({})) as { limit?: number }
    const limit = Math.min(body.limit || 50, 200) // Max 200 per call

    // Get GreenGale posts without first_image_cid (don't require pds_endpoint - we'll fetch it)
    const posts = await c.env.DB.prepare(`
      SELECT p.uri, p.author_did, p.rkey, a.pds_endpoint, a.handle
      FROM posts p
      JOIN authors a ON p.author_did = a.did
      WHERE p.source = 'greengale'
        AND p.first_image_cid IS NULL
      LIMIT ?
    `).bind(limit).all()

    let updated = 0
    let failed = 0
    let pdsUpdated = 0
    const errors: string[] = []

    for (const post of posts.results || []) {
      try {
        const authorDid = post.author_did as string
        const rkey = post.rkey as string
        let pdsEndpoint = post.pds_endpoint as string | null

        // Fetch PDS endpoint if not cached
        if (!pdsEndpoint) {
          pdsEndpoint = await fetchPdsEndpoint(authorDid)
          if (pdsEndpoint) {
            // Cache the PDS endpoint for future use
            await c.env.DB.prepare(
              'UPDATE authors SET pds_endpoint = ? WHERE did = ?'
            ).bind(pdsEndpoint, authorDid).run()
            pdsUpdated++
          } else {
            failed++
            errors.push(`${post.uri}: Could not resolve PDS endpoint`)
            continue
          }
        }

        // Fetch record from PDS
        const response = await fetch(
          `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?` +
          `repo=${encodeURIComponent(authorDid)}&` +
          `collection=app.greengale.blog.entry&` +
          `rkey=${encodeURIComponent(rkey)}`
        )

        if (response.ok) {
          const data = await response.json() as { value?: { blobs?: unknown[] } }
          const blobs = data.value?.blobs

          // Extract first non-sensitive image CID
          let firstCid: string | null = null
          if (blobs && Array.isArray(blobs)) {
            for (const blob of blobs) {
              if (typeof blob !== 'object' || blob === null) continue

              const blobRecord = blob as Record<string, unknown>

              // Skip if has sensitive labels
              const labels = blobRecord.labels as { values?: Array<{ val: string }> } | undefined
              if (labels?.values?.some(l =>
                ['nudity', 'sexual', 'porn', 'graphic-media'].includes(l.val)
              )) {
                continue
              }

              // Extract CID from blobref
              const blobref = blobRecord.blobref
              if (blobref && typeof blobref === 'object') {
                const ref = blobref as Record<string, unknown>
                if (ref.ref && typeof ref.ref === 'object') {
                  const innerRef = ref.ref as Record<string, unknown>
                  if (typeof innerRef.$link === 'string') {
                    firstCid = innerRef.$link
                    break
                  }
                }
                if (typeof ref.$link === 'string') {
                  firstCid = ref.$link
                  break
                }
              }
            }
          }

          if (firstCid) {
            await c.env.DB.prepare(
              'UPDATE posts SET first_image_cid = ? WHERE uri = ?'
            ).bind(firstCid, post.uri).run()

            // Invalidate OG cache for this post
            const handle = post.handle as string | null
            if (handle) {
              await c.env.CACHE.delete(`og:${handle}:${rkey}`)
            }

            updated++
          }
        } else {
          failed++
          errors.push(`${post.uri}: HTTP ${response.status}`)
        }
      } catch (err) {
        failed++
        errors.push(`${post.uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json({
      success: true,
      processed: posts.results?.length || 0,
      updated,
      failed,
      pdsEndpointsUpdated: pdsUpdated,
      errors: errors.slice(0, 10), // Only return first 10 errors
    })
  } catch (error) {
    console.error('Error backfilling first image CIDs:', error)
    return c.json({ error: 'Failed to backfill', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Backfill missed posts from known authors
// This checks each author's PDS for recent posts that might have been missed by the firehose
// Usage: POST /xrpc/app.greengale.admin.backfillMissedPosts?limit=10
app.post('/xrpc/app.greengale.admin.backfillMissedPosts', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)

  try {
    // Get authors who have posted recently (last 30 days)
    const authors = await c.env.DB.prepare(`
      SELECT DISTINCT a.did, a.handle, a.pds_endpoint
      FROM authors a
      INNER JOIN posts p ON a.did = p.author_did
      WHERE p.indexed_at > datetime('now', '-30 days')
      ORDER BY p.indexed_at DESC
      LIMIT ?
    `).bind(limit).all()

    if (!authors.results?.length) {
      return c.json({ success: true, message: 'No recent authors to check', checked: 0, found: 0, indexed: 0 })
    }

    const collections = [
      'app.greengale.document',
      'app.greengale.blog.entry',
      'com.whtwnd.blog.entry',
    ]

    let checked = 0
    let found = 0
    let indexed = 0
    const errors: string[] = []

    for (const author of authors.results) {
      const did = author.did as string
      const handle = author.handle as string
      let pdsEndpoint = author.pds_endpoint as string | null

      // If no PDS endpoint cached, resolve it (supports did:plc and did:web)
      if (!pdsEndpoint) {
        pdsEndpoint = await fetchPdsEndpoint(did)
      }

      if (!pdsEndpoint) {
        errors.push(`${handle}: No PDS endpoint`)
        continue
      }

      // Check each collection for recent posts
      for (const collection of collections) {
        try {
          const listUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&limit=10`
          const response = await fetch(listUrl)

          if (!response.ok) continue

          const data = await response.json() as {
            records?: Array<{
              uri: string
              cid: string
              value: Record<string, unknown>
            }>
          }

          if (!data.records?.length) continue

          found += data.records.length

          for (const record of data.records) {
            checked++
            const uri = record.uri
            const rkey = uri.split('/').pop()!

            // Check if we already have this post
            const existing = await c.env.DB.prepare(
              'SELECT 1 FROM posts WHERE uri = ?'
            ).bind(uri).first()

            if (existing) continue

            // Index the missing post
            const source = collection === 'com.whtwnd.blog.entry' ? 'whitewind' : 'greengale'
            const isV2 = collection === 'app.greengale.document'
            const value = record.value

            const title = (value.title as string) || null
            const subtitle = (value.subtitle as string) || null
            const content = (value.content as string) || ''
            const visibility = (value.visibility as string) || 'public'
            const createdAt = isV2
              ? (value.publishedAt as string) || null
              : (value.createdAt as string) || null
            const hasLatex = source === 'greengale' && value.latex === true
            const documentPath = isV2 ? (value.path as string) || null : null

            // Theme
            let themePreset: string | null = null
            if (value.theme) {
              const themeData = value.theme as Record<string, unknown>
              if (themeData.custom) {
                themePreset = JSON.stringify(themeData.custom)
              } else if (themeData.preset) {
                themePreset = themeData.preset as string
              }
            }

            // First image CID
            let firstImageCid: string | null = null
            const blobs = value.blobs as Array<Record<string, unknown>> | undefined
            if (blobs?.length) {
              for (const blob of blobs) {
                const blobref = blob.blobref as Record<string, unknown> | undefined
                if (blobref?.ref) {
                  const ref = blobref.ref as Record<string, unknown>
                  if (typeof ref.$link === 'string') {
                    firstImageCid = ref.$link
                    break
                  }
                }
              }
            }

            // Content preview
            const contentPreview = content
              .replace(/[#*`\[\]()!]/g, '')
              .replace(/\n+/g, ' ')
              .slice(0, 3000)

            // Slug
            const slug = title
              ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
              : null

            await c.env.DB.prepare(`
              INSERT INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, content_preview, has_latex, theme_preset, first_image_cid, path)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(uri) DO NOTHING
            `).bind(
              uri, did, rkey, title, subtitle, slug, source, visibility,
              createdAt, contentPreview, hasLatex ? 1 : 0, themePreset, firstImageCid, documentPath
            ).run()

            indexed++
            console.log(`Backfilled missed post: ${uri}`)
          }
        } catch (err) {
          errors.push(`${handle}/${collection}: ${err instanceof Error ? err.message : 'Unknown'}`)
        }
      }
    }

    // Invalidate cache if we indexed anything
    if (indexed > 0) {
      await Promise.all([
        c.env.CACHE.delete('recent_posts:24:'),
        c.env.CACHE.delete('rss:recent'),
      ])
    }

    return c.json({
      success: true,
      authorsChecked: authors.results.length,
      recordsChecked: checked,
      recordsFound: found,
      postsIndexed: indexed,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    console.error('Error backfilling missed posts:', error)
    return c.json({ error: 'Failed to backfill', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Backfill external_url for site.standard posts
// This re-resolves publication URLs for posts that have NULL external_url
// Usage: POST /xrpc/app.greengale.admin.backfillExternalUrls?limit=50&force=true
app.post('/xrpc/app.greengale.admin.backfillExternalUrls', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const force = c.req.query('force') === 'true'

  try {
    // Get site.standard posts - either just NULL external_url or all if force=true
    const query = force
      ? `SELECT uri, author_did FROM posts WHERE uri LIKE '%/site.standard.document/%' LIMIT ?`
      : `SELECT uri, author_did FROM posts WHERE uri LIKE '%/site.standard.document/%' AND external_url IS NULL LIMIT ?`
    const posts = await c.env.DB.prepare(query).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({ success: true, message: 'No posts to backfill', updated: 0 })
    }

    let updated = 0
    const errors: string[] = []

    for (const post of posts.results) {
      const uri = post.uri as string
      const did = post.author_did as string

      try {
        // Resolve the PDS endpoint from DID document (supports did:plc and did:web)
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          errors.push(`${uri}: Failed to resolve DID`)
          continue
        }

        // Fetch the site.standard.document record to get the site AT-URI
        const docRkey = uri.split('/').pop()
        const recordResponse = await fetch(
          `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=site.standard.document&rkey=${docRkey}`
        )

        if (!recordResponse.ok) {
          errors.push(`${uri}: Failed to fetch document`)
          continue
        }

        const record = await recordResponse.json() as {
          value?: { site?: string; path?: string; content?: { $type?: string; uri?: string } }
        }

        const siteUri = record.value?.site
        if (!siteUri) {
          errors.push(`${uri}: No site URI`)
          continue
        }

        // Get path from the record (or fall back to rkey)
        const path = record.value?.path || `/${docRkey}`

        // Check if content indicates this is from an external platform
        // GreenGale docs have: content: { $type: "app.greengale.document#contentRef", uri: "at://..." }
        // External docs (Leaflet, etc.) have inline content: content: { $type: "pub.leaflet.content", ... }
        const contentType = record.value?.content?.$type
        const contentUri = record.value?.content?.uri

        // It's external if content has a $type that's NOT GreenGale's contentRef
        const isExternalContent = contentType && !contentType.startsWith('app.greengale.')

        // It's GreenGale origin if content.uri points to a GreenGale document
        const isGreenGaleOrigin = contentUri && contentUri.includes('/app.greengale.document/')

        // Handle both URL and AT-URI formats for the site field
        let resolvedUrl: string | null = null
        const normalizedPath = path.startsWith('/') ? path : `/${path}`

        if (siteUri.startsWith('http://') || siteUri.startsWith('https://')) {
          // Site is already a URL - construct external URL directly
          const baseUrl = siteUri.replace(/\/$/, '')
          resolvedUrl = `${baseUrl}${normalizedPath}`
        } else if (siteUri.startsWith('at://')) {
          // Parse the site AT-URI to get publication details
          const match = siteUri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
          if (!match) {
            errors.push(`${uri}: Invalid site AT-URI`)
            continue
          }

          const [, pubDid, collection, pubRkey] = match

          // Resolve the publication's PDS (may be different DID, supports did:web)
          let pubPdsEndpoint = pdsEndpoint
          if (pubDid !== did) {
            const resolved = await fetchPdsEndpoint(pubDid)
            if (resolved) {
              pubPdsEndpoint = resolved
            }
          }

          // Fetch the publication record
          const pubResponse = await fetch(
            `${pubPdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(pubDid)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(pubRkey)}`
          )

          if (!pubResponse.ok) {
            errors.push(`${uri}: Failed to fetch publication`)
            continue
          }

          const pub = await pubResponse.json() as {
            value?: { url?: string }
          }

          const pubUrl = pub.value?.url
          if (!pubUrl) {
            errors.push(`${uri}: Publication has no URL`)
            continue
          }

          // Construct the external URL
          const baseUrl = pubUrl.replace(/\/$/, '')
          resolvedUrl = `${baseUrl}${normalizedPath}`
        } else {
          errors.push(`${uri}: Unknown site format: ${siteUri}`)
          continue
        }

        // Only use the resolved URL if it's appropriate
        let externalUrl: string | null = null
        if (isExternalContent && resolvedUrl.includes('greengale.app')) {
          // This is an external document (e.g., Leaflet) that incorrectly references
          // a GreenGale publication. Clear the external_url.
          console.log(`Clearing greengale.app URL for external platform document: ${uri}`)
        } else if (isGreenGaleOrigin || !resolvedUrl.includes('greengale.app')) {
          externalUrl = resolvedUrl
        } else {
          // Ambiguous case: no content.$type and greengale.app URL
          // This could be an old GreenGale post without content field, so allow it
          externalUrl = resolvedUrl
        }

        // Update the post (set to resolved URL or NULL)
        await c.env.DB.prepare(
          'UPDATE posts SET external_url = ? WHERE uri = ?'
        ).bind(externalUrl, uri).run()

        updated++
        console.log(`Backfilled external_url for ${uri}: ${externalUrl || 'NULL'}`)
      } catch (err) {
        errors.push(`${uri}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    // Clear network posts cache if we updated anything
    if (updated > 0) {
      await c.env.CACHE.delete('network_posts:24:')
    }

    return c.json({
      success: true,
      postsChecked: posts.results.length,
      postsUpdated: updated,
      errors: errors.slice(0, 20),
    })
  } catch (error) {
    console.error('Error backfilling external URLs:', error)
    return c.json({ error: 'Failed to backfill', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Debug endpoint to inspect a post's database record
// Usage: GET /xrpc/app.greengale.admin.inspectPost?uri=at://did/collection/rkey
app.get('/xrpc/app.greengale.admin.inspectPost', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const uri = c.req.query('uri')
  if (!uri) {
    return c.json({ error: 'Missing uri parameter' }, 400)
  }

  try {
    const post = await c.env.DB.prepare(`
      SELECT * FROM posts WHERE uri = ?
    `).bind(uri).first()

    if (!post) {
      return c.json({ error: 'Post not found', uri })
    }

    return c.json({ post })
  } catch (error) {
    return c.json({ error: 'Failed to inspect', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Backfill external_url from stored site_uri and path (no PDS fetch needed)
// For posts where site_uri is a URL (not an AT-URI)
// Usage: POST /xrpc/app.greengale.admin.backfillExternalUrlsFromStored?limit=100
app.post('/xrpc/app.greengale.admin.backfillExternalUrlsFromStored', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)

  try {
    // Find posts where:
    // - It's a site.standard.document
    // - site_uri is a URL (starts with http)
    // - external_url is NULL
    // - path is available
    const posts = await c.env.DB.prepare(`
      SELECT uri, site_uri, path, rkey
      FROM posts
      WHERE uri LIKE '%/site.standard.document/%'
        AND site_uri LIKE 'http%'
        AND external_url IS NULL
        AND path IS NOT NULL
      LIMIT ?
    `).bind(limit).all<{
      uri: string
      site_uri: string
      path: string
      rkey: string
    }>()

    if (!posts.results?.length) {
      return c.json({ success: true, message: 'No posts to backfill', updated: 0 })
    }

    let updated = 0
    const updates: Array<{ uri: string; externalUrl: string }> = []

    for (const post of posts.results) {
      // Construct external URL from stored values
      const baseUrl = post.site_uri.replace(/\/$/, '')
      const normalizedPath = post.path.startsWith('/') ? post.path : `/${post.path}`
      const externalUrl = `${baseUrl}${normalizedPath}`

      // Update the post
      await c.env.DB.prepare(
        'UPDATE posts SET external_url = ? WHERE uri = ?'
      ).bind(externalUrl, post.uri).run()

      updates.push({ uri: post.uri, externalUrl })
      updated++
    }

    // Clear search cache (best effort)
    try {
      await c.env.CACHE.delete('network_posts:24:')
    } catch (e) {
      console.log('Cache clear failed:', e)
    }

    return c.json({
      success: true,
      updated,
      updates,
    })
  } catch (error) {
    return c.json({ error: 'Failed to backfill', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Clean up stale site.standard.document records from the database
// Removes posts where:
// - The document no longer exists on the PDS
// - The publication no longer exists
// - The site URI is invalid (not an AT-URI)
// Usage: POST /xrpc/app.greengale.admin.cleanupStalePosts?limit=50&dryRun=true
app.post('/xrpc/app.greengale.admin.cleanupStalePosts', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const dryRun = c.req.query('dryRun') !== 'false' // Default to dry run for safety

  try {
    // Get site.standard.document posts
    const posts = await c.env.DB.prepare(
      `SELECT uri, author_did, path FROM posts WHERE uri LIKE '%/site.standard.document/%' LIMIT ?`
    ).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({ success: true, message: 'No posts to check', checked: 0, deleted: 0 })
    }

    const toDelete: Array<{ uri: string; reason: string }> = []
    const errors: string[] = []

    for (const post of posts.results) {
      const uri = post.uri as string
      const did = post.author_did as string
      const rkey = uri.split('/').pop()

      try {
        // Resolve the PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          toDelete.push({ uri, reason: 'Failed to resolve DID' })
          continue
        }

        // Try to fetch the document
        const docResponse = await fetch(
          `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=site.standard.document&rkey=${rkey}`
        )

        if (!docResponse.ok) {
          const errorData = await docResponse.json().catch(() => ({})) as { error?: string }
          if (errorData.error === 'RecordNotFound' || errorData.error === 'InvalidRequest') {
            toDelete.push({ uri, reason: 'Document not found on PDS' })
            continue
          }
          // Other errors (e.g., temporary PDS issues) - skip
          errors.push(`${uri}: PDS error - ${docResponse.status}`)
          continue
        }

        const record = await docResponse.json() as {
          value?: { site?: string }
        }

        const siteUri = record.value?.site
        if (!siteUri) {
          toDelete.push({ uri, reason: 'No site URI in document' })
          continue
        }

        // Check if site URI is valid AT-URI format
        const atUriMatch = siteUri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
        if (!atUriMatch) {
          toDelete.push({ uri, reason: `Invalid site URI format: ${siteUri}` })
          continue
        }

        const [, pubDid, collection, pubRkey] = atUriMatch

        // Resolve publication PDS (may be different DID)
        let pubPdsEndpoint = pdsEndpoint
        if (pubDid !== did) {
          const resolved = await fetchPdsEndpoint(pubDid)
          if (!resolved) {
            toDelete.push({ uri, reason: `Failed to resolve publication DID: ${pubDid}` })
            continue
          }
          pubPdsEndpoint = resolved
        }

        // Try to fetch the publication
        const pubResponse = await fetch(
          `${pubPdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(pubDid)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(pubRkey)}`
        )

        if (!pubResponse.ok) {
          const errorData = await pubResponse.json().catch(() => ({})) as { error?: string }
          if (errorData.error === 'RecordNotFound' || errorData.error === 'InvalidRequest') {
            toDelete.push({ uri, reason: 'Publication not found on PDS' })
            continue
          }
          // Other errors - skip
          errors.push(`${uri}: Publication PDS error - ${pubResponse.status}`)
          continue
        }

        // Document and publication both exist - this post is valid
      } catch (err) {
        errors.push(`${uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Delete stale posts (unless dry run)
    let deleted = 0
    if (!dryRun && toDelete.length > 0) {
      for (const { uri } of toDelete) {
        try {
          // Delete from posts table
          await c.env.DB.prepare('DELETE FROM posts WHERE uri = ?').bind(uri).run()
          // Delete associated tags
          await c.env.DB.prepare('DELETE FROM post_tags WHERE post_uri = ?').bind(uri).run()
          deleted++
        } catch (err) {
          errors.push(`Failed to delete ${uri}: ${err instanceof Error ? err.message : 'Unknown'}`)
        }
      }

      // Clear caches
      await Promise.all([
        c.env.CACHE.delete('network_posts:24:'),
        c.env.CACHE.delete('network_posts:50:'),
        c.env.CACHE.delete('network_posts:100:'),
      ])
    }

    return c.json({
      success: true,
      dryRun,
      checked: posts.results.length,
      toDelete: toDelete.length,
      deleted,
      staleRecords: toDelete.slice(0, 50), // Show first 50
      errors: errors.slice(0, 20),
    })
  } catch (error) {
    console.error('Error cleaning up stale posts:', error)
    return c.json({ error: 'Failed to cleanup', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Backfill tags for existing posts by fetching from PDS
// Usage: POST /xrpc/app.greengale.admin.backfillTags?limit=50
app.post('/xrpc/app.greengale.admin.backfillTags', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)

  try {
    // Get posts that don't have any tags in post_tags table yet
    // Focus on greengale posts (which support tags in the lexicon)
    const posts = await c.env.DB.prepare(`
      SELECT p.uri, p.author_did, p.rkey, a.pds_endpoint
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
      LEFT JOIN post_tags pt ON p.uri = pt.post_uri
      WHERE p.uri LIKE '%/app.greengale.document/%'
        AND pt.post_uri IS NULL
      LIMIT ?
    `).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({ success: true, message: 'No posts to backfill', checked: 0, updated: 0 })
    }

    let checked = 0
    let updated = 0
    const errors: string[] = []

    for (const post of posts.results) {
      checked++
      const uri = post.uri as string
      const did = post.author_did as string
      const rkey = post.rkey as string
      let pdsEndpoint = post.pds_endpoint as string | null

      // If no PDS endpoint cached, resolve it (supports did:plc and did:web)
      if (!pdsEndpoint) {
        pdsEndpoint = await fetchPdsEndpoint(did)
      }

      if (!pdsEndpoint) {
        errors.push(`${uri}: No PDS endpoint`)
        continue
      }

      try {
        // Fetch the record from PDS
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.greengale.document&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (!response.ok) {
          errors.push(`${uri}: Failed to fetch record (${response.status})`)
          continue
        }

        const data = await response.json() as {
          value?: { tags?: string[] }
        }

        const rawTags = data.value?.tags
        if (!rawTags || !Array.isArray(rawTags) || rawTags.length === 0) {
          // No tags in this record - mark as checked by inserting a placeholder we can skip
          // Actually, we'll just continue - not having tags is fine
          continue
        }

        // Normalize tags: lowercase, trim, dedupe, limit to 100
        const normalizedTags = rawTags
          .filter((t): t is string => typeof t === 'string')
          .map(t => t.toLowerCase().trim())
          .filter(t => t.length > 0 && t.length <= 100)
          .slice(0, 100)
          .filter((t, i, arr) => arr.indexOf(t) === i)

        if (normalizedTags.length === 0) {
          continue
        }

        // Insert tags into post_tags table
        const insertStatements = normalizedTags.map(tag =>
          c.env.DB.prepare(
            'INSERT OR IGNORE INTO post_tags (post_uri, tag) VALUES (?, ?)'
          ).bind(uri, tag)
        )

        await c.env.DB.batch(insertStatements)
        updated++

        // Invalidate caches
        await c.env.CACHE.delete(`popular_tags:20`)
        await c.env.CACHE.delete(`popular_tags:50`)
        await c.env.CACHE.delete(`popular_tags:100`)
      } catch (e) {
        errors.push(`${uri}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    }

    // Invalidate all feed caches since tags may have changed
    // Clear common limit values for both feeds
    const cacheKeysToDelete = [
      'recent_posts:24:', 'recent_posts:50:', 'recent_posts:100:',
      'network_posts:24:', 'network_posts:50:', 'network_posts:100:',
    ]
    await Promise.all(cacheKeysToDelete.map(key => c.env.CACHE.delete(key)))

    return c.json({
      success: true,
      postsChecked: checked,
      postsUpdated: updated,
      cacheCleared: cacheKeysToDelete.length,
      errors: errors.slice(0, 20),
    })
  } catch (error) {
    console.error('Error backfilling tags:', error)
    return c.json({ error: 'Failed to backfill', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Clear feed caches (useful after backfills or when debugging caching issues)
// Usage: POST /xrpc/app.greengale.admin.clearFeedCache
app.post('/xrpc/app.greengale.admin.clearFeedCache', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    // Clear all common feed cache entries
    // Note: KV doesn't support prefix-based deletion, so we clear known keys
    const cacheKeysToDelete = [
      // Recent posts (GreenGale)
      'recent_posts:24:', 'recent_posts:50:', 'recent_posts:100:',
      // Network posts (standard.site)
      'network_posts:24:', 'network_posts:50:', 'network_posts:100:',
      // Popular tags
      'popular_tags:10', 'popular_tags:20', 'popular_tags:50', 'popular_tags:100',
    ]

    await Promise.all(cacheKeysToDelete.map(key => c.env.CACHE.delete(key)))

    return c.json({
      success: true,
      keysCleared: cacheKeysToDelete,
    })
  } catch (error) {
    console.error('Error clearing feed cache:', error)
    return c.json({ error: 'Failed to clear cache', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// Delete duplicate site.standard.document posts that are GreenGale-originated
// These are dual-published posts where both app.greengale.document and site.standard.document exist
// Usage: POST /xrpc/app.greengale.admin.cleanupDualPublishedDuplicates?limit=100&dryRun=true
app.post('/xrpc/app.greengale.admin.cleanupDualPublishedDuplicates', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)
  const dryRun = c.req.query('dryRun') !== 'false'

  try {
    // Find site.standard.document posts that have a corresponding app.greengale.document
    // by matching author_did and rkey
    const duplicates = await c.env.DB.prepare(`
      SELECT
        ssd.uri as duplicate_uri,
        ssd.author_did,
        ssd.rkey,
        ssd.title,
        agd.uri as original_uri
      FROM posts ssd
      JOIN posts agd ON ssd.author_did = agd.author_did AND ssd.rkey = agd.rkey
      WHERE ssd.uri LIKE '%/site.standard.document/%'
        AND agd.uri LIKE '%/app.greengale.document/%'
      LIMIT ?
    `).bind(limit).all<{
      duplicate_uri: string
      author_did: string
      rkey: string
      title: string
      original_uri: string
    }>()

    if (!duplicates.results || duplicates.results.length === 0) {
      return c.json({
        success: true,
        message: 'No duplicate entries found',
        dryRun,
        duplicatesFound: 0,
        duplicatesDeleted: 0,
      })
    }

    const duplicateUris = duplicates.results.map(d => d.duplicate_uri)

    if (dryRun) {
      return c.json({
        success: true,
        dryRun: true,
        duplicatesFound: duplicates.results.length,
        duplicatesToDelete: duplicates.results.map(d => ({
          duplicateUri: d.duplicate_uri,
          originalUri: d.original_uri,
          title: d.title,
        })),
      })
    }

    // Delete the duplicate posts
    const placeholders = duplicateUris.map(() => '?').join(',')
    await c.env.DB.prepare(`DELETE FROM posts WHERE uri IN (${placeholders})`)
      .bind(...duplicateUris)
      .run()

    // Delete associated tags
    await c.env.DB.prepare(`DELETE FROM post_tags WHERE post_uri IN (${placeholders})`)
      .bind(...duplicateUris)
      .run()

    // Delete embeddings from Vectorize
    try {
      await c.env.VECTORIZE_INDEX.deleteByIds(duplicateUris)
    } catch (e) {
      console.log('Error deleting embeddings (may not exist):', e)
    }

    // Clear feed caches (non-critical, don't fail if rate limited)
    let cacheCleared = false
    try {
      await Promise.all([
        c.env.CACHE.delete('recent_posts:12:'),
        c.env.CACHE.delete('recent_posts:24:'),
        c.env.CACHE.delete('recent_posts:50:'),
        c.env.CACHE.delete('recent_posts:100:'),
        c.env.CACHE.delete('rss:recent'),
      ])
      cacheCleared = true
    } catch (e) {
      console.log('Cache clear failed (rate limited), will expire naturally:', e)
    }

    return c.json({
      success: true,
      dryRun: false,
      duplicatesFound: duplicates.results.length,
      duplicatesDeleted: duplicates.results.length,
      deletedUris: duplicateUris,
      cacheCleared,
    })
  } catch (error) {
    console.error('Error cleaning up duplicates:', error)
    return c.json({
      error: 'Failed to clean up duplicates',
      details: error instanceof Error ? error.message : 'Unknown',
    }, 500)
  }
})

// Fix corrupted created_at dates (BLOB instead of TEXT)
// Some posts have dates stored as byte arrays instead of strings
// This endpoint re-fetches the date from PDS and stores it correctly
// Usage: POST /xrpc/app.greengale.admin.fixCorruptedDates?limit=50
app.post('/xrpc/app.greengale.admin.fixCorruptedDates', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)

  try {
    // Find posts where created_at doesn't match the expected date format
    // SQLite stores BLOBs and TEXT differently - BLOB types won't match the pattern
    // Also find posts where created_at is NULL or empty
    const posts = await c.env.DB.prepare(`
      SELECT uri, author_did, rkey, created_at, source
      FROM posts
      WHERE uri LIKE '%/site.standard.document/%'
        AND (
          created_at IS NULL
          OR created_at = ''
          OR typeof(created_at) = 'blob'
          OR (typeof(created_at) = 'text' AND created_at NOT GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]*')
        )
      LIMIT ?
    `).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({ success: true, message: 'No corrupted dates found', checked: 0, fixed: 0 })
    }

    let fixed = 0
    const errors: string[] = []

    for (const post of posts.results) {
      const uri = post.uri as string
      const did = post.author_did as string
      const rkey = post.rkey as string

      try {
        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          errors.push(`${uri}: Failed to resolve DID`)
          continue
        }

        // Determine collection from URI
        const collectionMatch = uri.match(/\/([^/]+)\/[^/]+$/)
        const collection = collectionMatch ? collectionMatch[1] : 'site.standard.document'

        // Fetch the record from PDS
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (!response.ok) {
          errors.push(`${uri}: Failed to fetch record (${response.status})`)
          continue
        }

        const data = await response.json() as {
          value?: { publishedAt?: string; createdAt?: string }
        }

        // Get the date - V2/site.standard use publishedAt, V1/WhiteWind use createdAt
        const dateValue = data.value?.publishedAt || data.value?.createdAt
        if (!dateValue || typeof dateValue !== 'string') {
          errors.push(`${uri}: No valid date in record`)
          continue
        }

        // Update the database with the correct date string
        await c.env.DB.prepare(
          'UPDATE posts SET created_at = ? WHERE uri = ?'
        ).bind(dateValue, uri).run()

        fixed++
        console.log(`Fixed created_at for ${uri}: ${dateValue}`)
      } catch (err) {
        errors.push(`${uri}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    // Clear caches if we fixed anything
    if (fixed > 0) {
      await Promise.all([
        c.env.CACHE.delete('network_posts:24:'),
        c.env.CACHE.delete('network_posts:50:'),
        c.env.CACHE.delete('network_posts:100:'),
      ])
    }

    return c.json({
      success: true,
      postsChecked: posts.results.length,
      postsFixed: fixed,
      errors: errors.slice(0, 20),
    })
  } catch (error) {
    console.error('Error fixing corrupted dates:', error)
    return c.json({ error: 'Failed to fix dates', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

// =============================================================================
// Embedding Management
// =============================================================================

/**
 * Get embedding statistics
 */
app.get('/xrpc/app.greengale.admin.getEmbeddingStats', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const stats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN has_embedding = 1 THEN 1 ELSE 0 END) as embedded,
        SUM(CASE WHEN has_embedding = 0 AND visibility = 'public' AND deleted_at IS NULL THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN has_embedding = -1 THEN 1 ELSE 0 END) as skipped,
        SUM(CASE WHEN has_embedding = -2 THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as soft_deleted
      FROM posts
    `).first()

    return c.json({
      total: stats?.total ?? 0,
      embedded: stats?.embedded ?? 0,
      pending: stats?.pending ?? 0,
      skipped: stats?.skipped ?? 0,
      failed: stats?.failed ?? 0,
      softDeleted: stats?.soft_deleted ?? 0,
    })
  } catch (error) {
    console.error('Error getting embedding stats:', error)
    return c.json({ error: 'Failed to get stats' }, 500)
  }
})

/**
 * Backfill embeddings for existing posts
 * Processes posts that don't have embeddings yet
 */
app.post('/xrpc/app.greengale.admin.backfillEmbeddings', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const dryRun = c.req.query('dryRun') === 'true'

  try {
    // Get posts needing embeddings
    const posts = await c.env.DB.prepare(`
      SELECT
        p.uri,
        p.author_did,
        p.title,
        p.created_at
      FROM posts p
      WHERE p.visibility = 'public'
        AND p.deleted_at IS NULL
        AND (p.has_embedding = 0 OR p.has_embedding = -2)
      ORDER BY p.created_at DESC
      LIMIT ?
    `).bind(limit).all()

    if (!posts.results?.length) {
      return c.json({ success: true, processed: 0, message: 'No posts need embeddings' })
    }

    if (dryRun) {
      return c.json({
        success: true,
        dryRun: true,
        wouldProcess: posts.results.length,
        posts: posts.results.map(p => ({
          uri: p.uri,
          title: p.title,
        })),
      })
    }

    let processed = 0
    let skipped = 0
    let failed = 0
    const errors: Array<{ uri: string; error: string }> = []

    for (const post of posts.results) {
      const uri = post.uri as string
      const did = post.author_did as string
      const title = post.title as string | null
      const createdAt = post.created_at as string | null

      try {
        // Parse URI to get collection and rkey
        const uriMatch = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
        if (!uriMatch) {
          errors.push({ uri, error: 'Invalid URI format' })
          failed++
          continue
        }

        const [, , collection, rkey] = uriMatch

        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          errors.push({ uri, error: 'Failed to resolve DID' })
          failed++
          continue
        }

        // Fetch record from PDS
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (!response.ok) {
          if (response.status === 404) {
            // Post deleted from PDS - soft delete it
            await c.env.DB.prepare(
              'UPDATE posts SET deleted_at = datetime("now") WHERE uri = ?'
            ).bind(uri).run()
            skipped++
            continue
          }
          errors.push({ uri, error: `PDS fetch failed: ${response.status}` })
          failed++
          continue
        }

        const data = await response.json() as { value: Record<string, unknown> }
        const record = data.value

        // Extract content
        const extracted = extractContent(record, collection)
        if (!extracted.success || extracted.wordCount < 20) {
          await c.env.DB.prepare(
            'UPDATE posts SET has_embedding = -1 WHERE uri = ?'
          ).bind(uri).run()
          skipped++
          continue
        }

        // Hash content
        const contentHash = await hashContent(extracted.text)

        // Get subtitle for context
        const subtitle = collection === 'site.standard.document'
          ? (record?.description as string) || undefined
          : (record?.subtitle as string) || undefined

        // Chunk content
        const chunks = chunkByHeadings(extracted, title || undefined, subtitle)

        // Generate embeddings
        const texts = chunks.map(c => c.text)
        const embeddings = await generateEmbeddings(c.env.AI, texts)

        // Prepare for Vectorize (use hashed IDs to fit 64-byte limit)
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
            return { id, vector: embeddings[i], metadata }
          })
        )

        // Upsert to Vectorize
        await upsertEmbeddings(c.env.VECTORIZE, vectorEmbeddings)

        // Update D1
        await c.env.DB.prepare(
          'UPDATE posts SET has_embedding = 1, content_hash = ? WHERE uri = ?'
        ).bind(contentHash, uri).run()

        processed++
      } catch (err) {
        errors.push({ uri, error: err instanceof Error ? err.message : 'Unknown' })
        failed++
        // Mark as failed to retry later
        await c.env.DB.prepare(
          'UPDATE posts SET has_embedding = -2 WHERE uri = ?'
        ).bind(uri).run()
      }
    }

    return c.json({
      success: true,
      processed,
      skipped,
      failed,
      errors: errors.slice(0, 10),
    })
  } catch (error) {
    console.error('Error backfilling embeddings:', error)
    return c.json({ error: 'Failed to backfill', details: error instanceof Error ? error.message : 'Unknown' }, 500)
  }
})

/**
 * Backfill all posts for a specific author (admin only)
 * Useful for indexing WhiteWind or other posts from authors not yet in the system
 * Usage: POST /xrpc/app.greengale.admin.backfillAuthor
 * Body: { "did": "did:plc:xxx" } or { "handle": "user.bsky.social" }
 * Query params: ?dryRun=true (preview without indexing), ?collection=com.whtwnd.blog.entry (specific collection)
 */
app.post('/xrpc/app.greengale.admin.backfillAuthor', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const dryRun = c.req.query('dryRun') === 'true'
  const collectionFilter = c.req.query('collection') // Optional: filter to specific collection
  // Limit how many posts to index per invocation (to avoid Cloudflare subrequest limits)
  const limitParam = c.req.query('limit')
  const indexLimit = limitParam ? parseInt(limitParam, 10) : 50 // Default to 50 to stay well under 1000 subrequest limit

  try {
    const body = await c.req.json() as { did?: string; handle?: string }
    let { did } = body
    const { handle } = body

    // Resolve handle to DID if needed
    if (!did && handle) {
      // Try our DB first
      const authorRow = await c.env.DB.prepare(
        'SELECT did FROM authors WHERE handle = ?'
      ).bind(handle).first()

      if (authorRow) {
        did = authorRow.did as string
      } else {
        // Resolve via Bluesky API
        const resolveRes = await fetch(
          `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
        )
        if (resolveRes.ok) {
          const resolved = await resolveRes.json() as { did: string }
          did = resolved.did
        }
      }
    }

    if (!did) {
      return c.json({ error: 'Could not resolve DID. Provide a valid did or handle.' }, 400)
    }

    // Resolve PDS endpoint
    const pdsEndpoint = await fetchPdsEndpoint(did)
    if (!pdsEndpoint) {
      return c.json({ error: 'Could not resolve PDS endpoint for DID' }, 400)
    }

    // Collections to check (WhiteWind, GreenGale v1/v2, site.standard)
    const collections = collectionFilter
      ? [collectionFilter]
      : [
          'com.whtwnd.blog.entry',
          'app.greengale.blog.entry',
          'app.greengale.document',
          'site.standard.document',
        ]

    const results: {
      collection: string
      found: number
      alreadyIndexed: number
      newlyIndexed: number
      failed: number
      posts: Array<{ uri: string; title: string | null; status: string }>
    }[] = []

    // Get firehose DO for reindexing
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    for (const collection of collections) {
      const collectionResult = {
        collection,
        found: 0,
        alreadyIndexed: 0,
        newlyIndexed: 0,
        failed: 0,
        posts: [] as Array<{ uri: string; title: string | null; status: string }>,
      }

      try {
        // Fetch all records with pagination
        let cursor: string | undefined
        const allRecords: Array<{ uri: string; value: Record<string, unknown> }> = []

        do {
          const listUrl = new URL(`${pdsEndpoint}/xrpc/com.atproto.repo.listRecords`)
          listUrl.searchParams.set('repo', did)
          listUrl.searchParams.set('collection', collection)
          listUrl.searchParams.set('limit', '100')
          if (cursor) {
            listUrl.searchParams.set('cursor', cursor)
          }

          const response = await fetch(listUrl.toString())
          if (!response.ok) {
            // Collection doesn't exist for this user, skip
            break
          }

          const data = await response.json() as {
            records?: Array<{ uri: string; value: Record<string, unknown> }>
            cursor?: string
          }

          if (data.records?.length) {
            allRecords.push(...data.records)
          }
          cursor = data.cursor
        } while (cursor)

        collectionResult.found = allRecords.length
        // Debug: mark that we reached this point
        ;(collectionResult as Record<string, unknown>).reachedPostFetch = true

        if (allRecords.length === 0) {
          results.push(collectionResult)
          continue
        }

        // Debug: mark that we passed the length check
        ;(collectionResult as Record<string, unknown>).passedLengthCheck = true

        // Check which posts are already indexed (chunk to avoid SQLite placeholder limit)
        // D1 SQLite has a ~100 variable limit per query
        const uris = allRecords.map(r => r.uri)
        const existingUris = new Set<string>()
        const CHUNK_SIZE = 100

        for (let i = 0; i < uris.length; i += CHUNK_SIZE) {
          const chunk = uris.slice(i, i + CHUNK_SIZE)
          const placeholders = chunk.map(() => '?').join(',')
          const existingPosts = await c.env.DB.prepare(
            `SELECT uri FROM posts WHERE uri IN (${placeholders})`
          ).bind(...chunk).all()
          for (const row of existingPosts.results || []) {
            existingUris.add(row.uri as string)
          }
        }

        // Debug: mark that chunked query completed
        ;(collectionResult as Record<string, unknown>).chunkedQueryComplete = true
        ;(collectionResult as Record<string, unknown>).debug = {
          totalUris: uris.length,
          existingUrisCount: existingUris.size,
          dryRun,
          sampleUris: uris.slice(0, 3),
        }

        // Debug: about to start loop
        ;(collectionResult as Record<string, unknown>).startingLoop = true

        // Track how many we've indexed this invocation (to respect limit)
        let indexedThisRun = 0
        let skippedDueToLimit = 0

        for (const record of allRecords) {
          const uri = record.uri
          const title = (record.value.title as string) || null

          if (existingUris.has(uri)) {
            collectionResult.alreadyIndexed++
            collectionResult.posts.push({ uri, title, status: 'already_indexed' })
            continue
          }

          if (dryRun) {
            collectionResult.newlyIndexed++
            collectionResult.posts.push({ uri, title, status: 'would_index' })
            continue
          }

          // Check if we've hit the limit for this invocation
          if (indexedThisRun >= indexLimit) {
            skippedDueToLimit++
            continue
          }

          // Index via firehose DO (handles embeddings, author data, etc.)
          try {
            const reindexResponse = await firehose.fetch('http://internal/reindex', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uri }),
            })

            if (reindexResponse.ok) {
              collectionResult.newlyIndexed++
              indexedThisRun++
              collectionResult.posts.push({ uri, title, status: 'indexed' })
            } else {
              const errorData = await reindexResponse.json().catch(() => ({})) as { error?: string }
              collectionResult.failed++
              collectionResult.posts.push({
                uri,
                title,
                status: `failed: ${errorData.error || reindexResponse.statusText}`,
              })
            }
          } catch (err) {
            collectionResult.failed++
            collectionResult.posts.push({
              uri,
              title,
              status: `failed: ${err instanceof Error ? err.message : 'Unknown'}`,
            })
          }
        }

        // Track remaining posts for the response
        if (skippedDueToLimit > 0) {
          ;(collectionResult as Record<string, unknown>).remaining = skippedDueToLimit
        }
      } catch (err) {
        console.error(`Error processing ${collection} for ${did}:`, err)
        // Include error in result for debugging
        ;(collectionResult as Record<string, unknown>).error = err instanceof Error ? err.message : String(err)
      }

      results.push(collectionResult)
    }

    // Invalidate cache if we indexed anything
    const totalIndexed = results.reduce((sum, r) => sum + r.newlyIndexed, 0)
    if (totalIndexed > 0 && !dryRun) {
      // Get author's handle for RSS cache invalidation
      const authorRow = await c.env.DB.prepare(
        'SELECT handle FROM authors WHERE did = ?'
      ).bind(did).first()
      const authorHandle = authorRow?.handle as string | undefined

      await Promise.all([
        c.env.CACHE.delete('recent_posts:12:'),
        c.env.CACHE.delete('recent_posts:24:'),
        c.env.CACHE.delete('recent_posts:50:'),
        c.env.CACHE.delete('recent_posts:100:'),
        // Invalidate RSS feeds
        c.env.CACHE.delete('rss:recent'),
        authorHandle ? c.env.CACHE.delete(`rss:author:${authorHandle}`) : Promise.resolve(),
      ])
    }

    // Summary
    const summary = {
      did,
      handle: handle || null,
      pdsEndpoint,
      dryRun,
      totalFound: results.reduce((sum, r) => sum + r.found, 0),
      totalAlreadyIndexed: results.reduce((sum, r) => sum + r.alreadyIndexed, 0),
      totalNewlyIndexed: totalIndexed,
      totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
      indexLimit,
      collections: results.map(r => {
        const result = r as Record<string, unknown>
        return {
          collection: r.collection,
          found: r.found,
          alreadyIndexed: r.alreadyIndexed,
          newlyIndexed: r.newlyIndexed,
          failed: r.failed,
          // Only include post details for collections with posts
          ...(r.found > 0 ? { posts: r.posts.slice(0, 20) } : {}),
          // Include remaining count if we hit the limit
          ...(result.remaining ? { remaining: result.remaining } : {}),
          // Include debug fields if present
          ...(result.error ? { error: result.error } : {}),
          ...(result.debug ? { debug: result.debug } : {}),
          ...(result.reachedPostFetch !== undefined ? { reachedPostFetch: result.reachedPostFetch } : {}),
          ...(result.passedLengthCheck !== undefined ? { passedLengthCheck: result.passedLengthCheck } : {}),
          ...(result.chunkedQueryComplete !== undefined ? { chunkedQueryComplete: result.chunkedQueryComplete } : {}),
          ...(result.startingLoop !== undefined ? { startingLoop: result.startingLoop } : {}),
        }
      }),
    }

    return c.json(summary)
  } catch (error) {
    console.error('Error backfilling author:', error)
    return c.json({
      error: 'Failed to backfill author',
      details: error instanceof Error ? error.message : 'Unknown',
    }, 500)
  }
})

/**
 * Discover and backfill WhiteWind authors (admin only)
 * Uses com.atproto.sync.listReposByCollection to find all DIDs with WhiteWind posts,
 * then backfills any that aren't already indexed.
 * Usage: POST /xrpc/app.greengale.admin.discoverWhiteWindAuthors?limit=20&dryRun=true
 * Query params:
 *   - limit: Max authors to process per call (default 20, max 100)
 *   - cursor: Pagination cursor from previous call
 *   - dryRun: Preview without indexing
 *   - skipExisting: Skip authors who already have posts indexed (default true)
 */
app.post('/xrpc/app.greengale.admin.discoverWhiteWindAuthors', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  const inputCursor = c.req.query('cursor') || undefined
  const dryRun = c.req.query('dryRun') === 'true'
  const skipExisting = c.req.query('skipExisting') !== 'false' // Default true

  // Use regional relay - bsky.network doesn't support listReposByCollection directly
  const RELAY_URL = 'https://relay1.us-east.bsky.network'
  const COLLECTION = 'com.whtwnd.blog.entry'

  try {
    // Step 1: Fetch DIDs with WhiteWind posts from the relay
    const listUrl = new URL(`${RELAY_URL}/xrpc/com.atproto.sync.listReposByCollection`)
    listUrl.searchParams.set('collection', COLLECTION)
    listUrl.searchParams.set('limit', String(limit * 2)) // Fetch extra to account for filtering
    if (inputCursor) {
      listUrl.searchParams.set('cursor', inputCursor)
    }

    const listResponse = await fetch(listUrl.toString())
    if (!listResponse.ok) {
      const errorText = await listResponse.text()
      return c.json({
        error: 'Failed to fetch from relay',
        status: listResponse.status,
        details: errorText,
      }, 500)
    }

    const listData = await listResponse.json() as {
      repos?: Array<{ did: string }>
      cursor?: string
    }

    if (!listData.repos?.length) {
      return c.json({
        success: true,
        message: 'No more WhiteWind authors to discover',
        discovered: 0,
        processed: 0,
        cursor: null,
      })
    }

    // Step 2: Filter out authors we've already indexed (if skipExisting)
    let didsToProcess = listData.repos.map(r => r.did)

    if (skipExisting) {
      // Check which DIDs already have WhiteWind posts in our DB
      const placeholders = didsToProcess.map(() => '?').join(',')
      const existingAuthors = await c.env.DB.prepare(`
        SELECT DISTINCT author_did FROM posts
        WHERE author_did IN (${placeholders})
        AND source = 'whitewind'
      `).bind(...didsToProcess).all()

      const existingDids = new Set((existingAuthors.results || []).map(r => r.author_did as string))
      didsToProcess = didsToProcess.filter(did => !existingDids.has(did))
    }

    // Limit to requested amount
    didsToProcess = didsToProcess.slice(0, limit)

    if (didsToProcess.length === 0) {
      return c.json({
        success: true,
        message: 'All discovered authors already indexed',
        discovered: listData.repos.length,
        alreadyIndexed: listData.repos.length,
        processed: 0,
        cursor: listData.cursor || null,
      })
    }

    // Step 3: Process each author
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    const results: Array<{
      did: string
      handle: string | null
      postsFound: number
      postsIndexed: number
      status: string
    }> = []

    for (const did of didsToProcess) {
      const authorResult = {
        did,
        handle: null as string | null,
        postsFound: 0,
        postsIndexed: 0,
        status: 'pending',
      }

      try {
        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          authorResult.status = 'failed: could not resolve PDS'
          results.push(authorResult)
          continue
        }

        // Try to get handle from Bluesky API
        try {
          const profileRes = await fetch(
            `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
          )
          if (profileRes.ok) {
            const profile = await profileRes.json() as { handle?: string }
            authorResult.handle = profile.handle || null
          }
        } catch {
          // Handle lookup failed, continue without it
        }

        // Fetch WhiteWind posts
        const recordsUrl = new URL(`${pdsEndpoint}/xrpc/com.atproto.repo.listRecords`)
        recordsUrl.searchParams.set('repo', did)
        recordsUrl.searchParams.set('collection', COLLECTION)
        recordsUrl.searchParams.set('limit', '100')

        const recordsResponse = await fetch(recordsUrl.toString())
        if (!recordsResponse.ok) {
          authorResult.status = 'failed: could not fetch records'
          results.push(authorResult)
          continue
        }

        const recordsData = await recordsResponse.json() as {
          records?: Array<{ uri: string; value: Record<string, unknown> }>
        }

        const records = recordsData.records || []
        authorResult.postsFound = records.length

        if (records.length === 0) {
          authorResult.status = 'no posts found'
          results.push(authorResult)
          continue
        }

        if (dryRun) {
          authorResult.postsIndexed = records.length
          authorResult.status = 'would_index'
          results.push(authorResult)
          continue
        }

        // Check which posts are already indexed
        const uris = records.map(r => r.uri)
        const uriPlaceholders = uris.map(() => '?').join(',')
        const existingPosts = await c.env.DB.prepare(
          `SELECT uri FROM posts WHERE uri IN (${uriPlaceholders})`
        ).bind(...uris).all()
        const existingUris = new Set((existingPosts.results || []).map(r => r.uri as string))

        // Index new posts
        let indexed = 0
        for (const record of records) {
          if (existingUris.has(record.uri)) continue

          try {
            const reindexResponse = await firehose.fetch('http://internal/reindex', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uri: record.uri }),
            })

            if (reindexResponse.ok) {
              indexed++
            }
          } catch {
            // Individual post failed, continue with others
          }
        }

        authorResult.postsIndexed = indexed
        authorResult.status = indexed > 0 ? 'indexed' : 'all_posts_existed'
        results.push(authorResult)
      } catch (err) {
        authorResult.status = `failed: ${err instanceof Error ? err.message : 'unknown'}`
        results.push(authorResult)
      }
    }

    // Invalidate cache if we indexed anything
    const totalIndexed = results.reduce((sum, r) => sum + r.postsIndexed, 0)
    if (totalIndexed > 0 && !dryRun) {
      await Promise.all([
        c.env.CACHE.delete('recent_posts:12:'),
        c.env.CACHE.delete('recent_posts:24:'),
        c.env.CACHE.delete('recent_posts:50:'),
        c.env.CACHE.delete('recent_posts:100:'),
        c.env.CACHE.delete('rss:recent'),
      ])
    }

    return c.json({
      success: true,
      dryRun,
      discovered: listData.repos.length,
      processed: results.length,
      totalPostsFound: results.reduce((sum, r) => sum + r.postsFound, 0),
      totalPostsIndexed: totalIndexed,
      cursor: listData.cursor || null,
      authors: results,
    })
  } catch (error) {
    console.error('Error discovering WhiteWind authors:', error)
    return c.json({
      error: 'Failed to discover WhiteWind authors',
      details: error instanceof Error ? error.message : 'Unknown',
    }, 500)
  }
})

/**
 * Discover and backfill site.standard.publication records (admin only)
 * Used to index publications from Leaflet, Blento, and other platforms.
 * Usage: POST /xrpc/app.greengale.admin.discoverSiteStandardPublications?limit=20&dryRun=true
 * Query params:
 *   - limit: Max publications to process per call (default 20, max 100)
 *   - cursor: Pagination cursor from previous call
 *   - dryRun: Preview without indexing
 *   - skipExisting: Skip publications that already exist in DB (default true)
 *   - urlFilter: Only index publications matching this URL pattern (e.g., "leaflet.pub")
 */
app.post('/xrpc/app.greengale.admin.discoverSiteStandardPublications', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  const inputCursor = c.req.query('cursor') || undefined
  const dryRun = c.req.query('dryRun') === 'true'
  const skipExisting = c.req.query('skipExisting') !== 'false' // Default true
  const urlFilter = c.req.query('urlFilter') || undefined // e.g., "leaflet.pub"

  // Use regional relay
  const RELAY_URL = 'https://relay1.us-east.bsky.network'
  const COLLECTION = 'site.standard.publication'

  try {
    // Step 1: Fetch DIDs with site.standard.publication from the relay
    const listUrl = new URL(`${RELAY_URL}/xrpc/com.atproto.sync.listReposByCollection`)
    listUrl.searchParams.set('collection', COLLECTION)
    listUrl.searchParams.set('limit', String(limit * 3)) // Fetch extra to account for filtering
    if (inputCursor) {
      listUrl.searchParams.set('cursor', inputCursor)
    }

    const listResponse = await fetch(listUrl.toString())
    if (!listResponse.ok) {
      const errorText = await listResponse.text()
      return c.json({
        error: 'Failed to fetch from relay',
        status: listResponse.status,
        details: errorText,
      }, 500)
    }

    const listData = await listResponse.json() as {
      repos?: Array<{ did: string }>
      cursor?: string
    }

    if (!listData.repos?.length) {
      return c.json({
        success: true,
        message: 'No more site.standard.publication records to discover',
        discovered: 0,
        processed: 0,
        cursor: null,
      })
    }

    // Step 2: Filter out publications we've already indexed (if skipExisting)
    let didsToProcess = listData.repos.map(r => r.did)

    if (skipExisting) {
      // Batch the query to avoid SQLite variable limit
      const BATCH_SIZE = 50
      const existingDids = new Set<string>()

      for (let i = 0; i < didsToProcess.length; i += BATCH_SIZE) {
        const batch = didsToProcess.slice(i, i + BATCH_SIZE)
        const placeholders = batch.map(() => '?').join(',')
        const existingPubs = await c.env.DB.prepare(`
          SELECT author_did FROM publications
          WHERE author_did IN (${placeholders})
        `).bind(...batch).all()

        for (const r of existingPubs.results || []) {
          existingDids.add(r.author_did as string)
        }
      }

      didsToProcess = didsToProcess.filter(did => !existingDids.has(did))
    }

    // Limit to requested amount
    didsToProcess = didsToProcess.slice(0, limit)

    if (didsToProcess.length === 0) {
      return c.json({
        success: true,
        message: 'All discovered publications already indexed',
        discovered: listData.repos.length,
        alreadyIndexed: listData.repos.length,
        processed: 0,
        cursor: listData.cursor || null,
      })
    }

    // Step 3: Process each publication
    const firehoseId = c.env.FIREHOSE.idFromName('main')
    const firehose = c.env.FIREHOSE.get(firehoseId)

    const results: Array<{
      did: string
      handle: string | null
      url: string | null
      name: string | null
      status: string
    }> = []

    for (const did of didsToProcess) {
      const pubResult = {
        did,
        handle: null as string | null,
        url: null as string | null,
        name: null as string | null,
        status: 'pending',
      }

      try {
        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          pubResult.status = 'failed: could not resolve PDS'
          results.push(pubResult)
          continue
        }

        // Try to get handle from Bluesky API
        try {
          const profileRes = await fetch(
            `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
          )
          if (profileRes.ok) {
            const profile = await profileRes.json() as { handle?: string }
            pubResult.handle = profile.handle || null
          }
        } catch {
          // Handle lookup failed, continue without it
        }

        // Fetch site.standard.publication records
        const recordsUrl = new URL(`${pdsEndpoint}/xrpc/com.atproto.repo.listRecords`)
        recordsUrl.searchParams.set('repo', did)
        recordsUrl.searchParams.set('collection', COLLECTION)
        recordsUrl.searchParams.set('limit', '10')

        const recordsResponse = await fetch(recordsUrl.toString())
        if (!recordsResponse.ok) {
          pubResult.status = 'failed: could not fetch records'
          results.push(pubResult)
          continue
        }

        const recordsData = await recordsResponse.json() as {
          records?: Array<{ uri: string; value: Record<string, unknown> }>
        }

        const records = recordsData.records || []
        if (records.length === 0) {
          pubResult.status = 'no publications found'
          results.push(pubResult)
          continue
        }

        // Find the first publication (optionally filtered by URL)
        let targetRecord: { uri: string; value: Record<string, unknown> } | undefined
        for (const record of records) {
          const recordUrl = record.value?.url as string | undefined
          pubResult.url = recordUrl || null
          pubResult.name = (record.value?.name as string) || null

          // If URL filter is set, only process matching publications
          if (urlFilter && recordUrl && !recordUrl.toLowerCase().includes(urlFilter.toLowerCase())) {
            continue
          }

          targetRecord = record
          break
        }

        if (!targetRecord) {
          pubResult.status = urlFilter ? `no publication matching ${urlFilter}` : 'no valid publication'
          results.push(pubResult)
          continue
        }

        if (dryRun) {
          pubResult.status = 'would_index'
          results.push(pubResult)
          continue
        }

        // Index the publication via firehose reindex
        try {
          const reindexResponse = await firehose.fetch('http://internal/reindex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uri: targetRecord.uri }),
          })

          if (reindexResponse.ok) {
            pubResult.status = 'indexed'
          } else {
            pubResult.status = 'failed: reindex returned error'
          }
        } catch (err) {
          pubResult.status = `failed: ${err instanceof Error ? err.message : 'reindex error'}`
        }

        results.push(pubResult)
      } catch (err) {
        pubResult.status = `failed: ${err instanceof Error ? err.message : 'unknown'}`
        results.push(pubResult)
      }
    }

    // Invalidate search cache if we indexed anything
    const indexed = results.filter(r => r.status === 'indexed').length
    if (indexed > 0 && !dryRun) {
      // Clear publication search cache (starts with "search:")
      // Note: We can't enumerate KV keys, so just clear common patterns
    }

    return c.json({
      success: true,
      dryRun,
      urlFilter: urlFilter || null,
      discovered: listData.repos.length,
      processed: results.length,
      indexed,
      cursor: listData.cursor || null,
      publications: results,
    })
  } catch (error) {
    console.error('Error discovering site.standard.publications:', error)
    return c.json({
      error: 'Failed to discover site.standard.publications',
      details: error instanceof Error ? error.message : 'Unknown',
    }, 500)
  }
})

// Resolve avatar URL: prefer GreenGale publication icon over Bluesky avatar
function resolveAvatar(row: Record<string, unknown>): string | null {
  if (row.icon_cid && row.pds_endpoint && row.author_did) {
    return `${row.pds_endpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(row.author_did as string)}&cid=${encodeURIComponent(row.icon_cid as string)}`
  }
  return (row.avatar_url as string) || null
}

// Format post from DB row to API response
// Tags can be passed directly or extracted from the 'tags' column (comma-separated from GROUP_CONCAT)
function formatPost(row: Record<string, unknown>, tagsOverride?: string[]) {
  // Use provided tags, or extract from row.tags (GROUP_CONCAT result)
  let postTags: string[] | undefined = tagsOverride
  if (!postTags && row.tags && typeof row.tags === 'string') {
    postTags = row.tags.split(',').filter(t => t.length > 0)
  }

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
    contentPreview: row.content_preview,
    firstImageCid: row.first_image_cid,
    externalUrl: row.external_url || null,
    author: row.handle ? {
      did: row.author_did,
      handle: row.handle,
      displayName: row.display_name,
      avatar: resolveAvatar(row),
      pdsEndpoint: row.pds_endpoint,
    } : undefined,
    tags: postTags?.length ? postTags : undefined,
  }
}

// Scheduled handler for cron-based tasks
// Crons: */5 * * * * (watchdog), 0 3 * * * (reconciliation)
async function scheduled(
  event: ScheduledEvent,
  env: { DB: D1Database; CACHE: KVNamespace; FIREHOSE: DurableObjectNamespace; VECTORIZE: VectorizeIndex; AI: Ai },
  _ctx: ExecutionContext
) {
  // Check if this is the daily reconciliation (3 AM UTC)
  const scheduledDate = new Date(event.scheduledTime)
  const isReconciliation = scheduledDate.getUTCHours() === 3 && scheduledDate.getUTCMinutes() === 0

  if (isReconciliation) {
    await runReconciliation(env)
  } else {
    await runFirehoseWatchdog(env)
  }
}

// Firehose watchdog - runs every 5 minutes
async function runFirehoseWatchdog(
  env: { FIREHOSE: DurableObjectNamespace }
) {
  console.log('Firehose watchdog cron triggered')

  try {
    // Get firehose status
    const id = env.FIREHOSE.idFromName('main')
    const stub = env.FIREHOSE.get(id)
    const statusResponse = await stub.fetch(new Request('http://internal/status'))
    const status = await statusResponse.json() as {
      enabled: boolean
      connected: boolean
      cursor: number
      lastTimeUs: number
      processedCount: number
      errorCount: number
    }

    console.log('Firehose status:', JSON.stringify(status))

    // Check if firehose needs to be restarted
    const now = Date.now() * 1000 // Convert to microseconds
    const lastEventAge = status.lastTimeUs ? (now - status.lastTimeUs) / 1_000_000 : Infinity // seconds
    const staleThresholdSec = 10 * 60 // 10 minutes

    let shouldRestart = false
    let reason = ''

    if (!status.enabled) {
      shouldRestart = true
      reason = 'Firehose not enabled'
    } else if (!status.connected) {
      shouldRestart = true
      reason = 'Firehose not connected'
    } else if (lastEventAge > staleThresholdSec) {
      shouldRestart = true
      reason = `No events for ${Math.round(lastEventAge / 60)} minutes`
    }

    if (shouldRestart) {
      console.log(`Restarting firehose: ${reason}`)
      await stub.fetch(new Request('http://internal/start', { method: 'POST' }))
      console.log('Firehose restart initiated')
    } else {
      console.log('Firehose healthy, no action needed')
    }
  } catch (error) {
    console.error('Firehose watchdog error:', error)
    // Try to restart anyway on error
    try {
      const id = env.FIREHOSE.idFromName('main')
      const stub = env.FIREHOSE.get(id)
      await stub.fetch(new Request('http://internal/start', { method: 'POST' }))
      console.log('Firehose restart initiated after error')
    } catch (restartError) {
      console.error('Failed to restart firehose:', restartError)
    }
  }
}

// Daily reconciliation - runs at 3 AM UTC
// Verifies embeddings are in sync with D1, cleans up stale data, retries failed embeddings
async function runReconciliation(
  env: { DB: D1Database; VECTORIZE: VectorizeIndex; AI: Ai }
) {
  console.log('Reconciliation cron triggered')

  try {
    // 1. Retry failed embeddings (has_embedding = -2)
    const failedPosts = await env.DB.prepare(`
      SELECT uri, author_did, title, created_at
      FROM posts
      WHERE visibility = 'public'
        AND deleted_at IS NULL
        AND has_embedding = -2
      LIMIT 25
    `).all()

    let retried = 0
    let retrySuccess = 0
    let retryFailed = 0

    for (const post of failedPosts.results || []) {
      const uri = post.uri as string
      const did = post.author_did as string
      const title = post.title as string | null
      const createdAt = post.created_at as string | null

      try {
        // Parse URI to get collection and rkey
        const uriMatch = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
        if (!uriMatch) continue

        const [, , collection, rkey] = uriMatch

        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          console.log(`Retry skip ${uri}: cannot resolve PDS`)
          continue
        }

        // Fetch record from PDS
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (response.status === 404) {
          // Post deleted - soft delete it
          await env.DB.prepare(
            'UPDATE posts SET deleted_at = datetime("now"), has_embedding = 0 WHERE uri = ?'
          ).bind(uri).run()
          console.log(`Retry: soft-deleted missing post ${uri}`)
          continue
        }

        if (!response.ok) {
          console.log(`Retry skip ${uri}: PDS returned ${response.status}`)
          continue
        }

        const data = await response.json() as { value: Record<string, unknown> }
        const record = data.value

        // Extract content
        const extracted = extractContent(record, collection)
        if (!extracted.success || extracted.wordCount < 20) {
          await env.DB.prepare(
            'UPDATE posts SET has_embedding = -1 WHERE uri = ?'
          ).bind(uri).run()
          console.log(`Retry: marked as skipped (too short) ${uri}`)
          retried++
          continue
        }

        // Hash content
        const contentHash = await hashContent(extracted.text)

        // Get subtitle for context
        const subtitle = collection === 'site.standard.document'
          ? (record?.description as string) || undefined
          : (record?.subtitle as string) || undefined

        // Chunk content
        const chunks = chunkByHeadings(extracted, title || undefined, subtitle)

        // Generate embeddings
        const texts = chunks.map(c => c.text)
        const embeddings = await generateEmbeddings(env.AI, texts)

        // Prepare for Vectorize
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
            return { id, vector: embeddings[i], metadata }
          })
        )

        // Upsert to Vectorize
        await upsertEmbeddings(env.VECTORIZE, vectorEmbeddings)

        // Update D1
        await env.DB.prepare(
          'UPDATE posts SET has_embedding = 1, content_hash = ? WHERE uri = ?'
        ).bind(contentHash, uri).run()

        retried++
        retrySuccess++
        console.log(`Retry success: ${uri} (${chunks.length} chunks)`)
      } catch (err) {
        retried++
        retryFailed++
        console.error(`Retry failed for ${uri}:`, err)
        // Leave as -2 to retry next time
      }
    }

    if (retried > 0) {
      console.log(`Embedding retry: ${retrySuccess} success, ${retryFailed} failed out of ${retried} attempted`)
    }

    // 2. Verify stale posts still exist (not verified in 7 days)
    const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const stalePosts = await env.DB.prepare(`
      SELECT uri, author_did, has_embedding
      FROM posts
      WHERE visibility = 'public'
        AND deleted_at IS NULL
        AND (last_verified_at IS NULL OR last_verified_at < ?)
      LIMIT 50
    `).bind(staleThreshold).all()

    let verified = 0
    let softDeleted = 0

    for (const post of stalePosts.results || []) {
      const uri = post.uri as string
      const did = post.author_did as string
      const hasEmbedding = post.has_embedding as number

      try {
        // Parse URI to get collection and rkey
        const uriMatch = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
        if (!uriMatch) continue

        const [, , collection, rkey] = uriMatch

        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          // Can't verify - skip for now
          continue
        }

        // Check if post still exists
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (response.status === 404) {
          // Post deleted from PDS - soft delete and remove embedding
          await env.DB.prepare(
            'UPDATE posts SET deleted_at = datetime("now"), has_embedding = 0 WHERE uri = ?'
          ).bind(uri).run()

          if (hasEmbedding === 1) {
            const { deletePostEmbeddings } = await import('../lib/embeddings')
            await deletePostEmbeddings(env.VECTORIZE, uri)
          }
          softDeleted++
        } else if (response.ok) {
          // Post still exists - update verified timestamp
          await env.DB.prepare(
            'UPDATE posts SET last_verified_at = datetime("now") WHERE uri = ?'
          ).bind(uri).run()
          verified++
        }
        // If 5xx or timeout, skip - will retry next run
      } catch (err) {
        console.error(`Reconciliation error for ${uri}:`, err)
      }
    }

    // 3. Hard delete posts that have been soft-deleted for over 30 days
    const hardDeleteThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const hardDeleteResult = await env.DB.prepare(`
      DELETE FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < ?
    `).bind(hardDeleteThreshold).run()

    console.log(`Reconciliation complete: retrySuccess=${retrySuccess}, retryFailed=${retryFailed}, verified=${verified}, softDeleted=${softDeleted}, hardDeleted=${hardDeleteResult.meta.changes}`)
  } catch (error) {
    console.error('Reconciliation error:', error)
  }
}

// Clean up duplicate posts - finds ghost entries without external_url where
// a matching external post exists with the same (author, title, date)
// Usage: POST /xrpc/app.greengale.admin.cleanupDuplicatePosts
// Optional query params: ?dryRun=true (default true - must set to false to delete)
app.post('/xrpc/app.greengale.admin.cleanupDuplicatePosts', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const dryRun = c.req.query('dryRun') !== 'false'

    // Find ghost posts without external_url that have a matching external post
    // with the same author, title, and created_at
    const duplicates = await c.env.DB.prepare(`
      SELECT p1.uri, p1.author_did, p1.rkey, p1.title, p1.created_at,
             p2.uri as external_uri, p2.external_url
      FROM posts p1
      INNER JOIN posts p2 ON
        p2.author_did = p1.author_did
        AND p2.title = p1.title
        AND p2.created_at = p1.created_at
        AND p2.external_url IS NOT NULL
        AND p2.deleted_at IS NULL
        AND p2.uri != p1.uri
      WHERE p1.external_url IS NULL
        AND p1.deleted_at IS NULL
      LIMIT 100
    `).all()

    const ghosts = duplicates.results || []

    if (dryRun) {
      return c.json({
        dryRun: true,
        message: 'Set dryRun=false to delete these ghost entries',
        count: ghosts.length,
        ghosts: ghosts.map(g => ({
          ghostUri: g.uri,
          ghostRkey: g.rkey,
          title: g.title,
          externalUri: g.external_uri,
          externalUrl: g.external_url,
        })),
      })
    }

    // Delete the ghost entries
    let deleted = 0
    const errors: string[] = []

    for (const ghost of ghosts) {
      try {
        // Soft delete the ghost entry
        await c.env.DB.prepare(
          'UPDATE posts SET deleted_at = datetime("now"), has_embedding = 0 WHERE uri = ?'
        ).bind(ghost.uri).run()

        // Also delete any embeddings
        const { deletePostEmbeddings } = await import('../lib/embeddings')
        await deletePostEmbeddings(c.env.VECTORIZE, ghost.uri as string)

        deleted++
      } catch (err) {
        errors.push(`${ghost.uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json({
      dryRun: false,
      deleted,
      found: ghosts.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Cleanup duplicates error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// Clean up duplicate posts with same author/title/date but different content lengths
// Keeps the one with the longer content_preview, deletes the shorter ones
// Usage: POST /xrpc/app.greengale.admin.cleanupDuplicatesByContent?dryRun=true
app.post('/xrpc/app.greengale.admin.cleanupDuplicatesByContent', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const dryRun = c.req.query('dryRun') !== 'false'
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)

    // Find groups of posts with same author, title, and created_at
    // where there are multiple entries with different preview lengths
    const duplicateGroups = await c.env.DB.prepare(`
      SELECT
        p1.uri as uri,
        p1.author_did,
        p1.title,
        p1.created_at,
        p1.external_url,
        LENGTH(p1.content_preview) as preview_length,
        (
          SELECT MAX(LENGTH(p2.content_preview))
          FROM posts p2
          WHERE p2.author_did = p1.author_did
            AND p2.title = p1.title
            AND p2.created_at = p1.created_at
            AND p2.deleted_at IS NULL
        ) as max_preview_length
      FROM posts p1
      WHERE p1.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM posts p2
          WHERE p2.author_did = p1.author_did
            AND p2.title = p1.title
            AND p2.created_at = p1.created_at
            AND p2.uri != p1.uri
            AND p2.deleted_at IS NULL
        )
      ORDER BY p1.author_did, p1.title, p1.created_at
      LIMIT ?
    `).bind(limit).all()

    // Filter to find entries that should be deleted (not the max preview length)
    const toDelete = (duplicateGroups.results || []).filter(
      row => (row.preview_length as number) < (row.max_preview_length as number)
    )

    if (dryRun) {
      // Group by title for clearer output
      const grouped: Record<string, Array<{ uri: string; previewLength: number; externalUrl: string | null; willDelete: boolean }>> = {}
      for (const row of duplicateGroups.results || []) {
        const key = `${row.author_did}|${row.title}|${row.created_at}`
        if (!grouped[key]) grouped[key] = []
        grouped[key].push({
          uri: row.uri as string,
          previewLength: row.preview_length as number,
          externalUrl: row.external_url as string | null,
          willDelete: (row.preview_length as number) < (row.max_preview_length as number),
        })
      }

      return c.json({
        dryRun: true,
        message: 'Set dryRun=false to delete the shorter duplicates',
        totalDuplicateEntries: duplicateGroups.results?.length || 0,
        toDeleteCount: toDelete.length,
        groups: Object.entries(grouped).slice(0, 20).map(([key, entries]) => ({
          key: key.split('|')[1], // Just the title
          entries,
        })),
      })
    }

    // Delete the shorter duplicates
    let deleted = 0
    const errors: string[] = []

    for (const row of toDelete) {
      try {
        // Soft delete
        await c.env.DB.prepare(
          'UPDATE posts SET deleted_at = datetime("now"), has_embedding = 0 WHERE uri = ?'
        ).bind(row.uri).run()

        // Delete embeddings
        const { deletePostEmbeddings } = await import('../lib/embeddings')
        await deletePostEmbeddings(c.env.VECTORIZE, row.uri as string)

        deleted++
      } catch (err) {
        errors.push(`${row.uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json({
      dryRun: false,
      deleted,
      found: toDelete.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Cleanup duplicates by content error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// Clean up posts with invalid external URLs (e.g., ending in /index)
// These are incorrectly indexed posts that don't actually work
// Usage: POST /xrpc/app.greengale.admin.cleanupInvalidExternalUrls?dryRun=true
app.post('/xrpc/app.greengale.admin.cleanupInvalidExternalUrls', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const dryRun = c.req.query('dryRun') !== 'false'
    const limit = Math.min(parseInt(c.req.query('limit') || '200'), 1000)

    // Find posts with external_url ending in /index or other invalid patterns
    const invalidPosts = await c.env.DB.prepare(`
      SELECT uri, author_did, title, external_url, LENGTH(content_preview) as preview_length
      FROM posts
      WHERE external_url IS NOT NULL
        AND (
          external_url LIKE '%/index'
          OR external_url LIKE '%/index/'
        )
        AND deleted_at IS NULL
      ORDER BY indexed_at DESC
      LIMIT ?
    `).bind(limit).all()

    const posts = invalidPosts.results || []

    if (dryRun) {
      // Get total count
      const countResult = await c.env.DB.prepare(`
        SELECT COUNT(*) as total FROM posts
        WHERE external_url IS NOT NULL
          AND (external_url LIKE '%/index' OR external_url LIKE '%/index/')
          AND deleted_at IS NULL
      `).first()

      return c.json({
        dryRun: true,
        message: 'Set dryRun=false to delete these posts with invalid URLs',
        totalFound: (countResult?.total as number) || 0,
        sample: posts.slice(0, 20).map(p => ({
          uri: p.uri,
          title: p.title,
          externalUrl: p.external_url,
          previewLength: p.preview_length,
        })),
      })
    }

    // Delete the invalid posts
    let deleted = 0
    const errors: string[] = []

    for (const post of posts) {
      try {
        // Soft delete
        await c.env.DB.prepare(
          'UPDATE posts SET deleted_at = datetime("now"), has_embedding = 0 WHERE uri = ?'
        ).bind(post.uri).run()

        // Delete embeddings
        const { deletePostEmbeddings } = await import('../lib/embeddings')
        await deletePostEmbeddings(c.env.VECTORIZE, post.uri as string)

        deleted++
      } catch (err) {
        errors.push(`${post.uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json({
      dryRun: false,
      deleted,
      found: posts.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Cleanup invalid URLs error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// Diagnose content availability for posts with short previews
// Fetches the actual record from PDS to see what content fields exist
// Usage: GET /xrpc/app.greengale.admin.diagnoseShortPreviews?limit=10&minLength=250&maxLength=350
app.get('/xrpc/app.greengale.admin.diagnoseShortPreviews', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50)
    const minLength = parseInt(c.req.query('minLength') || '250')
    const maxLength = parseInt(c.req.query('maxLength') || '350')

    // Find posts with short content previews, prioritizing external posts
    const posts = await c.env.DB.prepare(`
      SELECT uri, author_did, rkey, title, external_url,
             LENGTH(content_preview) as preview_length,
             content_preview
      FROM posts
      WHERE content_preview IS NOT NULL
        AND LENGTH(content_preview) >= ?
        AND LENGTH(content_preview) <= ?
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN external_url IS NOT NULL THEN 0 ELSE 1 END,
        indexed_at DESC
      LIMIT ?
    `).bind(minLength, maxLength, limit).all()

    if (!posts.results?.length) {
      return c.json({
        message: 'No posts with short previews found in the specified range',
        minLength,
        maxLength,
        posts: []
      })
    }

    // Import Leaflet parser for extraction test
    const { extractLeafletContent, isLeafletContent } = await import('../lib/leaflet-parser')

    const diagnostics: Array<{
      uri: string
      title: string
      externalUrl: string | null
      previewLength: number
      currentPreview: string
      sourceContent: {
        textContent?: { exists: boolean; length: number; sample: string }
        content?: { type: string; length?: number; sample?: string }
        rawFields: string[]
      } | null
      extractedContent?: { length: number; sample: string }
      error?: string
    }> = []

    for (const post of posts.results) {
      const uri = post.uri as string
      const did = post.author_did as string
      const rkey = post.rkey as string

      try {
        // Parse URI to get collection
        const match = uri.match(/^at:\/\/[^/]+\/([^/]+)\//)
        const collection = match?.[1] || 'unknown'

        // Resolve PDS endpoint
        const pdsEndpoint = await fetchPdsEndpoint(did)
        if (!pdsEndpoint) {
          diagnostics.push({
            uri,
            title: post.title as string,
            externalUrl: post.external_url as string | null,
            previewLength: post.preview_length as number,
            currentPreview: (post.content_preview as string).substring(0, 200) + '...',
            sourceContent: null,
            error: 'Could not resolve PDS endpoint',
          })
          continue
        }

        // Fetch the actual record
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (!response.ok) {
          diagnostics.push({
            uri,
            title: post.title as string,
            externalUrl: post.external_url as string | null,
            previewLength: post.preview_length as number,
            currentPreview: (post.content_preview as string).substring(0, 200) + '...',
            sourceContent: null,
            error: `Record fetch failed: ${response.status}`,
          })
          continue
        }

        const data = await response.json() as { value: Record<string, unknown> }
        const record = data.value

        // Analyze content fields
        const sourceContent: {
          textContent?: { exists: boolean; length: number; sample: string }
          content?: { type: string; length?: number; sample?: string }
          rawFields: string[]
        } = {
          rawFields: Object.keys(record),
        }

        // Check textContent field
        if (record.textContent) {
          const text = record.textContent as string
          sourceContent.textContent = {
            exists: true,
            length: text.length,
            sample: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
          }
        }

        // Check content field
        if (record.content) {
          const content = record.content as Record<string, unknown>
          if (typeof content === 'string') {
            sourceContent.content = {
              type: 'string',
              length: content.length,
              sample: content.substring(0, 500) + (content.length > 500 ? '...' : ''),
            }
          } else if (content.$type) {
            sourceContent.content = {
              type: content.$type as string,
              sample: JSON.stringify(content).substring(0, 500) + '...',
            }
          } else {
            sourceContent.content = {
              type: 'object',
              sample: JSON.stringify(content).substring(0, 500) + '...',
            }
          }
        }

        // Test our extraction logic - same as firehose indexer
        let extractedContent: { length: number; sample: string } | undefined
        const candidates: string[] = []

        // 1. textContent
        if (record.textContent && typeof record.textContent === 'string') {
          candidates.push(record.textContent)
        }

        // 2. Leaflet content
        if (record.content && isLeafletContent(record.content)) {
          const leafletText = extractLeafletContent(record.content)
          if (leafletText) {
            candidates.push(leafletText)
          }
        }

        // 3. content as plain string
        if (record.content && typeof record.content === 'string') {
          candidates.push(record.content)
        }

        // Use longest
        const bestContent = candidates.reduce((longest, current) =>
          current.length > longest.length ? current : longest, '')

        if (bestContent) {
          extractedContent = {
            length: bestContent.length,
            sample: bestContent.substring(0, 500) + (bestContent.length > 500 ? '...' : ''),
          }
        }

        diagnostics.push({
          uri,
          title: post.title as string,
          externalUrl: post.external_url as string | null,
          previewLength: post.preview_length as number,
          currentPreview: (post.content_preview as string).substring(0, 200) + '...',
          sourceContent,
          extractedContent,
        })
      } catch (err) {
        diagnostics.push({
          uri,
          title: post.title as string,
          externalUrl: post.external_url as string | null,
          previewLength: post.preview_length as number,
          currentPreview: (post.content_preview as string).substring(0, 200) + '...',
          sourceContent: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return c.json({
      count: diagnostics.length,
      minLength,
      maxLength,
      posts: diagnostics,
    })
  } catch (error) {
    console.error('Diagnose short previews error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// Validate external URLs and clean up posts with dead links (404)
// Usage: POST /xrpc/app.greengale.admin.validateExternalUrls?limit=50&dryRun=true&author=byjp.me&offset=0
app.post('/xrpc/app.greengale.admin.validateExternalUrls', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  try {
    const dryRun = c.req.query('dryRun') !== 'false'
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
    const offset = parseInt(c.req.query('offset') || '0')
    const authorFilter = c.req.query('author')?.trim()
    const concurrency = Math.min(parseInt(c.req.query('concurrency') || '10'), 20)

    // Build query with optional author filter
    let sql = `
      SELECT uri, author_did, title, external_url
      FROM posts
      WHERE external_url IS NOT NULL
        AND external_url LIKE 'http%'
        AND deleted_at IS NULL
    `
    const params: (string | number)[] = []

    if (authorFilter) {
      sql += ` AND author_did IN (SELECT did FROM authors WHERE handle = ?)`
      params.push(authorFilter)
    }

    sql += ` ORDER BY indexed_at DESC LIMIT ? OFFSET ?`
    params.push(limit)
    params.push(offset)

    const postsResult = await c.env.DB.prepare(sql).bind(...params).all()
    const posts = postsResult.results || []

    if (posts.length === 0) {
      return c.json({
        dryRun,
        message: 'No posts with external URLs found',
        checked: 0,
        dead: 0,
        alive: 0,
      })
    }

    // Check URLs in parallel batches
    const results: Array<{
      uri: string
      title: string
      externalUrl: string
      status: number | 'error'
      isDead: boolean
    }> = []

    // Process in batches to respect concurrency limit
    for (let i = 0; i < posts.length; i += concurrency) {
      const batch = posts.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map(async (post) => {
          const url = post.external_url as string
          try {
            // Use HEAD request first (faster), fall back to GET if HEAD not allowed
            let response = await fetch(url, {
              method: 'HEAD',
              redirect: 'follow',
              headers: {
                'User-Agent': 'GreenGale-LinkValidator/1.0',
              },
            })

            // Some servers don't support HEAD, try GET
            if (response.status === 405) {
              response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                  'User-Agent': 'GreenGale-LinkValidator/1.0',
                },
              })
            }

            const isDead = response.status === 404 || response.status === 410

            return {
              uri: post.uri as string,
              title: post.title as string,
              externalUrl: url,
              status: response.status,
              isDead,
            }
          } catch (err) {
            // Network errors - treat as potentially dead but don't delete
            return {
              uri: post.uri as string,
              title: post.title as string,
              externalUrl: url,
              status: 'error' as const,
              isDead: false, // Don't delete on network errors
            }
          }
        })
      )
      results.push(...batchResults)
    }

    const deadLinks = results.filter(r => r.isDead)
    const aliveLinks = results.filter(r => !r.isDead && r.status !== 'error')
    const errorLinks = results.filter(r => r.status === 'error')

    if (dryRun) {
      return c.json({
        dryRun: true,
        message: 'Set dryRun=false to delete posts with dead links',
        offset,
        limit,
        checked: results.length,
        hasMore: results.length === limit,
        dead: deadLinks.length,
        alive: aliveLinks.length,
        errors: errorLinks.length,
        deadPosts: deadLinks.map(r => ({
          uri: r.uri,
          title: r.title,
          externalUrl: r.externalUrl,
          status: r.status,
        })),
        errorPosts: errorLinks.length > 0 ? errorLinks.slice(0, 10).map(r => ({
          uri: r.uri,
          title: r.title,
          externalUrl: r.externalUrl,
        })) : undefined,
      })
    }

    // Delete posts with dead links
    let deleted = 0
    const deleteErrors: string[] = []

    for (const post of deadLinks) {
      try {
        // Soft delete
        await c.env.DB.prepare(
          'UPDATE posts SET deleted_at = datetime("now"), has_embedding = 0 WHERE uri = ?'
        ).bind(post.uri).run()

        // Delete embeddings
        const { deletePostEmbeddings } = await import('../lib/embeddings')
        await deletePostEmbeddings(c.env.VECTORIZE, post.uri)

        deleted++
      } catch (err) {
        deleteErrors.push(`${post.uri}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return c.json({
      dryRun: false,
      checked: results.length,
      dead: deadLinks.length,
      deleted,
      alive: aliveLinks.length,
      errors: errorLinks.length,
      deleteErrors: deleteErrors.length > 0 ? deleteErrors : undefined,
    })
  } catch (error) {
    console.error('Validate external URLs error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// Delete posts and authors from blocked handle patterns (spam cleanup)
// Matches on both author handle AND DID patterns (for did:web: DIDs)
// Usage: POST /xrpc/app.greengale.admin.cleanupBlockedDomains?dryRun=true&deleteAuthors=false&limit=500
app.post('/xrpc/app.greengale.admin.cleanupBlockedDomains', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const dryRun = c.req.query('dryRun') !== 'false' // Default to dry run for safety
  const deleteAuthors = c.req.query('deleteAuthors') === 'true' // Default to keeping authors
  const limit = Math.min(parseInt(c.req.query('limit') || '500'), 1000)

  // Handle patterns to block (suffix match on handles)
  const blockedHandlePatterns = ['.brid.gy']
  // DID patterns to block (for did:web: style DIDs) - brid.gy uses did:web:brid.gy:...
  const blockedDidPatterns = ['did:web:brid.gy%', 'did:web:%brid.gy%']
  // PDS endpoints to block (spam bridge services - accounts may have various handles)
  const blockedPdsPatterns = ['brid.gy']

  try {
    // Count posts by handle match (via author join)
    const handleCountResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts p
       JOIN authors a ON p.author_did = a.did
       WHERE ${blockedHandlePatterns.map(() => 'LOWER(a.handle) LIKE ?').join(' OR ')}`
    ).bind(...blockedHandlePatterns.map(p => `%${p}`)).first()

    // Count posts by DID match (direct on posts table - catches posts without author records)
    const didCountResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts
       WHERE ${blockedDidPatterns.map(() => 'author_did LIKE ?').join(' OR ')}`
    ).bind(...blockedDidPatterns).first()

    // Count posts by PDS match (via author join - catches accounts with various handles but same PDS)
    const pdsCountResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts p
       JOIN authors a ON p.author_did = a.did
       WHERE ${blockedPdsPatterns.map(() => 'LOWER(a.pds_endpoint) LIKE ?').join(' OR ')}`
    ).bind(...blockedPdsPatterns.map(p => `%${p}%`)).first()

    // Count authors by handle
    const authorCountResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM authors
       WHERE ${blockedHandlePatterns.map(() => 'LOWER(handle) LIKE ?').join(' OR ')}`
    ).bind(...blockedHandlePatterns.map(p => `%${p}`)).first()

    // Count authors by DID
    const authorDidCountResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM authors
       WHERE ${blockedDidPatterns.map(() => 'did LIKE ?').join(' OR ')}`
    ).bind(...blockedDidPatterns).first()

    // Count authors by PDS
    const authorPdsCountResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM authors
       WHERE ${blockedPdsPatterns.map(() => 'LOWER(pds_endpoint) LIKE ?').join(' OR ')}`
    ).bind(...blockedPdsPatterns.map(p => `%${p}%`)).first()

    const postsByHandle = (handleCountResult?.count as number) || 0
    const postsByDid = (didCountResult?.count as number) || 0
    const postsByPds = (pdsCountResult?.count as number) || 0
    const authorsByHandle = (authorCountResult?.count as number) || 0
    const authorsByDid = (authorDidCountResult?.count as number) || 0
    const authorsByPds = (authorPdsCountResult?.count as number) || 0

    const totalPosts = postsByHandle + postsByDid + postsByPds
    const totalAuthors = authorsByHandle + authorsByDid + authorsByPds

    if (totalPosts === 0 && totalAuthors === 0) {
      return c.json({
        success: true,
        dryRun,
        message: 'No posts or authors from blocked domains found',
        postsFound: 0,
        authorsFound: 0,
      })
    }

    if (dryRun) {
      // Sample posts by DID pattern
      const samplePostsByDid = await c.env.DB.prepare(
        `SELECT uri, author_did, title FROM posts
         WHERE ${blockedDidPatterns.map(() => 'author_did LIKE ?').join(' OR ')}
         LIMIT 20`
      ).bind(...blockedDidPatterns).all()

      // Sample posts by PDS
      const samplePostsByPds = await c.env.DB.prepare(
        `SELECT p.uri, p.author_did, p.title, a.handle, a.pds_endpoint FROM posts p
         JOIN authors a ON p.author_did = a.did
         WHERE ${blockedPdsPatterns.map(() => 'LOWER(a.pds_endpoint) LIKE ?').join(' OR ')}
         LIMIT 20`
      ).bind(...blockedPdsPatterns.map(p => `%${p}%`)).all()

      // Sample authors
      const sampleAuthors = await c.env.DB.prepare(
        `SELECT did, handle, pds_endpoint, posts_count FROM authors
         WHERE ${blockedHandlePatterns.map(() => 'LOWER(handle) LIKE ?').join(' OR ')}
         OR ${blockedDidPatterns.map(() => 'did LIKE ?').join(' OR ')}
         OR ${blockedPdsPatterns.map(() => 'LOWER(pds_endpoint) LIKE ?').join(' OR ')}
         LIMIT 30`
      ).bind(...blockedHandlePatterns.map(p => `%${p}`), ...blockedDidPatterns, ...blockedPdsPatterns.map(p => `%${p}%`)).all()

      return c.json({
        success: true,
        dryRun: true,
        message: `Set dryRun=false to execute deletion.`,
        postsByHandle,
        postsByDid,
        postsByPds,
        totalPosts,
        authorsByHandle,
        authorsByDid,
        authorsByPds,
        totalAuthors,
        samplePostsByDid: samplePostsByDid.results,
        samplePostsByPds: samplePostsByPds.results,
        sampleAuthors: sampleAuthors.results,
        blockedPdsPatterns,
        deleteAuthors,
        limit,
      })
    }

    // Execute deletions
    let tagsDeleted = 0
    let postsDeleted = 0
    let publicationsDeleted = 0
    let authorsDeleted = 0

    // Step 1a: Delete tags for posts matching DID patterns
    const tagsDid = await c.env.DB.prepare(
      `DELETE FROM post_tags WHERE post_uri IN (
        SELECT uri FROM posts
        WHERE ${blockedDidPatterns.map(() => 'author_did LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedDidPatterns, limit).run()
    tagsDeleted += tagsDid.meta.changes || 0

    // Step 1b: Delete tags for posts matching handle patterns (via join)
    const tagsHandle = await c.env.DB.prepare(
      `DELETE FROM post_tags WHERE post_uri IN (
        SELECT p.uri FROM posts p
        JOIN authors a ON p.author_did = a.did
        WHERE ${blockedHandlePatterns.map(() => 'LOWER(a.handle) LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedHandlePatterns.map(p => `%${p}`), limit).run()
    tagsDeleted += tagsHandle.meta.changes || 0

    // Step 2a: Delete posts matching DID patterns
    const postsDid = await c.env.DB.prepare(
      `DELETE FROM posts WHERE uri IN (
        SELECT uri FROM posts
        WHERE ${blockedDidPatterns.map(() => 'author_did LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedDidPatterns, limit).run()
    postsDeleted += postsDid.meta.changes || 0

    // Step 2b: Delete posts matching handle patterns (via join)
    const postsHandle = await c.env.DB.prepare(
      `DELETE FROM posts WHERE uri IN (
        SELECT p.uri FROM posts p
        JOIN authors a ON p.author_did = a.did
        WHERE ${blockedHandlePatterns.map(() => 'LOWER(a.handle) LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedHandlePatterns.map(p => `%${p}`), limit).run()
    postsDeleted += postsHandle.meta.changes || 0

    // Step 2c: Delete tags for posts matching PDS patterns (via join)
    const tagsPds = await c.env.DB.prepare(
      `DELETE FROM post_tags WHERE post_uri IN (
        SELECT p.uri FROM posts p
        JOIN authors a ON p.author_did = a.did
        WHERE ${blockedPdsPatterns.map(() => 'LOWER(a.pds_endpoint) LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedPdsPatterns.map(p => `%${p}%`), limit).run()
    tagsDeleted += tagsPds.meta.changes || 0

    // Step 2d: Delete posts matching PDS patterns (via join)
    const postsPds = await c.env.DB.prepare(
      `DELETE FROM posts WHERE uri IN (
        SELECT p.uri FROM posts p
        JOIN authors a ON p.author_did = a.did
        WHERE ${blockedPdsPatterns.map(() => 'LOWER(a.pds_endpoint) LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedPdsPatterns.map(p => `%${p}%`), limit).run()
    postsDeleted += postsPds.meta.changes || 0

    // Step 3: Delete publications from blocked authors
    const pubs = await c.env.DB.prepare(
      `DELETE FROM publications WHERE author_did IN (
        SELECT did FROM authors
        WHERE ${blockedHandlePatterns.map(() => 'LOWER(handle) LIKE ?').join(' OR ')}
        OR ${blockedDidPatterns.map(() => 'did LIKE ?').join(' OR ')}
        OR ${blockedPdsPatterns.map(() => 'LOWER(pds_endpoint) LIKE ?').join(' OR ')}
        LIMIT ?
      )`
    ).bind(...blockedHandlePatterns.map(p => `%${p}`), ...blockedDidPatterns, ...blockedPdsPatterns.map(p => `%${p}%`), limit).run()
    publicationsDeleted = pubs.meta.changes || 0

    // Step 4: Delete authors (only those with no remaining posts)
    if (deleteAuthors) {
      const authors = await c.env.DB.prepare(
        `DELETE FROM authors WHERE did IN (
          SELECT a.did FROM authors a
          LEFT JOIN posts p ON a.did = p.author_did
          WHERE (${blockedHandlePatterns.map(() => 'LOWER(a.handle) LIKE ?').join(' OR ')}
                 OR ${blockedDidPatterns.map(() => 'a.did LIKE ?').join(' OR ')}
                 OR ${blockedPdsPatterns.map(() => 'LOWER(a.pds_endpoint) LIKE ?').join(' OR ')})
          AND p.uri IS NULL
          LIMIT ?
        )`
      ).bind(...blockedHandlePatterns.map(p => `%${p}`), ...blockedDidPatterns, ...blockedPdsPatterns.map(p => `%${p}%`), limit).run()
      authorsDeleted = authors.meta.changes || 0
    }

    // Clear caches
    await Promise.all([
      c.env.CACHE.delete('recent_posts:12:'),
      c.env.CACHE.delete('recent_posts:24:'),
      c.env.CACHE.delete('recent_posts:50:'),
      c.env.CACHE.delete('recent_posts:100:'),
      c.env.CACHE.delete('network_posts:v3:24:'),
      c.env.CACHE.delete('network_posts:v3:50:'),
      c.env.CACHE.delete('network_posts:v3:100:'),
      c.env.CACHE.delete('rss:recent'),
      c.env.CACHE.delete('popular_tags:20'),
      c.env.CACHE.delete('popular_tags:50'),
      c.env.CACHE.delete('popular_tags:100'),
    ])

    // Check remaining
    const remainingHandle = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts p
       JOIN authors a ON p.author_did = a.did
       WHERE ${blockedHandlePatterns.map(() => 'LOWER(a.handle) LIKE ?').join(' OR ')}`
    ).bind(...blockedHandlePatterns.map(p => `%${p}`)).first()
    const remainingDid = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts
       WHERE ${blockedDidPatterns.map(() => 'author_did LIKE ?').join(' OR ')}`
    ).bind(...blockedDidPatterns).first()
    const remainingPds = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts p
       JOIN authors a ON p.author_did = a.did
       WHERE ${blockedPdsPatterns.map(() => 'LOWER(a.pds_endpoint) LIKE ?').join(' OR ')}`
    ).bind(...blockedPdsPatterns.map(p => `%${p}%`)).first()

    const remaining = ((remainingHandle?.count as number) || 0) + ((remainingDid?.count as number) || 0) + ((remainingPds?.count as number) || 0)

    return c.json({
      success: true,
      dryRun: false,
      postsDeleted,
      tagsDeleted,
      publicationsDeleted,
      authorsDeleted,
      remaining,
      message: remaining > 0 ? `${remaining} posts remaining. Run again to continue.` : 'Cleanup complete.',
    })
  } catch (error) {
    console.error('Cleanup blocked domains error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

// Delete spam posts: authors with no handle, or posts with blocked external URLs
// Usage: POST /xrpc/app.greengale.admin.cleanupSpamPosts?dryRun=true&limit=500
app.post('/xrpc/app.greengale.admin.cleanupSpamPosts', async (c) => {
  const authError = requireAdmin(c)
  if (authError) {
    return c.json({ error: authError.error }, authError.status)
  }

  const dryRun = c.req.query('dryRun') !== 'false'
  const limit = Math.min(parseInt(c.req.query('limit') || '500'), 1000)

  // Blocked external URL domains
  const blockedDomains = [
    'forums.socialmediagirls.com',
    'hijiribe.donmai.us',
    'donmai.us',
    'chaturbate.com',
    'brid.gy',
  ]

  try {
    // Count posts from authors with no handle
    const noHandleCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts p
       JOIN authors a ON p.author_did = a.did
       WHERE a.handle IS NULL OR a.handle = ''`
    ).first()

    // Count posts with blocked external URLs
    const blockedUrlConditions = blockedDomains.map(() => 'external_url LIKE ?').join(' OR ')
    const blockedUrlCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts WHERE ${blockedUrlConditions}`
    ).bind(...blockedDomains.map(d => `%${d}%`)).first()

    const totalNoHandle = (noHandleCount?.count as number) || 0
    const totalBlockedUrl = (blockedUrlCount?.count as number) || 0

    if (dryRun) {
      // Get sample posts
      const sampleNoHandle = await c.env.DB.prepare(
        `SELECT p.uri, p.title, p.external_url, a.did, a.handle
         FROM posts p
         JOIN authors a ON p.author_did = a.did
         WHERE a.handle IS NULL OR a.handle = ''
         LIMIT 20`
      ).all()

      const sampleBlockedUrl = await c.env.DB.prepare(
        `SELECT uri, title, external_url FROM posts WHERE ${blockedUrlConditions} LIMIT 20`
      ).bind(...blockedDomains.map(d => `%${d}%`)).all()

      return c.json({
        success: true,
        dryRun: true,
        message: 'Set dryRun=false to execute deletion',
        postsWithNoHandle: totalNoHandle,
        postsWithBlockedUrls: totalBlockedUrl,
        sampleNoHandle: sampleNoHandle.results,
        sampleBlockedUrls: sampleBlockedUrl.results,
        blockedDomains,
        limit,
      })
    }

    // Execute deletions
    // Step 1: Delete tags for posts from authors with no handle
    const tagsNoHandle = await c.env.DB.prepare(
      `DELETE FROM post_tags WHERE post_uri IN (
        SELECT p.uri FROM posts p
        JOIN authors a ON p.author_did = a.did
        WHERE a.handle IS NULL OR a.handle = ''
        LIMIT ?
      )`
    ).bind(limit).run()

    // Step 2: Delete posts from authors with no handle
    const postsNoHandle = await c.env.DB.prepare(
      `DELETE FROM posts WHERE uri IN (
        SELECT p.uri FROM posts p
        JOIN authors a ON p.author_did = a.did
        WHERE a.handle IS NULL OR a.handle = ''
        LIMIT ?
      )`
    ).bind(limit).run()

    // Step 3: Delete tags for posts with blocked external URLs
    const tagsBlockedUrl = await c.env.DB.prepare(
      `DELETE FROM post_tags WHERE post_uri IN (
        SELECT uri FROM posts WHERE ${blockedUrlConditions} LIMIT ?
      )`
    ).bind(...blockedDomains.map(d => `%${d}%`), limit).run()

    // Step 4: Delete posts with blocked external URLs
    const postsBlockedUrl = await c.env.DB.prepare(
      `DELETE FROM posts WHERE uri IN (
        SELECT uri FROM posts WHERE ${blockedUrlConditions} LIMIT ?
      )`
    ).bind(...blockedDomains.map(d => `%${d}%`), limit).run()

    // Step 5: Delete authors with no handle and no remaining posts
    const authorsDeleted = await c.env.DB.prepare(
      `DELETE FROM authors WHERE did IN (
        SELECT a.did FROM authors a
        LEFT JOIN posts p ON a.did = p.author_did
        WHERE (a.handle IS NULL OR a.handle = '')
        AND p.uri IS NULL
        LIMIT ?
      )`
    ).bind(limit).run()

    // Clear caches
    await Promise.all([
      c.env.CACHE.delete('recent_posts:12:'),
      c.env.CACHE.delete('recent_posts:24:'),
      c.env.CACHE.delete('recent_posts:50:'),
      c.env.CACHE.delete('recent_posts:100:'),
      c.env.CACHE.delete('network_posts:v3:24:'),
      c.env.CACHE.delete('network_posts:v3:50:'),
      c.env.CACHE.delete('network_posts:v3:100:'),
      c.env.CACHE.delete('rss:recent'),
      c.env.CACHE.delete('popular_tags:20'),
      c.env.CACHE.delete('popular_tags:50'),
      c.env.CACHE.delete('popular_tags:100'),
    ])

    // Check remaining
    const remainingNoHandle = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts p
       JOIN authors a ON p.author_did = a.did
       WHERE a.handle IS NULL OR a.handle = ''`
    ).first()
    const remainingBlockedUrl = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts WHERE ${blockedUrlConditions}`
    ).bind(...blockedDomains.map(d => `%${d}%`)).first()

    const remaining = ((remainingNoHandle?.count as number) || 0) + ((remainingBlockedUrl?.count as number) || 0)

    return c.json({
      success: true,
      dryRun: false,
      postsDeletedNoHandle: postsNoHandle.meta.changes || 0,
      postsDeletedBlockedUrl: postsBlockedUrl.meta.changes || 0,
      tagsDeleted: (tagsNoHandle.meta.changes || 0) + (tagsBlockedUrl.meta.changes || 0),
      authorsDeleted: authorsDeleted.meta.changes || 0,
      remaining,
      message: remaining > 0 ? `${remaining} posts remaining. Run again to continue.` : 'Cleanup complete.',
    })
  } catch (error) {
    console.error('Cleanup spam posts error:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    )
  }
})

export default {
  fetch: app.fetch,
  scheduled,
}
