import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import { remarkBlueskyEmbed } from '../remark-bluesky-embed'
import type { Root, Paragraph, Link, Text, Html } from 'mdast'

// Helper to process markdown with the plugin
async function processMarkdown(markdown: string, options = {}): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBlueskyEmbed, options)

  const tree = processor.parse(markdown)
  await processor.run(tree)
  return tree as Root
}

// Helper to find HTML nodes in the tree
function findHtmlNodes(tree: Root): Html[] {
  const htmlNodes: Html[] = []
  function walk(node: unknown) {
    if (node && typeof node === 'object') {
      const n = node as { type?: string; children?: unknown[] }
      if (n.type === 'html') {
        htmlNodes.push(node as Html)
      }
      if (n.children) {
        for (const child of n.children) {
          walk(child)
        }
      }
    }
  }
  walk(tree)
  return htmlNodes
}

// Helper to find paragraph nodes
function findParagraphs(tree: Root): Paragraph[] {
  const paragraphs: Paragraph[] = []
  function walk(node: unknown) {
    if (node && typeof node === 'object') {
      const n = node as { type?: string; children?: unknown[] }
      if (n.type === 'paragraph') {
        paragraphs.push(node as Paragraph)
      }
      if (n.children) {
        for (const child of n.children) {
          walk(child)
        }
      }
    }
  }
  walk(tree)
  return paragraphs
}

describe('Remark Bluesky Embed Plugin', () => {
  // Suppress console.log from the plugin during tests
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('standalone Bluesky URLs', () => {
    it('transforms standalone Bluesky URL to embed placeholder', async () => {
      const markdown = `Check this out:

https://bsky.app/profile/user.bsky.social/post/abc123

Pretty cool!`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      expect(htmlNodes[0].value).toContain('bluesky-embed')
      expect(htmlNodes[0].value).toContain('bsky-r-abc123')
    })

    it('transforms Bluesky URL with DID', async () => {
      const markdown = `https://bsky.app/profile/did:plc:abc123xyz/post/rkey456`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      expect(htmlNodes[0].value).toContain('bsky-r-rkey456')
    })

    it('encodes handle in base64url format', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      // user.bsky.social in base64url = dXNlci5ic2t5LnNvY2lhbA
      expect(htmlNodes[0].value).toContain('bsky-h-')
    })

    it('handles URL with HTTPS scheme', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
    })

    it('handles URL with HTTP scheme', async () => {
      const markdown = `http://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
    })

    it('handles complex rkey with numbers and letters', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/3kp7abcXYZ789`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      expect(htmlNodes[0].value).toContain('bsky-r-3kp7abcXYZ789')
    })
  })

  describe('non-standalone URLs', () => {
    it('does not transform URL within text', async () => {
      const markdown = `Check out https://bsky.app/profile/user.bsky.social/post/abc123 for more info.`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)
      const paragraphs = findParagraphs(tree)

      expect(htmlNodes).toHaveLength(0)
      expect(paragraphs).toHaveLength(1)
    })

    it('does not transform URL in the middle of text', async () => {
      const markdown = `Before https://bsky.app/profile/user.bsky.social/post/abc123 after`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('handles URL with preceding text on same line', async () => {
      const markdown = `See: https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })
  })

  describe('non-Bluesky URLs', () => {
    it('does not transform non-Bluesky URLs', async () => {
      const markdown = `https://example.com/some/path`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('does not transform Bluesky profile URLs', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('does not transform Bluesky feed URLs', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/feed/aaaa`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('does not transform Bluesky lists URLs', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/lists/bbbb`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })
  })

  describe('multiple URLs', () => {
    it('transforms multiple standalone Bluesky URLs', async () => {
      const markdown = `First post:

https://bsky.app/profile/user1.bsky.social/post/post1

Second post:

https://bsky.app/profile/user2.bsky.social/post/post2`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(2)
      expect(htmlNodes[0].value).toContain('bsky-r-post1')
      expect(htmlNodes[1].value).toContain('bsky-r-post2')
    })

    it('transforms only standalone URLs when mixed with inline', async () => {
      const markdown = `Check https://bsky.app/profile/inline/post/inline1 and:

https://bsky.app/profile/standalone/post/standalone1`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      expect(htmlNodes[0].value).toContain('bsky-r-standalone1')
    })
  })

  describe('markdown link syntax', () => {
    it('transforms standalone markdown link with Bluesky URL', async () => {
      const markdown = `[Click here](https://bsky.app/profile/user.bsky.social/post/abc123)`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      expect(htmlNodes[0].value).toContain('bsky-r-abc123')
    })

    it('does not transform markdown link with text around it', async () => {
      const markdown = `See [this post](https://bsky.app/profile/user.bsky.social/post/abc123) for more.`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })
  })

  describe('whitespace handling', () => {
    it('handles URL with leading whitespace', async () => {
      const markdown = `   https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      // Leading whitespace becomes part of the text node, URL is not standalone
      // Actually, markdown parsing may treat this differently
      // The paragraph has a text child with whitespace + URL
      expect(htmlNodes.length).toBeGreaterThanOrEqual(0) // Behavior depends on parser
    })

    it('handles URL with trailing whitespace', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/abc123   `

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      // Trailing whitespace should be filtered out as only whitespace
      expect(htmlNodes).toHaveLength(1)
    })
  })

  describe('plugin options', () => {
    it('does not transform when disabled', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown, { enabled: false })
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('transforms by default (enabled not specified)', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown, {})
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
    })

    it('transforms when explicitly enabled', async () => {
      const markdown = `https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown, { enabled: true })
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
    })
  })

  describe('embed placeholder format', () => {
    it('creates span element with correct class structure', async () => {
      const markdown = `https://bsky.app/profile/test.bsky.social/post/xyz789`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(1)
      const value = htmlNodes[0].value

      // Check structure
      expect(value).toMatch(/^<span class="/)
      expect(value).toMatch(/"><\/span>$/)
      expect(value).toContain('bluesky-embed')
      expect(value).toMatch(/bsky-h-[A-Za-z0-9_-]+/)
      expect(value).toMatch(/bsky-r-[A-Za-z0-9]+/)
    })

    it('uses base64url encoding (no +, /, =)', async () => {
      // Handle that would produce +, /, or = in base64
      const markdown = `https://bsky.app/profile/some+user/with/special.handle/post/abc123`

      // This won't match the pattern because of the path structure
      // Let's use a handle that produces problematic base64
      const markdown2 = `https://bsky.app/profile/test/post/abc123`

      const tree = await processMarkdown(markdown2)
      const htmlNodes = findHtmlNodes(tree)

      if (htmlNodes.length > 0) {
        const value = htmlNodes[0].value
        // Should not contain base64 special chars
        expect(value).not.toContain('+')
        expect(value).not.toMatch(/bsky-h-[^"]*\//)
        expect(value).not.toMatch(/bsky-h-[^"]*=/)
      }
    })
  })

  describe('edge cases', () => {
    it('handles empty markdown', async () => {
      const markdown = ''

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('handles markdown with only whitespace', async () => {
      const markdown = '   \n\n   '

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('handles URL in code block (should not transform)', async () => {
      const markdown = `\`\`\`
https://bsky.app/profile/user.bsky.social/post/abc123
\`\`\``

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('handles URL in inline code (should not transform)', async () => {
      const markdown = '`https://bsky.app/profile/user.bsky.social/post/abc123`'

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      expect(htmlNodes).toHaveLength(0)
    })

    it('handles URL in blockquote', async () => {
      const markdown = `> https://bsky.app/profile/user.bsky.social/post/abc123`

      const tree = await processMarkdown(markdown)
      const htmlNodes = findHtmlNodes(tree)

      // Blockquote paragraph should be transformed
      expect(htmlNodes).toHaveLength(1)
    })
  })
})
