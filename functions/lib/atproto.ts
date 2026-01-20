// AT Protocol data fetching for edge runtime (Cloudflare Pages Functions)
// Adapted from src/lib/atproto.ts - simplified for server-side use without @atproto/api dependency

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
 * Check if a site.standard.document record exists for a given rkey
 */
async function checkSiteStandardDocument(
  pdsEndpoint: string,
  did: string,
  rkey: string
): Promise<string | undefined> {
  try {
    const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(SITE_STANDARD_COLLECTION)}&rkey=${encodeURIComponent(rkey)}`
    const response = await fetch(url)
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
    const listRes = await fetch(listUrl)
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
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  // Try V2 document first, then V1 GreenGale, then WhiteWind
  for (const collection of [GREENGALE_V2_COLLECTION, GREENGALE_V1_COLLECTION, WHITEWIND_COLLECTION]) {
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

      return {
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
    } catch {
      // Continue to next collection
    }
  }

  return null
}
