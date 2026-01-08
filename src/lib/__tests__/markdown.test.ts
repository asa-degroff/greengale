import { describe, it, expect } from 'vitest'
import { extractText, extractTitle, extractFirstImage } from '../markdown'

describe('Markdown Utilities', () => {
  describe('extractText', () => {
    it('extracts plain text from markdown', () => {
      const markdown = '# Hello World\n\nThis is a paragraph.'
      const text = extractText(markdown)
      expect(text).toBe('Hello World This is a paragraph.')
    })

    it('removes code blocks', () => {
      const markdown = 'Before\n```js\nconst x = 1;\n```\nAfter'
      const text = extractText(markdown)
      expect(text).toBe('Before After')
      expect(text).not.toContain('const')
    })

    it('removes inline code', () => {
      const markdown = 'Use the `console.log()` function'
      const text = extractText(markdown)
      expect(text).toBe('Use the function')
    })

    it('removes images', () => {
      const markdown = 'Text ![alt](image.png) more text'
      const text = extractText(markdown)
      expect(text).toBe('Text more text')
    })

    it('preserves link text but removes URLs', () => {
      const markdown = 'Click [here](https://example.com) for more'
      const text = extractText(markdown)
      expect(text).toBe('Click here for more')
    })

    it('removes heading markers', () => {
      const markdown = '# H1\n## H2\n### H3'
      const text = extractText(markdown)
      expect(text).toBe('H1 H2 H3')
    })

    it('removes bold and italic markers', () => {
      const markdown = 'This is **bold** and *italic* and ***both***'
      const text = extractText(markdown)
      expect(text).toBe('This is bold and italic and both')
    })

    it('removes blockquote markers', () => {
      const markdown = '> This is a quote\n> with multiple lines'
      const text = extractText(markdown)
      expect(text).toBe('This is a quote with multiple lines')
    })

    it('removes list markers', () => {
      const markdown = '- Item 1\n- Item 2\n* Item 3\n1. Numbered\n2. List'
      const text = extractText(markdown)
      expect(text).toBe('Item 1 Item 2 Item 3 Numbered List')
    })

    it('removes horizontal rules', () => {
      const markdown = 'Above\n---\nBelow'
      const text = extractText(markdown)
      expect(text).toBe('Above Below')
    })

    it('collapses whitespace', () => {
      const markdown = 'Too    many   spaces\n\n\nand lines'
      const text = extractText(markdown)
      expect(text).toBe('Too many spaces and lines')
    })

    it('truncates at maxLength', () => {
      const markdown = 'This is a long text that should be truncated at the word boundary'
      const text = extractText(markdown, 30)
      expect(text.length).toBeLessThanOrEqual(33) // 30 + "..."
      expect(text).toMatch(/\.\.\.$/)
    })

    it('truncates at word boundary', () => {
      const markdown = 'Hello wonderful world of testing'
      // With maxLength=20, truncated="Hello wonderful worl", lastSpace=16 (after "wonderful")
      const text = extractText(markdown, 20)
      expect(text).toBe('Hello wonderful...')
    })

    it('returns full text if shorter than maxLength', () => {
      const markdown = 'Short text'
      const text = extractText(markdown, 100)
      expect(text).toBe('Short text')
      expect(text).not.toContain('...')
    })

    it('handles empty string', () => {
      const text = extractText('')
      expect(text).toBe('')
    })

    it('handles complex nested markdown', () => {
      const markdown = `# Title

This is a **bold** paragraph with [a link](url).

\`\`\`python
print("code")
\`\`\`

> A quote with *emphasis*

- List item
`
      const text = extractText(markdown)
      expect(text).toContain('Title')
      expect(text).toContain('bold')
      expect(text).toContain('a link')
      expect(text).toContain('A quote with emphasis')
      expect(text).toContain('List item')
      expect(text).not.toContain('print')
      expect(text).not.toContain('```')
    })
  })

  describe('extractTitle', () => {
    it('extracts h1 heading', () => {
      const markdown = '# My Title\n\nParagraph text'
      const title = extractTitle(markdown)
      expect(title).toBe('My Title')
    })

    it('returns first h1 if multiple exist', () => {
      const markdown = '# First\n\n# Second'
      const title = extractTitle(markdown)
      expect(title).toBe('First')
    })

    it('ignores h2 and lower headings', () => {
      const markdown = '## Not a title\n\n# Real Title'
      const title = extractTitle(markdown)
      expect(title).toBe('Real Title')
    })

    it('returns undefined if no h1', () => {
      const markdown = '## H2 heading\n\nParagraph'
      const title = extractTitle(markdown)
      expect(title).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      const title = extractTitle('')
      expect(title).toBeUndefined()
    })

    it('trims whitespace from title', () => {
      const markdown = '#   Spaced Title   '
      const title = extractTitle(markdown)
      expect(title).toBe('Spaced Title')
    })

    it('handles title with special characters', () => {
      const markdown = "# Hello **World** and *Friends*"
      const title = extractTitle(markdown)
      expect(title).toBe('Hello **World** and *Friends*')
    })
  })

  describe('extractFirstImage', () => {
    it('extracts first image URL', () => {
      const markdown = 'Text ![alt](https://example.com/image.png) more'
      const url = extractFirstImage(markdown)
      expect(url).toBe('https://example.com/image.png')
    })

    it('returns first of multiple images', () => {
      const markdown = '![first](a.png) ![second](b.png)'
      const url = extractFirstImage(markdown)
      expect(url).toBe('a.png')
    })

    it('returns undefined if no images', () => {
      const markdown = 'No images here'
      const url = extractFirstImage(markdown)
      expect(url).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      const url = extractFirstImage('')
      expect(url).toBeUndefined()
    })

    it('ignores links that are not images', () => {
      const markdown = '[not image](link.html) ![image](image.png)'
      const url = extractFirstImage(markdown)
      expect(url).toBe('image.png')
    })

    it('handles complex alt text', () => {
      const markdown = '![A complex alt text with spaces](image.jpg)'
      const url = extractFirstImage(markdown)
      expect(url).toBe('image.jpg')
    })

    it('handles image with title', () => {
      // Note: the regex captures everything in parentheses, including title
      const markdown = '![alt](image.png "title")'
      const url = extractFirstImage(markdown)
      expect(url).toBe('image.png "title"')
    })

    it('handles relative paths', () => {
      const markdown = '![logo](./assets/logo.svg)'
      const url = extractFirstImage(markdown)
      expect(url).toBe('./assets/logo.svg')
    })
  })
})
