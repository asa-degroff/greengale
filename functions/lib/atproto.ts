// AT Protocol data fetching for edge runtime (Cloudflare Pages Functions)
// Adapted from src/lib/atproto.ts - simplified for server-side use without @atproto/api dependency

// Timeout for fetch requests (5 seconds)
const FETCH_TIMEOUT = 5000

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeout = FETCH_TIMEOUT
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

const WHITEWIND_COLLECTION = 'com.whtwnd.blog.entry'
const GREENGALE_V1_COLLECTION = 'app.greengale.blog.entry'
const GREENGALE_V2_COLLECTION = 'app.greengale.document'
const SITE_STANDARD_COLLECTION = 'site.standard.document'
const SITE_STANDARD_PUBLICATION = 'site.standard.publication'

export interface BlogEntry {
  uri: string
  cid: string
  authorDid: string
  rkey: string
  source: 'whitewind' | 'greengale'
  content: string
  title?: string
  subtitle?: string
  createdAt?: string
  visibility?: 'public' | 'url' | 'author'
  siteStandardUri?: string // AT-URI of site.standard.document if dual-published
  siteStandardPublicationUri?: string // AT-URI of author's site.standard.publication
}

export interface AuthorProfile {
  did: string
  handle: string
  displayName?: string
  avatar?: string
  description?: string
}

/**
 * Resolve a handle to a DID using Bluesky's public API
 */
export async function resolveHandle(handle: string): Promise<string> {
  const url = `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  console.log(`[atproto] Resolving handle: ${handle}`)
  const response = await fetchWithTimeout(url)
  if (!response.ok) {
    throw new Error(`Failed to resolve handle: ${handle} (status: ${response.status})`)
  }
  const data = await response.json() as { did: string }
  console.log(`[atproto] Resolved ${handle} -> ${data.did}`)
  return data.did
}

/**
 * Get the PDS endpoint for a DID
 */
export async function getPdsEndpoint(did: string): Promise<string> {
  let didDoc: { service?: Array<{ id: string; type: string; serviceEndpoint: string }> }

  console.log(`[atproto] Getting PDS endpoint for: ${did}`)
  if (did.startsWith('did:plc:')) {
    const response = await fetchWithTimeout(`https://plc.directory/${did}`)
    if (!response.ok) {
      throw new Error(`Failed to resolve DID: ${did} (status: ${response.status})`)
    }
    didDoc = await response.json()
  } else if (did.startsWith('did:web:')) {
    const domain = did.replace('did:web:', '').replace(/%3A/g, ':')
    const response = await fetchWithTimeout(`https://${domain}/.well-known/did.json`)
    if (!response.ok) {
      throw new Error(`Failed to resolve DID: ${did} (status: ${response.status})`)
    }
    didDoc = await response.json()
  } else {
    throw new Error(`Unsupported DID method: ${did}`)
  }

  const pdsService = didDoc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  )

  if (!pdsService) {
    throw new Error(`No PDS service found for DID: ${did}`)
  }

  console.log(`[atproto] PDS endpoint: ${pdsService.serviceEndpoint}`)
  return pdsService.serviceEndpoint
}

/**
 * Resolve identifier (handle or DID) to DID
 */
export async function resolveIdentity(identifier: string): Promise<string> {
  if (identifier.startsWith('did:')) {
    return identifier
  }
  return resolveHandle(identifier)
}

/**
 * Get author profile from Bluesky's public API
 */
export async function getAuthorProfile(identifier: string): Promise<AuthorProfile> {
  const did = await resolveIdentity(identifier)

  try {
    console.log(`[atproto] Getting profile for: ${did}`)
    const response = await fetchWithTimeout(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    )
    if (!response.ok) {
      console.log(`[atproto] Profile not found for ${did} (status: ${response.status})`)
      throw new Error('Profile not found')
    }
    const data = await response.json() as {
      did: string
      handle: string
      displayName?: string
      avatar?: string
      description?: string
    }

    console.log(`[atproto] Got profile: ${data.handle}`)
    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName,
      avatar: data.avatar,
      description: data.description,
    }
  } catch (error) {
    // Fallback: return minimal profile
    console.log(`[atproto] Profile fetch failed, using fallback: ${error}`)
    return { did, handle: identifier }
  }
}

/**
 * Check if a site.standard.document record exists for a given rkey
 */
async function checkSiteStandardDocument(
  pdsEndpoint: string,
  did: string,
  rkey: string
): Promise<string | undefined> {
  try {
    const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(SITE_STANDARD_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
    const response = await fetchWithTimeout(url)
    if (response.ok) {
      const data = await response.json() as { uri: string }
      return data.uri
    }
  } catch {
    // Ignore errors - record doesn't exist
  }
  return undefined
}

/**
 * Check if a TID is valid (13 characters, base32-sortable)
 */
function isValidTid(rkey: string): boolean {
  return /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/.test(rkey)
}

/**
 * Get the site.standard.publication AT-URI for a user
 * Returns the first publication record with a valid TID rkey that has GreenGale preferences
 */
async function getSiteStandardPublicationUri(
  pdsEndpoint: string,
  did: string
): Promise<string | undefined> {
  try {
    const listUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(SITE_STANDARD_PUBLICATION)}&limit=50`
    const listRes = await fetchWithTimeout(listUrl)
    if (!listRes.ok) return undefined

    const listData = await listRes.json() as {
      records?: Array<{ uri: string; value: Record<string, unknown> }>
    }
    if (!listData.records || listData.records.length === 0) return undefined

    // Find a GreenGale record with a valid TID rkey
    for (const record of listData.records) {
      // Only consider records that belong to GreenGale (have preferences.greengale)
      const preferences = record.value?.preferences as Record<string, unknown> | undefined
      if (!preferences?.greengale) {
        continue
      }

      const rkey = record.uri.split('/').pop() || ''
      if (isValidTid(rkey)) {
        return record.uri
      }
    }

    return undefined
  } catch {
    return undefined
  }
}

/**
 * Fetch a blog entry from the author's PDS
 */
export async function getBlogEntry(
  identifier: string,
  rkey: string
): Promise<BlogEntry | null> {
  console.log(`[atproto] Fetching blog entry: ${identifier}/${rkey}`)
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  // Try V2 document first, then V1 GreenGale, then WhiteWind
  for (const collection of [GREENGALE_V2_COLLECTION, GREENGALE_V1_COLLECTION, WHITEWIND_COLLECTION]) {
    try {
      console.log(`[atproto] Trying collection: ${collection}`)
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
      const response = await fetchWithTimeout(url)

      if (!response.ok) {
        continue
      }

      const data = await response.json() as {
        uri: string
        cid: string
        value: Record<string, unknown>
      }

      const record = data.value
      const visibility = (record.visibility as string | undefined) || 'public'

      // Don't return private posts for bots
      if (visibility === 'author') {
        return null
      }

      // V2 documents use publishedAt, V1/WhiteWind use createdAt
      const isV2 = collection === GREENGALE_V2_COLLECTION
      const createdAt = isV2
        ? (record.publishedAt as string | undefined)
        : (record.createdAt as string | undefined)

      // For GreenGale V2 documents, check if site.standard records exist
      let siteStandardUri: string | undefined
      let siteStandardPublicationUri: string | undefined
      if (isV2) {
        // Check for document and publication in parallel
        const [docUri, pubUri] = await Promise.all([
          checkSiteStandardDocument(pdsEndpoint, did, rkey),
          getSiteStandardPublicationUri(pdsEndpoint, did),
        ])
        siteStandardUri = docUri
        // Only include publication URI if document exists (indicates dual-publishing is enabled)
        if (docUri) {
          siteStandardPublicationUri = pubUri
        }
      }

      const entry: BlogEntry = {
        uri: data.uri,
        cid: data.cid,
        authorDid: did,
        rkey,
        source: collection === WHITEWIND_COLLECTION ? 'whitewind' : 'greengale',
        content: (record.content as string) || '',
        title: record.title as string | undefined,
        subtitle: record.subtitle as string | undefined,
        createdAt,
        visibility: visibility as BlogEntry['visibility'],
        siteStandardUri,
        siteStandardPublicationUri,
      }
      console.log(`[atproto] Found entry: ${entry.title || 'Untitled'} (${collection})`)
      return entry
    } catch (error) {
      // Continue to next collection
      console.log(`[atproto] Collection ${collection} failed: ${error}`)
    }
  }

  console.log(`[atproto] No entry found for ${identifier}/${rkey}`)
  return null
}

// API base URL for the GreenGale worker
const API_BASE = 'https://greengale.asadegroff.workers.dev'

/**
 * Post summary from the API (less data than full BlogEntry)
 */
export interface PostSummary {
  uri: string
  authorDid: string
  authorHandle: string
  authorDisplayName?: string
  authorAvatar?: string
  rkey: string
  title: string
  subtitle?: string
  createdAt: string
  source: string
}

/**
 * Get recent posts from the API
 */
export async function getRecentPosts(limit = 10): Promise<PostSummary[]> {
  try {
    console.log(`[atproto] Fetching recent posts (limit: ${limit})`)
    const url = `${API_BASE}/xrpc/app.greengale.feed.getRecentPosts?limit=${limit}`
    const response = await fetchWithTimeout(url)

    if (!response.ok) {
      console.log(`[atproto] Recent posts API failed: ${response.status}`)
      return []
    }

    const data = await response.json() as { posts: PostSummary[] }
    console.log(`[atproto] Got ${data.posts?.length || 0} recent posts`)
    return data.posts || []
  } catch (error) {
    console.error(`[atproto] Error fetching recent posts: ${error}`)
    return []
  }
}

/**
 * Get posts by a specific author from the API
 */
export async function getAuthorPosts(author: string, limit = 20): Promise<PostSummary[]> {
  try {
    console.log(`[atproto] Fetching posts for author: ${author}`)
    const url = `${API_BASE}/xrpc/app.greengale.feed.getAuthorPosts?author=${encodeURIComponent(author)}&limit=${limit}`
    const response = await fetchWithTimeout(url)

    if (!response.ok) {
      console.log(`[atproto] Author posts API failed: ${response.status}`)
      return []
    }

    const data = await response.json() as { posts: PostSummary[] }
    console.log(`[atproto] Got ${data.posts?.length || 0} posts for ${author}`)
    return data.posts || []
  } catch (error) {
    console.error(`[atproto] Error fetching author posts: ${error}`)
    return []
  }
}
