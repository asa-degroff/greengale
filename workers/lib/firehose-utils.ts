/**
 * Pure utility functions extracted from the firehose consumer for testability.
 * These have no Cloudflare-specific dependencies and can be imported directly in tests.
 */

// Content labels that indicate sensitive images (should not be used for OG thumbnails)
export const SENSITIVE_LABELS = ['nudity', 'sexual', 'porn', 'graphic-media']

// Collections we're interested in
export const BLOG_COLLECTIONS = [
  'com.whtwnd.blog.entry',
  'app.greengale.blog.entry',
  'app.greengale.document',
  'site.standard.document',
]

export const PUBLICATION_COLLECTIONS = [
  'app.greengale.publication',
  'site.standard.publication',
]

/**
 * Check if a blob has sensitive content labels that should be excluded from OG thumbnails
 */
export function hasSensitiveLabels(blob: Record<string, unknown>): boolean {
  const labels = blob.labels as { values?: Array<{ val: string }> } | undefined
  if (!labels?.values) return false
  return labels.values.some(l => SENSITIVE_LABELS.includes(l.val))
}

/**
 * Extract CID from a blobref object (handles multiple AT Protocol formats)
 */
export function extractCidFromBlobref(blobref: unknown): string | null {
  if (!blobref) return null

  // Direct CID string
  if (typeof blobref === 'string') return blobref
  if (typeof blobref !== 'object') return null

  const ref = blobref as Record<string, unknown>

  // Structure: { ref: { $link: cid } } or { ref: CID instance }
  if (ref.ref && typeof ref.ref === 'object') {
    const innerRef = ref.ref as Record<string, unknown>
    if (typeof innerRef.$link === 'string') return innerRef.$link
    if (typeof innerRef.toString === 'function') {
      const cidStr = innerRef.toString()
      if (typeof cidStr === 'string' && cidStr.startsWith('baf')) return cidStr
    }
  }

  // Structure: { $link: cid }
  if (typeof ref.$link === 'string') return ref.$link

  // Structure: { cid: string }
  if (typeof ref.cid === 'string') return ref.cid

  return null
}

/**
 * Extract the first non-sensitive image CID from a post's blobs array
 */
export function extractFirstImageCid(record: Record<string, unknown>): string | null {
  const blobs = record?.blobs
  if (!blobs || !Array.isArray(blobs)) return null

  for (const blob of blobs) {
    if (typeof blob !== 'object' || blob === null) continue

    // Skip images with sensitive content labels
    if (hasSensitiveLabels(blob as Record<string, unknown>)) continue

    // Extract CID from blobref
    const blobRecord = blob as Record<string, unknown>
    const cid = extractCidFromBlobref(blobRecord.blobref)
    if (cid) return cid // Return the first valid, non-sensitive image
  }

  return null
}

/**
 * Extract icon CID from a publication record's blob reference
 */
export function extractIconCid(record: Record<string, unknown> | undefined): string | null {
  let iconCid: string | null = null
  const icon = record?.icon as Record<string, unknown> | undefined
  if (icon?.ref && typeof icon.ref === 'object') {
    const ref = icon.ref as Record<string, unknown>
    if (ref.$link && typeof ref.$link === 'string') {
      iconCid = ref.$link
    }
  }
  return iconCid
}

/**
 * Generate a URL-safe slug from a title
 */
export function generateSlug(title: string | null): string | null {
  return title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : null
}

/**
 * Generate a content preview by stripping markdown and truncating
 */
export function generateContentPreview(content: string, maxLength: number = 3000): string {
  return content
    .replace(/[#*`\[\]()!]/g, '')
    .replace(/\n{2,}/g, '\n\n')          // Preserve paragraph breaks
    .replace(/(?<!\n)\n(?!\n)/g, ' ')     // Single newlines → space (soft wraps)
    .trim()
    .slice(0, maxLength)
}

/**
 * Normalize tags: lowercase, trim, dedupe, limit to 100
 */
export function normalizeTags(tags: unknown): string[] {
  if (!tags || !Array.isArray(tags)) return []

  return [...new Set(
    tags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0 && t.length <= 100)
  )].slice(0, 100)
}

/**
 * Resolve a DID to its DID document URL (supports did:plc and did:web)
 */
export function resolveDidDocUrl(did: string): string {
  if (did.startsWith('did:web:')) {
    const parts = did.slice('did:web:'.length).split(':')
    const host = decodeURIComponent(parts[0])
    const path = parts.length > 1 ? `/${parts.slice(1).map(decodeURIComponent).join('/')}` : '/.well-known'
    return `https://${host}${path}/did.json`
  }
  return `https://plc.directory/${did}`
}

/**
 * Route a Jetstream event to the appropriate handler action
 */
export function routeEvent(event: {
  kind: string
  commit?: {
    operation: string
    collection: string
  }
}): 'ignore' | 'index_post' | 'delete_post' | 'index_pub' | 'delete_pub' {
  if (event.kind !== 'commit') return 'ignore'
  if (!event.commit) return 'ignore'

  const { operation, collection } = event.commit

  if (PUBLICATION_COLLECTIONS.includes(collection)) {
    return operation === 'delete' ? 'delete_pub' : 'index_pub'
  }

  if (BLOG_COLLECTIONS.includes(collection)) {
    return operation === 'delete' ? 'delete_post' : 'index_post'
  }

  return 'ignore'
}

/** Post data extracted from a record for indexing */
export interface IndexedPost {
  uri: string
  did: string
  rkey: string
  title: string | null
  subtitle: string | null
  visibility: string
  content: string
  hasLatex: boolean
  createdAt: string | null
  themePreset: string | null
  firstImageCid: string | null
  source: 'whitewind' | 'greengale'
  slug: string | null
  contentPreview: string
}

/**
 * Extract post metadata from a record for indexing.
 * This extracts the basic fields; the full indexPost method does additional
 * processing (Leaflet content, external URLs, spam filtering, etc.)
 */
export function extractPostData(
  uri: string,
  did: string,
  rkey: string,
  source: 'whitewind' | 'greengale',
  record: Record<string, unknown> | undefined,
  collection: string
): IndexedPost {
  const isV2Document = collection === 'app.greengale.document'
  const isSiteStandardDocument = collection === 'site.standard.document'

  const title = (record?.title as string) || null
  const subtitle = isSiteStandardDocument
    ? (record?.description as string) || null
    : (record?.subtitle as string) || null
  const visibility = (record?.visibility as string) || 'public'
  const content = isSiteStandardDocument
    ? (record?.textContent as string) || ''
    : (record?.content as string) || ''
  const hasLatex = source === 'greengale' && !isSiteStandardDocument && (record?.latex === true)

  const createdAt = (isV2Document || isSiteStandardDocument)
    ? (record?.publishedAt as string) || null
    : (record?.createdAt as string) || null

  let themePreset: string | null = null
  if (record?.theme) {
    const themeData = record.theme as Record<string, unknown>
    if (themeData.custom) {
      themePreset = JSON.stringify(themeData.custom)
    } else if (themeData.preset) {
      themePreset = themeData.preset as string
    }
  }

  const firstImageCid = source === 'greengale' && record
    ? extractFirstImageCid(record)
    : null

  const contentPreview = generateContentPreview(content, 300)

  const slug = generateSlug(title)

  return {
    uri,
    did,
    rkey,
    title,
    subtitle,
    visibility,
    content,
    hasLatex,
    createdAt,
    themePreset,
    firstImageCid,
    source,
    slug,
    contentPreview,
  }
}

/**
 * Extract publication metadata from a record for indexing
 */
export function extractPublicationData(
  record: Record<string, unknown> | undefined,
  collection: string
) {
  const isSiteStandard = collection === 'site.standard.publication'

  const name = (record?.name as string) || null
  const description = (record?.description as string) || null
  const url = (record?.url as string) || null

  let themePreset: string | null = null
  const themeSource = isSiteStandard ? record?.basicTheme : record?.theme
  if (themeSource) {
    const themeData = themeSource as Record<string, unknown>
    if (isSiteStandard) {
      const rgbToHex = (rgb: unknown): string | undefined => {
        if (!rgb || typeof rgb !== 'object') return undefined
        const { r, g, b } = rgb as { r?: number; g?: number; b?: number }
        if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return undefined
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      }
      themePreset = JSON.stringify({
        background: rgbToHex(themeData.background),
        text: rgbToHex(themeData.foreground),
        accent: rgbToHex(themeData.accent),
      })
    } else if (themeData.custom) {
      themePreset = JSON.stringify(themeData.custom)
    } else if (themeData.preset) {
      themePreset = themeData.preset as string
    }
  }

  return { name, description, url, themePreset }
}

// Author data fetched from Bluesky API (separated from DB operations for atomic batching)
export interface AuthorData {
  did: string
  handle: string
  displayName: string | null
  description: string | null
  avatar: string | null
  banner: string | null
  pdsEndpoint: string | null
  isAiAgent: boolean
}

/**
 * Fetch author profile data from Bluesky API (network calls only, no DB operations)
 */
export async function fetchAuthorData(did: string): Promise<AuthorData | null> {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    )

    if (!response.ok) return null

    const profile = await response.json() as {
      did: string
      handle: string
      displayName?: string
      description?: string
      avatar?: string
      banner?: string
    }

    // Fetch PDS endpoint and AI agent label in parallel
    const [pdsEndpoint, isAiAgent] = await Promise.all([
      // PDS endpoint from DID document (needed for OG image thumbnails)
      (async (): Promise<string | null> => {
        try {
          const didDocUrl = resolveDidDocUrl(did)
          const didDocResponse = await fetch(didDocUrl)
          if (didDocResponse.ok) {
            const didDoc = await didDocResponse.json() as {
              service?: Array<{ id: string; type: string; serviceEndpoint: string }>
            }
            const pdsService = didDoc.service?.find(
              s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
            )
            return pdsService?.serviceEndpoint || null
          }
          return null
        } catch {
          return null
        }
      })(),
      // AI agent label from Hailey's Labeler
      (async (): Promise<boolean> => {
        try {
          const labelerDid = 'did:plc:saslbwamakedc4h6c5bmshvz'
          const labelResponse = await fetch(
            `https://public.api.bsky.app/xrpc/com.atproto.label.queryLabels?uriPatterns=${encodeURIComponent(did)}&sources=${encodeURIComponent(labelerDid)}`
          )
          if (!labelResponse.ok) return false
          const labelData = await labelResponse.json() as {
            labels?: Array<{ val: string; neg?: boolean }>
          }
          return (labelData.labels || []).some(l => l.val === 'ai-agent' && !l.neg)
        } catch {
          return false
        }
      })(),
    ])

    return {
      did: profile.did,
      handle: profile.handle,
      displayName: profile.displayName || null,
      description: profile.description || null,
      avatar: profile.avatar || null,
      banner: profile.banner || null,
      pdsEndpoint,
      isAiAgent,
    }
  } catch {
    return null
  }
}
