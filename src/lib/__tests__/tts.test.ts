import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initialTTSState,
  extractTextForTTS,
  extractTextForTTSAsync,
  splitIntoSentences,
  float32ToWavBlob,
  detectCapabilities,
  DEFAULT_VOICE,
  SAMPLE_RATE,
  MODEL_ID,
  PLAYBACK_RATES,
  type TTSState,
  type TTSStatus,
} from '../tts'

// Mock the image-labels module
vi.mock('../image-labels', () => ({
  extractCidFromBlobUrl: vi.fn((url: string) => {
    // Extract CID from blob URLs like "at://did:plc:xxx/blob/cid123"
    const match = url.match(/\/blob\/([^/]+)/)
    return match ? match[1] : null
  }),
  getBlobAltMap: vi.fn((blobs: Array<{ cid: string; alt?: string }>) => {
    const map = new Map<string, string>()
    if (blobs) {
      for (const blob of blobs) {
        if (blob.alt) {
          map.set(blob.cid, blob.alt)
        }
      }
    }
    return map
  }),
}))

// Mock the bluesky module
vi.mock('../bluesky', () => ({
  getBlueskyPost: vi.fn(),
  getBlueskyInteractions: vi.fn(),
}))

import { getBlueskyPost, getBlueskyInteractions } from '../bluesky'

describe('TTS Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Constants', () => {
    it('has correct default voice', () => {
      expect(DEFAULT_VOICE).toBe('af_heart')
    })

    it('has correct sample rate', () => {
      expect(SAMPLE_RATE).toBe(24000)
    })

    it('has correct model ID', () => {
      expect(MODEL_ID).toBe('onnx-community/Kokoro-82M-v1.0-ONNX')
    })

    it('has correct playback rates', () => {
      expect(PLAYBACK_RATES).toEqual([0.5, 0.75, 1.0, 1.25, 1.5, 2.0])
    })
  })

  describe('initialTTSState', () => {
    it('has correct initial values', () => {
      const expected: TTSState = {
        status: 'idle',
        modelProgress: 0,
        generationProgress: 0,
        currentSentence: null,
        sentenceIndex: 0,
        totalSentences: 0,
        error: null,
        isModelCached: false,
      }
      expect(initialTTSState).toEqual(expected)
    })

    it('has idle status', () => {
      expect(initialTTSState.status).toBe('idle')
    })
  })

  describe('extractTextForTTS', () => {
    describe('Code Block Removal', () => {
      it('removes fenced code blocks with language', () => {
        const markdown = 'Before\n```javascript\nconst x = 1;\n```\nAfter'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Before\n\nAfter')
        expect(result).not.toContain('const x')
        expect(result).not.toContain('javascript')
      })

      it('removes fenced code blocks without language', () => {
        const markdown = 'Before\n```\ncode here\n```\nAfter'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Before\n\nAfter')
        expect(result).not.toContain('code here')
      })

      it('removes inline code', () => {
        const markdown = 'Use the `console.log` function to debug.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Use the function to debug.')
        expect(result).not.toContain('console.log')
      })

      it('removes multiline code blocks', () => {
        const markdown = `Here's some code:
\`\`\`python
def hello():
    print("world")
\`\`\`
That's it.`
        const result = extractTextForTTS(markdown)
        expect(result).toContain("Here's some code:")
        expect(result).toContain("That's it.")
        expect(result).not.toContain('def hello')
        expect(result).not.toContain('python')
      })
    })

    describe('Image Handling', () => {
      it('converts images with markdown alt text to spoken description', () => {
        const markdown = 'Look at this: ![A beautiful sunset](https://example.com/sunset.jpg)'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Image: A beautiful sunset.')
        expect(result).not.toContain('https://')
      })

      it('uses blob alt text over markdown alt when available', () => {
        const markdown = 'Image: ![Markdown alt](at://did:plc:xxx/blob/cid123)'
        const blobs = [{ cid: 'cid123', alt: 'Blob alt text description' }]
        const result = extractTextForTTS(markdown, blobs)
        expect(result).toContain('Image: Blob alt text description.')
        expect(result).not.toContain('Markdown alt')
      })

      it('falls back to markdown alt when blob has no alt', () => {
        const markdown = '![Fallback description](at://did:plc:xxx/blob/cid456)'
        const blobs = [{ cid: 'cid456' }] // No alt text
        const result = extractTextForTTS(markdown, blobs)
        expect(result).toContain('Image: Fallback description.')
      })

      it('uses generic description for images without alt', () => {
        const markdown = '![](https://example.com/image.png)'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Image without description.')
      })

      it('handles multiple images', () => {
        const markdown = '![First](url1) and ![Second](url2)'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Image: First.')
        expect(result).toContain('Image: Second.')
      })
    })

    describe('Link Handling', () => {
      it('converts links to just text', () => {
        const markdown = 'Visit [Google](https://google.com) for more info.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Visit Google for more info.')
        expect(result).not.toContain('https://')
      })

      it('handles multiple links', () => {
        const markdown = '[Link 1](url1) and [Link 2](url2)'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Link 1 and Link 2')
      })
    })

    describe('Heading Removal', () => {
      it('removes h1 markers', () => {
        const markdown = '# Main Title\nContent here.'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Main Title')
        expect(result).not.toContain('#')
      })

      it('removes h2-h6 markers', () => {
        const markdown = '## H2\n### H3\n#### H4\n##### H5\n###### H6'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('H2')
        expect(result).toContain('H6')
        expect(result).not.toContain('#')
      })
    })

    describe('Text Formatting Removal', () => {
      it('removes bold markers (asterisks)', () => {
        const markdown = 'This is **bold** text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is bold text.')
      })

      it('removes bold markers (underscores)', () => {
        const markdown = 'This is __bold__ text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is bold text.')
      })

      it('removes italic markers (asterisks)', () => {
        const markdown = 'This is *italic* text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is italic text.')
      })

      it('removes italic markers (underscores)', () => {
        const markdown = 'This is _italic_ text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is italic text.')
      })

      it('removes bold-italic markers (asterisks)', () => {
        const markdown = 'This is ***bold-italic*** text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is bold-italic text.')
      })

      it('removes bold-italic markers (underscores)', () => {
        const markdown = 'This is ___bold-italic___ text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is bold-italic text.')
      })

      it('removes strikethrough markers', () => {
        const markdown = 'This is ~~deleted~~ text.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('This is deleted text.')
      })
    })

    describe('Blockquote Handling', () => {
      it('removes blockquote markers', () => {
        const markdown = '> This is a quote.\n> Another line.'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('This is a quote.')
        expect(result).toContain('Another line.')
        expect(result).not.toContain('>')
      })
    })

    describe('Horizontal Rule Removal', () => {
      it('removes dashes horizontal rule', () => {
        const markdown = 'Before\n---\nAfter'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Before')
        expect(result).toContain('After')
        expect(result).not.toContain('---')
      })

      it('removes asterisks horizontal rule', () => {
        const markdown = 'Before\n***\nAfter'
        const result = extractTextForTTS(markdown)
        expect(result).not.toContain('***')
      })

      it('removes underscores horizontal rule', () => {
        const markdown = 'Before\n___\nAfter'
        const result = extractTextForTTS(markdown)
        expect(result).not.toContain('___')
      })
    })

    describe('List Item Handling', () => {
      it('converts unordered list items to sentences with periods', () => {
        const markdown = '- First item\n- Second item'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('First item.')
        expect(result).toContain('Second item.')
      })

      it('preserves existing punctuation on list items', () => {
        const markdown = '- Already has period.\n- Has question mark?'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Already has period.')
        expect(result).toContain('Has question mark?')
        // Should not add extra periods
        expect(result).not.toContain('..')
      })

      it('converts ordered list items to sentences', () => {
        const markdown = '1. First step\n2. Second step'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('First step.')
        expect(result).toContain('Second step.')
      })

      it('handles asterisk list markers', () => {
        // Note: asterisks are processed by bold/italic removal first,
        // so '* Item' becomes ' Item' (asterisk removed as partial italic marker)
        // This is a known limitation - dash markers are preferred
        const markdown = '* Item one\n* Item two'
        const result = extractTextForTTS(markdown)
        // The asterisks get stripped, content remains
        expect(result).toContain('Item one')
        expect(result).toContain('Item two')
      })

      it('handles plus list markers', () => {
        const markdown = '+ Item A\n+ Item B'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('Item A.')
        expect(result).toContain('Item B.')
      })
    })

    describe('HTML Tag Removal', () => {
      it('removes simple HTML tags', () => {
        const markdown = '<div>Content</div>'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Content')
        expect(result).not.toContain('<')
        expect(result).not.toContain('>')
      })

      it('removes self-closing tags', () => {
        const markdown = 'Before<br/>After'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('BeforeAfter')
      })
    })

    describe('LaTeX Removal', () => {
      it('removes block LaTeX', () => {
        const markdown = 'Formula: $$E = mc^2$$ is famous.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Formula: is famous.')
        expect(result).not.toContain('$$')
        expect(result).not.toContain('mc^2')
      })

      it('removes inline LaTeX', () => {
        const markdown = 'The value $x = 5$ is correct.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('The value is correct.')
        expect(result).not.toContain('$')
      })

      it('removes multiline block LaTeX', () => {
        const markdown = 'Equation:\n$$\n\\frac{a}{b}\n$$\nEnd.'
        const result = extractTextForTTS(markdown)
        expect(result).not.toContain('\\frac')
      })
    })

    describe('Parentheses to Commas Conversion', () => {
      it('converts parentheses to commas for natural pauses', () => {
        const markdown = 'The cat (a tabby) sat on the mat.'
        const result = extractTextForTTS(markdown)
        expect(result).toContain('The cat')
        expect(result).toContain('a tabby')
        expect(result).not.toContain('(')
        expect(result).not.toContain(')')
      })

      it('cleans up double commas', () => {
        const markdown = 'Text (note) here.'
        const result = extractTextForTTS(markdown)
        expect(result).not.toContain(',,')
      })

      it('removes comma before sentence-ending punctuation', () => {
        const markdown = 'This is true (really).'
        const result = extractTextForTTS(markdown)
        expect(result).not.toContain(',.')
      })
    })

    describe('Whitespace Normalization', () => {
      it('normalizes multiple spaces', () => {
        const markdown = 'Too    many    spaces.'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Too many spaces.')
      })

      it('normalizes multiple newlines to double', () => {
        const markdown = 'Para 1\n\n\n\n\nPara 2'
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Para 1\n\nPara 2')
      })

      it('trims leading and trailing whitespace', () => {
        const markdown = '  Content  '
        const result = extractTextForTTS(markdown)
        expect(result).toBe('Content')
      })
    })

    describe('Complex Documents', () => {
      it('handles a realistic markdown document', () => {
        const markdown = `# Welcome

This is a **blog post** about _programming_.

Here's some code:

\`\`\`javascript
const greeting = "Hello";
\`\`\`

## Key Points

- First point
- Second point with [a link](https://example.com)

![Diagram](https://example.com/diagram.png)

> A wise quote

The formula $$E = mc^2$$ is famous.

Visit [our site](https://example.com) for more.`

        const result = extractTextForTTS(markdown)

        // Should contain readable text
        expect(result).toContain('Welcome')
        expect(result).toContain('blog post')
        expect(result).toContain('programming')
        expect(result).toContain('Key Points')
        expect(result).toContain('First point.')
        expect(result).toContain('our site')
        expect(result).toContain('A wise quote')

        // Should NOT contain code, markdown syntax, or URLs
        expect(result).not.toContain('const greeting')
        expect(result).not.toContain('**')
        expect(result).not.toContain('_')
        expect(result).not.toContain('```')
        expect(result).not.toContain('https://')
        expect(result).not.toContain('$$')
        expect(result).not.toContain('##')
        expect(result).not.toContain('>')
      })
    })
  })

  describe('extractTextForTTSAsync', () => {
    beforeEach(() => {
      vi.mocked(getBlueskyPost).mockReset()
      vi.mocked(getBlueskyInteractions).mockReset()
    })

    it('returns same result as sync version for markdown without Bluesky links', async () => {
      const markdown = '# Hello\n\nThis is **bold** text.'
      const asyncResult = await extractTextForTTSAsync(markdown)
      const syncResult = extractTextForTTS(markdown)
      expect(asyncResult).toBe(syncResult)
    })

    it('replaces Bluesky post URLs with speakable content', async () => {
      vi.mocked(getBlueskyPost).mockResolvedValueOnce({
        uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
        cid: 'cid123',
        author: {
          did: 'did:plc:abc',
          handle: 'alice.bsky.social',
          displayName: 'Alice',
        },
        text: 'This is my post content!',
        createdAt: '2024-01-01T00:00:00.000Z',
      })

      const markdown = 'Check out this post: https://bsky.app/profile/alice.bsky.social/post/xyz'
      const result = await extractTextForTTSAsync(markdown)

      expect(result).toContain('Bluesky post by Alice')
      expect(result).toContain('This is my post content!')
      expect(result).not.toContain('https://bsky.app')
    })

    it('uses handle when displayName is not available', async () => {
      vi.mocked(getBlueskyPost).mockResolvedValueOnce({
        uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
        cid: 'cid123',
        author: {
          did: 'did:plc:abc',
          handle: 'bob.bsky.social',
          displayName: '',
        },
        text: 'Post without display name',
        createdAt: '2024-01-01T00:00:00.000Z',
      })

      const markdown = 'See: https://bsky.app/profile/bob.bsky.social/post/abc123'
      const result = await extractTextForTTSAsync(markdown)

      expect(result).toContain('Bluesky post by bob.bsky.social')
    })

    it('includes image alt text from Bluesky posts', async () => {
      vi.mocked(getBlueskyPost).mockResolvedValueOnce({
        uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
        cid: 'cid123',
        author: {
          did: 'did:plc:abc',
          handle: 'carol.bsky.social',
          displayName: 'Carol',
        },
        text: 'Check out this photo!',
        createdAt: '2024-01-01T00:00:00.000Z',
        images: [
          { thumb: 'url1', fullsize: 'url1', alt: 'A sunset over the mountains' },
          { thumb: 'url2', fullsize: 'url2', alt: '' }, // Empty alt should be skipped
        ],
      })

      const markdown = 'Post: https://bsky.app/profile/carol.bsky.social/post/photo1'
      const result = await extractTextForTTSAsync(markdown)

      expect(result).toContain('Image: A sunset over the mountains.')
      expect(result).not.toContain('url1')
    })

    it('handles failed Bluesky post fetch gracefully', async () => {
      vi.mocked(getBlueskyPost).mockRejectedValueOnce(new Error('Network error'))

      const markdown = 'See this: https://bsky.app/profile/user.bsky.social/post/failed123'
      const result = await extractTextForTTSAsync(markdown)

      expect(result).toContain('Embedded Bluesky post.')
      expect(result).not.toContain('https://bsky.app')
    })

    it('handles multiple Bluesky URLs', async () => {
      vi.mocked(getBlueskyPost)
        .mockResolvedValueOnce({
          uri: 'at://did:plc:1/app.bsky.feed.post/1',
          cid: 'cid1',
          author: { did: 'did:plc:1', handle: 'user1.bsky.social', displayName: 'User One' },
          text: 'First post',
          createdAt: '2024-01-01T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          uri: 'at://did:plc:2/app.bsky.feed.post/2',
          cid: 'cid2',
          author: { did: 'did:plc:2', handle: 'user2.bsky.social', displayName: 'User Two' },
          text: 'Second post',
          createdAt: '2024-01-01T00:00:00.000Z',
        })

      const markdown = `Two posts:
https://bsky.app/profile/user1.bsky.social/post/abc
https://bsky.app/profile/user2.bsky.social/post/def`

      const result = await extractTextForTTSAsync(markdown)

      expect(result).toContain('User One')
      expect(result).toContain('First post')
      expect(result).toContain('User Two')
      expect(result).toContain('Second post')
    })

    it('fetches and appends discussions when postUrl is provided', async () => {
      vi.mocked(getBlueskyInteractions).mockResolvedValueOnce({
        likes: 10,
        reposts: 5,
        quotes: 2,
        posts: [
          {
            uri: 'at://did:plc:1/app.bsky.feed.post/1',
            cid: 'cid1',
            author: { did: 'did:plc:1', handle: 'commenter.bsky.social', displayName: 'Commenter' },
            text: 'Great article! https://example.com',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      })

      const markdown = 'My blog post content.'
      const result = await extractTextForTTSAsync(markdown, undefined, 'https://greengale.app/author/post')

      expect(result).toContain('Discussions from the network.')
      expect(result).toContain('Post by Commenter')
      expect(result).toContain('Great article!')
      // URLs should be stripped from discussion content
      expect(result).not.toContain('https://example.com')
    })

    it('includes replies in discussions', async () => {
      vi.mocked(getBlueskyInteractions).mockResolvedValueOnce({
        likes: 0,
        reposts: 0,
        quotes: 0,
        posts: [
          {
            uri: 'at://did:plc:1/app.bsky.feed.post/1',
            cid: 'cid1',
            author: { did: 'did:plc:1', handle: 'poster.bsky.social', displayName: 'Poster' },
            text: 'Original comment',
            createdAt: '2024-01-01T00:00:00.000Z',
            replies: [
              {
                uri: 'at://did:plc:2/app.bsky.feed.post/2',
                cid: 'cid2',
                author: { did: 'did:plc:2', handle: 'replier.bsky.social', displayName: 'Replier' },
                text: 'Reply to the comment',
                createdAt: '2024-01-01T00:00:00.000Z',
              },
            ],
          },
        ],
      })

      const result = await extractTextForTTSAsync('Content', undefined, 'https://greengale.app/post')

      expect(result).toContain('Post by Poster')
      expect(result).toContain('Original comment')
      expect(result).toContain('Reply by Replier')
      expect(result).toContain('Reply to the comment')
    })

    it('handles failed discussions fetch gracefully', async () => {
      vi.mocked(getBlueskyInteractions).mockRejectedValueOnce(new Error('Network error'))

      const markdown = 'Blog content.'
      const result = await extractTextForTTSAsync(markdown, undefined, 'https://greengale.app/post')

      // Should still return the main content
      expect(result).toContain('Blog content.')
      // Should not include discussions section
      expect(result).not.toContain('Discussions from the network')
    })

    it('does not fetch discussions when no postUrl provided', async () => {
      const markdown = 'Just content.'
      await extractTextForTTSAsync(markdown)

      expect(getBlueskyInteractions).not.toHaveBeenCalled()
    })
  })

  describe('splitIntoSentences', () => {
    it('splits text on sentence-ending punctuation', () => {
      const text = 'First sentence. Second sentence. Third sentence.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['First sentence.', 'Second sentence.', 'Third sentence.'])
    })

    it('handles question marks', () => {
      const text = 'Is this a question? Yes it is.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Is this a question?', 'Yes it is.'])
    })

    it('handles exclamation marks', () => {
      const text = 'Wow! Amazing! Great job.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Wow!', 'Amazing!', 'Great job.'])
    })

    it('handles mixed punctuation', () => {
      const text = 'Statement. Question? Exclamation!'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Statement.', 'Question?', 'Exclamation!'])
    })

    it('splits on newlines (paragraph breaks)', () => {
      const text = 'First paragraph.\n\nSecond paragraph.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['First paragraph.', 'Second paragraph.'])
    })

    it('handles lines ending with colon as separate sentences', () => {
      const text = "Here's what happens:\nFirst step. Second step."
      const result = splitIntoSentences(text)
      expect(result).toEqual(["Here's what happens:", 'First step.', 'Second step.'])
    })

    it('handles lines without ending punctuation', () => {
      const text = 'Line without period\nAnother line'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Line without period', 'Another line'])
    })

    it('filters out empty lines', () => {
      const text = 'First.\n\n\n\nSecond.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['First.', 'Second.'])
    })

    it('normalizes whitespace within sentences', () => {
      const text = 'Too   many    spaces   here.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Too many spaces here.'])
    })

    it('trims sentences', () => {
      const text = '  Leading spaces.   Trailing spaces.  '
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Leading spaces.', 'Trailing spaces.'])
    })

    it('handles single sentence', () => {
      const text = 'Just one sentence.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Just one sentence.'])
    })

    it('handles text without punctuation', () => {
      const text = 'No punctuation at all'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['No punctuation at all'])
    })

    it('returns normalized input for empty-ish text', () => {
      const text = '   '
      const result = splitIntoSentences(text)
      expect(result).toEqual([''])
    })

    it('handles list items as separate sentences', () => {
      const text = 'Introduction.\nFirst item.\nSecond item.\nConclusion.'
      const result = splitIntoSentences(text)
      expect(result).toEqual(['Introduction.', 'First item.', 'Second item.', 'Conclusion.'])
    })
  })

  describe('float32ToWavBlob', () => {
    it('creates a Blob with audio/wav type', () => {
      const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
      const blob = float32ToWavBlob(samples)

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('audio/wav')
    })

    it('creates correct size WAV file', () => {
      const samples = new Float32Array(100)
      const blob = float32ToWavBlob(samples)

      // WAV header is 44 bytes, each sample is 2 bytes (int16)
      const expectedSize = 44 + 100 * 2
      expect(blob.size).toBe(expectedSize)
    })

    it('uses default sample rate when not specified', () => {
      const samples = new Float32Array([0])
      const blob = float32ToWavBlob(samples)

      // Just verify it doesn't throw and creates a valid blob
      expect(blob.size).toBeGreaterThan(44)
    })

    it('accepts custom sample rate', () => {
      const samples = new Float32Array([0])
      const blob = float32ToWavBlob(samples, 44100)

      expect(blob).toBeInstanceOf(Blob)
    })

    it('handles empty samples array', () => {
      const samples = new Float32Array(0)
      const blob = float32ToWavBlob(samples)

      // Should just have header
      expect(blob.size).toBe(44)
    })

    it('clamps samples to valid range', async () => {
      // Samples outside [-1, 1] should be clamped
      const samples = new Float32Array([2, -2, 1.5, -1.5])
      const blob = float32ToWavBlob(samples)

      // Should not throw, blob should be created
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.size).toBe(44 + 4 * 2)
    })

    it('produces valid WAV header', async () => {
      const samples = new Float32Array([0])
      const blob = float32ToWavBlob(samples, 24000)
      const buffer = await blob.arrayBuffer()
      const view = new DataView(buffer)

      // Check RIFF header
      expect(String.fromCharCode(view.getUint8(0))).toBe('R')
      expect(String.fromCharCode(view.getUint8(1))).toBe('I')
      expect(String.fromCharCode(view.getUint8(2))).toBe('F')
      expect(String.fromCharCode(view.getUint8(3))).toBe('F')

      // Check WAVE format
      expect(String.fromCharCode(view.getUint8(8))).toBe('W')
      expect(String.fromCharCode(view.getUint8(9))).toBe('A')
      expect(String.fromCharCode(view.getUint8(10))).toBe('V')
      expect(String.fromCharCode(view.getUint8(11))).toBe('E')

      // Check fmt chunk
      expect(String.fromCharCode(view.getUint8(12))).toBe('f')
      expect(String.fromCharCode(view.getUint8(13))).toBe('m')
      expect(String.fromCharCode(view.getUint8(14))).toBe('t')
      expect(String.fromCharCode(view.getUint8(15))).toBe(' ')

      // Check audio format (1 = PCM)
      expect(view.getUint16(20, true)).toBe(1)

      // Check number of channels (1 = mono)
      expect(view.getUint16(22, true)).toBe(1)

      // Check sample rate
      expect(view.getUint32(24, true)).toBe(24000)

      // Check bits per sample
      expect(view.getUint16(34, true)).toBe(16)

      // Check data chunk
      expect(String.fromCharCode(view.getUint8(36))).toBe('d')
      expect(String.fromCharCode(view.getUint8(37))).toBe('a')
      expect(String.fromCharCode(view.getUint8(38))).toBe('t')
      expect(String.fromCharCode(view.getUint8(39))).toBe('a')
    })
  })

  describe('detectCapabilities', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('detects WASM support', async () => {
      vi.stubGlobal('navigator', { platform: 'Linux', userAgent: 'Mozilla/5.0 Linux Chrome' })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.wasm).toBe(true)
    })

    it('detects AudioContext support', async () => {
      vi.stubGlobal('navigator', { platform: 'Linux', userAgent: 'Mozilla/5.0 Linux Chrome' })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.audioContext).toBe(true)
    })

    it('detects webkit AudioContext on Safari', async () => {
      vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Safari' })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', undefined)
      vi.stubGlobal('window', { webkitAudioContext: class {}, indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.audioContext).toBe(true)
    })

    it('detects IndexedDB support', async () => {
      vi.stubGlobal('navigator', { platform: 'Linux', userAgent: 'Mozilla/5.0 Linux Chrome' })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.indexedDB).toBe(true)
    })

    it('recommends WASM with q8 for non-Mac platforms', async () => {
      vi.stubGlobal('navigator', { platform: 'Linux', userAgent: 'Mozilla/5.0 Linux Chrome' })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.recommended.device).toBe('wasm')
      expect(caps.recommended.dtype).toBe('q8')
      expect(caps.recommended.modelSize).toBe('~92 MB')
    })

    it('respects force-webgpu localStorage setting', async () => {
      const mockDevice = { destroy: vi.fn() }
      const mockAdapter = { requestDevice: vi.fn().mockResolvedValue(mockDevice) }
      const mockGpu = { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) }

      vi.stubGlobal('navigator', {
        platform: 'Linux',
        userAgent: 'Mozilla/5.0 Linux Chrome',
        gpu: mockGpu,
      })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'tts-force-webgpu' ? 'true' : null) })

      const caps = await detectCapabilities()
      expect(caps.webgpu).toBe(true)
      expect(caps.recommended.device).toBe('webgpu')
      expect(caps.recommended.dtype).toBe('fp32')
      expect(caps.recommended.modelSize).toBe('~326 MB')
    })

    it('enables WebGPU by default on Mac', async () => {
      const mockDevice = { destroy: vi.fn() }
      const mockAdapter = { requestDevice: vi.fn().mockResolvedValue(mockDevice) }
      const mockGpu = { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) }

      vi.stubGlobal('navigator', {
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 Mac Chrome',
        gpu: mockGpu,
      })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.webgpu).toBe(true)
      expect(caps.recommended.device).toBe('webgpu')
    })

    it('handles WebGPU detection failure gracefully', async () => {
      const mockGpu = { requestAdapter: vi.fn().mockResolvedValue(null) }

      vi.stubGlobal('navigator', {
        platform: 'Linux',
        userAgent: 'Mozilla/5.0 Linux Chrome',
        gpu: mockGpu,
      })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.webgpu).toBe(false)
      expect(caps.recommended.device).toBe('wasm')
    })

    it('handles WebGPU exception gracefully', async () => {
      const mockGpu = { requestAdapter: vi.fn().mockRejectedValue(new Error('WebGPU error')) }

      vi.stubGlobal('navigator', {
        platform: 'Linux',
        userAgent: 'Mozilla/5.0 Linux Chrome',
        gpu: mockGpu,
      })
      vi.stubGlobal('WebAssembly', {})
      vi.stubGlobal('AudioContext', class {})
      vi.stubGlobal('window', { indexedDB: {} })
      vi.stubGlobal('localStorage', { getItem: () => null })

      const caps = await detectCapabilities()
      expect(caps.webgpu).toBe(false)
    })
  })

  describe('TTSStatus type', () => {
    it('includes all expected statuses', () => {
      // This is a compile-time check - if this code compiles, the types are correct
      const statuses: TTSStatus[] = ['idle', 'loading-model', 'generating', 'playing', 'paused', 'error']
      expect(statuses).toHaveLength(6)
    })
  })
})
