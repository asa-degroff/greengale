import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { slugify, toBasicTheme, toGreenGaleTheme, hexToRgb, computeAccentForeground, extractPlaintext, resolveExternalUrl, deduplicateBlogEntries, hasOldBasicThemeFormat, convertOldBasicTheme } from '../atproto'
import type { BlogEntry, SiteStandardColor } from '../atproto'
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
})
