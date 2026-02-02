/**
 * AppView API client for GreenGale backend
 *
 * This provides indexed data from the D1 database, which is faster than
 * direct PDS fetching for listing operations. Falls back to direct PDS
 * fetching for full content retrieval.
 */

const API_BASE = import.meta.env.VITE_APPVIEW_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://greengale.asadegroff.workers.dev')

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
  contentPreview?: string | null
  firstImageCid?: string | null
  author?: {
    did: string
    handle: string
    displayName: string | null
    avatar: string | null
    pdsEndpoint?: string | null
  }
  tags?: string[]
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
 * Get posts from accounts the viewer follows on Bluesky
 */
export async function getFollowingPosts(
  viewer: string,
  limit = 50,
  cursor?: string
): Promise<RecentPostsResponse> {
  const params = new URLSearchParams({ viewer, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getFollowingPosts?${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch following posts: ${response.statusText}`)
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

/**
 * Search result from publication search
 */
export interface SearchResult {
  did: string
  handle: string
  displayName: string | null
  avatarUrl: string | null
  publication: {
    name: string
    url: string | null
    isExternal?: boolean  // True if publication URL points to external site (e.g., Blento)
  } | null
  matchType: 'handle' | 'displayName' | 'publicationName' | 'publicationUrl' | 'postTitle' | 'tag'
  // Optional post info for postTitle and tag matches
  post?: {
    rkey: string
    title: string
  }
  // Optional tag info for tag matches
  tag?: string
}

export interface SearchPublicationsResponse {
  results: SearchResult[]
}

/**
 * Search for authors by handle, display name, publication name, or URL
 */
export async function searchPublications(
  query: string,
  limit = 10,
  signal?: AbortSignal
): Promise<SearchPublicationsResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.search.publications?${params}`,
    { signal }
  )

  if (!response.ok) {
    throw new Error(`Failed to search publications: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Response for posts by tag
 */
export interface TagPostsResponse {
  tag: string
  posts: AppViewPost[]
  cursor?: string
}

/**
 * Get posts by tag
 */
export async function getPostsByTag(
  tag: string,
  limit = 50,
  cursor?: string
): Promise<TagPostsResponse> {
  const params = new URLSearchParams({ tag, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getPostsByTag?${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch posts by tag: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Post search result from semantic/keyword/hybrid search
 */
export interface PostSearchResult {
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
}

export interface SearchPostsResponse {
  posts: PostSearchResult[]
  query: string
  mode: 'keyword' | 'semantic' | 'hybrid'
  fallback?: 'keyword'
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid'

/**
 * Unified search result combining author/publication and post results
 */
export type UnifiedSearchResult =
  | { type: 'author'; data: SearchResult }
  | { type: 'post'; data: PostSearchResult }

/**
 * Search field types
 * - handle: Search author handles
 * - name: Search author display names
 * - pub: Search publication names and URLs
 * - title: Search post titles and subtitles
 * - content: Search post content preview and tags
 */
export type SearchField = 'handle' | 'name' | 'pub' | 'title' | 'content'

/**
 * Search for posts using semantic, keyword, or hybrid search
 */
export async function searchPosts(
  query: string,
  options?: {
    limit?: number
    mode?: SearchMode
    author?: string
    after?: string
    before?: string
    fields?: SearchField[]
    signal?: AbortSignal
  }
): Promise<SearchPostsResponse> {
  const params = new URLSearchParams({ q: query })

  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.mode) params.set('mode', options.mode)
  if (options?.author) params.set('author', options.author)
  if (options?.after) params.set('after', options.after)
  if (options?.before) params.set('before', options.before)
  if (options?.fields && options.fields.length > 0) {
    params.set('fields', options.fields.join(','))
  }

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.search.posts?${params}`,
    { signal: options?.signal }
  )

  if (!response.ok) {
    throw new Error(`Failed to search posts: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Popular tag with count
 */
export interface PopularTag {
  tag: string
  count: number
}

/**
 * Response for popular tags
 */
export interface PopularTagsResponse {
  tags: PopularTag[]
}

/**
 * Get popular tags with post counts
 */
export async function getPopularTags(limit = 20): Promise<PopularTagsResponse> {
  const params = new URLSearchParams({ limit: String(limit) })

  const response = await fetch(
    `${API_BASE}/xrpc/app.greengale.feed.getPopularTags?${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch popular tags: ${response.statusText}`)
  }

  return response.json()
}
