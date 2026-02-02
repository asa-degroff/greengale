import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { FirehoseConsumer } from '../firehose'
import { generateOGImage, generateHomepageOGImage, generateProfileOGImage } from '../lib/og-image'
import { buildRSSFeed, fetchPostContent, markdownToHtml, type RSSChannel, type RSSItem } from '../lib/rss'
import { buildSitemap, type SitemapUrl } from '../lib/sitemap'

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

    // Fetch post + author + publication data from D1 (including first_image_cid and pds_endpoint for OG thumbnails)
    // Exclude site.standard.document posts since they don't have theme data
    // (dual-published posts share the same rkey, so we want the GreenGale version)
    const post = await c.env.DB.prepare(`
      SELECT p.uri, p.title, p.subtitle, p.theme_preset, p.first_image_cid,
             a.handle, a.display_name, a.avatar_url, a.pds_endpoint,
             pub.theme_preset AS publication_theme_preset
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
      authorAvatar: post.avatar_url as string | null,
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
    const authorRow = await c.env.DB.prepare(
      'SELECT did, display_name, description, avatar_url FROM authors WHERE handle = ?'
    ).bind(handle).first()

    if (!authorRow) {
      return c.json({ error: 'Author not found' }, 404)
    }

    const authorDid = authorRow.did as string
    const authorName = (authorRow.display_name as string) || handle
    const authorDescription = (authorRow.description as string) || `Blog posts by ${authorName}`
    const authorAvatar = authorRow.avatar_url as string | null

    // Fetch publication metadata (if exists)
    const pubRow = await c.env.DB.prepare(
      'SELECT name, description FROM publications WHERE author_did = ?'
    ).bind(authorDid).first()

    const pubName = pubRow?.name as string | null
    const pubDescription = pubRow?.description as string | null

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
        a.handle, a.display_name, a.avatar_url,
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
          a.handle, a.display_name, a.avatar_url,
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
             handle, display_name, avatar_url, tags
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
          a.handle, a.display_name, a.avatar_url,
          (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags,
          ROW_NUMBER() OVER (PARTITION BY p.author_did ORDER BY p.created_at DESC) as author_rank
        FROM posts p
        LEFT JOIN authors a ON p.author_did = a.did
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
             handle, display_name, avatar_url, tags
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
        a.handle, a.display_name, a.avatar_url,
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
        avatar: row.avatar_url || null,
      },
      rkey: row.rkey,
      title: row.title || null,
      subtitle: row.subtitle || null,
      source: 'network',
      visibility: row.visibility,
      createdAt: row.created_at,
      indexedAt: row.indexed_at,
      externalUrl: row.external_url,
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
        (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_uri = p.uri) as tags
      FROM posts p
      LEFT JOIN authors a ON p.author_did = a.did
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

    // Exclude site.standard.document posts since dual-published posts share the same rkey
    const post = await c.env.DB.prepare(`
      SELECT
        p.uri, p.author_did, p.rkey, p.title, p.subtitle, p.source,
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
      ? `SELECT a.*, p.name as pub_name, p.description as pub_description, p.theme_preset as pub_theme, p.url as pub_url
         FROM authors a
         LEFT JOIN publications p ON a.did = p.author_did
         WHERE a.did = ?`
      : `SELECT a.*, p.name as pub_name, p.description as pub_description, p.theme_preset as pub_theme, p.url as pub_url
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
      avatar: authorRow.avatar_url,
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

    const prefixPattern = `${searchTerm}%`
    const containsPattern = `%${searchTerm}%`

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
          p.name as pub_name,
          p.url as pub_url,
          NULL as post_rkey,
          NULL as post_title,
          NULL as matched_tag,
          CASE
            WHEN LOWER(a.handle) = ?1 THEN 1
            WHEN LOWER(a.handle) LIKE ?2 THEN 2
            WHEN LOWER(a.display_name) LIKE ?3 THEN 3
            WHEN LOWER(p.name) LIKE ?3 THEN 4
            WHEN LOWER(p.url) LIKE ?3 THEN 5
          END as match_priority,
          CASE
            WHEN LOWER(a.handle) = ?1 THEN 'handle'
            WHEN LOWER(a.handle) LIKE ?2 THEN 'handle'
            WHEN LOWER(a.display_name) LIKE ?3 THEN 'displayName'
            WHEN LOWER(p.name) LIKE ?3 THEN 'publicationName'
            WHEN LOWER(p.url) LIKE ?3 THEN 'publicationUrl'
          END as match_type,
          a.posts_count
        FROM authors a
        LEFT JOIN publications p ON a.did = p.author_did
        WHERE
          LOWER(a.handle) = ?1
          OR LOWER(a.handle) LIKE ?2
          OR LOWER(a.display_name) LIKE ?3
          OR LOWER(p.name) LIKE ?3
          OR LOWER(p.url) LIKE ?3

        UNION ALL

        -- Part 2: Post title matches (deduplicated by author_did + rkey)
        -- When both app.greengale.document and site.standard.document exist for the same post,
        -- we pick just one using GROUP BY. MIN(uri) prefers 'app.greengale' over 'site.standard' alphabetically.
        SELECT
          a.did,
          a.handle,
          a.display_name,
          a.avatar_url,
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
            AND LOWER(title) LIKE ?3
          GROUP BY author_did, rkey
        ) posts
        JOIN authors a ON posts.author_did = a.did

        UNION ALL

        -- Part 3: Tag matches - find posts with matching tags
        SELECT
          a.did,
          a.handle,
          a.display_name,
          a.avatar_url,
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
            AND LOWER(pt.tag) LIKE ?3
          GROUP BY p.author_did, p.rkey, pt.tag
        ) tagged_posts
        JOIN authors a ON tagged_posts.author_did = a.did
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
      pub_name: string | null
      pub_url: string | null
      post_rkey: string | null
      post_title: string | null
      matched_tag: string | null
      match_type: string
    }

    const results = (result.results as SearchResultRow[] || []).map((row) => ({
      did: row.did,
      handle: row.handle,
      displayName: row.display_name || null,
      avatarUrl: row.avatar_url || null,
      publication: row.pub_name ? {
        name: row.pub_name,
        url: row.pub_url || null,
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
// This fetches fresh data including theme and updates the database
// Usage: POST /xrpc/app.greengale.admin.reindexPost
// Body: { "handle": "user.bsky.social", "rkey": "abc123" }
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
        'SELECT did, pds_endpoint FROM authors WHERE handle = ?'
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
    let pdsEndpoint = await fetchPdsEndpoint(did)
    if (!pdsEndpoint) {
      return c.json({ error: 'Could not determine PDS endpoint' }, 500)
    }

    // Try each collection
    const collections = [
      'app.greengale.document',
      'app.greengale.blog.entry',
      'com.whtwnd.blog.entry',
    ]

    let found = false
    let result: Record<string, unknown> = {}

    for (const collection of collections) {
      try {
        const recordUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
        const response = await fetch(recordUrl)

        if (!response.ok) continue

        const data = await response.json() as {
          uri: string
          cid: string
          value: Record<string, unknown>
        }

        found = true
        const uri = data.uri
        const value = data.value
        const source = collection === 'com.whtwnd.blog.entry' ? 'whitewind' : 'greengale'
        const isV2 = collection === 'app.greengale.document'

        const title = (value.title as string) || null
        const subtitle = (value.subtitle as string) || null
        const content = (value.content as string) || ''
        const visibility = (value.visibility as string) || 'public'
        const createdAt = isV2
          ? (value.publishedAt as string) || null
          : (value.createdAt as string) || null
        const hasLatex = source === 'greengale' && value.latex === true
        const documentPath = isV2 ? (value.path as string) || null : null
        const documentUrl = isV2 ? (value.url as string) || null : null

        // Theme extraction
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
          .slice(0, 300)

        // Slug
        const slug = title
          ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          : null

        // Update the post (using ON CONFLICT DO UPDATE to update existing)
        await c.env.DB.prepare(`
          INSERT INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, content_preview, has_latex, theme_preset, first_image_cid, url, path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            indexed_at = datetime('now')
        `).bind(
          uri, did, rkey, title, subtitle, slug, source, visibility,
          createdAt, contentPreview, hasLatex ? 1 : 0, themePreset, firstImageCid,
          documentUrl, documentPath
        ).run()

        // Invalidate OG cache
        const authorRow = await c.env.DB.prepare(
          'SELECT handle FROM authors WHERE did = ?'
        ).bind(did).first()
        if (authorRow?.handle) {
          await c.env.CACHE.delete(`og:${authorRow.handle}:${rkey}`)
        }

        // Invalidate recent posts cache
        await c.env.CACHE.delete('recent_posts:24:')

        result = {
          success: true,
          uri,
          collection,
          title,
          themePreset,
          firstImageCid,
          message: `Re-indexed post and invalidated caches`,
        }
        break
      } catch (err) {
        // Try next collection
        continue
      }
    }

    if (!found) {
      return c.json({ error: 'Post not found in any collection' }, 404)
    }

    return c.json(result)
  } catch (error) {
    console.error('Error re-indexing post:', error)
    return c.json({ error: 'Failed to re-index post', details: error instanceof Error ? error.message : 'Unknown' }, 500)
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
          .slice(0, 300)

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
              .slice(0, 300)

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
      await c.env.CACHE.delete('recent_posts:24:')
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

        // Parse the site AT-URI to get publication details
        const match = siteUri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
        if (!match) {
          errors.push(`${uri}: Invalid site URI`)
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
        // Ensure there's exactly one slash between base URL and path
        const baseUrl = pubUrl.replace(/\/$/, '')
        const normalizedPath = path.startsWith('/') ? path : `/${path}`
        const resolvedUrl = `${baseUrl}${normalizedPath}`

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
      avatar: row.avatar_url,
      pdsEndpoint: row.pds_endpoint,
    } : undefined,
    tags: postTags?.length ? postTags : undefined,
  }
}

// Scheduled handler for cron-based firehose watchdog
async function scheduled(
  _event: ScheduledEvent,
  env: { DB: D1Database; CACHE: KVNamespace; FIREHOSE: DurableObjectNamespace },
  _ctx: ExecutionContext
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

export default {
  fetch: app.fetch,
  scheduled,
}
