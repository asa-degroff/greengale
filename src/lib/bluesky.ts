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
