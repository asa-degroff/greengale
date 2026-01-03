import { AtpAgent } from '@atproto/api'
import { isValidHandle } from '@atproto/syntax'
import type { Theme, ThemePreset, CustomColors } from './themes'
import type { SelfLabels } from './image-upload'

// Simple DID validation
function isValidDid(did: string): boolean {
  return did.startsWith('did:plc:') || did.startsWith('did:web:')
}

// WhiteWind lexicon namespace
const WHITEWIND_COLLECTION = 'com.whtwnd.blog.entry'
// GreenGale V1 lexicon namespace
const GREENGALE_COLLECTION = 'app.greengale.blog.entry'
// GreenGale V2 document lexicon (site.standard compatible)
const DOCUMENT_COLLECTION = 'app.greengale.document'
// GreenGale publication lexicon (site.standard compatible)
const PUBLICATION_COLLECTION = 'app.greengale.publication'

// Theme presets for validation
const VALID_PRESETS = new Set<ThemePreset>([
  'github-light',
  'github-dark',
  'dracula',
  'nord',
  'solarized-light',
  'solarized-dark',
  'monokai',
])

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
  theme?: Theme
  visibility?: 'public' | 'url' | 'author'
  latex?: boolean
  blobs?: Array<{
    blobref: unknown
    name?: string
    alt?: string
    labels?: SelfLabels
  }>
  // V2 document fields (site.standard compatible)
  url?: string
  path?: string
}

function parseTheme(rawTheme: unknown): Theme | undefined {
  if (!rawTheme || typeof rawTheme !== 'object') return undefined

  const theme = rawTheme as Record<string, unknown>
  const result: Theme = {}

  // WhiteWind uses simple string for theme (e.g., "github-light")
  if (typeof theme === 'string') {
    if (VALID_PRESETS.has(theme as ThemePreset)) {
      return { preset: theme as ThemePreset }
    }
    return undefined
  }

  // GreenGale uses object with preset and/or custom
  if (typeof theme.preset === 'string' && VALID_PRESETS.has(theme.preset as ThemePreset)) {
    result.preset = theme.preset as ThemePreset
  }

  if (theme.custom && typeof theme.custom === 'object') {
    const custom = theme.custom as Record<string, unknown>
    const customColors: CustomColors = {}
    if (typeof custom.background === 'string') customColors.background = custom.background
    if (typeof custom.text === 'string') customColors.text = custom.text
    if (typeof custom.accent === 'string') customColors.accent = custom.accent
    if (typeof custom.codeBackground === 'string') customColors.codeBackground = custom.codeBackground
    if (Object.keys(customColors).length > 0) {
      result.custom = customColors
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

export interface AuthorProfile {
  did: string
  handle: string
  displayName?: string
  avatar?: string
  description?: string
}

export interface Publication {
  name: string
  url: string
  description?: string
  theme?: Theme
}

/**
 * Resolve a handle or DID to a DID
 */
export async function resolveIdentity(identifier: string): Promise<string> {
  if (isValidDid(identifier)) {
    return identifier
  }

  if (!isValidHandle(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`)
  }

  // Use Bluesky's public API to resolve handle
  const agent = new AtpAgent({ service: 'https://public.api.bsky.app' })
  const response = await agent.resolveHandle({ handle: identifier })
  return response.data.did
}

/**
 * Get the PDS endpoint for a DID
 */
export async function getPdsEndpoint(did: string): Promise<string> {
  // Fetch DID document
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

  // Find atproto_pds service
  const pdsService = didDoc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  )

  if (!pdsService) {
    throw new Error(`No PDS service found for DID: ${did}`)
  }

  return pdsService.serviceEndpoint
}

/**
 * Fetch an author's profile from their PDS
 */
export async function getAuthorProfile(identifier: string): Promise<AuthorProfile> {
  const did = await resolveIdentity(identifier)

  // Use Bluesky's public API to get profile with resolved avatar URL
  try {
    const agent = new AtpAgent({ service: 'https://public.api.bsky.app' })
    const response = await agent.app.bsky.actor.getProfile({ actor: did })

    return {
      did,
      handle: response.data.handle,
      displayName: response.data.displayName,
      avatar: response.data.avatar,
      description: response.data.description,
    }
  } catch {
    // Fallback: try to get handle from DID document
    try {
      const handleResponse = await fetch(`https://plc.directory/${did}`)
      const didDoc = await handleResponse.json()
      const handle = didDoc.alsoKnownAs?.[0]?.replace('at://', '') || did
      return { did, handle }
    } catch {
      return { did, handle: identifier }
    }
  }
}

/**
 * Get a single blog entry by author and rkey
 * @param viewerDid Optional viewer's DID - required to view private (author-only) posts
 */
export async function getBlogEntry(
  identifier: string,
  rkey: string,
  viewerDid?: string
): Promise<BlogEntry | null> {
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  const agent = new AtpAgent({ service: pdsEndpoint })

  // Try V2 document first, then V1 GreenGale, then WhiteWind
  for (const collection of [DOCUMENT_COLLECTION, GREENGALE_COLLECTION, WHITEWIND_COLLECTION]) {
    try {
      const response = await agent.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey,
      })

      const record = response.data.value as Record<string, unknown>
      const visibility = (record.visibility as string | undefined) || 'public'

      // Check visibility permissions
      const isAuthor = viewerDid && viewerDid === did

      if (visibility === 'author' && !isAuthor) {
        // Private post - only the author can view
        return null
      }
      // 'url' visibility allows anyone with the link, 'public' is open to all

      // V2 documents use publishedAt, V1/WhiteWind use createdAt
      const isV2 = collection === DOCUMENT_COLLECTION
      const createdAt = isV2
        ? (record.publishedAt as string | undefined)
        : (record.createdAt as string | undefined)

      return {
        uri: response.data.uri,
        cid: response.data.cid || '',
        authorDid: did,
        rkey,
        source: collection === WHITEWIND_COLLECTION ? 'whitewind' : 'greengale',
        content: (record.content as string) || '',
        title: record.title as string | undefined,
        subtitle: record.subtitle as string | undefined,
        createdAt,
        theme: parseTheme(record.theme),
        visibility: visibility as BlogEntry['visibility'],
        latex: record.latex as boolean | undefined,
        blobs: record.blobs as BlogEntry['blobs'],
        // V2 fields
        url: isV2 ? (record.url as string | undefined) : undefined,
        path: isV2 ? (record.path as string | undefined) : undefined,
      }
    } catch {
      // Continue to next collection
    }
  }

  return null
}

/**
 * List blog entries for an author
 * @param viewerDid Optional viewer's DID - if matches author, includes private posts
 * @param maxPerCollection Maximum posts to fetch per collection (default 1000)
 */
export async function listBlogEntries(
  identifier: string,
  options: { viewerDid?: string; maxPerCollection?: number } = {}
): Promise<{ entries: BlogEntry[] }> {
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  const agent = new AtpAgent({ service: pdsEndpoint })

  const entries: BlogEntry[] = []

  // Check if viewer is the author (can see all posts)
  const isOwnProfile = options.viewerDid && options.viewerDid === did
  const maxPerCollection = options.maxPerCollection || 2000

  // Fetch from all three collections independently (cursors are collection-specific)
  for (const collection of [DOCUMENT_COLLECTION, GREENGALE_COLLECTION, WHITEWIND_COLLECTION]) {
    try {
      let cursor: string | undefined
      let fetched = 0
      const isV2 = collection === DOCUMENT_COLLECTION

      // Paginate through all records in this collection
      while (fetched < maxPerCollection) {
        const limit = Math.min(100, maxPerCollection - fetched)
        const response = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection,
          limit,
          cursor,
        })

        for (const item of response.data.records) {
          const record = item.value as Record<string, unknown>
          const visibility = (record.visibility as string | undefined) || 'public'

          // Filter by visibility
          if (!isOwnProfile && visibility !== 'public') {
            // Non-owners can only see public posts
            continue
          }

          // V2 documents use publishedAt, V1/WhiteWind use createdAt
          const createdAt = isV2
            ? (record.publishedAt as string | undefined)
            : (record.createdAt as string | undefined)

          entries.push({
            uri: item.uri,
            cid: item.cid,
            authorDid: did,
            rkey: item.uri.split('/').pop() || '',
            source: collection === WHITEWIND_COLLECTION ? 'whitewind' : 'greengale',
            content: (record.content as string) || '',
            title: record.title as string | undefined,
            subtitle: record.subtitle as string | undefined,
            createdAt,
            theme: parseTheme(record.theme),
            visibility: visibility as 'public' | 'url' | 'author',
            latex: record.latex as boolean | undefined,
            blobs: record.blobs as BlogEntry['blobs'],
            // V2 fields
            url: isV2 ? (record.url as string | undefined) : undefined,
            path: isV2 ? (record.path as string | undefined) : undefined,
          })
        }

        fetched += response.data.records.length

        // Check if there are more records
        if (!response.data.cursor || response.data.records.length < limit) {
          break
        }
        cursor = response.data.cursor
      }
    } catch {
      // Collection might not exist for this user
    }
  }

  // Sort by createdAt descending
  entries.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return dateB - dateA
  })

  return { entries }
}

/**
 * Generate a URL slug from a title
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
}

/**
 * Get a user's publication settings from their PDS
 * Publications use 'self' as the rkey (singleton pattern)
 */
export async function getPublication(identifier: string): Promise<Publication | null> {
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  const agent = new AtpAgent({ service: pdsEndpoint })

  try {
    const response = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: PUBLICATION_COLLECTION,
      rkey: 'self',
    })

    const record = response.data.value as Record<string, unknown>

    return {
      name: (record.name as string) || '',
      url: (record.url as string) || '',
      description: record.description as string | undefined,
      theme: parseTheme(record.theme),
    }
  } catch {
    // Publication doesn't exist
    return null
  }
}

/**
 * Save a user's publication settings to their PDS
 * Uses putRecord with rkey 'self' (creates or updates)
 */
export async function savePublication(
  session: { did: string; fetchHandler: (url: string, options: RequestInit) => Promise<Response> },
  publication: Publication
): Promise<void> {
  const record = {
    $type: PUBLICATION_COLLECTION,
    name: publication.name,
    url: publication.url,
    description: publication.description || undefined,
    theme: publication.theme || undefined,
  }

  const response = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: PUBLICATION_COLLECTION,
      rkey: 'self',
      record,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.message || 'Failed to save publication')
  }
}
