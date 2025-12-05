import { AtpAgent } from '@atproto/api'
import { isValidHandle } from '@atproto/syntax'
import type { Theme, ThemePreset, CustomColors } from './themes'

// Simple DID validation
function isValidDid(did: string): boolean {
  return did.startsWith('did:plc:') || did.startsWith('did:web:')
}

// WhiteWind lexicon namespace
const WHITEWIND_COLLECTION = 'com.whtwnd.blog.entry'
// GreenGale lexicon namespace
const GREENGALE_COLLECTION = 'app.greengale.blog.entry'

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
  }>
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

  // Try GreenGale first, then WhiteWind
  for (const collection of [GREENGALE_COLLECTION, WHITEWIND_COLLECTION]) {
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

      return {
        uri: response.data.uri,
        cid: response.data.cid || '',
        authorDid: did,
        rkey,
        source: collection === GREENGALE_COLLECTION ? 'greengale' : 'whitewind',
        content: (record.content as string) || '',
        title: record.title as string | undefined,
        subtitle: record.subtitle as string | undefined,
        createdAt: record.createdAt as string | undefined,
        theme: parseTheme(record.theme),
        visibility: visibility as BlogEntry['visibility'],
        latex: record.latex as boolean | undefined,
        blobs: record.blobs as BlogEntry['blobs'],
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
 */
export async function listBlogEntries(
  identifier: string,
  options: { limit?: number; viewerDid?: string } = {}
): Promise<{ entries: BlogEntry[] }> {
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)

  const agent = new AtpAgent({ service: pdsEndpoint })

  const entries: BlogEntry[] = []

  // Check if viewer is the author (can see all posts)
  const isOwnProfile = options.viewerDid && options.viewerDid === did

  // Fetch from both collections independently (cursors are collection-specific)
  for (const collection of [GREENGALE_COLLECTION, WHITEWIND_COLLECTION]) {
    try {
      const response = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection,
        limit: options.limit || 100,
      })

      for (const item of response.data.records) {
        const record = item.value as Record<string, unknown>
        const visibility = (record.visibility as string | undefined) || 'public'

        // Filter by visibility
        if (!isOwnProfile && visibility !== 'public') {
          // Non-owners can only see public posts
          continue
        }

        entries.push({
          uri: item.uri,
          cid: item.cid,
          authorDid: did,
          rkey: item.uri.split('/').pop() || '',
          source: collection === GREENGALE_COLLECTION ? 'greengale' : 'whitewind',
          content: (record.content as string) || '',
          title: record.title as string | undefined,
          subtitle: record.subtitle as string | undefined,
          createdAt: record.createdAt as string | undefined,
          theme: parseTheme(record.theme),
          visibility: visibility as 'public' | 'url' | 'author',
          latex: record.latex as boolean | undefined,
          blobs: record.blobs as BlogEntry['blobs'],
        })
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
