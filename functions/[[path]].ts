// Bot detection middleware for Cloudflare Pages Functions
// Serves pre-rendered HTML to bots/AI agents while regular users get the SPA

import { getBlogEntry, getAuthorProfile } from './lib/atproto'
import { renderPostHtml } from './lib/render-html'

interface Env {
  // D1 binding (optional - we use PDS directly for now)
  DB?: D1Database
}

// Bot detection patterns - match common bots and AI agents
const BOT_PATTERNS = [
  // AI/LLM agents and their tools
  /letta/i,
  /claude/i,
  /chatgpt/i,
  /gpt/i,
  /openai/i,
  /anthropic/i,
  /perplexity/i,
  /cohere/i,
  /exa/i,           // Exa API (used by Letta)
  /trafilatura/i,   // Trafilatura (used by Letta as fallback)

  // Search engine crawlers
  /googlebot/i,
  /bingbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,

  // Social media preview bots
  /twitterbot/i,
  /facebookexternalhit/i,
  /linkedinbot/i,
  /discordbot/i,
  /telegrambot/i,
  /slackbot/i,
  /whatsapp/i,
  /bluesky/i,          // Bluesky link preview (Cardyb)
  /cardyb/i,           // Bluesky Cardyb bot

  // Generic bot patterns
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /headless/i,

  // HTTP clients (often used by bots)
  /curl/i,
  /wget/i,
  /python-requests/i,
  /python\//i,      // Generic Python UA
  /httpx/i,
  /axios/i,
  /node-fetch/i,
  /got\//i,
  /libwww/i,
  /java\//i,
  /okhttp/i,
  /go-http-client/i,
  /ruby/i,
  /perl/i,
  /php\//i,
]

// Patterns that indicate a real browser (not a bot)
const BROWSER_PATTERNS = [
  /mozilla\/.*gecko/i,   // Firefox
  /chrome\/.*safari/i,   // Chrome
  /safari\/.*version/i,  // Safari
  /edg\//i,              // Edge
  /opr\//i,              // Opera
]

function isBot(userAgent: string | null): boolean {
  // No User-Agent is suspicious - likely a simple HTTP client
  if (!userAgent) return true

  // If it matches a known bot pattern, it's a bot
  if (BOT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return true
  }

  // If it looks like a real browser, it's not a bot
  if (BROWSER_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return false
  }

  // Unknown User-Agent - treat as bot to be safe
  // This catches cases where the UA doesn't match known patterns
  return true
}

// Parse post routes: /:handle/:rkey
function parsePostRoute(
  pathname: string
): { handle: string; rkey: string } | null {
  // Remove leading slash and split
  const parts = pathname.slice(1).split('/')

  // Must be exactly 2 parts
  if (parts.length !== 2) return null

  const [handle, rkey] = parts

  // Exclude known non-post routes
  const reservedPaths = ['auth', 'new', 'edit', 'api', 'xrpc', '_next', 'assets']
  if (reservedPaths.includes(handle)) return null

  // Basic validation
  if (!handle || !rkey) return null

  return { handle, rkey }
}

// GreenGale platform account DID for site.standard verification
const GREENGALE_PLATFORM_DID = 'did:plc:purpkfw7haimc4zu5a57slza'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next } = context
  const url = new URL(request.url)

  // Handle .well-known/site.standard.publication endpoint
  // This returns the AT-URI of a publication record
  // Without ?handle param: returns GreenGale's platform publication
  // With ?handle=user.bsky.social: proxies to worker for per-user lookup
  // See: https://standard.site
  if (url.pathname === '/.well-known/site.standard.publication') {
    const handle = url.searchParams.get('handle')
    if (handle) {
      // Proxy to worker for per-user lookup (worker has D1 access)
      const workerUrl = `https://greengale.asadegroff.workers.dev/.well-known/site.standard.publication?handle=${encodeURIComponent(handle)}`
      const workerResponse = await fetch(workerUrl)
      return new Response(await workerResponse.text(), {
        status: workerResponse.status,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
    // No handle - return platform publication
    return new Response(
      `at://${GREENGALE_PLATFORM_DID}/site.standard.publication/self`,
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        },
      }
    )
  }

  // Legacy endpoint for app.greengale.publication
  if (url.pathname === '/.well-known/app.greengale.publication') {
    return new Response(
      `at://${GREENGALE_PLATFORM_DID}/app.greengale.publication/self`,
      {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        },
      }
    )
  }

  // Only intercept for bot requests
  const userAgent = request.headers.get('user-agent')
  const isBotRequest = isBot(userAgent)

  // Log for debugging (visible in Cloudflare dashboard -> Pages -> Functions -> Logs)
  console.log(`[Prerender] ${url.pathname} | UA: ${userAgent?.substring(0, 100) || 'none'} | Bot: ${isBotRequest}`)

  if (!isBotRequest) {
    return next()
  }

  // Only intercept post routes
  const postRoute = parsePostRoute(url.pathname)
  if (!postRoute) {
    return next()
  }

  try {
    // Fetch post data from PDS
    const [entry, author] = await Promise.all([
      getBlogEntry(postRoute.handle, postRoute.rkey),
      getAuthorProfile(postRoute.handle),
    ])

    if (!entry) {
      // Post not found - let SPA handle the 404
      return next()
    }

    // Render HTML for bots
    const html = await renderPostHtml({
      entry,
      author,
      handle: author.handle,
      rkey: postRoute.rkey,
    })

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'X-Robots-Tag': 'index, follow',
      },
    })
  } catch (error) {
    console.error('Bot prerender error:', error)
    // Fallback to SPA on error
    return next()
  }
}
