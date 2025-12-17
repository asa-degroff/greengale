/**
 * Image Labels Utility Module
 *
 * Utilities for extracting CIDs from blob URLs and working with
 * content labels for image moderation.
 */

import type { ContentLabelValue, SelfLabels } from './image-upload'
import type { BlogEntry } from './atproto'

/**
 * Extract CID from an AT Protocol blob URL
 *
 * Blob URLs follow the pattern:
 * https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=...&cid=...
 */
export function extractCidFromBlobUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const cid = urlObj.searchParams.get('cid')
    return cid || null
  } catch {
    // Try regex fallback for relative URLs or malformed URLs
    const match = url.match(/[?&]cid=([^&]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }
}

/**
 * Extract CID from a blobref object
 * Handles multiple possible structures returned by AT Protocol
 */
function extractCidFromBlobref(blobref: unknown): string | null {
  // Handle null/undefined
  if (!blobref) return null

  // Structure 0: Direct CID string
  if (typeof blobref === 'string') {
    return blobref
  }

  if (typeof blobref !== 'object') return null

  const ref = blobref as Record<string, unknown>

  // Structure 1: { ref: _CID } (AT Protocol SDK BlobRef class)
  // The ref property is a CID class instance with a toString() method
  if (ref.ref && typeof ref.ref === 'object') {
    const innerRef = ref.ref as Record<string, unknown>

    // Try toString() method (CID class instances)
    if (typeof innerRef.toString === 'function') {
      const cidStr = innerRef.toString()
      if (typeof cidStr === 'string' && cidStr.startsWith('baf')) {
        return cidStr
      }
    }

    // Fallback: { $link: cid } (plain object format)
    if (typeof innerRef.$link === 'string') {
      return innerRef.$link
    }
  }

  // Structure 2: { $link: cid } (simplified CID reference)
  if (typeof ref.$link === 'string') {
    return ref.$link
  }

  // Structure 3: { cid: string } (alternative format)
  if (typeof ref.cid === 'string') {
    return ref.cid
  }

  return null
}

/**
 * Build a map of CID -> labels from a blog entry's blobs array
 */
export function getBlobLabelsMap(
  blobs: BlogEntry['blobs']
): Map<string, SelfLabels> {
  const map = new Map<string, SelfLabels>()
  if (!blobs) return map

  for (const blob of blobs) {
    if (!blob.labels?.values?.length) continue

    // Extract CID from blobref (handles multiple formats)
    const cid = extractCidFromBlobref(blob.blobref)
    if (cid) {
      map.set(cid, blob.labels)
    }
  }

  return map
}

/**
 * Build a map of CID -> alt text from a blog entry's blobs array
 */
export function getBlobAltMap(blobs: BlogEntry['blobs']): Map<string, string> {
  const map = new Map<string, string>()
  if (!blobs) return map

  for (const blob of blobs) {
    if (!blob.alt) continue

    // Extract CID from blobref (handles multiple formats)
    const cid = extractCidFromBlobref(blob.blobref)
    if (cid) {
      map.set(cid, blob.alt)
    }
  }

  return map
}

/**
 * Get user-friendly warning text for content labels
 */
export function getLabelWarningText(labels: ContentLabelValue[]): string {
  if (labels.includes('porn')) {
    return 'Adult Content (Explicit)'
  }
  if (labels.includes('sexual')) {
    return 'Sexually Suggestive Content'
  }
  if (labels.includes('graphic-media')) {
    return 'Graphic/Disturbing Media'
  }
  if (labels.includes('nudity')) {
    return 'Nudity'
  }
  return 'Sensitive Content'
}

/**
 * Get label values from a SelfLabels object
 */
export function getLabelValues(labels: SelfLabels | undefined): ContentLabelValue[] {
  if (!labels?.values) return []
  return labels.values.map((l) => l.val)
}

/**
 * Check if any labels require age verification (18+)
 */
export function requiresAgeVerification(labels: ContentLabelValue[]): boolean {
  return labels.includes('porn') || labels.includes('sexual')
}

/**
 * Content label options for the editor UI
 */
export const CONTENT_LABEL_OPTIONS: Array<{
  value: ContentLabelValue
  label: string
  description: string
}> = [
  {
    value: 'nudity',
    label: 'Nudity',
    description: 'Non-sexual nudity (artistic, educational)',
  },
  {
    value: 'sexual',
    label: 'Suggestive',
    description: 'Sexually suggestive content',
  },
  {
    value: 'porn',
    label: 'Adult',
    description: 'Explicit sexual content (18+)',
  },
  {
    value: 'graphic-media',
    label: 'Graphic',
    description: 'Violence, gore, or disturbing imagery',
  },
]
