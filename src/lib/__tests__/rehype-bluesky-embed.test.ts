import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { rehypeBlueskyEmbed } from '../rehype-bluesky-embed'

// Helper to process HTML content through the rehype plugin
async function processHtml(html: string, options = {}): Promise<string> {
  // Wrap in markdown paragraph to get through remarkParse
  const markdown = html

  const processor = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeBlueskyEmbed, options)
    .use(rehypeStringify)

  const result = await processor.process(markdown)
  return String(result)
}

describe('Rehype Bluesky Embed Plugin', () => {

  describe('WhiteWind embed format', () => {
    it('transforms blockquote with data-bluesky-uri to embed placeholder', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:fzkpgpjj7nki7r5rhtmgzrez/app.bsky.feed.post/3kp5ye4rai22d">
        <p>Some post content</p>
      </blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('<bsky-embed')
      expect(result).toContain('handle="did:plc:fzkpgpjj7nki7r5rhtmgzrez"')
      expect(result).toContain('rkey="3kp5ye4rai22d"')
      expect(result).not.toContain('<blockquote')
    })

    it('extracts DID correctly from AT URI', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:abc123xyz/app.bsky.feed.post/rkey456"></blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('handle="did:plc:abc123xyz"')
      expect(result).toContain('rkey="rkey456"')
    })

    it('handles full WhiteWind embed with content', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:test123/app.bsky.feed.post/abc789" data-bluesky-cid="bafyrei...">
        <p lang="ja">🌟WhiteWind アップデート🌟<br><br><a href="https://bsky.app/profile/did:plc:test123/post/abc789?ref_src=embed">[image or embed]</a></p>
        &mdash; WhiteWind (<a href="https://bsky.app/profile/did:plc:test123?ref_src=embed">@whtwnd.com</a>) <a href="https://bsky.app/profile/did:plc:test123/post/abc789?ref_src=embed">2024年4月3日</a>
      </blockquote>
      <script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>`

      const result = await processHtml(html)

      expect(result).toContain('<bsky-embed')
      expect(result).toContain('handle="did:plc:test123"')
      expect(result).toContain('rkey="abc789"')
    })
  })

  describe('non-Bluesky blockquotes', () => {
    it('does not transform regular blockquotes', async () => {
      const html = `<blockquote>
        <p>This is a regular quote</p>
      </blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('<blockquote>')
      expect(result).not.toContain('<bsky-embed')
    })

    it('does not transform blockquotes without bluesky-embed class', async () => {
      const html = `<blockquote class="other-class" data-bluesky-uri="at://did:plc:xxx/app.bsky.feed.post/yyy">
        <p>Not a Bluesky embed</p>
      </blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('<blockquote')
      expect(result).not.toContain('<bsky-embed')
    })

    it('does not transform blockquotes without data-bluesky-uri', async () => {
      const html = `<blockquote class="bluesky-embed">
        <p>Missing URI attribute</p>
      </blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('<blockquote')
      expect(result).not.toContain('<bsky-embed')
    })
  })

  describe('invalid AT URIs', () => {
    it('ignores blockquotes with invalid AT URI format', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="invalid-uri">
        <p>Invalid URI</p>
      </blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('<blockquote')
      expect(result).not.toContain('<bsky-embed')
    })

    it('ignores AT URIs for non-post collections', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:xxx/app.bsky.actor.profile/self">
        <p>Not a post</p>
      </blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('<blockquote')
      expect(result).not.toContain('<bsky-embed')
    })
  })

  describe('multiple embeds', () => {
    it('transforms multiple embeds in the same document', async () => {
      // No leading whitespace to avoid markdown treating as code block
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:aaa/app.bsky.feed.post/post1"></blockquote>

Some text between

<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:bbb/app.bsky.feed.post/post2"></blockquote>`

      const result = await processHtml(html)

      expect(result).toContain('rkey="post1"')
      expect(result).toContain('rkey="post2"')
    })
  })

  describe('plugin options', () => {
    it('does not transform when disabled', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:xxx/app.bsky.feed.post/yyy"></blockquote>`

      const result = await processHtml(html, { enabled: false })

      expect(result).toContain('<blockquote')
      expect(result).not.toContain('<bsky-embed')
    })

    it('transforms by default (enabled not specified)', async () => {
      const html = `<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:xxx/app.bsky.feed.post/abc123"></blockquote>`

      const result = await processHtml(html, {})

      expect(result).toContain('rkey="abc123"')
    })
  })

  describe('mixed content', () => {
    it('handles markdown with embedded HTML blockquotes', async () => {
      const markdown = `# Title

Some regular text.

<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:xxx/app.bsky.feed.post/embed1"></blockquote>

More text after the embed.

> This is a regular markdown blockquote
`

      const result = await processHtml(markdown)

      expect(result).toContain('rkey="embed1"')
      expect(result).toContain('<h1>Title</h1>')
      // Regular blockquote should still exist
      expect(result).toContain('<blockquote>')
    })
  })
})
