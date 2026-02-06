import { describe, it, expect } from 'vitest'
import {
  GREENGALE_CONTENT_MAX_BYTES,
  WHITEWIND_CONTENT_MAX_BYTES,
  PDS_JSON_SAFE_LIMIT,
  CONTENT_PREVIEW_CHARS,
  getUtf8ByteLength,
  formatByteCount,
} from '../content-limits'

describe('content-limits', () => {
  describe('constants', () => {
    it('GREENGALE_CONTENT_MAX_BYTES is 1,000,000', () => {
      expect(GREENGALE_CONTENT_MAX_BYTES).toBe(1_000_000)
    })

    it('WHITEWIND_CONTENT_MAX_BYTES is 100,000', () => {
      expect(WHITEWIND_CONTENT_MAX_BYTES).toBe(100_000)
    })

    it('PDS_JSON_SAFE_LIMIT is under PDS jsonLimit of 150KB', () => {
      expect(PDS_JSON_SAFE_LIMIT).toBe(130_000)
      expect(PDS_JSON_SAFE_LIMIT).toBeLessThan(150 * 1024)
    })

    it('CONTENT_PREVIEW_CHARS is 10,000', () => {
      expect(CONTENT_PREVIEW_CHARS).toBe(10_000)
    })
  })

  describe('getUtf8ByteLength', () => {
    it('counts ASCII characters as 1 byte each', () => {
      expect(getUtf8ByteLength('hello')).toBe(5)
    })

    it('counts empty string as 0 bytes', () => {
      expect(getUtf8ByteLength('')).toBe(0)
    })

    it('counts CJK characters as 3 bytes each', () => {
      expect(getUtf8ByteLength('世界')).toBe(6)
    })

    it('counts emoji as 4 bytes', () => {
      expect(getUtf8ByteLength('😀')).toBe(4)
    })

    it('counts accented characters as 2 bytes each', () => {
      expect(getUtf8ByteLength('é')).toBe(2)
    })

    it('handles mixed ASCII and multi-byte content', () => {
      // "Hello 世界!" = 6 ASCII (1 each) + 2 CJK (3 each) + 1 ASCII = 13 bytes
      expect(getUtf8ByteLength('Hello 世界!')).toBe(13)
    })

    it('handles complex emoji sequences', () => {
      // Family emoji (compound) is multiple code points
      const familyEmoji = '👨‍👩‍👧‍👦'
      expect(getUtf8ByteLength(familyEmoji)).toBeGreaterThan(4)
    })

    it('byte count exceeds character count for multi-byte strings', () => {
      const cjkText = '日本語テスト' // 6 characters, 18 bytes
      expect(getUtf8ByteLength(cjkText)).toBe(18)
      expect(getUtf8ByteLength(cjkText)).toBeGreaterThan(cjkText.length)
    })

    it('byte count equals character count for pure ASCII', () => {
      const ascii = 'Hello, world!'
      expect(getUtf8ByteLength(ascii)).toBe(ascii.length)
    })
  })

  describe('formatByteCount', () => {
    it('formats small numbers', () => {
      expect(formatByteCount(0)).toBe('0')
    })

    it('formats numbers with locale separators', () => {
      // toLocaleString output varies by locale, so just check it returns a string
      const result = formatByteCount(900000)
      expect(typeof result).toBe('string')
      expect(result).toContain('900')
    })
  })
})
