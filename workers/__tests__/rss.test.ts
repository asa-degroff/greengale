import { describe, it, expect } from 'vitest'
import {
  escapeXML,
  formatRSSDate,
  buildRSSFeed,
  markdownToHtml,
  type RSSChannel,
  type RSSItem,
} from '../lib/rss'

describe('escapeXML', () => {
  it('escapes ampersand', () => {
    expect(escapeXML('foo & bar')).toBe('foo &amp; bar')
  })

  it('escapes less than', () => {
    expect(escapeXML('foo < bar')).toBe('foo &lt; bar')
  })

  it('escapes greater than', () => {
    expect(escapeXML('foo > bar')).toBe('foo &gt; bar')
  })

  it('escapes double quotes', () => {
    expect(escapeXML('foo "bar" baz')).toBe('foo &quot;bar&quot; baz')
  })

  it('escapes single quotes', () => {
    expect(escapeXML("foo 'bar' baz")).toBe('foo &apos;bar&apos; baz')
  })

  it('escapes multiple special characters', () => {
    expect(escapeXML('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    )
  })

  it('handles empty string', () => {
    expect(escapeXML('')).toBe('')
  })

  it('handles string with no special characters', () => {
    expect(escapeXML('Hello World')).toBe('Hello World')
  })

  it('escapes HTML entities in blog titles', () => {
    expect(escapeXML('C++ vs C#: A <comparison>')).toBe(
      'C++ vs C#: A &lt;comparison&gt;'
    )
  })

  it('handles unicode characters', () => {
    expect(escapeXML('Hello 世界 🌍')).toBe('Hello 世界 🌍')
  })
})

describe('formatRSSDate', () => {
  it('converts ISO 8601 to RFC 2822 format', () => {
    expect(formatRSSDate('2024-01-15T10:30:00.000Z')).toBe(
      'Mon, 15 Jan 2024 10:30:00 GMT'
    )
  })

  it('handles midnight correctly', () => {
    expect(formatRSSDate('2024-03-01T00:00:00.000Z')).toBe(
      'Fri, 01 Mar 2024 00:00:00 GMT'
    )
  })

  it('handles end of day correctly', () => {
    expect(formatRSSDate('2024-12-31T23:59:59.000Z')).toBe(
      'Tue, 31 Dec 2024 23:59:59 GMT'
    )
  })

  it('handles all days of the week', () => {
    // Sunday
    expect(formatRSSDate('2024-01-07T12:00:00Z')).toBe(
      'Sun, 07 Jan 2024 12:00:00 GMT'
    )
    // Monday
    expect(formatRSSDate('2024-01-08T12:00:00Z')).toBe(
      'Mon, 08 Jan 2024 12:00:00 GMT'
    )
    // Tuesday
    expect(formatRSSDate('2024-01-09T12:00:00Z')).toBe(
      'Tue, 09 Jan 2024 12:00:00 GMT'
    )
    // Wednesday
    expect(formatRSSDate('2024-01-10T12:00:00Z')).toBe(
      'Wed, 10 Jan 2024 12:00:00 GMT'
    )
    // Thursday
    expect(formatRSSDate('2024-01-11T12:00:00Z')).toBe(
      'Thu, 11 Jan 2024 12:00:00 GMT'
    )
    // Friday
    expect(formatRSSDate('2024-01-12T12:00:00Z')).toBe(
      'Fri, 12 Jan 2024 12:00:00 GMT'
    )
    // Saturday
    expect(formatRSSDate('2024-01-13T12:00:00Z')).toBe(
      'Sat, 13 Jan 2024 12:00:00 GMT'
    )
  })

  it('handles all months', () => {
    expect(formatRSSDate('2024-01-15T12:00:00Z')).toContain('Jan')
    expect(formatRSSDate('2024-02-15T12:00:00Z')).toContain('Feb')
    expect(formatRSSDate('2024-03-15T12:00:00Z')).toContain('Mar')
    expect(formatRSSDate('2024-04-15T12:00:00Z')).toContain('Apr')
    expect(formatRSSDate('2024-05-15T12:00:00Z')).toContain('May')
    expect(formatRSSDate('2024-06-15T12:00:00Z')).toContain('Jun')
    expect(formatRSSDate('2024-07-15T12:00:00Z')).toContain('Jul')
    expect(formatRSSDate('2024-08-15T12:00:00Z')).toContain('Aug')
    expect(formatRSSDate('2024-09-15T12:00:00Z')).toContain('Sep')
    expect(formatRSSDate('2024-10-15T12:00:00Z')).toContain('Oct')
    expect(formatRSSDate('2024-11-15T12:00:00Z')).toContain('Nov')
    expect(formatRSSDate('2024-12-15T12:00:00Z')).toContain('Dec')
  })

  it('returns empty string for invalid date', () => {
    expect(formatRSSDate('not-a-date')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(formatRSSDate('')).toBe('')
  })

  it('handles dates without milliseconds', () => {
    expect(formatRSSDate('2024-06-20T15:45:30Z')).toBe(
      'Thu, 20 Jun 2024 15:45:30 GMT'
    )
  })

  it('pads single-digit values correctly', () => {
    expect(formatRSSDate('2024-01-05T09:05:03Z')).toBe(
      'Fri, 05 Jan 2024 09:05:03 GMT'
    )
  })

  it('handles leap year date', () => {
    expect(formatRSSDate('2024-02-29T12:00:00Z')).toBe(
      'Thu, 29 Feb 2024 12:00:00 GMT'
    )
  })
})

describe('buildRSSFeed', () => {
  const baseChannel: RSSChannel = {
    title: 'Test Blog',
    link: 'https://greengale.app/test.bsky.social',
    description: 'A test blog',
    selfLink: 'https://greengale.app/test.bsky.social/rss',
  }

  const baseItem: RSSItem = {
    title: 'Test Post',
    link: 'https://greengale.app/test.bsky.social/abc123',
    guid: 'https://greengale.app/test.bsky.social/abc123',
    pubDate: '2024-01-15T10:30:00.000Z',
    description: 'This is a test post description.',
  }

  it('generates valid RSS 2.0 structure', () => {
    const feed = buildRSSFeed(baseChannel, [])

    expect(feed).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(feed).toContain('<rss version="2.0"')
    expect(feed).toContain('xmlns:atom="http://www.w3.org/2005/Atom"')
    expect(feed).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"')
    expect(feed).toContain('<channel>')
    expect(feed).toContain('</channel>')
    expect(feed).toContain('</rss>')
  })

  it('includes channel metadata', () => {
    const feed = buildRSSFeed(baseChannel, [])

    expect(feed).toContain('<title>Test Blog</title>')
    expect(feed).toContain('<link>https://greengale.app/test.bsky.social</link>')
    expect(feed).toContain('<description>A test blog</description>')
  })

  it('includes atom:link self reference', () => {
    const feed = buildRSSFeed(baseChannel, [])

    expect(feed).toContain(
      '<atom:link href="https://greengale.app/test.bsky.social/rss" rel="self" type="application/rss+xml"/>'
    )
  })

  it('includes lastBuildDate when provided', () => {
    const channel = { ...baseChannel, lastBuildDate: '2024-01-15T10:30:00.000Z' }
    const feed = buildRSSFeed(channel, [])

    expect(feed).toContain('<lastBuildDate>Mon, 15 Jan 2024 10:30:00 GMT</lastBuildDate>')
  })

  it('omits lastBuildDate when not provided', () => {
    const feed = buildRSSFeed(baseChannel, [])

    expect(feed).not.toContain('<lastBuildDate>')
  })

  it('includes channel image when provided', () => {
    const channel = {
      ...baseChannel,
      imageUrl: 'https://example.com/avatar.jpg',
      imageTitle: 'Author Avatar',
    }
    const feed = buildRSSFeed(channel, [])

    expect(feed).toContain('<image>')
    expect(feed).toContain('<url>https://example.com/avatar.jpg</url>')
    expect(feed).toContain('<title>Author Avatar</title>')
    expect(feed).toContain('</image>')
  })

  it('uses channel title for image title when not provided', () => {
    const channel = {
      ...baseChannel,
      imageUrl: 'https://example.com/avatar.jpg',
    }
    const feed = buildRSSFeed(channel, [])

    expect(feed).toContain('<title>Test Blog</title>')
  })

  it('generates items correctly', () => {
    const feed = buildRSSFeed(baseChannel, [baseItem])

    expect(feed).toContain('<item>')
    expect(feed).toContain('<title>Test Post</title>')
    expect(feed).toContain('<link>https://greengale.app/test.bsky.social/abc123</link>')
    expect(feed).toContain('<guid isPermaLink="true">https://greengale.app/test.bsky.social/abc123</guid>')
    expect(feed).toContain('<pubDate>Mon, 15 Jan 2024 10:30:00 GMT</pubDate>')
    expect(feed).toContain('</item>')
  })

  it('wraps description in CDATA', () => {
    const feed = buildRSSFeed(baseChannel, [baseItem])

    expect(feed).toContain('<description><![CDATA[This is a test post description.]]></description>')
  })

  it('includes dc:creator when provided', () => {
    const item = { ...baseItem, creator: 'John Doe' }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain('<dc:creator>John Doe</dc:creator>')
  })

  it('omits dc:creator when not provided', () => {
    const feed = buildRSSFeed(baseChannel, [baseItem])

    expect(feed).not.toContain('<dc:creator>')
  })

  it('includes categories (tags) when provided', () => {
    const item = { ...baseItem, categories: ['javascript', 'react', 'web'] }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain('<category>javascript</category>')
    expect(feed).toContain('<category>react</category>')
    expect(feed).toContain('<category>web</category>')
  })

  it('omits categories when empty', () => {
    const item = { ...baseItem, categories: [] }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).not.toContain('<category>')
  })

  it('includes enclosure when provided', () => {
    const item = {
      ...baseItem,
      enclosureUrl: 'https://cdn.bsky.app/blob/did:plc:xxx/image.avif',
      enclosureType: 'image/avif',
      enclosureLength: 12345,
    }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain(
      '<enclosure url="https://cdn.bsky.app/blob/did:plc:xxx/image.avif" type="image/avif" length="12345"/>'
    )
  })

  it('uses default values for enclosure when not provided', () => {
    const item = {
      ...baseItem,
      enclosureUrl: 'https://example.com/image.avif',
    }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain('type="image/avif"')
    expect(feed).toContain('length="0"')
  })

  it('escapes special characters in channel fields', () => {
    const channel = {
      ...baseChannel,
      title: 'Blog <with> & special "chars"',
      description: "It's a <test>",
    }
    const feed = buildRSSFeed(channel, [])

    expect(feed).toContain('<title>Blog &lt;with&gt; &amp; special &quot;chars&quot;</title>')
    expect(feed).toContain('<description>It&apos;s a &lt;test&gt;</description>')
  })

  it('escapes special characters in item fields', () => {
    const item = {
      ...baseItem,
      title: 'Post <with> & special "chars"',
      creator: "O'Brien & Partners",
    }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain('<title>Post &lt;with&gt; &amp; special &quot;chars&quot;</title>')
    expect(feed).toContain('<dc:creator>O&apos;Brien &amp; Partners</dc:creator>')
  })

  it('handles multiple items', () => {
    const items = [
      { ...baseItem, title: 'Post 1' },
      { ...baseItem, title: 'Post 2' },
      { ...baseItem, title: 'Post 3' },
    ]
    const feed = buildRSSFeed(baseChannel, items)

    expect(feed).toContain('<title>Post 1</title>')
    expect(feed).toContain('<title>Post 2</title>')
    expect(feed).toContain('<title>Post 3</title>')
    expect((feed.match(/<item>/g) || []).length).toBe(3)
  })

  it('handles empty items array', () => {
    const feed = buildRSSFeed(baseChannel, [])

    expect(feed).not.toContain('<item>')
    expect(feed).toContain('<channel>')
    expect(feed).toContain('</channel>')
  })

  it('handles items with all optional fields', () => {
    const item: RSSItem = {
      title: 'Full Post',
      link: 'https://greengale.app/test/full',
      guid: 'https://greengale.app/test/full',
      pubDate: '2024-06-15T12:00:00Z',
      description: 'A fully featured post',
      creator: 'Jane Smith',
      categories: ['tech', 'tutorial'],
      enclosureUrl: 'https://example.com/image.avif',
      enclosureType: 'image/avif',
      enclosureLength: 50000,
    }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain('<title>Full Post</title>')
    expect(feed).toContain('<dc:creator>Jane Smith</dc:creator>')
    expect(feed).toContain('<category>tech</category>')
    expect(feed).toContain('<category>tutorial</category>')
    expect(feed).toContain('<enclosure')
  })

  it('preserves HTML in description via CDATA', () => {
    const item = {
      ...baseItem,
      description: 'This has <strong>bold</strong> and <a href="test">links</a>',
    }
    const feed = buildRSSFeed(baseChannel, [item])

    expect(feed).toContain(
      '<description><![CDATA[This has <strong>bold</strong> and <a href="test">links</a>]]></description>'
    )
  })

  it('handles unicode in content', () => {
    const channel = {
      ...baseChannel,
      title: '日本語ブログ',
      description: 'A blog with 世界 emoji 🌍',
    }
    const item = {
      ...baseItem,
      title: 'Post with émojis 🚀',
      description: 'Content: 中文, العربية, עברית',
    }
    const feed = buildRSSFeed(channel, [item])

    expect(feed).toContain('<title>日本語ブログ</title>')
    expect(feed).toContain('<title>Post with émojis 🚀</title>')
    expect(feed).toContain('Content: 中文, العربية, עברית')
  })
})

describe('markdownToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(markdownToHtml('')).toBe('')
  })

  it('escapes HTML entities', () => {
    expect(markdownToHtml('foo & bar')).toContain('&amp;')
    expect(markdownToHtml('foo < bar')).toContain('&lt;')
    expect(markdownToHtml('foo > bar')).toContain('&gt;')
  })

  it('converts headers', () => {
    expect(markdownToHtml('# Heading 1')).toContain('<h1>Heading 1</h1>')
    expect(markdownToHtml('## Heading 2')).toContain('<h2>Heading 2</h2>')
    expect(markdownToHtml('### Heading 3')).toContain('<h3>Heading 3</h3>')
    expect(markdownToHtml('#### Heading 4')).toContain('<h4>Heading 4</h4>')
    expect(markdownToHtml('##### Heading 5')).toContain('<h5>Heading 5</h5>')
    expect(markdownToHtml('###### Heading 6')).toContain('<h6>Heading 6</h6>')
  })

  it('converts bold text', () => {
    expect(markdownToHtml('This is **bold** text')).toContain('<strong>bold</strong>')
    expect(markdownToHtml('This is __bold__ text')).toContain('<strong>bold</strong>')
  })

  it('converts italic text', () => {
    expect(markdownToHtml('This is *italic* text')).toContain('<em>italic</em>')
    expect(markdownToHtml('This is _italic_ text')).toContain('<em>italic</em>')
  })

  it('converts strikethrough text', () => {
    expect(markdownToHtml('This is ~~deleted~~ text')).toContain('<del>deleted</del>')
  })

  it('converts links', () => {
    expect(markdownToHtml('Check [this link](https://example.com)')).toContain(
      '<a href="https://example.com">this link</a>'
    )
  })

  it('converts images', () => {
    expect(markdownToHtml('![Alt text](https://example.com/image.jpg)')).toContain(
      '<img src="https://example.com/image.jpg" alt="Alt text" />'
    )
  })

  it('converts inline code', () => {
    expect(markdownToHtml('Use `const x = 1` for variables')).toContain(
      '<code>const x = 1</code>'
    )
  })

  it('converts fenced code blocks', () => {
    const md = '```javascript\nconst x = 1;\n```'
    const html = markdownToHtml(md)
    expect(html).toContain('<pre><code>')
    expect(html).toContain('const x = 1;')
    expect(html).toContain('</code></pre>')
  })

  it('converts blockquotes', () => {
    expect(markdownToHtml('> This is a quote')).toContain('<blockquote>This is a quote</blockquote>')
  })

  it('converts unordered lists', () => {
    const md = '- Item 1\n- Item 2\n- Item 3'
    const html = markdownToHtml(md)
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>Item 1</li>')
    expect(html).toContain('<li>Item 2</li>')
    expect(html).toContain('<li>Item 3</li>')
    expect(html).toContain('</ul>')
  })

  it('converts ordered lists', () => {
    const md = '1. First\n2. Second\n3. Third'
    const html = markdownToHtml(md)
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>First</li>')
    expect(html).toContain('<li>Second</li>')
    expect(html).toContain('<li>Third</li>')
    expect(html).toContain('</ol>')
  })

  it('converts horizontal rules', () => {
    expect(markdownToHtml('---')).toContain('<hr />')
    expect(markdownToHtml('***')).toContain('<hr />')
  })

  it('wraps paragraphs in p tags', () => {
    const md = 'First paragraph.\n\nSecond paragraph.'
    const html = markdownToHtml(md)
    expect(html).toContain('<p>First paragraph.</p>')
    expect(html).toContain('<p>Second paragraph.</p>')
  })

  it('converts single newlines to br tags within paragraphs', () => {
    const md = 'Line one\nLine two'
    const html = markdownToHtml(md)
    expect(html).toContain('Line one<br />')
    expect(html).toContain('Line two')
  })

  it('handles complex markdown', () => {
    const md = `# Blog Post

This is **bold** and *italic* text with a [link](https://example.com).

## Section 2

Here's some code: \`const x = 1\`

- Item one
- Item two

> A blockquote

---

The end.`

    const html = markdownToHtml(md)
    expect(html).toContain('<h1>Blog Post</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<a href="https://example.com">link</a>')
    expect(html).toContain('<h2>Section 2</h2>')
    expect(html).toContain('<code>const x = 1</code>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>Item one</li>')
    expect(html).toContain('<blockquote>A blockquote</blockquote>')
    expect(html).toContain('<hr />')
    expect(html).toContain('The end.')
  })

  it('handles unicode content', () => {
    const md = '# 日本語タイトル\n\nHello 世界 🌍'
    const html = markdownToHtml(md)
    expect(html).toContain('<h1>日本語タイトル</h1>')
    expect(html).toContain('Hello 世界 🌍')
  })

  it('does not wrap block elements in p tags', () => {
    const md = '# Header\n\nParagraph'
    const html = markdownToHtml(md)
    expect(html).not.toContain('<p><h1>')
    expect(html).toContain('<h1>Header</h1>')
    expect(html).toContain('<p>Paragraph</p>')
  })
})
