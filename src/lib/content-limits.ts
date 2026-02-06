/** Maximum content size for GreenGale documents in UTF-8 bytes (1 MB) */
export const GREENGALE_CONTENT_MAX_BYTES = 1_000_000

/** Maximum content size for WhiteWind documents in UTF-8 bytes */
export const WHITEWIND_CONTENT_MAX_BYTES = 100_000

/**
 * Safe limit for the JSON body of a putRecord request to the PDS.
 * The Bluesky PDS has a jsonLimit of 150KB (153,600 bytes).
 * We use 130KB to leave margin for JSON encoding overhead and record metadata.
 */
export const PDS_JSON_SAFE_LIMIT = 130_000

/**
 * Maximum characters for the inline content preview when content is stored as a blob.
 * This truncated preview is stored in the record's `content` field for backward compatibility.
 */
export const CONTENT_PREVIEW_CHARS = 10_000

const encoder = new TextEncoder()

/** Returns the UTF-8 byte length of a string */
export function getUtf8ByteLength(str: string): number {
  return encoder.encode(str).byteLength
}

/** Formats a byte count for display (e.g. "1,234" or "1,000,000") */
export function formatByteCount(bytes: number): string {
  return bytes.toLocaleString()
}
