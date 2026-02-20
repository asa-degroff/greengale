import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { slugify, toBasicTheme, toGreenGaleTheme, hexToRgb, computeAccentForeground, extractPlaintext, resolveExternalUrl, deduplicateBlogEntries, hasOldBasicThemeFormat, convertOldBasicTheme, parseVoiceTheme, voiceThemeToRecord, generateTid, resolveIdentity, getPdsEndpoint, clearIdentityCache, withRetry, togglePinnedPost } from '../atproto'
import type { BlogEntry, SiteStandardColor, SiteStandardDocument } from '../atproto'
import type { Theme } from '../themes'

// Mock fetch globally for resolveExternalUrl tests
const mockFetch = vi.fn()

// Helper to create a mock Response
function mockResponse(data: unknown, options: { ok?: boolean } = {}) {
  const { ok = true } = options
  return {
    ok,
    json: () => Promise.resolve(data),
  } as Response
}

describe('AT Protocol Utilities', () => {
  describe('slugify', () => {
    it('converts text to lowercase', () => {
      expect(slugify('Hello World')).toBe('hello-world')
    })

    it('replaces spaces and special chars with hyphens', () => {
      expect(slugify('Hello, World!')).toBe('hello-world')
    })

    it('replaces multiple non-alphanumeric chars with single hyphen', () => {
      expect(slugify('Hello   World')).toBe('hello-world')
      expect(slugify('Hello...World')).toBe('hello-world')
    })

    it('trims leading and trailing hyphens', () => {
      expect(slugify('  Hello World  ')).toBe('hello-world')
      expect(slugify('...Hello...')).toBe('hello')
    })

    it('handles empty string', () => {
      expect(slugify('')).toBe('')
    })

    it('handles string of only special chars', () => {
      expect(slugify('!!!')).toBe('')
    })

    it('preserves numbers', () => {
      expect(slugify('Chapter 1: Introduction')).toBe('chapter-1-introduction')
    })

    it('truncates to 100 characters', () => {
      const longTitle = 'a'.repeat(150)
      expect(slugify(longTitle).length).toBe(100)
    })

    it('truncates correctly without breaking at hyphen', () => {
      const title = 'word '.repeat(30) // Creates "word-word-word-..."
      const slug = slugify(title)
      expect(slug.length).toBeLessThanOrEqual(100)
    })

    it('handles unicode characters', () => {
      expect(slugify('Hello 世界')).toBe('hello')
    })

    it('handles emoji', () => {
      expect(slugify('Hello 🌍 World')).toBe('hello-world')
    })

    it('handles mixed case and punctuation', () => {
      expect(slugify('API v2.0: The New Version!')).toBe('api-v2-0-the-new-version')
    })

    it('handles hyphens in input', () => {
      expect(slugify('well-known-path')).toBe('well-known-path')
    })

    it('collapses multiple hyphens from input', () => {
      expect(slugify('well---known---path')).toBe('well-known-path')
    })
  })

  describe('hexToRgb', () => {
    it('returns undefined for undefined input', () => {
      expect(hexToRgb(undefined)).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      expect(hexToRgb('')).toBeUndefined()
    })

    const $type = 'site.standard.theme.color#rgb' as const

    it('parses 6-character hex with hash', () => {
      expect(hexToRgb('#ff0000')).toEqual({ $type, r: 255, g: 0, b: 0 })
      expect(hexToRgb('#00ff00')).toEqual({ $type, r: 0, g: 255, b: 0 })
      expect(hexToRgb('#0000ff')).toEqual({ $type, r: 0, g: 0, b: 255 })
    })

    it('parses 6-character hex without hash', () => {
      expect(hexToRgb('ff0000')).toEqual({ $type, r: 255, g: 0, b: 0 })
    })

    it('parses 3-character hex with hash', () => {
      expect(hexToRgb('#f00')).toEqual({ $type, r: 255, g: 0, b: 0 })
      expect(hexToRgb('#0f0')).toEqual({ $type, r: 0, g: 255, b: 0 })
      expect(hexToRgb('#00f')).toEqual({ $type, r: 0, g: 0, b: 255 })
    })

    it('parses 3-character hex without hash', () => {
      expect(hexToRgb('f00')).toEqual({ $type, r: 255, g: 0, b: 0 })
    })

    it('parses mixed case hex', () => {
      expect(hexToRgb('#AbCdEf')).toEqual({ $type, r: 171, g: 205, b: 239 })
    })

    it('returns undefined for invalid hex length', () => {
      expect(hexToRgb('#12345')).toBeUndefined()
      expect(hexToRgb('#1234567')).toBeUndefined()
    })

    it('returns undefined for invalid hex characters', () => {
      expect(hexToRgb('#gggggg')).toBeUndefined()
      expect(hexToRgb('#xyz')).toBeUndefined()
    })
  })

  describe('computeAccentForeground', () => {
    const $type = 'site.standard.theme.color#rgb' as const

    it('returns white for dark colors (fallback without theme colors)', () => {
      // Dark blue
      expect(computeAccentForeground({ r: 0, g: 0, b: 128 })).toEqual({ $type, r: 255, g: 255, b: 255 })
      // Black
      expect(computeAccentForeground({ r: 0, g: 0, b: 0 })).toEqual({ $type, r: 255, g: 255, b: 255 })
      // Dark purple
      expect(computeAccentForeground({ r: 50, g: 0, b: 100 })).toEqual({ $type, r: 255, g: 255, b: 255 })
    })

    it('returns black for light colors (fallback without theme colors)', () => {
      // White
      expect(computeAccentForeground({ r: 255, g: 255, b: 255 })).toEqual({ $type, r: 0, g: 0, b: 0 })
      // Yellow
      expect(computeAccentForeground({ r: 255, g: 255, b: 0 })).toEqual({ $type, r: 0, g: 0, b: 0 })
      // Light blue
      expect(computeAccentForeground({ r: 100, g: 200, b: 255 })).toEqual({ $type, r: 0, g: 0, b: 0 })
    })

    it('handles mid-range colors based on luminance (fallback)', () => {
      // Pure green has high luminance -> black text
      expect(computeAccentForeground({ r: 0, g: 255, b: 0 })).toEqual({ $type, r: 0, g: 0, b: 0 })
      // Pure red has luminance ~0.21 which is above 0.179 threshold -> black text
      expect(computeAccentForeground({ r: 255, g: 0, b: 0 })).toEqual({ $type, r: 0, g: 0, b: 0 })
      // Dark red has lower luminance -> white text
      expect(computeAccentForeground({ r: 128, g: 0, b: 0 })).toEqual({ $type, r: 255, g: 255, b: 255 })
    })

    it('uses foreground color when it has better contrast', () => {
      // Dark accent with dark foreground and light background
      // Dark foreground provides worse contrast, light background wins
      const darkAccent = { $type, r: 0, g: 0, b: 128 }
      const darkFg = { $type, r: 30, g: 30, b: 30 }
      const lightBg = { $type, r: 255, g: 255, b: 255 }
      expect(computeAccentForeground(darkAccent, darkFg, lightBg)).toEqual(lightBg)
    })

    it('uses background color when it has better contrast', () => {
      // Light accent (yellow) with light foreground and dark background
      // Dark background provides better contrast
      const lightAccent = { $type, r: 255, g: 255, b: 0 }
      const lightFg = { $type, r: 230, g: 230, b: 230 }
      const darkBg = { $type, r: 20, g: 20, b: 20 }
      expect(computeAccentForeground(lightAccent, lightFg, darkBg)).toEqual(darkBg)
    })

    it('falls back to black/white when theme colors lack contrast', () => {
      // Mid-range accent with similar mid-range foreground and background
      const midAccent = { $type, r: 128, g: 128, b: 128 }
      const midFg = { $type, r: 120, g: 120, b: 120 }
      const midBg = { $type, r: 140, g: 140, b: 140 }
      // Neither provides 3:1 contrast, falls back to black (accent is light enough)
      expect(computeAccentForeground(midAccent, midFg, midBg)).toEqual({ $type, r: 0, g: 0, b: 0 })
    })
  })

  describe('toBasicTheme', () => {
    const $type = 'site.standard.theme.color#rgb' as const
    const themeType = 'site.standard.theme.basic' as const

    it('returns undefined for undefined theme', () => {
      expect(toBasicTheme(undefined)).toBeUndefined()
    })

    it('returns default colors for empty theme object', () => {
      // Empty theme falls through to default preset
      const result = toBasicTheme({})
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 26, g: 26, b: 26 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 37, g: 99, b: 235 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })
    })

    it('converts custom theme colors to RGB', () => {
      const theme: Theme = {
        custom: {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        },
      }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 0, g: 0, b: 0 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 0, g: 102, b: 204 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })
    })

    it('handles custom theme with partial colors', () => {
      const theme: Theme = {
        custom: {
          background: '#ffffff',
        },
      }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: undefined,
        background: { $type, r: 255, g: 255, b: 255 },
        accent: undefined,
        accentForeground: undefined,
      })
    })

    it('converts default preset', () => {
      const theme: Theme = { preset: 'default' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 26, g: 26, b: 26 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 37, g: 99, b: 235 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })
    })

    it('converts github-light preset', () => {
      const theme: Theme = { preset: 'github-light' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 36, g: 41, b: 47 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 9, g: 105, b: 218 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })
    })

    it('converts github-dark preset', () => {
      const theme: Theme = { preset: 'github-dark' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 230, g: 237, b: 243 },
        background: { $type, r: 13, g: 17, b: 23 },
        accent: { $type, r: 88, g: 166, b: 255 },
        // Uses dark background for contrast with light accent
        accentForeground: { $type, r: 13, g: 17, b: 23 },
      })
    })

    it('converts dracula preset', () => {
      const theme: Theme = { preset: 'dracula' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 248, g: 248, b: 242 },
        background: { $type, r: 40, g: 42, b: 54 },
        accent: { $type, r: 189, g: 147, b: 249 },
        // Uses dark background for contrast with light purple accent
        accentForeground: { $type, r: 40, g: 42, b: 54 },
      })
    })

    it('converts nord preset', () => {
      const theme: Theme = { preset: 'nord' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 236, g: 239, b: 244 },
        background: { $type, r: 46, g: 52, b: 64 },
        accent: { $type, r: 136, g: 192, b: 208 },
        // Uses dark background for contrast with light accent
        accentForeground: { $type, r: 46, g: 52, b: 64 },
      })
    })

    it('converts solarized-light preset', () => {
      const theme: Theme = { preset: 'solarized-light' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 101, g: 123, b: 131 },
        background: { $type, r: 253, g: 246, b: 227 },
        accent: { $type, r: 38, g: 139, b: 210 },
        // Uses light background for contrast with blue accent
        accentForeground: { $type, r: 253, g: 246, b: 227 },
      })
    })

    it('converts solarized-dark preset', () => {
      const theme: Theme = { preset: 'solarized-dark' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 131, g: 148, b: 150 },
        background: { $type, r: 0, g: 43, b: 54 },
        accent: { $type, r: 38, g: 139, b: 210 },
        // Uses dark background for contrast with blue accent
        accentForeground: { $type, r: 0, g: 43, b: 54 },
      })
    })

    it('converts monokai preset', () => {
      const theme: Theme = { preset: 'monokai' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 248, g: 248, b: 242 },
        background: { $type, r: 39, g: 40, b: 34 },
        accent: { $type, r: 166, g: 226, b: 46 },
        // Uses dark background for contrast with bright green accent
        accentForeground: { $type, r: 39, g: 40, b: 34 },
      })
    })

    it('falls back to default for unknown preset', () => {
      const theme: Theme = { preset: 'unknown' as 'default' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 26, g: 26, b: 26 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 37, g: 99, b: 235 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })
    })

    it('prioritizes custom colors over preset', () => {
      const theme: Theme = {
        preset: 'dracula',
        custom: {
          background: '#000000',
          text: '#ffffff',
          accent: '#ff0000',
        },
      }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 255, g: 255, b: 255 },
        background: { $type, r: 0, g: 0, b: 0 },
        accent: { $type, r: 255, g: 0, b: 0 },
        // Pure red #ff0000 has luminance ~0.21 > 0.179 threshold
        accentForeground: { $type, r: 0, g: 0, b: 0 },
      })
    })

    it('handles custom preset (uses default colors)', () => {
      const theme: Theme = { preset: 'custom' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 26, g: 26, b: 26 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 37, g: 99, b: 235 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })
    })

    it('computes accentForeground based on accent luminance', () => {
      // Light accent (yellow) -> black foreground
      const lightAccent: Theme = {
        custom: { accent: '#ffff00' },
      }
      expect(toBasicTheme(lightAccent)?.accentForeground).toEqual({ $type, r: 0, g: 0, b: 0 })

      // Dark accent (dark blue) -> white foreground
      const darkAccent: Theme = {
        custom: { accent: '#000080' },
      }
      expect(toBasicTheme(darkAccent)?.accentForeground).toEqual({ $type, r: 255, g: 255, b: 255 })
    })
  })

  describe('toGreenGaleTheme', () => {
    const ggThemeType = 'app.greengale.theme' as const

    it('returns undefined for undefined theme', () => {
      expect(toGreenGaleTheme(undefined)).toBeUndefined()
    })

    it('returns $type with undefined preset/custom for empty theme', () => {
      const result = toGreenGaleTheme({})
      expect(result).toEqual({
        $type: ggThemeType,
        preset: undefined,
        custom: undefined,
      })
    })

    it('passes through preset name', () => {
      const theme: Theme = { preset: 'solarized-dark' }
      const result = toGreenGaleTheme(theme)
      expect(result).toEqual({
        $type: ggThemeType,
        preset: 'solarized-dark',
        custom: undefined,
      })
    })

    it('passes through custom colors as hex strings', () => {
      const theme: Theme = {
        custom: {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        },
      }
      const result = toGreenGaleTheme(theme)
      expect(result).toEqual({
        $type: ggThemeType,
        preset: undefined,
        custom: {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        },
      })
    })

    it('passes through both preset and custom when both provided', () => {
      const theme: Theme = {
        preset: 'dracula',
        custom: {
          background: '#000000',
          text: '#ffffff',
          accent: '#ff0000',
        },
      }
      const result = toGreenGaleTheme(theme)
      expect(result).toEqual({
        $type: ggThemeType,
        preset: 'dracula',
        custom: {
          background: '#000000',
          text: '#ffffff',
          accent: '#ff0000',
        },
      })
    })
  })

  describe('extractPlaintext', () => {
    it('removes code blocks', () => {
      const markdown = `Text before

\`\`\`javascript
const x = 1;
console.log(x);
\`\`\`

Text after`
      const result = extractPlaintext(markdown)
      // Whitespace is normalized to single spaces
      expect(result).toBe('Text before Text after')
      expect(result).not.toContain('const')
      expect(result).not.toContain('console')
    })

    it('removes inline code', () => {
      const markdown = 'Use the `console.log()` function'
      const result = extractPlaintext(markdown)
      expect(result).toBe('Use the  function')
    })

    it('removes LaTeX blocks', () => {
      const markdown = `Equation:

$$
E = mc^2
$$

End.`
      const result = extractPlaintext(markdown)
      // Whitespace is normalized to single spaces
      expect(result).toBe('Equation: End.')
      expect(result).not.toContain('E = mc')
    })

    it('removes inline LaTeX', () => {
      const markdown = 'The formula $x^2 + y^2 = z^2$ is famous.'
      const result = extractPlaintext(markdown)
      expect(result).toBe('The formula  is famous.')
    })

    it('removes images', () => {
      const markdown = 'Look at this ![beautiful image](https://example.com/image.png) here.'
      const result = extractPlaintext(markdown)
      expect(result).toBe('Look at this  here.')
    })

    it('extracts link text but removes URLs', () => {
      const markdown = 'Check out [my website](https://example.com) for more.'
      const result = extractPlaintext(markdown)
      expect(result).toBe('Check out my website for more.')
    })

    it('removes heading markers', () => {
      const markdown = `# Title
## Subtitle
### Section`
      const result = extractPlaintext(markdown)
      expect(result).toBe('Title Subtitle Section')
    })

    it('removes bold/italic markers', () => {
      const markdown = 'This is **bold** and *italic* and ***both***.'
      const result = extractPlaintext(markdown)
      expect(result).toBe('This is bold and italic and both.')
    })

    it('removes strikethrough markers', () => {
      const markdown = 'This is ~~strikethrough~~ text.'
      const result = extractPlaintext(markdown)
      expect(result).toBe('This is strikethrough text.')
    })

    it('normalizes whitespace', () => {
      const markdown = `Line one.

Line two.


Line three.`
      const result = extractPlaintext(markdown)
      expect(result).toBe('Line one. Line two. Line three.')
    })

    it('handles empty string', () => {
      expect(extractPlaintext('')).toBe('')
    })

    it('handles plain text without formatting', () => {
      const markdown = 'Just plain text here.'
      expect(extractPlaintext(markdown)).toBe('Just plain text here.')
    })

    it('truncates to 100000 characters', () => {
      const longContent = 'a '.repeat(60000) // 120000 chars
      const result = extractPlaintext(longContent)
      expect(result.length).toBeLessThanOrEqual(100000)
    })

    it('handles complex markdown document', () => {
      const markdown = `# Welcome

This is a **bold** introduction with a [link](https://example.com).

## Code Example

\`\`\`python
print("Hello")
\`\`\`

The formula $E = mc^2$ is shown above.

![Image](image.png)

### Conclusion

Thanks for reading!`
      const result = extractPlaintext(markdown)
      expect(result).toContain('Welcome')
      expect(result).toContain('bold introduction')
      expect(result).toContain('link')
      expect(result).toContain('Conclusion')
      expect(result).toContain('Thanks for reading')
      expect(result).not.toContain('print')
      expect(result).not.toContain('E = mc')
      expect(result).not.toContain('Image')
    })

    it('removes backticks from inline code', () => {
      const markdown = 'The `backticks` should be gone.'
      const result = extractPlaintext(markdown)
      expect(result).not.toContain('`')
    })

    it('handles multiple code blocks', () => {
      const markdown = `First:
\`\`\`
code1
\`\`\`

Second:
\`\`\`
code2
\`\`\`

Third.`
      const result = extractPlaintext(markdown)
      expect(result).toContain('First')
      expect(result).toContain('Second')
      expect(result).toContain('Third')
      expect(result).not.toContain('code1')
      expect(result).not.toContain('code2')
    })

    it('handles nested markdown syntax', () => {
      const markdown = 'Check **[bold link](url)** here.'
      const result = extractPlaintext(markdown)
      expect(result).toBe('Check bold link here.')
    })
  })

  describe('resolveExternalUrl', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch)
      mockFetch.mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns null for invalid AT-URI format', async () => {
      const result = await resolveExternalUrl('invalid-uri', '/posts/test')
      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns null for AT-URI missing parts', async () => {
      const result = await resolveExternalUrl('at://did:plc:abc', '/posts/test')
      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns null when DID resolution fails', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false }))

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/test'
      )
      expect(result).toBeNull()
      expect(mockFetch).toHaveBeenCalledWith('https://plc.directory/did:plc:abc123')
    })

    it('returns null when DID document has no PDS service', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#other', type: 'OtherService', serviceEndpoint: 'https://other.com' },
          ],
        })
      )

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/test'
      )
      expect(result).toBeNull()
    })

    it('returns null when publication record fetch fails', async () => {
      // DID resolution succeeds
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      // Publication fetch fails
      mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false }))

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/test'
      )
      expect(result).toBeNull()
    })

    it('returns null when publication has no URL', async () => {
      // DID resolution succeeds
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      // Publication has no URL
      mockFetch.mockResolvedValueOnce(mockResponse({ value: {} }))

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/test'
      )
      expect(result).toBeNull()
    })

    it('constructs full URL from publication URL and path', async () => {
      // DID resolution
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      // Publication record
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          value: { url: 'https://blog.example.com' },
        })
      )

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/my-post'
      )
      expect(result).toBe('https://blog.example.com/posts/my-post')
    })

    it('handles path without leading slash', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          value: { url: 'https://blog.example.com' },
        })
      )

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        'posts/my-post'
      )
      expect(result).toBe('https://blog.example.com/posts/my-post')
    })

    it('removes trailing slash from publication URL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          value: { url: 'https://blog.example.com/' },
        })
      )

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/my-post'
      )
      expect(result).toBe('https://blog.example.com/posts/my-post')
    })

    it('handles did:web identifiers', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          value: { url: 'https://myblog.com' },
        })
      )

      const result = await resolveExternalUrl(
        'at://did:web:example.com/site.standard.publication/main',
        '/article/hello'
      )
      expect(result).toBe('https://myblog.com/article/hello')
      expect(mockFetch).toHaveBeenCalledWith('https://plc.directory/did:web:example.com')
    })

    it('finds PDS service by type when id differs', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          value: { url: 'https://blog.example.com' },
        })
      )

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/test'
      )
      expect(result).toBe('https://blog.example.com/posts/test')
    })

    it('returns null when fetch throws an error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/self',
        '/posts/test'
      )
      expect(result).toBeNull()
    })

    it('constructs correct record URL for publication fetch', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' },
          ],
        })
      )
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          value: { url: 'https://blog.example.com' },
        })
      )

      await resolveExternalUrl(
        'at://did:plc:abc123/site.standard.publication/my-pub',
        '/posts/test'
      )

      // Verify the record fetch URL
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://pds.example.com/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc123&collection=site.standard.publication&rkey=my-pub'
      )
    })
  })

  describe('deduplicateBlogEntries', () => {
    // Helper to create a minimal BlogEntry for testing
    function createEntry(overrides: Partial<BlogEntry>): BlogEntry {
      return {
        uri: 'at://did:plc:test/collection/rkey',
        cid: 'cid123',
        authorDid: 'did:plc:test',
        rkey: 'test-rkey',
        source: 'greengale',
        content: 'Test content',
        ...overrides,
      }
    }

    it('returns empty array for empty input', () => {
      expect(deduplicateBlogEntries([])).toEqual([])
    })

    it('returns single entry unchanged', () => {
      const entry = createEntry({ rkey: 'post-1' })
      const result = deduplicateBlogEntries([entry])
      expect(result).toEqual([entry])
    })

    it('keeps all entries with different rkeys', () => {
      const entries = [
        createEntry({ rkey: 'post-1', source: 'greengale' }),
        createEntry({ rkey: 'post-2', source: 'whitewind' }),
        createEntry({ rkey: 'post-3', source: 'network' }),
      ]
      const result = deduplicateBlogEntries(entries)
      expect(result).toHaveLength(3)
    })

    it('keeps GreenGale version when duplicate with network post', () => {
      const greengaleEntry = createEntry({
        rkey: 'dual-post',
        source: 'greengale',
        uri: 'at://did:plc:test/app.greengale.document/dual-post',
        title: 'GreenGale Title',
      })
      const networkEntry = createEntry({
        rkey: 'dual-post',
        source: 'network',
        uri: 'at://did:plc:test/site.standard.document/dual-post',
        title: 'Network Title',
      })

      // GreenGale first
      let result = deduplicateBlogEntries([greengaleEntry, networkEntry])
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('greengale')
      expect(result[0].title).toBe('GreenGale Title')

      // Network first (GreenGale should still win)
      result = deduplicateBlogEntries([networkEntry, greengaleEntry])
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('greengale')
      expect(result[0].title).toBe('GreenGale Title')
    })

    it('keeps WhiteWind version when duplicate with network post', () => {
      const whitewindEntry = createEntry({
        rkey: 'dual-post',
        source: 'whitewind',
        title: 'WhiteWind Title',
      })
      const networkEntry = createEntry({
        rkey: 'dual-post',
        source: 'network',
        title: 'Network Title',
      })

      const result = deduplicateBlogEntries([networkEntry, whitewindEntry])
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('whitewind')
      expect(result[0].title).toBe('WhiteWind Title')
    })

    it('keeps first entry when both are GreenGale', () => {
      const entry1 = createEntry({
        rkey: 'same-rkey',
        source: 'greengale',
        uri: 'at://did:plc:test/app.greengale.document/same-rkey',
        title: 'First',
      })
      const entry2 = createEntry({
        rkey: 'same-rkey',
        source: 'greengale',
        uri: 'at://did:plc:test/app.greengale.blog.entry/same-rkey',
        title: 'Second',
      })

      const result = deduplicateBlogEntries([entry1, entry2])
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('First')
    })

    it('keeps first entry when both are network posts', () => {
      const entry1 = createEntry({
        rkey: 'network-post',
        source: 'network',
        title: 'First Network',
      })
      const entry2 = createEntry({
        rkey: 'network-post',
        source: 'network',
        title: 'Second Network',
      })

      const result = deduplicateBlogEntries([entry1, entry2])
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('First Network')
    })

    it('handles mixed scenario with multiple duplicates', () => {
      const entries = [
        createEntry({ rkey: 'unique-1', source: 'greengale', title: 'Unique 1' }),
        createEntry({ rkey: 'dual-1', source: 'network', title: 'Dual 1 Network' }),
        createEntry({ rkey: 'unique-2', source: 'whitewind', title: 'Unique 2' }),
        createEntry({ rkey: 'dual-1', source: 'greengale', title: 'Dual 1 GreenGale' }),
        createEntry({ rkey: 'dual-2', source: 'network', title: 'Dual 2 Network' }),
        createEntry({ rkey: 'dual-2', source: 'whitewind', title: 'Dual 2 WhiteWind' }),
      ]

      const result = deduplicateBlogEntries(entries)
      expect(result).toHaveLength(4)

      // Find entries by rkey
      const unique1 = result.find((e) => e.rkey === 'unique-1')
      const unique2 = result.find((e) => e.rkey === 'unique-2')
      const dual1 = result.find((e) => e.rkey === 'dual-1')
      const dual2 = result.find((e) => e.rkey === 'dual-2')

      expect(unique1?.title).toBe('Unique 1')
      expect(unique2?.title).toBe('Unique 2')
      expect(dual1?.title).toBe('Dual 1 GreenGale') // GreenGale preferred over network
      expect(dual2?.title).toBe('Dual 2 WhiteWind') // WhiteWind preferred over network
    })

    it('preserves all properties of kept entries', () => {
      const fullEntry = createEntry({
        rkey: 'full-post',
        source: 'greengale',
        title: 'Full Title',
        subtitle: 'Full Subtitle',
        content: 'Full content here',
        createdAt: '2024-01-15T10:00:00Z',
        visibility: 'public',
        externalUrl: undefined,
      })
      const networkEntry = createEntry({
        rkey: 'full-post',
        source: 'network',
        title: 'Network Title',
        externalUrl: 'https://example.com/post',
      })

      const result = deduplicateBlogEntries([networkEntry, fullEntry])
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(fullEntry)
    })
  })

  describe('hasOldBasicThemeFormat', () => {
    const $type = 'site.standard.theme.color#rgb' as const
    const themeType = 'site.standard.theme.basic' as const

    it('returns false for null/undefined', () => {
      expect(hasOldBasicThemeFormat(null)).toBe(false)
      expect(hasOldBasicThemeFormat(undefined)).toBe(false)
    })

    it('returns false for non-objects', () => {
      expect(hasOldBasicThemeFormat('string')).toBe(false)
      expect(hasOldBasicThemeFormat(123)).toBe(false)
      expect(hasOldBasicThemeFormat(true)).toBe(false)
    })

    it('returns true for old property names (hex strings)', () => {
      expect(hasOldBasicThemeFormat({ primaryColor: '#ff0000' })).toBe(true)
      expect(hasOldBasicThemeFormat({ backgroundColor: '#ffffff' })).toBe(true)
      expect(hasOldBasicThemeFormat({ accentColor: '#0000ff' })).toBe(true)
      expect(hasOldBasicThemeFormat({
        primaryColor: '#000000',
        backgroundColor: '#ffffff',
        accentColor: '#0066cc',
      })).toBe(true)
    })

    it('returns true for new property names as hex strings', () => {
      expect(hasOldBasicThemeFormat({ foreground: '#000000' })).toBe(true)
      expect(hasOldBasicThemeFormat({ background: '#ffffff' })).toBe(true)
      expect(hasOldBasicThemeFormat({ accent: '#0066cc' })).toBe(true)
    })

    it('returns true for RGB objects without $type', () => {
      // Missing $type on theme itself
      expect(hasOldBasicThemeFormat({
        foreground: { $type, r: 0, g: 0, b: 0 },
        background: { $type, r: 255, g: 255, b: 255 },
      })).toBe(true)

      // Missing $type on colors
      expect(hasOldBasicThemeFormat({
        $type: themeType,
        foreground: { r: 0, g: 0, b: 0 },
        background: { r: 255, g: 255, b: 255 },
      })).toBe(true)
    })

    it('returns false for new format with all $type fields', () => {
      expect(hasOldBasicThemeFormat({
        $type: themeType,
        foreground: { $type, r: 0, g: 0, b: 0 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 0, g: 102, b: 204 },
        accentForeground: { $type, r: 255, g: 255, b: 255 },
      })).toBe(false)
    })

    it('returns false for empty object', () => {
      expect(hasOldBasicThemeFormat({})).toBe(false)
    })

    it('returns false for partial new format with $type', () => {
      expect(hasOldBasicThemeFormat({
        $type: themeType,
        foreground: { $type, r: 0, g: 0, b: 0 },
      })).toBe(false)
    })
  })

  describe('convertOldBasicTheme', () => {
    const $type = 'site.standard.theme.color#rgb' as const
    const themeType = 'site.standard.theme.basic' as const

    it('returns undefined for null/undefined', () => {
      expect(convertOldBasicTheme(null)).toBeUndefined()
      expect(convertOldBasicTheme(undefined)).toBeUndefined()
    })

    it('returns undefined for non-objects', () => {
      expect(convertOldBasicTheme('string')).toBeUndefined()
      expect(convertOldBasicTheme(123)).toBeUndefined()
    })

    it('converts old property names to new RGB format', () => {
      const result = convertOldBasicTheme({
        primaryColor: '#000000',
        backgroundColor: '#ffffff',
        accentColor: '#0066cc',
      })

      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 0, g: 0, b: 0 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: { $type, r: 0, g: 102, b: 204 },
        accentForeground: { $type, r: 255, g: 255, b: 255 }, // White bg provides contrast with dark blue accent
      })
    })

    it('converts new property names with hex strings to RGB', () => {
      const result = convertOldBasicTheme({
        foreground: '#1a1a1a',
        background: '#f5f5f5',
        accent: '#ff0000',
      })

      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 26, g: 26, b: 26 },
        background: { $type, r: 245, g: 245, b: 245 },
        accent: { $type, r: 255, g: 0, b: 0 },
        accentForeground: { $type, r: 26, g: 26, b: 26 }, // Uses dark foreground for light red accent
      })
    })

    it('handles partial old format', () => {
      const result = convertOldBasicTheme({
        primaryColor: '#333333',
      })

      expect(result?.$type).toBe(themeType)
      expect(result?.foreground).toEqual({ $type, r: 51, g: 51, b: 51 })
      expect(result?.background).toBeUndefined()
      expect(result?.accent).toBeUndefined()
    })

    it('adds $type to already valid RGB format', () => {
      const validTheme = {
        foreground: { r: 0, g: 0, b: 0 },
        background: { r: 255, g: 255, b: 255 },
      }
      const result = convertOldBasicTheme(validTheme)
      expect(result).toEqual({
        $type: themeType,
        foreground: { $type, r: 0, g: 0, b: 0 },
        background: { $type, r: 255, g: 255, b: 255 },
        accent: undefined,
        accentForeground: undefined,
      })
    })

    it('returns undefined for empty object', () => {
      expect(convertOldBasicTheme({})).toBeUndefined()
    })

    it('computes accentForeground using theme colors for contrast', () => {
      // Dark theme with light accent - should use dark background for accentForeground
      const darkTheme = convertOldBasicTheme({
        primaryColor: '#ffffff',
        backgroundColor: '#1a1a1a',
        accentColor: '#88c0d0', // Light blue
      })
      expect(darkTheme?.accentForeground).toEqual({ $type, r: 26, g: 26, b: 26 }) // Dark background

      // Light theme with dark accent - should use light background for accentForeground
      const lightTheme = convertOldBasicTheme({
        primaryColor: '#1a1a1a',
        backgroundColor: '#ffffff',
        accentColor: '#002b36', // Dark teal
      })
      expect(lightTheme?.accentForeground).toEqual({ $type, r: 255, g: 255, b: 255 }) // Light background
    })
  })

  describe('Tag normalization in BlogEntry', () => {
    // Helper function matching the normalization logic in getBlogEntry/listBlogEntries
    function normalizeTags(rawTags: unknown): string[] | undefined {
      if (!rawTags || !Array.isArray(rawTags)) return undefined
      const normalized = rawTags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 0)
        .filter((t, i, arr) => arr.indexOf(t) === i)
      return normalized.length > 0 ? normalized : undefined
    }

    it('returns undefined for null/undefined tags', () => {
      expect(normalizeTags(null)).toBeUndefined()
      expect(normalizeTags(undefined)).toBeUndefined()
    })

    it('returns undefined for non-array tags', () => {
      expect(normalizeTags('string')).toBeUndefined()
      expect(normalizeTags(123)).toBeUndefined()
      expect(normalizeTags({})).toBeUndefined()
    })

    it('returns undefined for empty array', () => {
      expect(normalizeTags([])).toBeUndefined()
    })

    it('normalizes tags to lowercase', () => {
      expect(normalizeTags(['JavaScript', 'TypeScript', 'REACT'])).toEqual([
        'javascript',
        'typescript',
        'react',
      ])
    })

    it('trims whitespace from tags', () => {
      expect(normalizeTags(['  javascript  ', ' react ', 'typescript'])).toEqual([
        'javascript',
        'react',
        'typescript',
      ])
    })

    it('filters out empty strings after trimming', () => {
      expect(normalizeTags(['', 'javascript', '   ', 'react'])).toEqual([
        'javascript',
        'react',
      ])
    })

    it('filters out non-string values', () => {
      expect(normalizeTags(['javascript', 123, null, 'react', undefined])).toEqual([
        'javascript',
        'react',
      ])
    })

    it('deduplicates tags (case-insensitive)', () => {
      expect(normalizeTags(['JavaScript', 'javascript', 'JAVASCRIPT', 'react', 'React'])).toEqual([
        'javascript',
        'react',
      ])
    })

    it('preserves tag order (first occurrence wins)', () => {
      expect(normalizeTags(['React', 'javascript', 'REACT', 'typescript'])).toEqual([
        'react',
        'javascript',
        'typescript',
      ])
    })

    it('handles tags with special characters', () => {
      expect(normalizeTags(['c++', 'c#', '.net', 'node.js'])).toEqual([
        'c++',
        'c#',
        '.net',
        'node.js',
      ])
    })

    it('handles multi-word tags', () => {
      expect(normalizeTags(['machine learning', 'Web Development', 'Open Source'])).toEqual([
        'machine learning',
        'web development',
        'open source',
      ])
    })

    it('handles tags with numbers', () => {
      expect(normalizeTags(['ES6', 'web3', 'Python3'])).toEqual([
        'es6',
        'web3',
        'python3',
      ])
    })
  })

  describe('BlogEntry tags interface', () => {
    it('allows tags to be undefined', () => {
      const entry: BlogEntry = {
        uri: 'at://did:plc:test/app.greengale.document/test',
        cid: 'cid123',
        authorDid: 'did:plc:test',
        rkey: 'test',
        source: 'greengale',
        content: 'Test',
      }
      expect(entry.tags).toBeUndefined()
    })

    it('allows tags to be an array of strings', () => {
      const entry: BlogEntry = {
        uri: 'at://did:plc:test/app.greengale.document/test',
        cid: 'cid123',
        authorDid: 'did:plc:test',
        rkey: 'test',
        source: 'greengale',
        content: 'Test',
        tags: ['javascript', 'react', 'typescript'],
      }
      expect(entry.tags).toEqual(['javascript', 'react', 'typescript'])
    })

    it('allows empty tags array', () => {
      const entry: BlogEntry = {
        uri: 'at://did:plc:test/app.greengale.document/test',
        cid: 'cid123',
        authorDid: 'did:plc:test',
        rkey: 'test',
        source: 'greengale',
        content: 'Test',
        tags: [],
      }
      expect(entry.tags).toEqual([])
    })
  })

  describe('SiteStandardDocument content field', () => {
    it('requires $type in content for union type compliance', () => {
      // This test documents the required structure for site.standard.document content field
      // The content field is an open union that requires a $type discriminator
      const validContent: SiteStandardDocument['content'] = {
        $type: 'app.greengale.document#contentRef',
        uri: 'at://did:plc:abc123/app.greengale.document/xyz789',
      }
      expect(validContent.$type).toBe('app.greengale.document#contentRef')
      expect(validContent.uri).toMatch(/^at:\/\//)
    })

    it('accepts valid AT-URI format for content.uri', () => {
      const validUris = [
        'at://did:plc:abc123/app.greengale.document/xyz789',
        'at://did:web:example.com/app.greengale.document/abc',
        'at://handle.bsky.social/app.greengale.document/123',
      ]

      for (const uri of validUris) {
        const content: SiteStandardDocument['content'] = {
          $type: 'app.greengale.document#contentRef',
          uri,
        }
        expect(content.uri).toBe(uri)
      }
    })

    it('uses correct $type for GreenGale content references', () => {
      // The $type must match the lexicon definition: app.greengale.document#contentRef
      const content: SiteStandardDocument['content'] = {
        $type: 'app.greengale.document#contentRef',
        uri: 'at://did:plc:test/app.greengale.document/test123',
      }
      // Verify the type is the GreenGale contentRef type
      expect(content.$type).toBe('app.greengale.document#contentRef')
      // The type string should reference the contentRef definition in the document lexicon
      expect(content.$type).toContain('#contentRef')
    })

    it('content field is optional in SiteStandardDocument', () => {
      // site.standard.document allows content to be undefined
      const docWithoutContent: SiteStandardDocument = {
        site: 'at://did:plc:abc/site.standard.publication/tid123',
        title: 'Test Document',
        publishedAt: '2024-01-15T10:00:00Z',
      }
      expect(docWithoutContent.content).toBeUndefined()
    })

    it('full SiteStandardDocument structure with content', () => {
      const fullDoc: SiteStandardDocument = {
        site: 'at://did:plc:abc123/site.standard.publication/tid456',
        path: '/post-rkey',
        title: 'Test Post Title',
        description: 'A test post description',
        content: {
          $type: 'app.greengale.document#contentRef',
          uri: 'at://did:plc:abc123/app.greengale.document/post-rkey',
        },
        textContent: 'Plain text version of the post',
        publishedAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-16T12:00:00Z',
      }

      expect(fullDoc.site).toMatch(/^at:\/\//)
      expect(fullDoc.path).toBe('/post-rkey')
      expect(fullDoc.title).toBe('Test Post Title')
      expect(fullDoc.content?.$type).toBe('app.greengale.document#contentRef')
      expect(fullDoc.content?.uri).toMatch(/^at:\/\//)
    })
  })

  describe('parseVoiceTheme', () => {
    it('returns undefined for null/undefined', () => {
      expect(parseVoiceTheme(null)).toBeUndefined()
      expect(parseVoiceTheme(undefined)).toBeUndefined()
    })

    it('returns undefined for non-objects', () => {
      expect(parseVoiceTheme('string')).toBeUndefined()
      expect(parseVoiceTheme(123)).toBeUndefined()
      expect(parseVoiceTheme(true)).toBeUndefined()
      expect(parseVoiceTheme([])).toBeUndefined()
    })

    it('returns undefined for empty object', () => {
      expect(parseVoiceTheme({})).toBeUndefined()
    })

    it('parses voice setting', () => {
      expect(parseVoiceTheme({ voice: 'af_heart' })).toEqual({ voice: 'af_heart' })
      expect(parseVoiceTheme({ voice: 'am_adam' })).toEqual({ voice: 'am_adam' })
    })

    it('ignores empty voice string', () => {
      expect(parseVoiceTheme({ voice: '' })).toBeUndefined()
    })

    it('ignores non-string voice', () => {
      expect(parseVoiceTheme({ voice: 123 })).toBeUndefined()
      expect(parseVoiceTheme({ voice: null })).toBeUndefined()
    })

    it('parses valid pitch values', () => {
      expect(parseVoiceTheme({ pitch: 0.5 })).toEqual({ pitch: 0.5 })
      expect(parseVoiceTheme({ pitch: 1.0 })).toEqual({ pitch: 1.0 })
      expect(parseVoiceTheme({ pitch: 1.5 })).toEqual({ pitch: 1.5 })
      expect(parseVoiceTheme({ pitch: 0.75 })).toEqual({ pitch: 0.75 })
    })

    it('ignores pitch values outside valid range', () => {
      expect(parseVoiceTheme({ pitch: 0.4 })).toBeUndefined()
      expect(parseVoiceTheme({ pitch: 1.6 })).toBeUndefined()
      expect(parseVoiceTheme({ pitch: 0 })).toBeUndefined()
      expect(parseVoiceTheme({ pitch: 2.0 })).toBeUndefined()
    })

    it('ignores non-number pitch', () => {
      expect(parseVoiceTheme({ pitch: '1.0' })).toBeUndefined()
      expect(parseVoiceTheme({ pitch: null })).toBeUndefined()
    })

    it('parses valid speed values', () => {
      expect(parseVoiceTheme({ speed: 0.5 })).toEqual({ speed: 0.5 })
      expect(parseVoiceTheme({ speed: 1.0 })).toEqual({ speed: 1.0 })
      expect(parseVoiceTheme({ speed: 2.0 })).toEqual({ speed: 2.0 })
      expect(parseVoiceTheme({ speed: 1.5 })).toEqual({ speed: 1.5 })
    })

    it('ignores speed values outside valid range', () => {
      expect(parseVoiceTheme({ speed: 0.4 })).toBeUndefined()
      expect(parseVoiceTheme({ speed: 2.1 })).toBeUndefined()
      expect(parseVoiceTheme({ speed: 0 })).toBeUndefined()
    })

    it('ignores non-number speed', () => {
      expect(parseVoiceTheme({ speed: '1.0' })).toBeUndefined()
      expect(parseVoiceTheme({ speed: null })).toBeUndefined()
    })

    it('parses complete voiceTheme object', () => {
      expect(parseVoiceTheme({
        voice: 'bf_emma',
        pitch: 0.9,
        speed: 1.2,
      })).toEqual({
        voice: 'bf_emma',
        pitch: 0.9,
        speed: 1.2,
      })
    })

    it('parses partial voiceTheme with valid values only', () => {
      expect(parseVoiceTheme({
        voice: 'am_adam',
        pitch: 0.3, // Invalid (out of range)
        speed: 1.5,
      })).toEqual({
        voice: 'am_adam',
        speed: 1.5,
      })

      expect(parseVoiceTheme({
        voice: '',      // Invalid (empty)
        pitch: 1.0,
        speed: 'fast',  // Invalid (not a number)
      })).toEqual({
        pitch: 1.0,
      })
    })

    it('ignores unknown properties', () => {
      expect(parseVoiceTheme({
        voice: 'af_heart',
        unknownProp: 'value',
        anotherProp: 123,
      })).toEqual({
        voice: 'af_heart',
      })
    })

    it('handles boundary values for pitch', () => {
      expect(parseVoiceTheme({ pitch: 0.5 })).toEqual({ pitch: 0.5 })
      expect(parseVoiceTheme({ pitch: 1.5 })).toEqual({ pitch: 1.5 })
      // Just outside boundaries
      expect(parseVoiceTheme({ pitch: 0.49 })).toBeUndefined()
      expect(parseVoiceTheme({ pitch: 1.51 })).toBeUndefined()
    })

    it('handles boundary values for speed', () => {
      expect(parseVoiceTheme({ speed: 0.5 })).toEqual({ speed: 0.5 })
      expect(parseVoiceTheme({ speed: 2.0 })).toEqual({ speed: 2.0 })
      // Just outside boundaries
      expect(parseVoiceTheme({ speed: 0.49 })).toBeUndefined()
      expect(parseVoiceTheme({ speed: 2.01 })).toBeUndefined()
    })

    // Integer format tests (AT Protocol stores as x100)
    it('parses pitch from integer format (x100)', () => {
      expect(parseVoiceTheme({ pitch: 50 })).toEqual({ pitch: 0.5 })
      expect(parseVoiceTheme({ pitch: 100 })).toEqual({ pitch: 1.0 })
      expect(parseVoiceTheme({ pitch: 150 })).toEqual({ pitch: 1.5 })
      expect(parseVoiceTheme({ pitch: 90 })).toEqual({ pitch: 0.9 })
    })

    it('parses speed from integer format (x100)', () => {
      expect(parseVoiceTheme({ speed: 50 })).toEqual({ speed: 0.5 })
      expect(parseVoiceTheme({ speed: 100 })).toEqual({ speed: 1.0 })
      expect(parseVoiceTheme({ speed: 200 })).toEqual({ speed: 2.0 })
      expect(parseVoiceTheme({ speed: 125 })).toEqual({ speed: 1.25 })
    })

    it('parses complete voiceTheme from integer format', () => {
      expect(parseVoiceTheme({
        voice: 'bf_emma',
        pitch: 90,
        speed: 120,
      })).toEqual({
        voice: 'bf_emma',
        pitch: 0.9,
        speed: 1.2,
      })
    })
  })

  describe('voiceThemeToRecord', () => {
    it('returns undefined for undefined input', () => {
      expect(voiceThemeToRecord(undefined)).toBeUndefined()
    })

    it('returns undefined for empty voiceTheme', () => {
      expect(voiceThemeToRecord({})).toBeUndefined()
    })

    it('converts voice only', () => {
      expect(voiceThemeToRecord({ voice: 'af_heart' })).toEqual({ voice: 'af_heart' })
    })

    it('converts pitch to integer format (x100)', () => {
      expect(voiceThemeToRecord({ pitch: 0.5 })).toEqual({ pitch: 50 })
      expect(voiceThemeToRecord({ pitch: 0.9 })).toEqual({ pitch: 90 })
      expect(voiceThemeToRecord({ pitch: 1.5 })).toEqual({ pitch: 150 })
    })

    it('converts speed to integer format (x100)', () => {
      expect(voiceThemeToRecord({ speed: 0.5 })).toEqual({ speed: 50 })
      expect(voiceThemeToRecord({ speed: 1.25 })).toEqual({ speed: 125 })
      expect(voiceThemeToRecord({ speed: 2.0 })).toEqual({ speed: 200 })
    })

    it('excludes pitch when value is 1.0 (default)', () => {
      expect(voiceThemeToRecord({ pitch: 1.0 })).toBeUndefined()
      expect(voiceThemeToRecord({ voice: 'af_heart', pitch: 1.0 })).toEqual({ voice: 'af_heart' })
    })

    it('excludes speed when value is 1.0 (default)', () => {
      expect(voiceThemeToRecord({ speed: 1.0 })).toBeUndefined()
      expect(voiceThemeToRecord({ voice: 'af_heart', speed: 1.0 })).toEqual({ voice: 'af_heart' })
    })

    it('converts complete voiceTheme', () => {
      expect(voiceThemeToRecord({
        voice: 'bf_emma',
        pitch: 0.9,
        speed: 1.2,
      })).toEqual({
        voice: 'bf_emma',
        pitch: 90,
        speed: 120,
      })
    })

    it('handles partial voiceTheme with non-default values', () => {
      expect(voiceThemeToRecord({
        pitch: 0.75,
        speed: 1.0, // Default, should be excluded
      })).toEqual({
        pitch: 75,
      })
    })
  })

  describe('generateTid', () => {
    it('produces a 13-character string', () => {
      const tid = generateTid()
      expect(tid).toHaveLength(13)
    })

    it('uses only base32-sortable characters', () => {
      for (let i = 0; i < 20; i++) {
        const tid = generateTid()
        expect(tid).toMatch(/^[234567a-z]{13}$/)
      }
    })

    it('generates unique values on successive calls', () => {
      const tids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        tids.add(generateTid())
      }
      // Random clock ID (2 chars = 1024 combos) ensures most are unique
      // even within same millisecond. Allow small collision margin.
      expect(tids.size).toBeGreaterThan(40)
    })

    it('encodes timestamp in first 11 characters (sortable portion)', () => {
      // Generate two TIDs and verify the timestamp portion (first 11 chars)
      // is consistent with base32-sortable encoding of the current time
      const tid = generateTid()
      const timestampPart = tid.slice(0, 11)
      const clockPart = tid.slice(11)

      expect(timestampPart).toHaveLength(11)
      expect(clockPart).toHaveLength(2)
      // Both parts should use base32 charset
      expect(timestampPart).toMatch(/^[234567a-z]+$/)
      expect(clockPart).toMatch(/^[234567a-z]+$/)
    })
  })

  describe('resolveIdentity', () => {
    beforeEach(() => {
      clearIdentityCache()
      vi.stubGlobal('fetch', mockFetch)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      mockFetch.mockReset()
    })

    it('returns DID directly if input is already a did:plc', async () => {
      const did = 'did:plc:abc123def456'
      const result = await resolveIdentity(did)
      expect(result).toBe(did)
    })

    it('returns DID directly if input is a did:web', async () => {
      const did = 'did:web:example.com'
      const result = await resolveIdentity(did)
      expect(result).toBe(did)
    })

    it('throws for invalid identifier', async () => {
      await expect(resolveIdentity('not valid!!')).rejects.toThrow('Invalid identifier')
    })

    it('throws for empty string', async () => {
      await expect(resolveIdentity('')).rejects.toThrow('Invalid identifier')
    })
  })

  describe('getPdsEndpoint', () => {
    beforeEach(() => {
      clearIdentityCache()
      vi.stubGlobal('fetch', mockFetch)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      mockFetch.mockReset()
    })

    it('resolves did:plc via plc.directory', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        service: [
          { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }
        ]
      }))

      const result = await getPdsEndpoint('did:plc:abc123')
      expect(result).toBe('https://pds.example.com')
      expect(mockFetch).toHaveBeenCalledWith('https://plc.directory/did:plc:abc123')
    })

    it('resolves did:web via .well-known/did.json', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        service: [
          { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.web.com' }
        ]
      }))

      const result = await getPdsEndpoint('did:web:example.com')
      expect(result).toBe('https://pds.web.com')
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/.well-known/did.json')
    })

    it('throws for unsupported DID method', async () => {
      await expect(getPdsEndpoint('did:key:abc')).rejects.toThrow('Unsupported DID method')
    })

    it('throws when DID document fetch fails', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, { ok: false }))
      await expect(getPdsEndpoint('did:plc:fail123')).rejects.toThrow('Failed to resolve DID')
    })

    it('throws when no PDS service in DID document', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        service: [
          { id: '#other', type: 'OtherService', serviceEndpoint: 'https://other.com' }
        ]
      }))
      await expect(getPdsEndpoint('did:plc:nopds')).rejects.toThrow('No PDS service found')
    })

    it('caches results and avoids repeated fetches', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        service: [
          { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.cached.com' }
        ]
      }))

      const first = await getPdsEndpoint('did:plc:cacheme')
      const second = await getPdsEndpoint('did:plc:cacheme')

      expect(first).toBe('https://pds.cached.com')
      expect(second).toBe('https://pds.cached.com')
      // Only one fetch should have been made
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('clearIdentityCache forces re-fetch', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.old.com' }
          ]
        }))
        .mockResolvedValueOnce(mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.new.com' }
          ]
        }))

      const first = await getPdsEndpoint('did:plc:clearme')
      expect(first).toBe('https://pds.old.com')

      clearIdentityCache()

      const second = await getPdsEndpoint('did:plc:clearme')
      expect(second).toBe('https://pds.new.com')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('cache expires after TTL', async () => {
      vi.useFakeTimers()
      mockFetch
        .mockResolvedValueOnce(mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.ttl.com' }
          ]
        }))
        .mockResolvedValueOnce(mockResponse({
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.ttl2.com' }
          ]
        }))

      const first = await getPdsEndpoint('did:plc:ttltest')
      expect(first).toBe('https://pds.ttl.com')

      // Advance past TTL (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      const second = await getPdsEndpoint('did:plc:ttltest')
      expect(second).toBe('https://pds.ttl2.com')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('finds PDS service by type field', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        service: [
          { id: '#other', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.bytype.com' }
        ]
      }))

      const result = await getPdsEndpoint('did:plc:bytype')
      expect(result).toBe('https://pds.bytype.com')
    })
  })

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success')
      const result = await withRetry(fn)
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries on failure and returns on eventual success', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn)
      await vi.advanceTimersByTimeAsync(100) // first backoff delay
      const result = await promise

      expect(result).toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('throws last error after all retries exhausted', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'))

      // Attach catch handler immediately to avoid unhandled rejection
      let caughtError: Error | undefined
      const promise = withRetry(fn).catch((e: Error) => { caughtError = e })

      await vi.advanceTimersByTimeAsync(100) // 1st backoff
      await vi.advanceTimersByTimeAsync(200) // 2nd backoff
      await promise

      expect(caughtError?.message).toBe('fail 3')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('uses exponential backoff delays', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok')

      const promise = withRetry(fn, 2, 100)

      // After 99ms, second attempt hasn't happened yet
      await vi.advanceTimersByTimeAsync(99)
      expect(fn).toHaveBeenCalledTimes(1)

      // At 100ms (baseDelay * 2^0), second attempt fires
      await vi.advanceTimersByTimeAsync(1)
      expect(fn).toHaveBeenCalledTimes(2)

      // After 199ms more (total 300ms), third attempt hasn't happened
      await vi.advanceTimersByTimeAsync(199)
      expect(fn).toHaveBeenCalledTimes(2)

      // At 200ms (baseDelay * 2^1), third attempt fires
      await vi.advanceTimersByTimeAsync(1)
      const result = await promise
      expect(result).toBe('ok')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('respects custom maxRetries parameter', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'))

      const promise = withRetry(fn, 0) // No retries

      await expect(promise).rejects.toThrow('always fails')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('respects custom baseDelayMs parameter', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('ok')

      const promise = withRetry(fn, 1, 500)

      await vi.advanceTimersByTimeAsync(499)
      expect(fn).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      const result = await promise
      expect(result).toBe('ok')
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('togglePinnedPost', () => {
    it('adds rkey to empty pins', () => {
      expect(togglePinnedPost(undefined, 'abc')).toEqual(['abc'])
      expect(togglePinnedPost([], 'abc')).toEqual(['abc'])
    })

    it('appends rkey to existing pins', () => {
      expect(togglePinnedPost(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    })

    it('removes rkey if already pinned', () => {
      expect(togglePinnedPost(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    })

    it('returns unchanged array when at max and adding new', () => {
      const pins = ['a', 'b', 'c', 'd']
      expect(togglePinnedPost(pins, 'e')).toEqual(['a', 'b', 'c', 'd'])
    })

    it('can still remove when at max', () => {
      const pins = ['a', 'b', 'c', 'd']
      expect(togglePinnedPost(pins, 'c')).toEqual(['a', 'b', 'd'])
    })

    it('respects custom maxPins', () => {
      expect(togglePinnedPost(['a', 'b'], 'c', 2)).toEqual(['a', 'b'])
      expect(togglePinnedPost(['a'], 'b', 2)).toEqual(['a', 'b'])
    })

    it('preserves order of existing pins when removing', () => {
      expect(togglePinnedPost(['x', 'y', 'z'], 'x')).toEqual(['y', 'z'])
      expect(togglePinnedPost(['x', 'y', 'z'], 'z')).toEqual(['x', 'y'])
    })

    it('returns new array reference (immutable)', () => {
      const pins = ['a', 'b']
      const result = togglePinnedPost(pins, 'c')
      expect(result).not.toBe(pins)
    })
  })
})
