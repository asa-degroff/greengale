import { AtpAgent } from '@atproto/api'
import { isValidHandle } from '@atproto/syntax'
import type { Theme, ThemePreset, CustomColors } from './themes'
import type { SelfLabels } from './image-upload'

// Simple DID validation
function isValidDid(did: string): boolean {
  return did.startsWith('did:plc:') || did.startsWith('did:web:')
}

// TID (Timestamp Identifier) generation for AT Protocol records
// TID format: 13 base32-sortable characters encoding microsecond timestamp + clock ID
const S32_CHAR = '234567abcdefghijklmnopqrstuvwxyz'

/**
 * Generate a TID (Timestamp Identifier) for AT Protocol records
 * Format: 13 characters of base32-sortable encoding
 * - First 11 chars: microsecond timestamp
 * - Last 2 chars: clock ID (random)
 */
export function generateTid(): string {
  // Get current time in microseconds (use performance.now for sub-millisecond precision)
  const now = Date.now() * 1000
  let tid = ''

  // Encode timestamp (53 bits) into 11 base32 characters
  let timestamp = now
  for (let i = 0; i < 11; i++) {
    tid = S32_CHAR[timestamp & 0x1f] + tid
    timestamp = Math.floor(timestamp / 32)
  }

  // Add 2 random characters for clock ID
  tid += S32_CHAR[Math.floor(Math.random() * 32)]
  tid += S32_CHAR[Math.floor(Math.random() * 32)]

  return tid
}

// WhiteWind lexicon namespace
const WHITEWIND_COLLECTION = 'com.whtwnd.blog.entry'
// GreenGale V1 lexicon namespace
const GREENGALE_COLLECTION = 'app.greengale.blog.entry'
// GreenGale V2 document lexicon (site.standard compatible)
const DOCUMENT_COLLECTION = 'app.greengale.document'
// GreenGale publication lexicon (site.standard compatible)
const PUBLICATION_COLLECTION = 'app.greengale.publication'
// site.standard lexicon namespaces (for dual-publishing)
const SITE_STANDARD_PUBLICATION = 'site.standard.publication'
const SITE_STANDARD_DOCUMENT = 'site.standard.document'

// Theme presets for validation
const VALID_PRESETS = new Set<ThemePreset>([
  'default',
  'github-light',
  'github-dark',
  'dracula',
  'nord',
  'solarized-light',
  'solarized-dark',
  'monokai',
  'custom',
])

export interface BlogEntry {
  uri: string
  cid: string
  authorDid: string
  rkey: string
  source: 'whitewind' | 'greengale' | 'network'
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
  // External URL for site.standard posts (resolved from publication)
  externalUrl?: string
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
  enableSiteStandard?: boolean
  showInDiscover?: boolean
}

// site.standard.theme.color#rgb format (RGB integers 0-255)
export interface SiteStandardColor {
  $type?: 'site.standard.theme.color#rgb'
  r: number
  g: number
  b: number
}

// site.standard.theme.basic schema
export interface SiteStandardBasicTheme {
  $type?: 'site.standard.theme.basic'
  foreground?: SiteStandardColor
  background?: SiteStandardColor
  accent?: SiteStandardColor
  accentForeground?: SiteStandardColor
}

// app.greengale.theme record structure (stored at top level of publication)
// Uses native GreenGale format with hex colors (not RGB like basicTheme)
export interface GreenGaleTheme {
  $type: 'app.greengale.theme'
  preset?: string // Theme preset name (e.g., 'solarized-dark', 'dracula')
  custom?: {
    background?: string // Hex color (e.g., '#ffffff')
    text?: string       // Hex color
    accent?: string     // Hex color
  }
}

// site.standard.publication record structure
export interface SiteStandardPublication {
  url: string
  name: string
  description?: string
  icon?: unknown // BlobRef
  basicTheme?: SiteStandardBasicTheme
  theme?: GreenGaleTheme // GreenGale's full theme (app.greengale.theme)
  preferences?: unknown
  // Internal: the rkey used for this publication (TID format)
  rkey?: string
}

// site.standard.document record structure
export interface SiteStandardDocument {
  site: string // AT-URI of publication: at://did/site.standard.publication/{tid}
  path?: string
  title: string
  description?: string
  coverImage?: unknown // BlobRef
  content?: {
    uri: string // AT-URI to app.greengale.document
  }
  textContent?: string
  bskyPostRef?: { uri: string; cid: string }
  tags?: string[]
  publishedAt: string
  updatedAt?: string
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
 * Resolve a site.standard.publication AT-URI to get the external URL
 * @param siteUri AT-URI like at://did/site.standard.publication/rkey
 * @param documentPath Path component from the document (e.g., "/posts/my-post")
 * @returns Full external URL or null if resolution fails
 */
export async function resolveExternalUrl(siteUri: string, documentPath: string): Promise<string | null> {
  try {
    // Parse AT-URI: at://did/collection/rkey
    const match = siteUri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/)
    if (!match) return null

    const [, pubDid, collection, rkey] = match

    // Resolve DID to find PDS endpoint
    const didDocRes = await fetch(`https://plc.directory/${pubDid}`)
    if (!didDocRes.ok) return null
    const didDoc = (await didDocRes.json()) as {
      service?: Array<{ id: string; type: string; serviceEndpoint: string }>
    }

    const pdsService = didDoc.service?.find(
      (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
    )
    if (!pdsService?.serviceEndpoint) return null

    // Fetch publication record
    const recordUrl = `${pdsService.serviceEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(pubDid)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
    const recordRes = await fetch(recordUrl)
    if (!recordRes.ok) return null

    const record = (await recordRes.json()) as { value?: { url?: string } }
    const pubUrl = record.value?.url
    if (!pubUrl) return null

    // Construct full URL
    const baseUrl = pubUrl.replace(/\/$/, '')
    const normalizedPath = documentPath.startsWith('/') ? documentPath : `/${documentPath}`
    return `${baseUrl}${normalizedPath}`
  } catch {
    return null
  }
}

/**
 * De-duplicate blog entries by rkey, preferring GreenGale/WhiteWind over network posts
 * When the same rkey exists in multiple collections (dual-published), keep the richer version
 */
export function deduplicateBlogEntries(entries: BlogEntry[]): BlogEntry[] {
  const seen = new Map<string, BlogEntry>()
  for (const entry of entries) {
    const key = entry.rkey
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, entry)
    } else if (entry.source !== 'network' && existing.source === 'network') {
      // Prefer GreenGale/WhiteWind over site.standard (network)
      seen.set(key, entry)
    }
  }
  return Array.from(seen.values())
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

  // Collect entries that need external URL resolution (site.standard posts)
  const pendingUrlResolutions: Array<{ entry: BlogEntry; siteUri: string; path: string }> = []

  // Fetch from all four collections independently (cursors are collection-specific)
  for (const collection of [DOCUMENT_COLLECTION, GREENGALE_COLLECTION, WHITEWIND_COLLECTION, SITE_STANDARD_DOCUMENT]) {
    try {
      let cursor: string | undefined
      let fetched = 0
      const isV2 = collection === DOCUMENT_COLLECTION
      const isSiteStandard = collection === SITE_STANDARD_DOCUMENT

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
          // site.standard posts are always public (no visibility field)
          const visibility = isSiteStandard ? 'public' : ((record.visibility as string | undefined) || 'public')

          // Filter by visibility
          if (!isOwnProfile && visibility !== 'public') {
            // Non-owners can only see public posts
            continue
          }

          // Field mapping: site.standard uses different field names
          // V2/site.standard use publishedAt, V1/WhiteWind use createdAt
          const createdAt = (isV2 || isSiteStandard)
            ? (record.publishedAt as string | undefined)
            : (record.createdAt as string | undefined)

          // site.standard uses 'description' for subtitle, 'textContent' for content
          const subtitle = isSiteStandard
            ? (record.description as string | undefined)
            : (record.subtitle as string | undefined)

          const content = isSiteStandard
            ? (record.textContent as string) || ''
            : (record.content as string) || ''

          // Determine source type
          let source: BlogEntry['source']
          if (collection === WHITEWIND_COLLECTION) {
            source = 'whitewind'
          } else if (isSiteStandard) {
            source = 'network'
          } else {
            source = 'greengale'
          }

          // Get path for both V2 and site.standard
          const path = (isV2 || isSiteStandard) ? (record.path as string | undefined) : undefined

          const entry: BlogEntry = {
            uri: item.uri,
            cid: item.cid,
            authorDid: did,
            rkey: item.uri.split('/').pop() || '',
            source,
            content,
            title: record.title as string | undefined,
            subtitle,
            createdAt,
            theme: parseTheme(record.theme),
            visibility: visibility as 'public' | 'url' | 'author',
            latex: record.latex as boolean | undefined,
            blobs: record.blobs as BlogEntry['blobs'],
            // V2 fields
            url: isV2 ? (record.url as string | undefined) : undefined,
            path,
          }

          entries.push(entry)

          // Queue external URL resolution for site.standard posts
          if (isSiteStandard) {
            const siteUri = record.site as string | undefined
            if (siteUri && path) {
              pendingUrlResolutions.push({ entry, siteUri, path })
            }
          }
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

  // Resolve external URLs for site.standard posts (in parallel)
  if (pendingUrlResolutions.length > 0) {
    const resolutions = await Promise.all(
      pendingUrlResolutions.map(async ({ entry, siteUri, path }) => {
        const externalUrl = await resolveExternalUrl(siteUri, path)
        return { entry, externalUrl }
      })
    )
    for (const { entry, externalUrl } of resolutions) {
      if (externalUrl) {
        entry.externalUrl = externalUrl
      }
    }
  }

  // De-duplicate dual-published posts (prefer GreenGale/WhiteWind over network)
  const deduplicatedEntries = deduplicateBlogEntries(entries)

  // Sort by createdAt descending
  deduplicatedEntries.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return dateB - dateA
  })

  return { entries: deduplicatedEntries }
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
      enableSiteStandard: (record.enableSiteStandard as boolean | undefined) || false,
      showInDiscover: (record.showInDiscover as boolean | undefined) ?? true,
    }
  } catch {
    // Publication doesn't exist
    return null
  }
}

/**
 * Save a user's publication settings to their PDS
 * Uses putRecord with rkey 'self' (creates or updates)
 * When enableSiteStandard is true, also saves to site.standard.publication
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
    enableSiteStandard: publication.enableSiteStandard || undefined,
    showInDiscover: publication.showInDiscover === false ? false : undefined,
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

  // Dual-publish to site.standard.publication if enabled, otherwise delete
  if (publication.enableSiteStandard) {
    try {
      await saveSiteStandardPublication(session, {
        url: publication.url,
        name: publication.name,
        description: publication.description,
        basicTheme: toBasicTheme(publication.theme),
        theme: toGreenGaleTheme(publication.theme),
        preferences: {
          showInDiscover: publication.showInDiscover !== false,
          greengale: {},
        },
      })
    } catch (err) {
      // Don't fail the main save if site.standard fails
      console.warn('Failed to dual-publish to site.standard.publication:', err)
    }
  } else {
    // Delete GreenGale's site.standard.publication record if it exists
    try {
      await deleteSiteStandardPublication(session)
    } catch (err) {
      // Don't fail the main save if deletion fails
      console.warn('Failed to delete site.standard.publication:', err)
    }
  }
}

/**
 * Convert hex color string to RGB object
 * Returns undefined if the hex string is invalid
 */
export function hexToRgb(hex: string | undefined): SiteStandardColor | undefined {
  if (!hex) return undefined

  // Remove # prefix if present
  const cleanHex = hex.replace(/^#/, '')

  // Support both 3-char and 6-char hex
  let r: number, g: number, b: number
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16)
    g = parseInt(cleanHex[1] + cleanHex[1], 16)
    b = parseInt(cleanHex[2] + cleanHex[2], 16)
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16)
    g = parseInt(cleanHex.slice(2, 4), 16)
    b = parseInt(cleanHex.slice(4, 6), 16)
  } else {
    return undefined
  }

  // Validate parsed values
  if (isNaN(r) || isNaN(g) || isNaN(b)) return undefined

  return { $type: 'site.standard.theme.color#rgb', r, g, b }
}

/**
 * Compute luminance of a color (0-1 range)
 * Used to determine if text should be light or dark on a given background
 */
function getLuminance(color: SiteStandardColor): number {
  const { r, g, b } = color
  // Convert to 0-1 range and apply sRGB transfer function
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * Compute a contrasting foreground color for text on an accent background
 * Uses the theme's foreground or background color for cohesion,
 * choosing whichever provides better contrast with the accent
 */
export function computeAccentForeground(
  accent: SiteStandardColor,
  foreground?: SiteStandardColor,
  background?: SiteStandardColor
): SiteStandardColor {
  const accentLuminance = getLuminance(accent)

  // Calculate contrast ratios with foreground and background
  // Using simplified contrast check based on luminance difference
  const fgLuminance = foreground ? getLuminance(foreground) : 0
  const bgLuminance = background ? getLuminance(background) : 1

  // Calculate contrast ratios (WCAG formula simplified)
  const fgContrast = foreground
    ? (Math.max(accentLuminance, fgLuminance) + 0.05) /
      (Math.min(accentLuminance, fgLuminance) + 0.05)
    : 0
  const bgContrast = background
    ? (Math.max(accentLuminance, bgLuminance) + 0.05) /
      (Math.min(accentLuminance, bgLuminance) + 0.05)
    : 0

  // Use whichever color provides better contrast
  // Require at least 3:1 contrast ratio for large text (WCAG AA)
  if (fgContrast >= bgContrast && fgContrast >= 3 && foreground) {
    return foreground
  }
  if (bgContrast >= 3 && background) {
    return background
  }

  // Fallback to pure black/white if theme colors don't provide sufficient contrast
  return accentLuminance > 0.179
    ? { $type: 'site.standard.theme.color#rgb', r: 0, g: 0, b: 0 }
    : { $type: 'site.standard.theme.color#rgb', r: 255, g: 255, b: 255 }
}

/**
 * Convert GreenGale theme to site.standard basicTheme format
 * Uses RGB objects as per site.standard.theme.basic schema
 */
export function toBasicTheme(theme?: Theme): SiteStandardBasicTheme | undefined {
  if (!theme) return undefined

  // Map presets to hex colors (approximate values)
  const presetColors: Record<string, { foreground: string; background: string; accent: string }> = {
    default: { foreground: '#1a1a1a', background: '#ffffff', accent: '#2563eb' },
    'github-light': { foreground: '#24292f', background: '#ffffff', accent: '#0969da' },
    'github-dark': { foreground: '#e6edf3', background: '#0d1117', accent: '#58a6ff' },
    dracula: { foreground: '#f8f8f2', background: '#282a36', accent: '#bd93f9' },
    nord: { foreground: '#eceff4', background: '#2e3440', accent: '#88c0d0' },
    'solarized-light': { foreground: '#657b83', background: '#fdf6e3', accent: '#268bd2' },
    'solarized-dark': { foreground: '#839496', background: '#002b36', accent: '#268bd2' },
    monokai: { foreground: '#f8f8f2', background: '#272822', accent: '#a6e22e' },
  }

  let foregroundHex: string | undefined
  let backgroundHex: string | undefined
  let accentHex: string | undefined

  if (theme.custom) {
    foregroundHex = theme.custom.text
    backgroundHex = theme.custom.background
    accentHex = theme.custom.accent
  } else {
    const colors = presetColors[theme.preset || 'default'] || presetColors.default
    foregroundHex = colors.foreground
    backgroundHex = colors.background
    accentHex = colors.accent
  }

  const foreground = hexToRgb(foregroundHex)
  const background = hexToRgb(backgroundHex)
  const accent = hexToRgb(accentHex)
  const accentForeground = accent
    ? computeAccentForeground(accent, foreground, background)
    : undefined

  return {
    $type: 'site.standard.theme.basic',
    foreground,
    background,
    accent,
    accentForeground,
  }
}

/**
 * Convert GreenGale theme to app.greengale.theme format
 * Simply adds $type and passes through the native hex color format
 */
export function toGreenGaleTheme(theme?: Theme): GreenGaleTheme | undefined {
  if (!theme) return undefined

  return {
    $type: 'app.greengale.theme',
    preset: theme.preset,
    custom: theme.custom,
  }
}

/**
 * Extract plaintext from markdown content for textContent field
 */
export function extractPlaintext(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]*`/g, '') // Remove inline code
    .replace(/\$\$[\s\S]*?\$\$/g, '') // Remove LaTeX blocks
    .replace(/\$[^$]*\$/g, '') // Remove inline LaTeX
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // Remove images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Extract link text
    .replace(/^#{1,6}\s+/gm, '') // Remove heading markers
    .replace(/[*_~`]/g, '') // Remove markdown formatting
    .replace(/\n+/g, ' ') // Normalize whitespace
    .trim()
    .slice(0, 100000)
}

/**
 * Check if an rkey is a valid TID format (13 base32-sortable characters)
 */
function isValidTid(rkey: string): boolean {
  if (rkey.length !== 13) return false
  // TID uses base32-sortable: 234567abcdefghijklmnopqrstuvwxyz
  return /^[234567a-z]{13}$/.test(rkey)
}

/**
 * Check if a site.standard.publication record belongs to GreenGale
 * by looking for preferences.greengale in the record
 */
function isGreenGalePublication(record: Record<string, unknown>): boolean {
  const preferences = record.preferences as Record<string, unknown> | undefined
  return preferences?.greengale !== undefined
}

/**
 * Save site.standard.publication record (dual-publish)
 * Uses TID-based keys as required by site.standard schema
 * Only manages GreenGale's own records (identified by preferences.greengale)
 * Returns the rkey used (for building AT-URIs)
 */
export async function saveSiteStandardPublication(
  session: { did: string; fetchHandler: (url: string, options: RequestInit) => Promise<Response> },
  publication: SiteStandardPublication
): Promise<string> {
  // If rkey provided and valid TID, use it
  let rkey = publication.rkey && isValidTid(publication.rkey) ? publication.rkey : undefined
  let oldInvalidRkey: string | undefined

  if (!rkey) {
    // Try to find existing GreenGale publication to get its rkey
    const listResponse = await session.fetchHandler(
      `/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(session.did)}&collection=${encodeURIComponent(SITE_STANDARD_PUBLICATION)}&limit=50`,
      { method: 'GET' }
    )

    if (listResponse.ok) {
      const listData = await listResponse.json() as { records?: Array<{ uri: string; value: Record<string, unknown> }> }
      if (listData.records && listData.records.length > 0) {
        // Look for a GreenGale record (has preferences.greengale)
        for (const item of listData.records) {
          // Only consider records that belong to GreenGale
          if (!isGreenGalePublication(item.value)) {
            continue
          }

          const existingRkey = item.uri.split('/').pop() || ''
          if (isValidTid(existingRkey)) {
            // Found a GreenGale record with valid TID
            rkey = existingRkey
            break
          } else {
            // Found a GreenGale record with invalid rkey (like 'self'), mark for deletion
            oldInvalidRkey = existingRkey
          }
        }
      }
    }

    // If no valid GreenGale record found, generate new TID
    if (!rkey) {
      rkey = generateTid()
    }
  }

  // Ensure preferences.greengale is set to identify this as a GreenGale record
  const preferences = (publication.preferences || {}) as Record<string, unknown>
  if (!preferences.greengale) {
    preferences.greengale = {}
  }

  const record = {
    $type: SITE_STANDARD_PUBLICATION,
    url: publication.url,
    name: publication.name,
    description: publication.description || undefined,
    basicTheme: publication.basicTheme || undefined,
    theme: publication.theme || undefined,
    preferences,
  }

  // Save with valid TID rkey
  const response = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: SITE_STANDARD_PUBLICATION,
      rkey,
      record,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.message || 'Failed to save site.standard.publication')
  }

  // Clean up old invalid GreenGale record (like 'self') after successful save
  if (oldInvalidRkey && oldInvalidRkey !== rkey) {
    try {
      await session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: session.did,
          collection: SITE_STANDARD_PUBLICATION,
          rkey: oldInvalidRkey,
        }),
      })
    } catch {
      // Ignore deletion errors - the new record was saved successfully
    }
  }

  return rkey
}

/**
 * Delete GreenGale's site.standard.publication record
 * Only deletes records that belong to GreenGale (have preferences.greengale)
 * Used when user disables site.standard publishing
 */
export async function deleteSiteStandardPublication(
  session: { did: string; fetchHandler: (url: string, options: RequestInit) => Promise<Response> }
): Promise<void> {
  // List all site.standard.publication records
  const listResponse = await session.fetchHandler(
    `/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(session.did)}&collection=${encodeURIComponent(SITE_STANDARD_PUBLICATION)}&limit=50`,
    { method: 'GET' }
  )

  if (!listResponse.ok) {
    return // No records to delete
  }

  const listData = await listResponse.json() as { records?: Array<{ uri: string; value: Record<string, unknown> }> }
  if (!listData.records || listData.records.length === 0) {
    return // No records to delete
  }

  // Find and delete only GreenGale records
  for (const item of listData.records) {
    if (!isGreenGalePublication(item.value)) {
      continue // Skip records from other apps
    }

    const rkey = item.uri.split('/').pop() || ''
    if (!rkey) continue

    try {
      await session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: session.did,
          collection: SITE_STANDARD_PUBLICATION,
          rkey,
        }),
      })
      console.log(`[SiteStandard] Deleted publication record: ${rkey}`)
    } catch (err) {
      console.warn(`[SiteStandard] Failed to delete publication record: ${rkey}`, err)
    }
  }
}

/**
 * Save site.standard.document record (dual-publish)
 * Uses the same rkey as the app.greengale.document for consistency
 */
export async function saveSiteStandardDocument(
  session: { did: string; fetchHandler: (url: string, options: RequestInit) => Promise<Response> },
  document: SiteStandardDocument,
  rkey: string
): Promise<void> {
  const record = {
    $type: SITE_STANDARD_DOCUMENT,
    site: document.site,
    path: document.path || undefined,
    title: document.title,
    description: document.description || undefined,
    content: document.content || undefined,
    textContent: document.textContent || undefined,
    tags: document.tags?.length ? document.tags : undefined,
    publishedAt: document.publishedAt,
    updatedAt: document.updatedAt || undefined,
  }

  const response = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: session.did,
      collection: SITE_STANDARD_DOCUMENT,
      rkey,
      record,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.message || 'Failed to save site.standard.document')
  }
}

/**
 * Get a user's GreenGale site.standard.publication from their PDS
 * Only returns records that belong to GreenGale (have preferences.greengale)
 * and have a valid TID rkey
 */
export async function getSiteStandardPublication(
  identifier: string
): Promise<SiteStandardPublication | null> {
  const did = await resolveIdentity(identifier)
  const pdsEndpoint = await getPdsEndpoint(did)
  const agent = new AtpAgent({ service: pdsEndpoint })

  // Check if rkey is a valid TID (13 base32-sortable characters)
  const isValidTidRkey = (rkey: string): boolean => {
    if (rkey.length !== 13) return false
    return /^[234567a-z]{13}$/.test(rkey)
  }

  try {
    // List records to find GreenGale's publication
    const response = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: SITE_STANDARD_PUBLICATION,
      limit: 50,
    })

    if (response.data.records.length === 0) {
      return null
    }

    // Find a GreenGale record with a valid TID rkey
    for (const item of response.data.records) {
      const record = item.value as Record<string, unknown>

      // Only consider records that belong to GreenGale
      const preferences = record.preferences as Record<string, unknown> | undefined
      if (!preferences?.greengale) {
        continue
      }

      const rkey = item.uri.split('/').pop() || ''
      if (isValidTidRkey(rkey)) {
        return {
          url: (record.url as string) || '',
          name: (record.name as string) || '',
          description: record.description as string | undefined,
          basicTheme: record.basicTheme as SiteStandardPublication['basicTheme'],
          preferences: record.preferences,
          rkey,
        }
      }
    }

    // No valid GreenGale publication found
    return null
  } catch {
    return null
  }
}

/**
 * Check if a basicTheme uses the old format (hex strings, old property names, or missing $type)
 * Old format: { primaryColor: '#hex', backgroundColor: '#hex', accentColor: '#hex' }
 * New format: { $type: 'site.standard.theme.basic', foreground: {$type, r,g,b}, ... }
 */
export function hasOldBasicThemeFormat(
  theme: unknown
): theme is { primaryColor?: string; backgroundColor?: string; accentColor?: string } {
  if (!theme || typeof theme !== 'object') return false

  const t = theme as Record<string, unknown>

  // Check for old property names (hex strings)
  if (
    typeof t.primaryColor === 'string' ||
    typeof t.backgroundColor === 'string' ||
    typeof t.accentColor === 'string'
  ) {
    return true
  }

  // Check if new property names exist but are hex strings instead of RGB objects
  if (
    typeof t.foreground === 'string' ||
    typeof t.background === 'string' ||
    typeof t.accent === 'string'
  ) {
    return true
  }

  // Check if $type is missing on the theme itself
  if (t.$type !== 'site.standard.theme.basic') {
    // Only flag as old format if there are color properties present
    if (t.foreground || t.background || t.accent) {
      return true
    }
  }

  // Check if any color objects are missing $type
  const colorProps = ['foreground', 'background', 'accent', 'accentForeground']
  for (const prop of colorProps) {
    const color = t[prop] as Record<string, unknown> | undefined
    if (color && typeof color.r === 'number' && color.$type !== 'site.standard.theme.color#rgb') {
      return true
    }
  }

  return false
}

/**
 * Convert old basicTheme format to new RGB format
 */
export function convertOldBasicTheme(
  oldTheme: unknown
): SiteStandardBasicTheme | undefined {
  if (!oldTheme || typeof oldTheme !== 'object') return undefined

  const t = oldTheme as Record<string, unknown>

  // Handle old property names: primaryColor -> foreground, backgroundColor -> background, accentColor -> accent
  let foregroundHex: string | undefined
  let backgroundHex: string | undefined
  let accentHex: string | undefined

  if (typeof t.primaryColor === 'string') {
    foregroundHex = t.primaryColor
  } else if (typeof t.foreground === 'string') {
    foregroundHex = t.foreground
  }

  if (typeof t.backgroundColor === 'string') {
    backgroundHex = t.backgroundColor
  } else if (typeof t.background === 'string') {
    backgroundHex = t.background
  }

  if (typeof t.accentColor === 'string') {
    accentHex = t.accentColor
  } else if (typeof t.accent === 'string') {
    accentHex = t.accent
  }

  // If already in RGB format, ensure $type fields are set
  if (!foregroundHex && !backgroundHex && !accentHex) {
    // Check if it's already valid RGB format
    if (
      (t.foreground && typeof (t.foreground as Record<string, unknown>).r === 'number') ||
      (t.background && typeof (t.background as Record<string, unknown>).r === 'number')
    ) {
      // Add/update $type fields (spread first, then $type to ensure it overwrites any old value)
      const existing = oldTheme as SiteStandardBasicTheme
      return {
        $type: 'site.standard.theme.basic',
        foreground: existing.foreground
          ? { ...existing.foreground, $type: 'site.standard.theme.color#rgb' }
          : undefined,
        background: existing.background
          ? { ...existing.background, $type: 'site.standard.theme.color#rgb' }
          : undefined,
        accent: existing.accent
          ? { ...existing.accent, $type: 'site.standard.theme.color#rgb' }
          : undefined,
        accentForeground: existing.accentForeground
          ? { ...existing.accentForeground, $type: 'site.standard.theme.color#rgb' }
          : undefined,
      }
    }
    return undefined
  }

  // Convert hex strings to RGB objects (hexToRgb already adds $type)
  const foreground = hexToRgb(foregroundHex)
  const background = hexToRgb(backgroundHex)
  const accent = hexToRgb(accentHex)
  const accentForeground = accent
    ? computeAccentForeground(accent, foreground, background)
    : undefined

  return {
    $type: 'site.standard.theme.basic',
    foreground,
    background,
    accent,
    accentForeground,
  }
}

/**
 * Migrate old site.standard.publication records to new format
 * Should be called after user login to ensure records are up-to-date
 *
 * Migration tasks:
 * 1. Convert 'self' rkey to proper TID
 * 2. Convert old basicTheme format (hex strings) to new RGB format with $type
 * 3. Add preferences.greengale identifier
 * 4. Move theme from preferences.greengale.theme to top-level theme property
 * 5. Convert old RGB theme format to new hex format
 */
export async function migrateSiteStandardPublication(
  session: { did: string; fetchHandler: (url: string, options: RequestInit) => Promise<Response> }
): Promise<{ migrated: boolean; error?: string }> {
  // Check if rkey is a valid TID (13 base32-sortable characters)
  const isValidTidRkey = (rkey: string): boolean => {
    if (rkey.length !== 13) return false
    return /^[234567a-z]{13}$/.test(rkey)
  }

  try {
    // List all site.standard.publication records
    const listResponse = await session.fetchHandler(
      `/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(session.did)}&collection=${encodeURIComponent(SITE_STANDARD_PUBLICATION)}&limit=50`,
      { method: 'GET' }
    )

    if (!listResponse.ok) {
      return { migrated: false }
    }

    const listData = (await listResponse.json()) as {
      records?: Array<{ uri: string; value: Record<string, unknown> }>
    }

    if (!listData.records || listData.records.length === 0) {
      return { migrated: false }
    }

    let migratedCount = 0

    for (const item of listData.records) {
      const record = item.value
      const rkey = item.uri.split('/').pop() || ''

      // Check if this is a GreenGale record
      const preferences = record.preferences as Record<string, unknown> | undefined
      const isGreenGaleRecord =
        preferences?.greengale ||
        (typeof record.url === 'string' && record.url.includes('greengale.app'))

      if (!isGreenGaleRecord) continue

      // Check if theme needs to be migrated from preferences to top-level
      const oldThemeInPrefs = (preferences?.greengale as Record<string, unknown> | undefined)?.theme as Theme | undefined
      const hasOldThemeLocation = oldThemeInPrefs !== undefined && !record.theme

      // Check if top-level theme has old RGB format (needs conversion to hex)
      const existingTheme = record.theme as Record<string, unknown> | undefined
      const hasOldThemeFormat = existingTheme &&
        existingTheme.$type === 'app.greengale.theme' &&
        (existingTheme.foreground !== undefined || existingTheme.background !== undefined)

      // Check if migration is needed
      const needsMigration =
        rkey === 'self' ||
        !isValidTidRkey(rkey) ||
        hasOldBasicThemeFormat(record.basicTheme) ||
        hasOldThemeLocation ||
        hasOldThemeFormat ||
        !preferences?.greengale

      if (!needsMigration) continue

      console.log(`[Migration] Migrating site.standard.publication record: ${rkey}`)

      // Build the new record
      const newBasicTheme = hasOldBasicThemeFormat(record.basicTheme)
        ? convertOldBasicTheme(record.basicTheme)
        : record.basicTheme

      // Migrate theme to new format
      // Priority: 1) Convert old RGB format to hex, 2) Move from preferences, 3) Keep undefined
      let newTheme: GreenGaleTheme | undefined
      if (hasOldThemeFormat && existingTheme) {
        // Convert old RGB format to new hex format
        // Extract preset from old format, custom colors need RGB->hex conversion
        const oldPreset = existingTheme.preset as string | undefined
        const oldFg = existingTheme.foreground as { r: number; g: number; b: number } | undefined
        const oldBg = existingTheme.background as { r: number; g: number; b: number } | undefined
        const oldAccent = existingTheme.accent as { r: number; g: number; b: number } | undefined

        const rgbToHex = (c: { r: number; g: number; b: number }) =>
          `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`

        // If there were custom RGB colors, convert them to hex
        const hasCustomColors = oldFg || oldBg || oldAccent
        newTheme = {
          $type: 'app.greengale.theme',
          preset: oldPreset,
          custom: hasCustomColors ? {
            text: oldFg ? rgbToHex(oldFg) : undefined,
            background: oldBg ? rgbToHex(oldBg) : undefined,
            accent: oldAccent ? rgbToHex(oldAccent) : undefined,
          } : undefined,
        }
      } else if (oldThemeInPrefs) {
        // Move from preferences.greengale.theme to top-level
        newTheme = toGreenGaleTheme(oldThemeInPrefs)
      } else {
        newTheme = undefined
      }

      // Build new preferences without the theme (it's now at top level)
      const existingGreengale = (preferences?.greengale || {}) as Record<string, unknown>
      const { theme: _removedTheme, ...cleanGreengale } = existingGreengale

      const newRecord = {
        $type: SITE_STANDARD_PUBLICATION,
        url: record.url,
        name: record.name,
        description: record.description,
        basicTheme: newBasicTheme,
        theme: newTheme,
        preferences: {
          ...(preferences || {}),
          greengale: Object.keys(cleanGreengale).length > 0
            ? cleanGreengale
            : { migrated: true, migratedAt: new Date().toISOString() },
        },
      }

      // Generate new TID for the record
      const newRkey = generateTid()

      // Create new record with TID rkey
      const putResponse = await session.fetchHandler(
        `/xrpc/com.atproto.repo.putRecord`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: SITE_STANDARD_PUBLICATION,
            rkey: newRkey,
            record: newRecord,
          }),
        }
      )

      if (!putResponse.ok) {
        const errorText = await putResponse.text()
        console.warn(`[Migration] Failed to create new record: ${errorText}`)
        continue
      }

      // Delete the old record if it had a different rkey
      if (rkey !== newRkey) {
        try {
          const deleteResponse = await session.fetchHandler(
            `/xrpc/com.atproto.repo.deleteRecord`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repo: session.did,
                collection: SITE_STANDARD_PUBLICATION,
                rkey: rkey,
              }),
            }
          )

          if (deleteResponse.ok) {
            console.log(`[Migration] Deleted old record with rkey: ${rkey}`)
          } else {
            console.warn(`[Migration] Failed to delete old record: ${rkey}`)
          }
        } catch (deleteError) {
          console.warn(`[Migration] Failed to delete old record: ${rkey}`, deleteError)
          // Continue anyway - the new record was created successfully
        }
      }

      migratedCount++
      console.log(`[Migration] Successfully migrated to new rkey: ${newRkey}`)
    }

    return { migrated: migratedCount > 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Migration] Failed to migrate site.standard.publication:', message)
    return { migrated: false, error: message }
  }
}
