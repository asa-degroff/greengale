import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkSvg } from '../remark-svg'

// Mock the svg-sanitizer module
vi.mock('../svg-sanitizer', () => ({
  sanitizeSvg: vi.fn((svg: string) => {
    // Simulate sanitization - return null for "invalid" SVGs
    if (svg.includes('onerror') || svg.includes('<script')) {
      return null
    }
    // Return the SVG as-is for valid ones (simplified mock)
    return svg.trim()
  }),
  wrapSvg: vi.fn((svg: string) => `<div class="svg-container">${svg}</div>`),
}))

import { sanitizeSvg, wrapSvg } from '../svg-sanitizer'

describe('remarkSvg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function processMarkdown(markdown: string, options?: { wrapInContainer?: boolean }) {
    const result = await unified()
      .use(remarkParse)
      .use(remarkSvg, options)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process(markdown)

    return String(result)
  }

  describe('Language Detection', () => {
    it('processes code blocks with svg language', async () => {
      const markdown = '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledWith(
        '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>'
      )
    })

    it('processes xml code blocks that start with <svg', async () => {
      const markdown = '```xml\n<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledWith(
        '<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>'
      )
    })

    it('processes html code blocks that start with <svg', async () => {
      const markdown = '```html\n<svg viewBox="0 0 50 50"><line x1="0" y1="0" x2="50" y2="50"/></svg>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledWith(
        '<svg viewBox="0 0 50 50"><line x1="0" y1="0" x2="50" y2="50"/></svg>'
      )
    })

    it('ignores xml code blocks that do not start with <svg', async () => {
      const markdown = '```xml\n<root><child>content</child></root>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).not.toHaveBeenCalled()
    })

    it('ignores html code blocks that do not start with <svg', async () => {
      const markdown = '```html\n<div><p>Hello</p></div>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).not.toHaveBeenCalled()
    })

    it('ignores other language code blocks', async () => {
      const markdown = '```javascript\nconst x = 1;\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).not.toHaveBeenCalled()
    })

    it('ignores code blocks without language', async () => {
      const markdown = '```\n<svg></svg>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).not.toHaveBeenCalled()
    })

    it('handles whitespace before <svg in xml blocks', async () => {
      const markdown = '```xml\n  <svg viewBox="0 0 100 100"></svg>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalled()
    })

    it('handles whitespace before <svg in html blocks', async () => {
      const markdown = '```html\n\n<svg></svg>\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalled()
    })
  })

  describe('SVG Sanitization', () => {
    it('passes SVG content to sanitizer', async () => {
      const svgContent = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>'
      const markdown = `\`\`\`svg\n${svgContent}\n\`\`\``

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledWith(svgContent)
    })

    it('handles multiline SVG content', async () => {
      const markdown = `\`\`\`svg
<svg viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="blue"/>
  <text x="50" y="55" text-anchor="middle">Hello</text>
</svg>
\`\`\``

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalled()
      const callArg = (sanitizeSvg as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg).toContain('<circle')
      expect(callArg).toContain('<text')
    })
  })

  describe('Error Handling', () => {
    it('replaces invalid SVG with error message', async () => {
      const markdown = '```svg\n<svg onerror="alert(1)"></svg>\n```'

      const result = await processMarkdown(markdown)

      expect(result).toContain('svg-error')
      expect(result).toContain('Invalid or unsafe SVG content')
    })

    it('replaces SVG with script tags with error message', async () => {
      const markdown = '```svg\n<svg><script>alert(1)</script></svg>\n```'

      const result = await processMarkdown(markdown)

      expect(result).toContain('svg-error')
    })
  })

  describe('Container Wrapping', () => {
    it('wraps SVG in container by default', async () => {
      const markdown = '```svg\n<svg viewBox="0 0 100 100"></svg>\n```'

      await processMarkdown(markdown)

      expect(wrapSvg).toHaveBeenCalled()
    })

    it('wraps SVG in container when wrapInContainer is true', async () => {
      const markdown = '```svg\n<svg viewBox="0 0 100 100"></svg>\n```'

      await processMarkdown(markdown, { wrapInContainer: true })

      expect(wrapSvg).toHaveBeenCalled()
    })

    it('does not wrap SVG when wrapInContainer is false', async () => {
      const markdown = '```svg\n<svg viewBox="0 0 100 100"></svg>\n```'

      await processMarkdown(markdown, { wrapInContainer: false })

      expect(wrapSvg).not.toHaveBeenCalled()
    })

    it('includes container div class in output when wrapped', async () => {
      const markdown = '```svg\n<svg viewBox="0 0 100 100"></svg>\n```'

      const result = await processMarkdown(markdown)

      expect(result).toContain('svg-container')
    })
  })

  describe('Output Generation', () => {
    it('outputs sanitized SVG content', async () => {
      const markdown = '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```'

      const result = await processMarkdown(markdown)

      expect(result).toContain('<svg')
      expect(result).toContain('viewBox="0 0 100 100"')
      expect(result).toContain('<circle')
    })

    it('replaces code block with HTML node', async () => {
      const markdown = '```svg\n<svg></svg>\n```'

      const result = await processMarkdown(markdown)

      // Should not contain code block markers
      expect(result).not.toContain('```')
      // Should not have pre/code wrapping for the SVG
      expect(result).toContain('<svg')
    })
  })

  describe('Multiple SVG Blocks', () => {
    it('processes multiple SVG blocks in same document', async () => {
      const markdown = `
# First SVG

\`\`\`svg
<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>
\`\`\`

# Second SVG

\`\`\`svg
<svg viewBox="0 0 200 200"><rect width="100" height="100"/></svg>
\`\`\`
`

      const result = await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledTimes(2)
      expect(result).toContain('<circle')
      expect(result).toContain('<rect')
    })

    it('handles mix of valid and invalid SVG blocks', async () => {
      const markdown = `
\`\`\`svg
<svg viewBox="0 0 100 100"><circle/></svg>
\`\`\`

\`\`\`svg
<svg onerror="bad"></svg>
\`\`\`
`

      const result = await processMarkdown(markdown)

      expect(result).toContain('<circle')
      expect(result).toContain('svg-error')
    })
  })

  describe('Mixed Content', () => {
    it('preserves other markdown content', async () => {
      const markdown = `
# Heading

Some paragraph text.

\`\`\`svg
<svg viewBox="0 0 100 100"></svg>
\`\`\`

More text after.

\`\`\`javascript
const x = 1;
\`\`\`
`

      const result = await processMarkdown(markdown)

      expect(result).toContain('Heading')
      expect(result).toContain('Some paragraph text')
      expect(result).toContain('More text after')
      expect(result).toContain('<svg')
      expect(result).toContain('const x = 1')
    })

    it('does not affect inline code', async () => {
      const markdown = 'Use `<svg>` element for graphics.'

      const result = await processMarkdown(markdown)

      expect(sanitizeSvg).not.toHaveBeenCalled()
      expect(result).toContain('<code>')
    })
  })

  describe('Edge Cases', () => {
    it('handles empty SVG block', async () => {
      const markdown = '```svg\n\n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledWith('')
    })

    it('handles SVG with only whitespace', async () => {
      const markdown = '```svg\n   \n```'

      await processMarkdown(markdown)

      expect(sanitizeSvg).toHaveBeenCalledWith('   ')
    })

    it('preserves SVG attributes', async () => {
      const markdown = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200"></svg>\n```'

      const result = await processMarkdown(markdown)

      expect(result).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(result).toContain('viewBox="0 0 100 100"')
      expect(result).toContain('width="200"')
      expect(result).toContain('height="200"')
    })

    it('handles SVG with special characters in content', async () => {
      const markdown = '```svg\n<svg><text>Hello & Goodbye</text></svg>\n```'

      await processMarkdown(markdown)

      const callArg = (sanitizeSvg as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg).toContain('Hello & Goodbye')
    })

    it('handles SVG with CDATA sections', async () => {
      const markdown = '```svg\n<svg><style><![CDATA[.cls { fill: red; }]]></style></svg>\n```'

      await processMarkdown(markdown)

      const callArg = (sanitizeSvg as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg).toContain('CDATA')
    })
  })
})

describe('remarkSvg Plugin Options', () => {
  it('uses default options when none provided', async () => {
    // The plugin should work with no options
    const processor = unified()
      .use(remarkParse)
      .use(remarkSvg)

    expect(processor).toBeDefined()
  })

  it('accepts empty options object', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkSvg, {})

    expect(processor).toBeDefined()
  })

  it('accepts wrapInContainer option', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkSvg, { wrapInContainer: false })

    expect(processor).toBeDefined()
  })
})
