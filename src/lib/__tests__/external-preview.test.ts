import { describe, it, expect } from 'vitest'

/**
 * Tests for pure helper functions extracted from ExternalPreviewPanel.
 *
 * These functions are module-scoped in ExternalPreviewPanel.tsx.
 * Since they're not exported, we replicate them here for testing.
 * If the implementations drift, update these copies to match.
 */

// --- Replicated helpers (module-scoped in ExternalPreviewPanel.tsx) ---

function formatDate(dateString: string | null) {
  if (!dateString) return null
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return null
  }
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

interface PostLike {
  contentPreview: string | null
  subtitle: string | null
}

function processContent(p: PostLike) {
  const preview = p.contentPreview
  const sub = p.subtitle
  let content: string | null = null

  if (preview) {
    const trimmed = preview.trim()
    const subTrimmed = sub?.trim()

    if (subTrimmed && trimmed.startsWith(subTrimmed)) {
      const remainder = trimmed.slice(subTrimmed.length).trim()
      if (remainder.length > 20) content = remainder
    } else {
      content = trimmed
    }
  }

  const isTruncated = !!(content && preview && preview.trim().length >= 2900)

  return { displayContent: content, contentIsTruncated: isTruncated }
}

// --- Tests ---

describe('ExternalPreviewPanel helpers', () => {
  describe('formatDate', () => {
    it('formats a valid ISO date string', () => {
      const result = formatDate('2024-06-15T12:00:00Z')
      // Locale-dependent, but should contain year and day
      expect(result).toContain('2024')
      expect(result).toContain('15')
    })

    it('returns null for null input', () => {
      expect(formatDate(null)).toBeNull()
    })

    it('returns a string for a date-only input', () => {
      const result = formatDate('2023-06-15')
      expect(result).toBeTruthy()
      // Mid-month date avoids timezone boundary issues
      expect(result).toContain('2023')
    })

    it('handles old dates', () => {
      const result = formatDate('2000-06-15T12:00:00Z')
      expect(result).toContain('2000')
    })
  })

  describe('getHostname', () => {
    it('extracts hostname from a standard URL', () => {
      expect(getHostname('https://example.com/path')).toBe('example.com')
    })

    it('extracts hostname from URL with subdomain', () => {
      expect(getHostname('https://blog.example.com/post/123')).toBe('blog.example.com')
    })

    it('includes port when present', () => {
      expect(getHostname('http://localhost:3000/api')).toBe('localhost')
    })

    it('returns original string for invalid URL', () => {
      expect(getHostname('not-a-url')).toBe('not-a-url')
    })

    it('returns original string for empty string', () => {
      expect(getHostname('')).toBe('')
    })

    it('handles URL with query params and fragment', () => {
      expect(getHostname('https://site.org/page?q=1#section')).toBe('site.org')
    })
  })

  describe('processContent', () => {
    it('returns null content when contentPreview is null', () => {
      const result = processContent({ contentPreview: null, subtitle: null })
      expect(result.displayContent).toBeNull()
      expect(result.contentIsTruncated).toBe(false)
    })

    it('returns trimmed preview as content when no subtitle', () => {
      const result = processContent({
        contentPreview: '  Hello world  ',
        subtitle: null,
      })
      expect(result.displayContent).toBe('Hello world')
    })

    it('returns preview when subtitle does not match start of preview', () => {
      const result = processContent({
        contentPreview: 'Content that does not start with subtitle',
        subtitle: 'Different subtitle',
      })
      expect(result.displayContent).toBe('Content that does not start with subtitle')
    })

    it('deduplicates subtitle from preview start', () => {
      const result = processContent({
        contentPreview: 'My Subtitle Here is the rest of the content that follows after it.',
        subtitle: 'My Subtitle',
      })
      expect(result.displayContent).toBe('Here is the rest of the content that follows after it.')
    })

    it('returns null when remainder after subtitle dedup is too short', () => {
      const result = processContent({
        contentPreview: 'My Subtitle Short rest',
        subtitle: 'My Subtitle',
      })
      // "Short rest" is 10 chars, under the 20-char threshold
      expect(result.displayContent).toBeNull()
    })

    it('returns null when preview exactly matches subtitle', () => {
      const result = processContent({
        contentPreview: 'Exact match subtitle',
        subtitle: 'Exact match subtitle',
      })
      // Remainder is empty after removing subtitle
      expect(result.displayContent).toBeNull()
    })

    it('marks content as truncated when preview is >= 2900 chars', () => {
      const longContent = 'A'.repeat(2900)
      const result = processContent({
        contentPreview: longContent,
        subtitle: null,
      })
      expect(result.displayContent).toBe(longContent)
      expect(result.contentIsTruncated).toBe(true)
    })

    it('marks content as not truncated when preview is < 2900 chars', () => {
      const shortContent = 'A'.repeat(2899)
      const result = processContent({
        contentPreview: shortContent,
        subtitle: null,
      })
      expect(result.displayContent).toBe(shortContent)
      expect(result.contentIsTruncated).toBe(false)
    })

    it('handles empty string preview', () => {
      const result = processContent({
        contentPreview: '',
        subtitle: null,
      })
      expect(result.displayContent).toBeNull()
    })

    it('handles whitespace-only preview', () => {
      const result = processContent({
        contentPreview: '   \n\n  ',
        subtitle: null,
      })
      // After trimming, becomes empty string (preview is truthy, but trimmed is empty)
      expect(result.displayContent).toBe('')
    })

    it('truncation check uses raw preview length, not deduped content', () => {
      // Subtitle takes up most of the preview, but the preview itself is long
      const subtitle = 'S'.repeat(2800)
      const rest = 'R'.repeat(200)
      const result = processContent({
        contentPreview: subtitle + rest,
        subtitle,
      })
      // Raw preview is 3000 chars (>= 2900), so truncated
      expect(result.displayContent).toBe(rest)
      expect(result.contentIsTruncated).toBe(true)
    })
  })
})
