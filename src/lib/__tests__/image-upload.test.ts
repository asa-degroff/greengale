import { describe, it, expect } from 'vitest'
import {
  validateImageFile,
  getBlobUrl,
  generateMarkdownImage,
} from '../image-upload'

// Helper to create a mock File object
function createMockFile(
  name: string,
  size: number,
  type: string
): File {
  const content = new ArrayBuffer(size)
  const blob = new Blob([content], { type })
  return new File([blob], name, { type })
}

describe('Image Upload Utilities', () => {
  describe('validateImageFile', () => {
    describe('supported image types', () => {
      it('accepts JPEG files', () => {
        const file = createMockFile('test.jpg', 1024, 'image/jpeg')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      it('accepts PNG files', () => {
        const file = createMockFile('test.png', 1024, 'image/png')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts GIF files', () => {
        const file = createMockFile('test.gif', 1024, 'image/gif')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts WebP files', () => {
        const file = createMockFile('test.webp', 1024, 'image/webp')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts AVIF files', () => {
        const file = createMockFile('test.avif', 1024, 'image/avif')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts BMP files', () => {
        const file = createMockFile('test.bmp', 1024, 'image/bmp')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts HEIC files', () => {
        const file = createMockFile('test.heic', 1024, 'image/heic')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts HEIF files', () => {
        const file = createMockFile('test.heif', 1024, 'image/heif')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })
    })

    describe('unsupported image types', () => {
      it('rejects SVG files', () => {
        const file = createMockFile('test.svg', 1024, 'image/svg+xml')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Unsupported image type')
        expect(result.error).toContain('image/svg+xml')
      })

      it('rejects TIFF files', () => {
        const file = createMockFile('test.tiff', 1024, 'image/tiff')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Unsupported image type')
      })

      it('rejects PDF files', () => {
        const file = createMockFile('test.pdf', 1024, 'application/pdf')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Unsupported image type')
      })

      it('rejects text files', () => {
        const file = createMockFile('test.txt', 1024, 'text/plain')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Unsupported image type')
      })

      it('rejects files with empty type', () => {
        const file = createMockFile('test', 1024, '')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('unknown')
      })

      it('lists supported formats in error message', () => {
        const file = createMockFile('test.xyz', 1024, 'image/xyz')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('JPEG')
        expect(result.error).toContain('PNG')
        expect(result.error).toContain('GIF')
        expect(result.error).toContain('WebP')
        expect(result.error).toContain('AVIF')
        expect(result.error).toContain('BMP')
        expect(result.error).toContain('HEIC')
      })
    })

    describe('file size limits', () => {
      it('accepts files under 50MB', () => {
        const file = createMockFile('test.jpg', 49 * 1024 * 1024, 'image/jpeg')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts files exactly at 50MB', () => {
        const file = createMockFile('test.jpg', 50 * 1024 * 1024, 'image/jpeg')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('rejects files over 50MB', () => {
        const file = createMockFile('test.jpg', 50 * 1024 * 1024 + 1, 'image/jpeg')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('too large')
        expect(result.error).toContain('50MB')
      })

      it('accepts small files', () => {
        const file = createMockFile('test.jpg', 100, 'image/jpeg')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })

      it('accepts 1 byte file', () => {
        const file = createMockFile('test.jpg', 1, 'image/jpeg')
        const result = validateImageFile(file)
        expect(result.valid).toBe(true)
      })
    })

    describe('edge cases', () => {
      it('validates type before size', () => {
        // Large file with unsupported type should fail on type, not size
        const file = createMockFile('test.xyz', 100 * 1024 * 1024, 'image/xyz')
        const result = validateImageFile(file)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Unsupported image type')
      })
    })
  })

  describe('getBlobUrl', () => {
    it('generates correct blob URL', () => {
      const url = getBlobUrl(
        'https://pds.example.com',
        'did:plc:abc123',
        'bafkreixyz789'
      )
      expect(url).toBe(
        'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc123&cid=bafkreixyz789'
      )
    })

    it('encodes DID with special characters', () => {
      const url = getBlobUrl(
        'https://pds.example.com',
        'did:web:example.com:user',
        'bafkrei123'
      )
      expect(url).toContain('did=did%3Aweb%3Aexample.com%3Auser')
    })

    it('encodes CID properly', () => {
      const url = getBlobUrl(
        'https://pds.example.com',
        'did:plc:abc',
        'bafkrei+test'
      )
      expect(url).toContain('cid=bafkrei%2Btest')
    })

    it('handles trailing slash in PDS endpoint', () => {
      const url = getBlobUrl(
        'https://pds.example.com/',
        'did:plc:abc',
        'bafkrei123'
      )
      // Should work but may have double slash - depends on implementation
      expect(url).toContain('/xrpc/com.atproto.sync.getBlob')
    })

    it('works with localhost PDS', () => {
      const url = getBlobUrl(
        'http://localhost:2583',
        'did:plc:test',
        'bafkreitest'
      )
      expect(url).toBe(
        'http://localhost:2583/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Atest&cid=bafkreitest'
      )
    })
  })

  describe('generateMarkdownImage', () => {
    it('generates basic markdown image syntax', () => {
      const result = generateMarkdownImage('A cat', 'https://example.com/cat.jpg')
      expect(result).toBe('![A cat](https://example.com/cat.jpg)')
    })

    it('handles empty alt text', () => {
      const result = generateMarkdownImage('', 'https://example.com/image.jpg')
      expect(result).toBe('![](https://example.com/image.jpg)')
    })

    it('escapes square brackets in alt text', () => {
      const result = generateMarkdownImage(
        'Image [with] brackets',
        'https://example.com/image.jpg'
      )
      expect(result).toBe('![Image \\[with\\] brackets](https://example.com/image.jpg)')
    })

    it('escapes multiple brackets', () => {
      const result = generateMarkdownImage(
        '[start] middle [end]',
        'https://example.com/image.jpg'
      )
      expect(result).toBe('![\\[start\\] middle \\[end\\]](https://example.com/image.jpg)')
    })

    it('handles special characters in alt text (not brackets)', () => {
      const result = generateMarkdownImage(
        'Image with "quotes" & ampersand',
        'https://example.com/image.jpg'
      )
      expect(result).toBe('![Image with "quotes" & ampersand](https://example.com/image.jpg)')
    })

    it('handles newlines in alt text', () => {
      const result = generateMarkdownImage(
        'Line 1\nLine 2',
        'https://example.com/image.jpg'
      )
      expect(result).toBe('![Line 1\nLine 2](https://example.com/image.jpg)')
    })

    it('handles unicode in alt text', () => {
      const result = generateMarkdownImage(
        '世界 🌍 мир',
        'https://example.com/world.jpg'
      )
      expect(result).toBe('![世界 🌍 мир](https://example.com/world.jpg)')
    })

    it('handles complex blob URLs', () => {
      const url = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc&cid=bafkrei123'
      const result = generateMarkdownImage('Uploaded image', url)
      expect(result).toBe(`![Uploaded image](${url})`)
    })

    it('handles parentheses in URL (edge case)', () => {
      // Note: Markdown may have issues with parens in URLs, but the function doesn't escape them
      const url = 'https://example.com/image(1).jpg'
      const result = generateMarkdownImage('Alt', url)
      expect(result).toBe('![Alt](https://example.com/image(1).jpg)')
    })
  })
})
