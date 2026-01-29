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
  /aiohttp/i,       // Python async HTTP
  /axios/i,
  /node-fetch/i,
  /undici/i,        // Node.js HTTP client
  /got\//i,
  /libwww/i,
  /java\//i,
  /okhttp/i,
  /go-http-client/i,
  /ruby/i,
  /perl/i,
  /php\//i,

  // Content extraction / SEO tools
  /newspaper/i,     // Python newspaper library
  /readability/i,
  /mercury/i,       // Mercury Parser
  /diffbot/i,
  /embedly/i,
  /iframely/i,
  /prerender/i,     // Prerender services
  /headlesschrome/i,
  /phantomjs/i,
  /slimerjs/i,
  /splash/i,        // Scrapinghub Splash
]

// Patterns that indicate a real browser (not a bot)
const BROWSER_PATTERNS = [
  /mozilla\/.*gecko/i,   // Firefox
  /chrome\/.*safari/i,   // Chrome
  /safari\/.*version/i,  // Safari
  /edg\//i,              // Edge
  /opr\//i,              // Opera
]

// Known datacenter/cloud provider ASN organizations (bots often come from these)
const DATACENTER_PATTERNS = [
  /data\s*center/i,
  /amazon/i,
  /aws/i,
  /google\s*cloud/i,
  /microsoft/i,
  /azure/i,
  /digitalocean/i,
  /linode/i,
  /vultr/i,
  /hetzner/i,
  /ovh/i,
  /cloudflare/i,
  /fastly/i,
  /akamai/i,
  /oracle\s*cloud/i,
  /ibm\s*cloud/i,
  /rackspace/i,
  /scaleway/i,
  /upcloud/i,
  /packet/i,
  /equinix/i,
  /leaseweb/i,
  /contabo/i,
  /choopa/i,       // Vultr's parent
  /the\s*constant/i,
  /servermania/i,
  /psychz/i,
  /colocation/i,
  /colo\b/i,       // Colocation abbreviation
  /hosting/i,
  /\bhost\b/i,     // "Host" as standalone word (Host Wagon, HostGator, etc.)
  /hostway/i,
  /hostgator/i,
  /bluehost/i,
  /godaddy/i,
  /namecheap/i,
  /dreamhost/i,
  /hostinger/i,
  /siteground/i,
  /a2\s*hosting/i,
  /inmotion/i,
  /server/i,
  /vps/i,
  /dedicated/i,
  /cloud/i,        // Generic "cloud" in org name
  /\bllc\b.*(?:network|tech|internet|web|data)/i,  // LLC + tech keywords
  /(?:network|tech|internet|web|data).*\bllc\b/i,  // tech keywords + LLC
  /wagon/i,        // Host Wagon
  /m247/i,         // M247 Ltd
  /zenlayer/i,
  /cogent/i,
  /hurricane/i,    // Hurricane Electric
  /quadranet/i,
  /fdcservers/i,
  /buyvm/i,
  /ramnode/i,
  /ionos/i,
  /1\&1/i,         // 1&1 IONOS
  /strato/i,
  /aruba/i,
  /infomaniak/i,
  /webhosting/i,
]

interface CfProperties {
  asOrganization?: string
  botManagement?: {
    score?: number
    verifiedBot?: boolean
  }
}

function isBot(userAgent: string | null, cfProperties?: CfProperties): boolean {
  // No User-Agent is suspicious - likely a simple HTTP client
  if (!userAgent) return true

  // If it matches a known bot pattern, it's a bot
  if (BOT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return true
  }

  // Check Cloudflare's verified bot flag
  if (cfProperties?.botManagement?.verifiedBot) {
    return true
  }

  // Check if request comes from a known datacenter/cloud provider
  // Real users typically browse from residential ISPs, not datacenters
  if (cfProperties?.asOrganization) {
    if (DATACENTER_PATTERNS.some((pattern) => pattern.test(cfProperties.asOrganization!))) {
      return true
    }
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

// OAuth scope (must match src/lib/auth.tsx OAUTH_SCOPE)
const OAUTH_SCOPE =
  'atproto repo?collection=app.greengale.blog.entry&collection=app.greengale.document&collection=app.greengale.publication&collection=com.whtwnd.blog.entry&collection=site.standard.publication&collection=site.standard.document blob:image/*'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next } = context
  const url = new URL(request.url)

  console.log(`[Pages Function] Request: ${url.pathname}`)

  // Debug endpoint to verify function is running
  if (url.pathname === '/__prerender-test') {
    const userAgent = request.headers.get('user-agent')
    const cf = (request as Request & { cf?: CfProperties }).cf
    const isBotResult = isBot(userAgent, cf)
    return new Response(JSON.stringify({
      status: 'ok',
      functionLoaded: true,
      userAgent,
      isBot: isBotResult,
      cfAsOrganization: cf?.asOrganization,
      cfBotScore: cf?.botManagement?.score,
      cfVerifiedBot: cf?.botManagement?.verifiedBot,
      timestamp: new Date().toISOString(),
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // Serve dynamic client-metadata.json so each deployment (greengale.app,
  // pwa.greengale-app.pages.dev, etc.) has a client_id matching its own origin.
  // AT Protocol OAuth requires redirect_uri origin to match client_id origin.
  if (url.pathname === '/client-metadata.json') {
    const origin = url.origin
    const metadata = {
      client_id: `${origin}/client-metadata.json`,
      client_name: 'GreenGale',
      client_uri: origin,
      logo_uri: `${origin}/logo.png`,
      tos_uri: `${origin}/terms`,
      policy_uri: `${origin}/privacy`,
      redirect_uris: [`${origin}/auth/callback`],
      scope: OAUTH_SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true,
    }
    return new Response(JSON.stringify(metadata, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // Handle .well-known/site.standard.publication endpoint
  // This returns the AT-URI of a publication record
  // Proxies to worker which looks up the actual TID-based rkey from PDS
  // See: https://standard.site
  if (url.pathname === '/.well-known/site.standard.publication') {
    // Proxy all requests to worker (handles both platform and per-user lookups)
    // Worker fetches the actual publication rkey from PDS since site.standard uses TIDs, not 'self'
    const handle = url.searchParams.get('handle')
    const workerUrl = handle
      ? `https://greengale.asadegroff.workers.dev/.well-known/site.standard.publication?handle=${encodeURIComponent(handle)}`
      : 'https://greengale.asadegroff.workers.dev/.well-known/site.standard.publication'
    const workerResponse = await fetch(workerUrl)
    return new Response(await workerResponse.text(), {
      status: workerResponse.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
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

  // Handle /:handle/.well-known/site.standard.publication for user blog verification
  // e.g., /3fz.org/.well-known/site.standard.publication
  const userPublicationMatch = url.pathname.match(/^\/([^/]+)\/\.well-known\/site\.standard\.publication$/)
  if (userPublicationMatch) {
    const handle = userPublicationMatch[1]
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

  // Only intercept for bot requests
  const userAgent = request.headers.get('user-agent')
  const cf = (request as Request & { cf?: CfProperties }).cf
  const isBotRequest = isBot(userAgent, cf)

  // Log for debugging (visible in Cloudflare dashboard -> Pages -> Functions -> Logs)
  console.log(`[Prerender] ${url.pathname} | UA: ${userAgent?.substring(0, 100) || 'none'} | ASN: ${cf?.asOrganization || 'unknown'} | Bot: ${isBotRequest}`)

  if (!isBotRequest) {
    return next()
  }

  // Only intercept post routes
  const postRoute = parsePostRoute(url.pathname)
  if (!postRoute) {
    return next()
  }

  try {
    console.log(`[Prerender] Fetching data for ${postRoute.handle}/${postRoute.rkey}`)

    // Fetch post data from PDS
    const [entry, author] = await Promise.all([
      getBlogEntry(postRoute.handle, postRoute.rkey),
      getAuthorProfile(postRoute.handle),
    ])

    if (!entry) {
      // Post not found - let SPA handle the 404
      console.log(`[Prerender] Post not found: ${postRoute.handle}/${postRoute.rkey}`)
      return next()
    }

    console.log(`[Prerender] Rendering HTML for: ${entry.title || 'Untitled'}`)

    // Render HTML for bots
    const html = renderPostHtml({
      entry,
      author,
      handle: author.handle,
      rkey: postRoute.rkey,
    })

    console.log(`[Prerender] Success: ${postRoute.handle}/${postRoute.rkey} (${html.length} bytes)`)

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'X-Robots-Tag': 'index, follow',
      },
    })
  } catch (error) {
    // Log detailed error for debugging
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[Prerender] Error for ${postRoute.handle}/${postRoute.rkey}:`, errorMessage)
    if (errorStack) {
      console.error(`[Prerender] Stack:`, errorStack)
    }
    // Fallback to SPA on error
    return next()
  }
}
