import { describe, it, expect } from 'vitest'
import {
  validateImageFile,
  getBlobUrl,
  generateMarkdownImage,
  isAnimatedImage,
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

// Helper to create a File from binary data
function createFileFromBytes(
  name: string,
  bytes: number[],
  type: string
): File {
  const buffer = new Uint8Array(bytes)
  const blob = new Blob([buffer], { type })
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

  describe('isAnimatedImage', () => {
    describe('GIF animation detection', () => {
      it('detects animated GIF (multiple image descriptors)', async () => {
        // GIF89a header + two image descriptors (0x2C)
        const bytes = [
          // GIF89a signature
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
          // Logical screen descriptor (7 bytes)
          0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
          // First image descriptor
          0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
          // Some data
          0x02, 0x02, 0x44, 0x01, 0x00,
          // Second image descriptor (makes it animated)
          0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
          // Trailer
          0x3b,
        ]
        const file = createFileFromBytes('animated.gif', bytes, 'image/gif')
        expect(await isAnimatedImage(file)).toBe(true)
      })

      it('detects static GIF (single image descriptor)', async () => {
        // GIF89a header + single image descriptor
        const bytes = [
          // GIF89a signature
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
          // Logical screen descriptor
          0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
          // Single image descriptor
          0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
          // Trailer
          0x3b,
        ]
        const file = createFileFromBytes('static.gif', bytes, 'image/gif')
        expect(await isAnimatedImage(file)).toBe(false)
      })

      it('returns false for invalid GIF signature', async () => {
        const bytes = [0x00, 0x00, 0x00, 0x2c, 0x2c] // Not a GIF
        const file = createFileFromBytes('fake.gif', bytes, 'image/gif')
        expect(await isAnimatedImage(file)).toBe(false)
      })
    })

    describe('PNG/APNG animation detection', () => {
      it('detects animated PNG (has acTL chunk)', async () => {
        // PNG signature + acTL chunk
        const bytes = [
          // PNG signature
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          // IHDR chunk (simplified)
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
          // acTL chunk (animation control) - makes it APNG
          0x00, 0x00, 0x00, 0x08, 0x61, 0x63, 0x54, 0x4c,
          0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
        ]
        const file = createFileFromBytes('animated.png', bytes, 'image/png')
        expect(await isAnimatedImage(file)).toBe(true)
      })

      it('detects static PNG (no acTL chunk)', async () => {
        // PNG signature without acTL
        const bytes = [
          // PNG signature
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          // IHDR chunk only
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
        ]
        const file = createFileFromBytes('static.png', bytes, 'image/png')
        expect(await isAnimatedImage(file)).toBe(false)
      })

      it('returns false for invalid PNG signature', async () => {
        const bytes = [0x00, 0x00, 0x00, 0x61, 0x63, 0x54, 0x4c]
        const file = createFileFromBytes('fake.png', bytes, 'image/png')
        expect(await isAnimatedImage(file)).toBe(false)
      })
    })

    describe('WebP animation detection', () => {
      it('detects animated WebP (VP8X with animation flag)', async () => {
        // RIFF....WEBP + VP8X with animation flag
        const bytes = [
          // RIFF header
          0x52, 0x49, 0x46, 0x46,
          0x24, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          // VP8X chunk
          0x56, 0x50, 0x38, 0x58, // VP8X
          0x0a, 0x00, 0x00, 0x00, // chunk size
          0x02, 0x00, 0x00, 0x00, // flags (bit 1 = animation)
          0x00, 0x00, 0x00, // canvas width
          0x00, 0x00, 0x00, // canvas height
        ]
        const file = createFileFromBytes('animated.webp', bytes, 'image/webp')
        expect(await isAnimatedImage(file)).toBe(true)
      })

      it('detects animated WebP (has ANIM chunk)', async () => {
        // RIFF....WEBP + ANIM chunk
        const bytes = [
          // RIFF header
          0x52, 0x49, 0x46, 0x46,
          0x20, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
          // VP8X without animation flag
          0x56, 0x50, 0x38, 0x58,
          0x0a, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, // no animation flag
          0x00, 0x00, 0x00,
          0x00, 0x00, 0x00,
          // ANIM chunk
          0x41, 0x4e, 0x49, 0x4d,
          0x06, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]
        const file = createFileFromBytes('animated.webp', bytes, 'image/webp')
        expect(await isAnimatedImage(file)).toBe(true)
      })

      it('detects static WebP (no animation flag or ANIM chunk)', async () => {
        // RIFF....WEBP + VP8X without animation
        const bytes = [
          // RIFF header
          0x52, 0x49, 0x46, 0x46,
          0x1a, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
          // VP8X chunk without animation flag
          0x56, 0x50, 0x38, 0x58,
          0x0a, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, // flags = 0 (no animation)
          0x00, 0x00, 0x00,
          0x00, 0x00, 0x00,
        ]
        const file = createFileFromBytes('static.webp', bytes, 'image/webp')
        expect(await isAnimatedImage(file)).toBe(false)
      })

      it('returns false for invalid WebP signature', async () => {
        const bytes = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
        const file = createFileFromBytes('fake.webp', bytes, 'image/webp')
        expect(await isAnimatedImage(file)).toBe(false)
      })
    })

    describe('AVIF animation detection', () => {
      it('detects animated AVIF (has avis brand)', async () => {
        // ISOBMFF ftyp box with avis brand
        const bytes = [
          // ftyp box size (20 bytes)
          0x00, 0x00, 0x00, 0x14,
          // ftyp
          0x66, 0x74, 0x79, 0x70,
          // major brand: avif
          0x61, 0x76, 0x69, 0x66,
          // minor version
          0x00, 0x00, 0x00, 0x00,
          // compatible brand: avis (animated)
          0x61, 0x76, 0x69, 0x73,
        ]
        const file = createFileFromBytes('animated.avif', bytes, 'image/avif')
        expect(await isAnimatedImage(file)).toBe(true)
      })

      it('detects static AVIF (no avis brand)', async () => {
        // ISOBMFF ftyp box with avif brand only
        const bytes = [
          // ftyp box size (20 bytes)
          0x00, 0x00, 0x00, 0x14,
          // ftyp
          0x66, 0x74, 0x79, 0x70,
          // major brand: avif
          0x61, 0x76, 0x69, 0x66,
          // minor version
          0x00, 0x00, 0x00, 0x00,
          // compatible brand: mif1 (not animated)
          0x6d, 0x69, 0x66, 0x31,
        ]
        const file = createFileFromBytes('static.avif', bytes, 'image/avif')
        expect(await isAnimatedImage(file)).toBe(false)
      })

      it('returns false for invalid AVIF structure', async () => {
        const bytes = [0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]
        const file = createFileFromBytes('fake.avif', bytes, 'image/avif')
        expect(await isAnimatedImage(file)).toBe(false)
      })
    })

    describe('unsupported types', () => {
      it('returns false for JPEG (never animated)', async () => {
        const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]
        const file = createFileFromBytes('photo.jpg', bytes, 'image/jpeg')
        expect(await isAnimatedImage(file)).toBe(false)
      })

      it('returns false for BMP (never animated)', async () => {
        const bytes = [0x42, 0x4d, 0x00, 0x00, 0x00, 0x00]
        const file = createFileFromBytes('image.bmp', bytes, 'image/bmp')
        expect(await isAnimatedImage(file)).toBe(false)
      })

      it('returns false for unknown type', async () => {
        const bytes = [0x00, 0x00, 0x00, 0x00]
        const file = createFileFromBytes('unknown.xyz', bytes, 'image/xyz')
        expect(await isAnimatedImage(file)).toBe(false)
      })
    })
  })
})
