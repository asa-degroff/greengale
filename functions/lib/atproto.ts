// AT Protocol data fetching for edge runtime (Cloudflare Pages Functions)
// Adapted from src/lib/atproto.ts - simplified for server-side use without @atproto/api dependency

const WHITEWIND_COLLECTION = 'com.whtwnd.blog.entry'
const GREENGALE_COLLECTION = 'app.greengale.blog.entry'

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
  const response = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  )
  if (!response.ok) {
    throw new Error(`Failed to resolve handle: ${handle}`)
  }
  const data = await response.json() as { did: string }
  return data.did
}

/**
 * Get the PDS endpoint for a DID
 */
export async function getPdsEndpoint(did: string): Promise<string> {
  let didDoc: { service?: Array<{ id: string; type: string; serviceEndpoint: string }> }

  if (did.startsWith('did:plc:')) {
    const response = await fetch(`https://plc.directory/${did}`)
    if (!response.ok) {
      throw new Error(`Failed to resolve DID: ${did}`)
    }
    didDoc = await response.json()
  } else if (did.startsWith('did:web:')) {
    const domain = did.replace('did:web:', '').replace(/%3A/g, ':')
    const response = await fetch(`https://${domain}/.well-known/did.json`)
    if (!response.ok) {
      throw new Error(`Failed to resolve DID: ${did}`)
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
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    )
    if (!response.ok) {
      throw new Error('Profile not found')
    }
    const data = await response.json() as {
      did: string
      handle: string
      displayName?: string
      avatar?: string
      description?: string
    }

    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName,
      avatar: data.avatar,
      description: data.description,
    }
  } catch {
    // Fallback: return minimal profile
    return { did, handle: identifier }
  }
}

/**
 * Fetch a blog entry from the author's PDS
 */
export async function getBlogEntry(
  identifier: string,
  rkey: string
): Promise<BlogEntry | null> {
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  // Try GreenGale first, then WhiteWind
  for (const collection of [GREENGALE_COLLECTION, WHITEWIND_COLLECTION]) {
    try {
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
      const response = await fetch(url)

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

      return {
        uri: data.uri,
        cid: data.cid,
        authorDid: did,
        rkey,
        source: collection === GREENGALE_COLLECTION ? 'greengale' : 'whitewind',
        content: (record.content as string) || '',
        title: record.title as string | undefined,
        subtitle: record.subtitle as string | undefined,
        createdAt: record.createdAt as string | undefined,
        visibility: visibility as BlogEntry['visibility'],
      }
    } catch {
      // Continue to next collection
    }
  }

  return null
}
