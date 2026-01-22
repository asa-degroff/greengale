import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { remarkMention } from '../remark-mention'
import type { Root, Link, Text } from 'mdast'

// Helper to process markdown with the plugin
async function processMarkdown(
  markdown: string,
  options = {}
): Promise<Root> {
  const processor = unified().use(remarkParse).use(remarkMention, options)

  const tree = processor.parse(markdown)
  await processor.run(tree)
  return tree as Root
}

// Helper to find link nodes in the tree
function findLinks(tree: Root): Link[] {
  const links: Link[] = []
  function walk(node: unknown) {
    if (node && typeof node === 'object') {
      const n = node as { type?: string; children?: unknown[] }
      if (n.type === 'link') {
        links.push(node as Link)
      }
      if (n.children) {
        for (const child of n.children) {
          walk(child)
        }
      }
    }
  }
  walk(tree)
  return links
}

// Helper to convert tree back to markdown
async function toMarkdown(tree: Root): Promise<string> {
  const processor = unified().use(remarkStringify)
  const result = await processor.stringify(tree)
  return String(result)
}

describe('Remark Mention Plugin', () => {
  describe('basic mentions', () => {
    it('transforms @mention at start of text', async () => {
      const markdown = '@alice.bsky.social is cool'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/alice.bsky.social')
      expect((links[0].children[0] as Text).value).toBe('@alice.bsky.social')
    })

    it('transforms @mention in middle of text', async () => {
      const markdown = 'Check out @bob.bsky.social for more'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/bob.bsky.social')
    })

    it('transforms @mention at end of text', async () => {
      const markdown = 'Follow me at @charlie.bsky.social'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/charlie.bsky.social')
    })

    it('transforms multiple mentions in same paragraph', async () => {
      const markdown = '@alice.bsky.social and @bob.bsky.social are friends'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(2)
      expect(links[0].url).toBe('/alice.bsky.social')
      expect(links[1].url).toBe('/bob.bsky.social')
    })

    it('transforms mention with only two segments', async () => {
      const markdown = 'Contact @someone.com'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/someone.com')
    })

    it('transforms mention with many segments', async () => {
      const markdown = 'Visit @user.subdomain.example.co.uk'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.subdomain.example.co.uk')
    })
  })

  describe('handle format validation', () => {
    it('handles with hyphens in segments', async () => {
      const markdown = 'Follow @my-cool-handle.bsky.social'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/my-cool-handle.bsky.social')
    })

    it('handles with numbers', async () => {
      const markdown = 'User @user123.bsky.social joined'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user123.bsky.social')
    })

    it('does not match single segment (no dots)', async () => {
      const markdown = '@username is not a valid handle'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('does not match handle starting with hyphen', async () => {
      const markdown = '@-invalid.bsky.social should not match'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })
  })

  describe('email addresses (should not match)', () => {
    it('does not match email addresses', async () => {
      const markdown = 'Contact me at user@example.com'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('does not match email with subdomain', async () => {
      const markdown = 'Email support@mail.example.com'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('matches mention but not email in same text', async () => {
      const markdown =
        'Follow @alice.bsky.social or email alice@example.com'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/alice.bsky.social')
    })
  })

  describe('punctuation handling', () => {
    it('handles mention followed by period', async () => {
      const markdown = 'Check out @user.bsky.social.'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention followed by comma', async () => {
      const markdown = 'Thanks @user.bsky.social, you rock!'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention followed by exclamation', async () => {
      const markdown = 'Great post @user.bsky.social!'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention in parentheses', async () => {
      const markdown = 'Credit to (@user.bsky.social) for the idea'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention after colon', async () => {
      const markdown = 'Author: @user.bsky.social'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })
  })

  describe('code contexts (should not match)', () => {
    it('does not match mention in inline code', async () => {
      const markdown = 'Use `@user.bsky.social` for the handle'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('does not match mention in code block', async () => {
      const markdown = `\`\`\`
@user.bsky.social
\`\`\``

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })
  })

  describe('existing links', () => {
    it('does not double-link mentions inside links', async () => {
      const markdown = '[Visit @user.bsky.social](https://example.com)'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      // Should only have the original link, not nest another
      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('https://example.com')
    })
  })

  describe('different text contexts', () => {
    it('handles mention in heading', async () => {
      const markdown = '# Post by @user.bsky.social'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention in list item', async () => {
      const markdown = '- Follow @user.bsky.social'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention in blockquote', async () => {
      const markdown = '> As @user.bsky.social said'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention in bold text', async () => {
      const markdown = '**@user.bsky.social** is great'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })

    it('handles mention in italic text', async () => {
      const markdown = '*@user.bsky.social* posted'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/user.bsky.social')
    })
  })

  describe('plugin options', () => {
    it('does not transform when disabled', async () => {
      const markdown = '@user.bsky.social is here'

      const tree = await processMarkdown(markdown, { enabled: false })
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('uses custom base URL', async () => {
      const markdown = '@user.bsky.social is here'

      const tree = await processMarkdown(markdown, {
        baseUrl: 'https://greengale.app/',
      })
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('https://greengale.app/user.bsky.social')
    })

    it('transforms by default (enabled not specified)', async () => {
      const markdown = '@user.bsky.social'

      const tree = await processMarkdown(markdown, {})
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('handles empty markdown', async () => {
      const markdown = ''

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('handles markdown with @ but no valid mention', async () => {
      const markdown = 'Email me @ your convenience'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })

    it('handles mention followed by newline', async () => {
      const markdown = `Follow @user.bsky.social
for updates`

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
    })

    it('preserves surrounding text correctly', async () => {
      const markdown = 'Before @user.bsky.social after'

      const tree = await processMarkdown(markdown)
      const md = await toMarkdown(tree)

      expect(md.trim()).toBe('Before [@user.bsky.social](/user.bsky.social) after')
    })

    it('handles consecutive mentions', async () => {
      const markdown = '@alice.bsky.social @bob.bsky.social'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(2)
    })

    it('does not match @ alone', async () => {
      const markdown = 'The @ symbol is used'

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(0)
    })
  })

  describe('real-world examples', () => {
    it('handles typical blog mention', async () => {
      const markdown = `Check out @alice.bsky.social's post about TypeScript!`

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/alice.bsky.social')
    })

    it('handles multiple authors attribution', async () => {
      const markdown = `Written by @alice.bsky.social and @bob.bsky.social`

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      expect(links).toHaveLength(2)
    })

    it('handles mixed content with code and mentions', async () => {
      const markdown = `Use \`@mention\` syntax to tag @alice.bsky.social`

      const tree = await processMarkdown(markdown)
      const links = findLinks(tree)

      // Only the second one should be linked (first is in code)
      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('/alice.bsky.social')
    })
  })
})
