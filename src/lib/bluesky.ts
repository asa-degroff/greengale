import React from 'react'

// GreenGale AppView URL (proxies Bluesky API to avoid CORS issues)
const APPVIEW_URL = import.meta.env.VITE_APPVIEW_URL || 'https://greengale.asadegroff.workers.dev'

export interface BlueskyPost {
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
  replies?: BlueskyPost[]
}

export interface BlueskyInteractionsResult {
  posts: BlueskyPost[]
  totalHits?: number
  cursor?: string
}

/**
 * Facet for rich text (links, mentions, hashtags)
 * Uses byte indices for correct unicode handling
 */
export interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number }
  features: Array<{
    $type: string
    uri?: string   // for links
    did?: string   // for mentions
    tag?: string   // for hashtags
  }>
}

/**
 * Embedded image with CDN URLs
 */
export interface BlueskyEmbedImage {
  alt: string
  thumb: string
  fullsize: string
  aspectRatio?: { width: number; height: number }
}

/**
 * Minimal Bluesky post for embeds (no engagement stats)
 */
export interface BlueskyEmbedPost {
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
  facets?: BlueskyFacet[] | null
  images?: BlueskyEmbedImage[] | null
}

/**
 * Get all Bluesky interactions for a blog post URL
 * Uses the GreenGale worker proxy to avoid CORS issues
 */
export async function getBlueskyInteractions(
  blogPostUrl: string,
  options: {
    limit?: number
    includeReplies?: boolean
    sort?: 'top' | 'latest'
  } = {}
): Promise<BlueskyInteractionsResult> {
  const { limit = 10, includeReplies = true, sort = 'top' } = options

  try {
    const url = new URL(`${APPVIEW_URL}/xrpc/app.greengale.feed.getBlueskyInteractions`)
    url.searchParams.set('url', blogPostUrl)
    url.searchParams.set('limit', limit.toString())
    url.searchParams.set('sort', sort)
    url.searchParams.set('includeReplies', includeReplies.toString())

    const response = await fetch(url.toString())

    if (!response.ok) {
      console.error('Failed to fetch Bluesky interactions:', response.status)
      return { posts: [] }
    }

    const data = await response.json() as BlueskyInteractionsResult
    return data
  } catch (error) {
    console.error('Failed to fetch Bluesky interactions:', error)
    return { posts: [] }
  }
}

/**
 * Generate a Bluesky web URL from an AT URI
 */
export function getBlueskyWebUrl(uri: string): string {
  // AT URI format: at://did:plc:xxx/app.bsky.feed.post/rkey
  const match = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/)
  if (!match) {
    return `https://bsky.app`
  }

  const [, did, rkey] = match
  return `https://bsky.app/profile/${did}/post/${rkey}`
}

/**
 * Generate a share URL for posting about a blog post on Bluesky
 */
export function getBlueskyShareUrl(blogPostUrl: string, title?: string): string {
  const text = title
    ? `${title}\n\n${blogPostUrl}`
    : blogPostUrl

  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`
}

/**
 * Fetch a single Bluesky post for embedding
 * Uses the GreenGale worker proxy to avoid CORS issues and enable caching
 */
export async function getBlueskyPost(
  handle: string,
  rkey: string
): Promise<BlueskyEmbedPost | null> {
  try {
    const url = new URL(`${APPVIEW_URL}/xrpc/app.greengale.feed.getBlueskyPost`)
    url.searchParams.set('handle', handle)
    url.searchParams.set('rkey', rkey)

    const response = await fetch(url.toString())

    if (!response.ok) {
      console.error('Failed to fetch Bluesky post:', response.status)
      return null
    }

    const data = await response.json() as { post: BlueskyEmbedPost | null; error?: string }

    if (!data.post) {
      return null
    }

    return data.post
  } catch (error) {
    console.error('Failed to fetch Bluesky post:', error)
    return null
  }
}

/**
 * Render text with facets (links, mentions, hashtags) as React elements.
 * Facets use byte indices, so we need to convert to/from UTF-8 bytes.
 */
export function renderTextWithFacets(
  text: string,
  facets: BlueskyFacet[] | null | undefined
): React.ReactNode[] {
  if (!facets || facets.length === 0) {
    return [text]
  }

  // Convert text to byte array for correct indexing
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const bytes = encoder.encode(text)

  // Sort facets by start position
  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart)

  const result: React.ReactNode[] = []
  let lastEnd = 0

  for (const facet of sorted) {
    // Add text before this facet
    if (facet.index.byteStart > lastEnd) {
      result.push(decoder.decode(bytes.slice(lastEnd, facet.index.byteStart)))
    }

    // Extract facet text
    const facetText = decoder.decode(bytes.slice(facet.index.byteStart, facet.index.byteEnd))
    const feature = facet.features[0]

    if (feature.$type === 'app.bsky.richtext.facet#link') {
      result.push(
        React.createElement('a', {
          key: facet.index.byteStart,
          href: feature.uri,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'text-[var(--theme-accent)] hover:underline',
        }, facetText)
      )
    } else if (feature.$type === 'app.bsky.richtext.facet#mention') {
      result.push(
        React.createElement('a', {
          key: facet.index.byteStart,
          href: `https://bsky.app/profile/${feature.did}`,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'text-[var(--theme-accent)] hover:underline',
        }, facetText)
      )
    } else if (feature.$type === 'app.bsky.richtext.facet#tag') {
      result.push(
        React.createElement('a', {
          key: facet.index.byteStart,
          href: `https://bsky.app/hashtag/${feature.tag}`,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'text-[var(--theme-accent)] hover:underline',
        }, facetText)
      )
    } else {
      result.push(facetText)
    }

    lastEnd = facet.index.byteEnd
  }

  // Add remaining text
  if (lastEnd < bytes.length) {
    result.push(decoder.decode(bytes.slice(lastEnd)))
  }

  return result
}

/**
 * Auto-detect URLs in plain text and render them as clickable links.
 * Useful for content without facets (like author bios).
 */
export function linkifyText(text: string): React.ReactNode[] {
  if (!text) return []

  // URL regex that matches http(s) URLs
  // Handles common URL characters including paths, query strings, and fragments
  // Stops at common punctuation that usually ends a sentence
  const urlRegex = /https?:\/\/[^\s<>"\[\]{}|\\^`]+[^\s<>"\[\]{}|\\^`.,;:!?)\]}"']/gi

  const result: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }

    // Add the URL as a link
    const url = match[0]
    result.push(
      React.createElement('a', {
        key: match.index,
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'text-[var(--site-accent)] hover:underline break-all',
      }, url)
    )

    lastIndex = match.index + url.length
  }

  // Add remaining text after last URL
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result.length > 0 ? result : [text]
}
