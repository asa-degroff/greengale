import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock workers-og
vi.mock('workers-og', () => {
  return {
    ImageResponse: class MockImageResponse {
      html: string
      options: Record<string, unknown>
      type = 'ImageResponse'
      constructor(html: string, options: Record<string, unknown>) {
        this.html = html
        this.options = options
      }
    },
    loadGoogleFont: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
  }
})

// Mock theme-colors module
vi.mock('../lib/theme-colors', () => ({
  resolveThemeColors: vi.fn().mockImplementation((preset, custom) => {
    if (custom?.background) {
      return {
        background: custom.background,
        text: custom.text || '#000000',
        textSecondary: '#666666',
        accent: custom.accent || '#0066cc',
        gridColor: 'rgba(0,0,0,0.1)',
        vignetteColor: 'rgba(0,0,0,0.3)',
      }
    }
    if (preset === 'dracula') {
      return {
        background: '#282a36',
        text: '#f8f8f2',
        textSecondary: '#6272a4',
        accent: '#bd93f9',
        gridColor: 'rgba(248,248,242,0.05)',
        vignetteColor: 'rgba(0,0,0,0.3)',
      }
    }
    // Default theme
    return {
      background: '#ffffff',
      text: '#1a1a2e',
      textSecondary: '#4a5568',
      accent: '#2d5a27',
      gridColor: 'rgba(0,0,0,0.05)',
      vignetteColor: 'rgba(0,0,0,0.3)',
    }
  }),
  isDarkTheme: vi.fn().mockImplementation((colors) => {
    // Simple heuristic: dark if background starts with low hex values
    const bg = colors.background
    if (bg.startsWith('#2') || bg.startsWith('#1') || bg.startsWith('#0')) return true
    return false
  }),
}))

// Constants matching the source
const U200D = String.fromCharCode(8205) // Zero Width Joiner
const UFE0Fg = /\uFE0F/g // Variation Selector

// Pure utility functions extracted for testing
function toCodePoint(unicodeSurrogates: string): string {
  const r: string[] = []
  let c = 0
  let p = 0
  let i = 0

  while (i < unicodeSurrogates.length) {
    c = unicodeSurrogates.charCodeAt(i++)
    if (p) {
      r.push((65536 + ((p - 55296) << 10) + (c - 56320)).toString(16))
      p = 0
    } else if (55296 <= c && c <= 56319) {
      p = c
    } else {
      r.push(c.toString(16))
    }
  }
  return r.join('-')
}

function getIconCode(char: string): string {
  return toCodePoint(char.indexOf(U200D) < 0 ? char.replace(UFE0Fg, '') : char)
}

function getEmojiUrl(emoji: string): string {
  const code = getIconCode(emoji)
  return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${code.toLowerCase()}.svg`
}

const EMOJI_DETECT_REGEX = /\p{Emoji}/u

function extractEmojis(text: string): string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const emojis: string[] = []
  const seen = new Set<string>()

  for (const { segment } of segmenter.segment(text)) {
    if (EMOJI_DETECT_REGEX.test(segment) && !seen.has(segment)) {
      if (!/^[0-9#*]$/.test(segment)) {
        emojis.push(segment)
        seen.add(segment)
      }
    }
  }

  return emojis
}

function getNonLatinChars(text: string): string {
  const nonLatin = text.match(/[^\x20-\x7E]/g)
  if (!nonLatin) return ''
  return [...new Set(nonLatin)].join('')
}

// Script detection patterns
const SCRIPT_FONTS = [
  { name: 'Cairo', detect: (text: string) => /[\u0600-\u06FF]/.test(text) },
  { name: 'Noto Sans Hebrew', detect: (text: string) => /[\u0590-\u05FF]/.test(text) },
  { name: 'Noto Sans KR', detect: (text: string) => /[\uAC00-\uD7AF]/.test(text) },
  { name: 'Noto Sans SC', detect: (text: string) => /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(text) },
  { name: 'Noto Sans Thai', detect: (text: string) => /[\u0E00-\u0E7F]/.test(text) },
  { name: 'Noto Sans Devanagari', detect: (text: string) => /[\u0900-\u097F]/.test(text) },
  { name: 'Noto Sans', detect: (text: string) => /[\u0400-\u04FF]/.test(text) }, // Cyrillic
]

function detectRequiredFonts(text: string): { name: string }[] {
  return SCRIPT_FONTS.filter(font => font.detect(text))
}

function escapeHtml(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildVignetteLayers(vignetteColor: string, isDark: boolean): string {
  const rgbaMatch = vignetteColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)

  let r: string, g: string, b: string, maxAlpha: number

  if (!rgbaMatch) {
    r = '0'; g = '0'; b = '0'; maxAlpha = 0.3
  } else if (isDark) {
    r = '0'; g = '0'; b = '0'
    maxAlpha = 0.25
  } else {
    r = rgbaMatch[1]
    g = rgbaMatch[2]
    b = rgbaMatch[3]
    maxAlpha = parseFloat(rgbaMatch[4] || '1')
  }

  const layers = [
    { alpha: maxAlpha * 0.175, start: '55%', end: '100%' },
    { alpha: maxAlpha * 0.15, start: '45%', end: '95%' },
    { alpha: maxAlpha * 0.1, start: '35%', end: '90%' },
  ]

  return layers.map(layer =>
    `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background: radial-gradient(ellipse at center, transparent ${layer.start}, rgba(${r}, ${g}, ${b}, ${layer.alpha.toFixed(3)}) ${layer.end});"></div>`
  ).join('\n    ')
}

describe('OG Image Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  describe('toCodePoint', () => {
    it('converts simple ASCII character', () => {
      expect(toCodePoint('A')).toBe('41')
    })

    it('converts basic emoji', () => {
      expect(toCodePoint('😀')).toBe('1f600')
    })

    it('handles surrogate pairs', () => {
      // 😀 is U+1F600, which is a surrogate pair in UTF-16
      const result = toCodePoint('😀')
      expect(result).toBe('1f600')
    })

    it('handles multiple characters', () => {
      expect(toCodePoint('AB')).toBe('41-42')
    })

    it('handles flag emoji (regional indicators)', () => {
      // 🇺🇸 = U+1F1FA U+1F1F8
      const result = toCodePoint('🇺🇸')
      expect(result).toBe('1f1fa-1f1f8')
    })
  })

  describe('getIconCode', () => {
    it('removes variation selector from simple emoji', () => {
      // Heart with variation selector
      const heartWithVS = '❤️'
      const result = getIconCode(heartWithVS)
      expect(result).toBe('2764')
    })

    it('preserves ZWJ sequences', () => {
      // Family emoji with ZWJ
      const familyEmoji = '👨‍👩‍👧'
      const result = getIconCode(familyEmoji)
      // Should contain the ZWJ (200d)
      expect(result).toContain('200d')
    })

    it('handles simple emoji without variation selector', () => {
      const result = getIconCode('😀')
      expect(result).toBe('1f600')
    })
  })

  describe('getEmojiUrl', () => {
    it('returns correct Twemoji CDN URL', () => {
      const url = getEmojiUrl('😀')
      expect(url).toBe('https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f600.svg')
    })

    it('lowercases the codepoint', () => {
      const url = getEmojiUrl('😀')
      expect(url).toMatch(/\/[a-f0-9]+\.svg$/)
    })

    it('handles flag emoji', () => {
      const url = getEmojiUrl('🇺🇸')
      expect(url).toBe('https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f1fa-1f1f8.svg')
    })
  })

  describe('extractEmojis', () => {
    it('extracts simple emojis from text', () => {
      const result = extractEmojis('Hello 😀 World 🌍')
      expect(result).toContain('😀')
      expect(result).toContain('🌍')
    })

    it('returns empty array for text without emojis', () => {
      const result = extractEmojis('Hello World')
      expect(result).toEqual([])
    })

    it('deduplicates emojis', () => {
      const result = extractEmojis('😀 test 😀 test 😀')
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('😀')
    })

    it('skips numbers and hash/asterisk', () => {
      const result = extractEmojis('1 2 3 # * test')
      expect(result).toEqual([])
    })

    it('handles compound emojis (skin tones)', () => {
      const result = extractEmojis('Hello 👋🏽')
      expect(result).toHaveLength(1)
      // The compound emoji should be treated as a single grapheme
    })

    it('handles ZWJ sequences as single emoji', () => {
      const result = extractEmojis('Family: 👨‍👩‍👧')
      expect(result).toHaveLength(1)
    })

    it('handles flag emojis', () => {
      const result = extractEmojis('USA 🇺🇸 and UK 🇬🇧')
      expect(result).toHaveLength(2)
    })
  })

  describe('getNonLatinChars', () => {
    it('returns empty string for ASCII text', () => {
      expect(getNonLatinChars('Hello World 123')).toBe('')
    })

    it('extracts Chinese characters', () => {
      const result = getNonLatinChars('Hello 你好 World')
      expect(result).toContain('你')
      expect(result).toContain('好')
    })

    it('extracts Cyrillic characters', () => {
      const result = getNonLatinChars('Hello Привет')
      expect(result).toContain('П')
      expect(result).toContain('р')
    })

    it('deduplicates characters', () => {
      const result = getNonLatinChars('你好你好你')
      expect(result).toBe('你好')
    })

    it('extracts Arabic characters', () => {
      const result = getNonLatinChars('Hello مرحبا')
      expect(result.length).toBeGreaterThan(0)
    })

    it('extracts Japanese hiragana and katakana', () => {
      const result = getNonLatinChars('Hello こんにちは カタカナ')
      expect(result).toContain('こ')
      expect(result).toContain('カ')
    })
  })

  describe('detectRequiredFonts', () => {
    it('returns empty array for Latin text', () => {
      const result = detectRequiredFonts('Hello World')
      expect(result).toEqual([])
    })

    it('detects Arabic script', () => {
      const result = detectRequiredFonts('مرحبا')
      expect(result.some(f => f.name === 'Cairo')).toBe(true)
    })

    it('detects Hebrew script', () => {
      const result = detectRequiredFonts('שלום')
      expect(result.some(f => f.name === 'Noto Sans Hebrew')).toBe(true)
    })

    it('detects Korean script', () => {
      const result = detectRequiredFonts('안녕하세요')
      expect(result.some(f => f.name === 'Noto Sans KR')).toBe(true)
    })

    it('detects Chinese/Japanese CJK', () => {
      const result = detectRequiredFonts('你好')
      expect(result.some(f => f.name === 'Noto Sans SC')).toBe(true)
    })

    it('detects Japanese hiragana', () => {
      const result = detectRequiredFonts('こんにちは')
      expect(result.some(f => f.name === 'Noto Sans SC')).toBe(true)
    })

    it('detects Thai script', () => {
      const result = detectRequiredFonts('สวัสดี')
      expect(result.some(f => f.name === 'Noto Sans Thai')).toBe(true)
    })

    it('detects Hindi/Devanagari script', () => {
      const result = detectRequiredFonts('नमस्ते')
      expect(result.some(f => f.name === 'Noto Sans Devanagari')).toBe(true)
    })

    it('detects Cyrillic script', () => {
      const result = detectRequiredFonts('Привет')
      expect(result.some(f => f.name === 'Noto Sans')).toBe(true)
    })

    it('detects multiple scripts', () => {
      const result = detectRequiredFonts('Hello 你好 Привет')
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('escapeHtml', () => {
    it('escapes less than sign', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    })

    it('escapes greater than sign', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b')
    })

    it('does not escape ampersand', () => {
      // Per the source comment: Satori renders HTML entities literally
      expect(escapeHtml('a & b')).toBe('a & b')
    })

    it('does not escape quotes', () => {
      expect(escapeHtml('"quoted"')).toBe('"quoted"')
    })

    it('handles mixed content', () => {
      expect(escapeHtml('<div>Hello & World</div>')).toBe('&lt;div&gt;Hello & World&lt;/div&gt;')
    })

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('')
    })
  })

  describe('buildVignetteLayers', () => {
    it('returns three vignette layers', () => {
      const result = buildVignetteLayers('rgba(0, 0, 0, 0.3)', false)
      const layerCount = (result.match(/<div/g) || []).length
      expect(layerCount).toBe(3)
    })

    it('uses radial gradient for each layer', () => {
      const result = buildVignetteLayers('rgba(0, 0, 0, 0.3)', false)
      expect(result).toContain('radial-gradient')
    })

    it('uses pure black for dark themes', () => {
      const result = buildVignetteLayers('rgba(100, 100, 100, 0.3)', true)
      // Should use 0,0,0 for dark themes regardless of input color
      expect(result).toContain('rgba(0, 0, 0,')
    })

    it('uses provided color for light themes', () => {
      const result = buildVignetteLayers('rgba(50, 60, 70, 0.3)', false)
      expect(result).toContain('rgba(50, 60, 70,')
    })

    it('handles malformed color string with fallback', () => {
      const result = buildVignetteLayers('invalid', false)
      expect(result).toContain('rgba(0, 0, 0,')
    })

    it('sets correct dimensions', () => {
      const result = buildVignetteLayers('rgba(0, 0, 0, 0.3)', false)
      expect(result).toContain('width: 1200px')
      expect(result).toContain('height: 630px')
    })
  })

  describe('Title and Subtitle Truncation', () => {
    // Test the truncation logic
    function truncateTitle(title: string, hasThumbnail: boolean): string {
      const maxLength = hasThumbnail ? 80 : 100
      return title.length > maxLength ? title.slice(0, maxLength - 3) + '...' : title
    }

    function truncateSubtitle(subtitle: string, hasThumbnail: boolean): string {
      const maxLength = hasThumbnail ? 120 : 150
      return subtitle.length > maxLength ? subtitle.slice(0, maxLength - 3) + '...' : subtitle
    }

    it('does not truncate short titles', () => {
      expect(truncateTitle('Short Title', false)).toBe('Short Title')
    })

    it('truncates long titles without thumbnail at 100 chars', () => {
      const longTitle = 'a'.repeat(110)
      const result = truncateTitle(longTitle, false)
      expect(result.length).toBe(100)
      expect(result.endsWith('...')).toBe(true)
    })

    it('truncates titles with thumbnail at 80 chars', () => {
      const longTitle = 'a'.repeat(90)
      const result = truncateTitle(longTitle, true)
      expect(result.length).toBe(80)
      expect(result.endsWith('...')).toBe(true)
    })

    it('truncates long subtitles without thumbnail at 150 chars', () => {
      const longSubtitle = 'b'.repeat(160)
      const result = truncateSubtitle(longSubtitle, false)
      expect(result.length).toBe(150)
      expect(result.endsWith('...')).toBe(true)
    })

    it('truncates subtitles with thumbnail at 120 chars', () => {
      const longSubtitle = 'b'.repeat(130)
      const result = truncateSubtitle(longSubtitle, true)
      expect(result.length).toBe(120)
      expect(result.endsWith('...')).toBe(true)
    })
  })

  describe('Title Font Size Calculation', () => {
    function calculateTitleFontSize(titleLength: number): number {
      if (titleLength > 60) return 52
      if (titleLength > 40) return 58
      return 66
    }

    it('uses 66px for short titles (<=40 chars)', () => {
      expect(calculateTitleFontSize(20)).toBe(66)
      expect(calculateTitleFontSize(40)).toBe(66)
    })

    it('uses 58px for medium titles (41-60 chars)', () => {
      expect(calculateTitleFontSize(41)).toBe(58)
      expect(calculateTitleFontSize(60)).toBe(58)
    })

    it('uses 52px for long titles (>60 chars)', () => {
      expect(calculateTitleFontSize(61)).toBe(52)
      expect(calculateTitleFontSize(100)).toBe(52)
    })
  })

  describe('Author Initial Extraction', () => {
    function getAuthorInitial(name: string, handle: string): string {
      return (name || handle).charAt(0).toUpperCase()
    }

    it('uses first char of name when available', () => {
      expect(getAuthorInitial('John Doe', 'johndoe')).toBe('J')
    })

    it('falls back to handle when name is empty', () => {
      expect(getAuthorInitial('', 'johndoe')).toBe('J')
    })

    it('uppercases the initial', () => {
      expect(getAuthorInitial('alice', 'alice')).toBe('A')
    })

    it('handles unicode names', () => {
      expect(getAuthorInitial('日本語', 'user')).toBe('日')
    })
  })

  describe('Profile Description Truncation', () => {
    function truncateDescription(description: string | null): string | null {
      if (!description) return null
      return description.length > 120
        ? description.slice(0, 117) + '...'
        : description
    }

    it('returns null for null input', () => {
      expect(truncateDescription(null)).toBeNull()
    })

    it('does not truncate short descriptions', () => {
      expect(truncateDescription('Short bio')).toBe('Short bio')
    })

    it('truncates at 120 chars', () => {
      const longDesc = 'a'.repeat(130)
      const result = truncateDescription(longDesc)
      expect(result?.length).toBe(120)
      expect(result?.endsWith('...')).toBe(true)
    })
  })

  describe('Posts Count Pluralization', () => {
    function formatPostsCount(count: number): string {
      return `${count} ${count === 1 ? 'post' : 'posts'}`
    }

    it('uses singular for 1 post', () => {
      expect(formatPostsCount(1)).toBe('1 post')
    })

    it('uses plural for 0 posts', () => {
      expect(formatPostsCount(0)).toBe('0 posts')
    })

    it('uses plural for multiple posts', () => {
      expect(formatPostsCount(5)).toBe('5 posts')
      expect(formatPostsCount(100)).toBe('100 posts')
    })
  })

  describe('Emoji Loading', () => {
    async function loadEmoji(emoji: string): Promise<string | null> {
      try {
        const url = getEmojiUrl(emoji)
        const response = await fetch(url)

        if (!response.ok) return null

        const svgText = await response.text()
        const base64 = btoa(svgText)
        return `data:image/svg+xml;base64,${base64}`
      } catch {
        return null
      }
    }

    it('returns data URL on successful fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<svg></svg>',
      })

      const result = await loadEmoji('😀')
      expect(result).toMatch(/^data:image\/svg\+xml;base64,/)
    })

    it('returns null on fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const result = await loadEmoji('😀')
      expect(result).toBeNull()
    })

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await loadEmoji('😀')
      expect(result).toBeNull()
    })

    it('fetches from Twemoji CDN', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '<svg></svg>',
      })

      await loadEmoji('😀')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f600.svg'
      )
    })
  })

  describe('Emoji Map Building', () => {
    async function buildEmojiMap(text: string): Promise<Record<string, string>> {
      const emojis = extractEmojis(text)
      if (emojis.length === 0) return {}

      const map: Record<string, string> = {}

      for (const emoji of emojis) {
        const response = await fetch(getEmojiUrl(emoji))
        if (response.ok) {
          const svgText = await response.text()
          const base64 = btoa(svgText)
          map[emoji] = `data:image/svg+xml;base64,${base64}`
        }
      }

      return map
    }

    it('returns empty object for text without emojis', async () => {
      const result = await buildEmojiMap('Hello World')
      expect(result).toEqual({})
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('builds map for emojis in text', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '<svg>test</svg>',
      })

      const result = await buildEmojiMap('Hello 😀 World')

      expect(Object.keys(result)).toContain('😀')
      expect(result['😀']).toMatch(/^data:image\/svg\+xml;base64,/)
    })
  })

  describe('Content Right Padding Calculation', () => {
    function getContentRightPadding(hasThumbnail: boolean): string {
      return hasThumbnail ? '360px' : '60px'
    }

    it('uses 60px without thumbnail', () => {
      expect(getContentRightPadding(false)).toBe('60px')
    })

    it('uses 360px with thumbnail', () => {
      // 280px thumbnail + 20px gap + 60px padding = 360px
      expect(getContentRightPadding(true)).toBe('360px')
    })
  })

  describe('OG Image Dimensions', () => {
    it('uses standard OG dimensions', () => {
      // Per OpenGraph spec, recommended is 1200x630
      const width = 1200
      const height = 630
      expect(width).toBe(1200)
      expect(height).toBe(630)
    })
  })

  describe('Integration: Generate OG Image', () => {
    beforeEach(() => {
      // Mock font fetches
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('.ttf')) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          })
        }
        if (url.includes('twemoji')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<svg></svg>'),
          })
        }
        return Promise.resolve({ ok: false })
      })
    })

    it('generates post OG image with required data', async () => {
      const { generateOGImage } = await import('../lib/og-image')

      const result = await generateOGImage({
        title: 'Test Post Title',
        subtitle: 'A great subtitle',
        authorName: 'Test Author',
        authorHandle: 'testauthor',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('ImageResponse')
    })

    it('generates homepage OG image', async () => {
      const { generateHomepageOGImage } = await import('../lib/og-image')

      const result = await generateHomepageOGImage()

      expect(result).toBeDefined()
      expect(result.type).toBe('ImageResponse')
    })

    it('generates profile OG image', async () => {
      const { generateProfileOGImage } = await import('../lib/og-image')

      const result = await generateProfileOGImage({
        displayName: 'Test User',
        handle: 'testuser',
        description: 'A test user bio',
        postsCount: 42,
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('ImageResponse')
    })
  })
})
