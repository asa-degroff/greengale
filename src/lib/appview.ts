/**
 * AppView API client for GreenGale backend
 *
 * This provides indexed data from the D1 database, which is faster than
 * direct PDS fetching for listing operations. Falls back to direct PDS
 * fetching for full content retrieval.
 */

const API_BASE = import.meta.env.VITE_APPVIEW_URL ||
  (import.meta.env.DEV ? 'http://localhost:8788' : 'https://greengale.asadegroff.workers.dev')

export interface AppViewPost {
  uri: string
  authorDid: string
  rkey: string
  title: string | null
  subtitle: string | null
  source: 'whitewind' | 'greengale' | 'network'
  visibility: string
  createdAt: string | null
  indexedAt: string
  externalUrl?: string | null
  author?: {
    did: string
    handle: string
    displayName: string | null
    avatar: string | null
  }
}

export interface AppViewPublication {
  name: string
  url: string
  description?: string
  theme?: string  // Preset name or JSON custom colors
}

export interface AppViewAuthor {
  did: string
  handle: string
  displayName: string | null
  avatar: string | null
  description: string | null
  postsCount: number
  publication?: AppViewPublication
}

export interface RecentPostsResponse {
  posts: AppViewPost[]
  cursor?: string
}

export interface AuthorPostsResponse {
  posts: AppViewPost[]
  cursor?: string
}

/**
 * Check if the AppView API is available
 */
export async function checkAppViewHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/xrpc/_health`)
    if (!response.ok) return false
    const data = await response.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

/**
 * Get recent posts from all authors
 */
export async function getRecentPosts(
  limit = 50,
  cursor?: string
): Promise<RecentPostsResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getRecentPosts?${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch recent posts: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get recent posts from the network (site.standard posts from external sites)
 */
export async function getNetworkPosts(
  limit = 50,
  cursor?: string
): Promise<RecentPostsResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getNetworkPosts?${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch network posts: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get posts by a specific author
 * @param viewer Optional viewer DID - if matches author, includes private posts
 */
export async function getAuthorPosts(
  author: string,
  limit = 50,
  cursor?: string,
  viewer?: string
): Promise<AuthorPostsResponse> {
  const params = new URLSearchParams({ author, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  if (viewer) params.set('viewer', viewer)

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getAuthorPosts?${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch author posts: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get a single post by author and rkey
 * @param viewer Optional viewer DID - required to view private (author-only) posts
 */
export async function getPost(
  author: string,
  rkey: string,
  viewer?: string
): Promise<AppViewPost | null> {
  const params = new URLSearchParams({ author, rkey })
  if (viewer) params.set('viewer', viewer)

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getPost?${params}`
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch post: ${response.statusText}`)
  }

  const data = await response.json()
  return data.post
}

/**
 * Get author profile from AppView
 */
export async function getAuthorProfile(
  author: string
): Promise<AppViewAuthor | null> {
  const params = new URLSearchParams({ author })

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.actor.getProfile?${params}`
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch author: ${response.statusText}`)
  }

  return response.json()
}
