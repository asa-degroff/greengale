import { describe, it, expect } from 'vitest'
import {
  extractContent,
  hashContent,
  chunkByHeadings,
  estimateTokens,
} from '../lib/content-extraction'

describe('extractContent', () => {
  describe('markdown extraction (GreenGale/WhiteWind)', () => {
    it('extracts plain text from markdown', () => {
      const record = {
        content: '# Hello World\n\nThis is a **bold** statement.',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.success).toBe(true)
      expect(result.format).toBe('markdown')
      expect(result.text).toContain('Hello World')
      expect(result.text).toContain('bold')
      expect(result.text).not.toContain('**')
      expect(result.text).not.toContain('#')
    })

    it('extracts headings from markdown', () => {
      const record = {
        content: '# Main Title\n\n## Section One\n\nContent here.\n\n### Subsection\n\nMore content.',
      }
      const result = extractContent(record, 'com.whtwnd.blog.entry')

      expect(result.headings).toHaveLength(3)
      expect(result.headings[0]).toEqual({ text: 'Main Title', level: 1 })
      expect(result.headings[1]).toEqual({ text: 'Section One', level: 2 })
      expect(result.headings[2]).toEqual({ text: 'Subsection', level: 3 })
    })

    it('skips code blocks', () => {
      const record = {
        content: 'Before code.\n\n```javascript\nconst x = 1;\n```\n\nAfter code.',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toContain('Before code')
      expect(result.text).toContain('After code')
      expect(result.text).not.toContain('const x = 1')
    })

    it('skips LaTeX blocks', () => {
      const record = {
        content: 'Math equation:\n\n$$\nE = mc^2\n$$\n\nEnd of math.',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toContain('Math equation')
      expect(result.text).toContain('End of math')
      expect(result.text).not.toContain('E = mc^2')
    })

    it('removes inline formatting', () => {
      const record = {
        content: 'This has *italic*, **bold**, `code`, and ~~strikethrough~~.',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toBe('This has italic, bold, code, and strikethrough.')
    })

    it('converts images to alt text', () => {
      const record = {
        content: 'Check out this image:\n\n![A beautiful sunset](https://example.com/sunset.jpg)',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toContain('[Image: A beautiful sunset]')
      expect(result.text).not.toContain('https://example.com')
    })

    it('removes links but keeps text', () => {
      const record = {
        content: 'Visit [our website](https://example.com) for more.',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toBe('Visit our website for more.')
    })

    it('removes list markers', () => {
      const record = {
        content: '- Item one\n- Item two\n* Item three\n1. First\n2. Second',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toContain('Item one')
      expect(result.text).toContain('First')
      expect(result.text).not.toContain('-')
      expect(result.text).not.toContain('*')
      expect(result.text).not.toContain('1.')
    })

    it('removes blockquote markers', () => {
      const record = {
        content: '> This is a quote\n> with multiple lines',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.text).toContain('This is a quote')
      expect(result.text).not.toContain('>')
    })

    it('counts words correctly', () => {
      const record = {
        content: 'One two three four five.',
      }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.wordCount).toBe(5)
    })

    it('handles empty content', () => {
      const record = { content: '' }
      const result = extractContent(record, 'app.greengale.document')

      expect(result.success).toBe(false)
      expect(result.text).toBe('')
      expect(result.wordCount).toBe(0)
    })
  })

  describe('site.standard.document extraction', () => {
    it('prefers textContent when available', () => {
      const record = {
        textContent: 'This is the plaintext content.',
        content: {
          $type: 'pub.leaflet.content',
          pages: [{ blocks: [{ $type: 'pub.leaflet.blocks.text', plaintext: 'Different content' }] }],
        },
      }
      const result = extractContent(record, 'site.standard.document')

      expect(result.success).toBe(true)
      expect(result.format).toBe('textContent')
      expect(result.text).toBe('This is the plaintext content.')
    })

    it('extracts from Leaflet blocks when no textContent', () => {
      const record = {
        content: {
          $type: 'pub.leaflet.content',
          pages: [{
            blocks: [
              { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'First paragraph' } },
              { block: { $type: 'pub.leaflet.blocks.header', plaintext: 'A Heading', level: 2 } },
              { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Second paragraph' } },
            ],
          }],
        },
      }
      const result = extractContent(record, 'site.standard.document')

      expect(result.success).toBe(true)
      expect(result.format).toBe('leaflet')
      expect(result.text).toContain('First paragraph')
      expect(result.text).toContain('A Heading')
      expect(result.text).toContain('Second paragraph')
      expect(result.headings).toHaveLength(1)
      expect(result.headings[0]).toEqual({ text: 'A Heading', level: 2 })
    })

    it('handles Leaflet image blocks with alt text', () => {
      const record = {
        content: {
          $type: 'pub.leaflet.content',
          pages: [{
            blocks: [
              { block: { $type: 'pub.leaflet.blocks.image', alt: 'A diagram' } },
            ],
          }],
        },
      }
      const result = extractContent(record, 'site.standard.document')

      expect(result.text).toContain('[Image: A diagram]')
    })

    it('handles Leaflet quote blocks', () => {
      const record = {
        content: {
          $type: 'pub.leaflet.content',
          pages: [{
            blocks: [
              { block: { $type: 'pub.leaflet.blocks.quote', plaintext: 'Wise words here' } },
            ],
          }],
        },
      }
      const result = extractContent(record, 'site.standard.document')

      expect(result.text).toContain('Wise words here')
    })

    it('returns failure for GreenGale content refs', () => {
      const record = {
        content: {
          $type: 'app.greengale.document#contentRef',
          uri: 'at://did:plc:example/app.greengale.document/abc123',
        },
      }
      const result = extractContent(record, 'site.standard.document')

      expect(result.success).toBe(false)
    })

    it('attempts generic extraction for unknown content types', () => {
      const record = {
        content: {
          $type: 'unknown.format',
          body: 'Some body text here.',
        },
      }
      const result = extractContent(record, 'site.standard.document')

      expect(result.success).toBe(true)
      expect(result.text).toBe('Some body text here.')
    })
  })

  describe('unknown collections', () => {
    it('returns failure for unknown collections', () => {
      const record = { content: 'Some content' }
      const result = extractContent(record, 'unknown.collection')

      expect(result.success).toBe(false)
      expect(result.format).toBe('unknown')
    })
  })
})

describe('hashContent', () => {
  it('produces consistent hashes', async () => {
    const text = 'Hello, world!'
    const hash1 = await hashContent(text)
    const hash2 = await hashContent(text)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces different hashes for different content', async () => {
    const hash1 = await hashContent('First text')
    const hash2 = await hashContent('Second text')

    expect(hash1).not.toBe(hash2)
  })

  it('handles empty string', async () => {
    const hash = await hashContent('')

    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('handles unicode content', async () => {
    const hash = await hashContent('こんにちは 世界 🌍')

    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('chunkByHeadings', () => {
  it('returns single chunk for short content', () => {
    const extracted = {
      text: 'A short post with just a few words.',
      headings: [],
      wordCount: 8,
      format: 'markdown' as const,
      success: true,
    }

    const chunks = chunkByHeadings(extracted, 'Title')

    expect(chunks).toHaveLength(1)
    expect(chunks[0].chunkIndex).toBe(0)
    expect(chunks[0].totalChunks).toBe(1)
    expect(chunks[0].text).toContain('Title')
    expect(chunks[0].text).toContain('A short post')
  })

  it('includes title and subtitle in first chunk', () => {
    const extracted = {
      text: 'Content here.',
      headings: [],
      wordCount: 2,
      format: 'markdown' as const,
      success: true,
    }

    const chunks = chunkByHeadings(extracted, 'Main Title', 'A subtitle')

    expect(chunks[0].text).toContain('Main Title')
    expect(chunks[0].text).toContain('A subtitle')
    expect(chunks[0].text).toContain('Content here')
  })

  it('splits long content by headings', () => {
    // Create content that exceeds maxTokens
    const longParagraph = 'Word '.repeat(300) // ~300 words
    const extracted = {
      text: `First Section\n${longParagraph}\nSecond Section\n${longParagraph}`,
      headings: [
        { text: 'First Section', level: 2 },
        { text: 'Second Section', level: 2 },
      ],
      wordCount: 602,
      format: 'markdown' as const,
      success: true,
    }

    const chunks = chunkByHeadings(extracted, undefined, undefined, {
      maxTokens: 400,
      minTokens: 50,
    })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.totalChunks).toBe(chunks.length)
    }
  })

  it('preserves chunk indices correctly', () => {
    const longParagraph = 'Word '.repeat(400)
    const extracted = {
      text: `Intro\n${longParagraph}\nSection One\n${longParagraph}\nSection Two\n${longParagraph}`,
      headings: [
        { text: 'Section One', level: 2 },
        { text: 'Section Two', level: 2 },
      ],
      wordCount: 1206,
      format: 'markdown' as const,
      success: true,
    }

    const chunks = chunkByHeadings(extracted, undefined, undefined, {
      maxTokens: 600,
      minTokens: 100,
    })

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i)
    }
  })
})

describe('estimateTokens', () => {
  it('estimates tokens roughly as length/4', () => {
    const text = 'Hello world this is a test' // 26 chars
    const tokens = estimateTokens(text)

    expect(tokens).toBe(7) // ceil(26/4) = 7
  })

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('handles long text', () => {
    const longText = 'a'.repeat(1000)
    const tokens = estimateTokens(longText)

    expect(tokens).toBe(250) // 1000/4 = 250
  })
})
