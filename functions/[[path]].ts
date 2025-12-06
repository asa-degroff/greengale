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
  // AI/LLM agents
  /letta/i,
  /claude/i,
  /chatgpt/i,
  /gpt/i,
  /openai/i,
  /anthropic/i,
  /perplexity/i,
  /cohere/i,

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
  /httpx/i,
  /axios/i,
  /node-fetch/i,
  /got\//i,
]

function isBot(userAgent: string | null): boolean {
  // No User-Agent is suspicious - likely a simple HTTP client
  if (!userAgent) return true

  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent))
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next } = context
  const url = new URL(request.url)

  // Only intercept for bot requests
  const userAgent = request.headers.get('user-agent')
  if (!isBot(userAgent)) {
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
