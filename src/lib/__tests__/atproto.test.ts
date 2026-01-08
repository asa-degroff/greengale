import { describe, it, expect } from 'vitest'
import { slugify, toBasicTheme, extractPlaintext } from '../atproto'
import type { Theme } from '../themes'

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

  describe('toBasicTheme', () => {
    it('returns undefined for undefined theme', () => {
      expect(toBasicTheme(undefined)).toBeUndefined()
    })

    it('returns default colors for empty theme object', () => {
      // Empty theme falls through to default preset
      expect(toBasicTheme({})).toEqual({
        primaryColor: '#1a1a1a',
        backgroundColor: '#ffffff',
        accentColor: '#2563eb',
      })
    })

    it('converts custom theme colors', () => {
      const theme: Theme = {
        custom: {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        },
      }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#000000',
        backgroundColor: '#ffffff',
        accentColor: '#0066cc',
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
        primaryColor: undefined,
        backgroundColor: '#ffffff',
        accentColor: undefined,
      })
    })

    it('converts default preset', () => {
      const theme: Theme = { preset: 'default' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#1a1a1a',
        backgroundColor: '#ffffff',
        accentColor: '#2563eb',
      })
    })

    it('converts github-light preset', () => {
      const theme: Theme = { preset: 'github-light' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#24292f',
        backgroundColor: '#ffffff',
        accentColor: '#0969da',
      })
    })

    it('converts github-dark preset', () => {
      const theme: Theme = { preset: 'github-dark' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#e6edf3',
        backgroundColor: '#0d1117',
        accentColor: '#58a6ff',
      })
    })

    it('converts dracula preset', () => {
      const theme: Theme = { preset: 'dracula' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#f8f8f2',
        backgroundColor: '#282a36',
        accentColor: '#bd93f9',
      })
    })

    it('converts nord preset', () => {
      const theme: Theme = { preset: 'nord' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#eceff4',
        backgroundColor: '#2e3440',
        accentColor: '#88c0d0',
      })
    })

    it('converts solarized-light preset', () => {
      const theme: Theme = { preset: 'solarized-light' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#657b83',
        backgroundColor: '#fdf6e3',
        accentColor: '#268bd2',
      })
    })

    it('converts solarized-dark preset', () => {
      const theme: Theme = { preset: 'solarized-dark' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#839496',
        backgroundColor: '#002b36',
        accentColor: '#268bd2',
      })
    })

    it('converts monokai preset', () => {
      const theme: Theme = { preset: 'monokai' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#f8f8f2',
        backgroundColor: '#272822',
        accentColor: '#a6e22e',
      })
    })

    it('falls back to default for unknown preset', () => {
      const theme: Theme = { preset: 'unknown' as 'default' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#1a1a1a',
        backgroundColor: '#ffffff',
        accentColor: '#2563eb',
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
        primaryColor: '#ffffff',
        backgroundColor: '#000000',
        accentColor: '#ff0000',
      })
    })

    it('handles custom preset (uses default colors)', () => {
      const theme: Theme = { preset: 'custom' }
      const result = toBasicTheme(theme)
      expect(result).toEqual({
        primaryColor: '#1a1a1a',
        backgroundColor: '#ffffff',
        accentColor: '#2563eb',
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
})
