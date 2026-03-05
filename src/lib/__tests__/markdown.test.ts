import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
import { extractText, extractTitle, extractFirstImage, renderMarkdown, clearMarkdownCache } from '../markdown'

/** Render a ReactNode to an HTML string for assertion */
function toHtml(node: ReactNode): string {
  return renderToStaticMarkup(createElement('div', null, node))
}

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

  describe('renderMarkdown', () => {
    beforeEach(() => {
      clearMarkdownCache()
    })

    it('renders simple markdown to React elements', async () => {
      const result = await renderMarkdown('Hello **world**')
      expect(result).not.toBeNull()
      expect(result).not.toBe('')
    })

    it('returns cached result for identical content and options', async () => {
      const content = 'Cached content test'
      const first = await renderMarkdown(content)
      const second = await renderMarkdown(content)
      // Same object reference means cache hit
      expect(second).toBe(first)
    })

    it('returns different results for different content', async () => {
      const first = await renderMarkdown('Content A')
      const second = await renderMarkdown('Content B')
      expect(second).not.toBe(first)
    })

    it('uses different cache keys for different options', async () => {
      const content = 'Same content, different options'
      const withLatex = await renderMarkdown(content, { enableLatex: true })
      const withoutLatex = await renderMarkdown(content, { enableLatex: false })
      // Different options should produce independent cache entries
      expect(withLatex).not.toBe(withoutLatex)
    })

    it('clearMarkdownCache invalidates cached results', async () => {
      const content = 'Clear cache test'
      const first = await renderMarkdown(content)

      clearMarkdownCache()

      const second = await renderMarkdown(content)
      // After cache clear, a new render occurs (different object)
      expect(second).not.toBe(first)
    })

    it('does not cache when custom components are provided', async () => {
      const content = 'No cache with components'
      const components = { p: ({ children }: { children: unknown }) => children }
      const first = await renderMarkdown(content, { components })
      const second = await renderMarkdown(content, { components })
      // Custom components bypass cache, so different objects each time
      expect(second).not.toBe(first)
    })

    it('handles enableSvg option in cache key', async () => {
      const content = 'SVG option test'
      const withSvg = await renderMarkdown(content, { enableSvg: true })
      const withoutSvg = await renderMarkdown(content, { enableSvg: false })
      expect(withSvg).not.toBe(withoutSvg)
    })

    it('handles empty content', async () => {
      const result = await renderMarkdown('')
      // Empty content still produces a valid ReactNode (not undefined)
      expect(result).not.toBeUndefined()
    })

    it('evicts oldest entry when cache exceeds max size', async () => {
      clearMarkdownCache()

      // Fill cache with 50 entries (0-49), reaching max size
      for (let i = 0; i < 50; i++) {
        await renderMarkdown(`Entry ${i}`)
      }

      // Entry 1 should be cached (returns same reference)
      const entry1 = await renderMarkdown('Entry 1')
      const entry1Cached = await renderMarkdown('Entry 1')
      expect(entry1Cached).toBe(entry1) // Same reference = cached

      // Adding a new entry triggers eviction of entry 0 (oldest by timestamp)
      await renderMarkdown('Entry 50 - triggers eviction')

      // Entry 1 was recently accessed so it should still be cached
      const entry1AfterEviction = await renderMarkdown('Entry 1')
      expect(entry1AfterEviction).toBe(entry1) // Still cached
    })
  })

  describe('XSS Prevention', () => {
    beforeEach(() => {
      clearMarkdownCache()
    })

    it('strips script tags from markdown', async () => {
      const result = await renderMarkdown('<script>alert("xss")</script>')
      const html = toHtml(result)
      expect(html).not.toContain('<script')
      expect(html).not.toContain('alert')
    })

    it('strips event handlers from HTML in markdown', async () => {
      const result = await renderMarkdown('<img src=x onerror="alert(1)">')
      const html = toHtml(result)
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('alert')
    })

    it('strips javascript: URLs from links', async () => {
      const result = await renderMarkdown('[click me](javascript:alert(1))')
      const html = toHtml(result)
      expect(html).not.toContain('javascript:')
    })

    it('strips iframe elements', async () => {
      const result = await renderMarkdown('<iframe src="https://evil.com"></iframe>')
      const html = toHtml(result)
      expect(html).not.toContain('iframe')
      expect(html).not.toContain('evil.com')
    })

    it('allows style tags (needed for SVG stylesheets)', async () => {
      // <style> is intentionally allowed for SVG internal stylesheets
      // CSS sanitization happens at the SVG remark plugin level, not rehype-sanitize
      const result = await renderMarkdown('<style>.cls { fill: red; }</style>')
      const html = toHtml(result)
      expect(html).toContain('style')
    })

    it('strips data: URLs from images', async () => {
      const result = await renderMarkdown('<img src="data:text/html,<script>alert(1)</script>">')
      const html = toHtml(result)
      expect(html).not.toContain('data:text/html')
    })
  })
})
