// OG image generation using workers-og (Satori + resvg-wasm)
import { ImageResponse, loadGoogleFont } from 'workers-og'
import { resolveThemeColors, isDarkTheme, type ThemeColors } from './theme-colors'

export interface OGImageData {
  title: string
  subtitle?: string | null
  authorName: string
  authorHandle: string
  authorAvatar?: string | null
  themePreset?: string | null
  customColors?: { background?: string; text?: string; accent?: string } | null
  /** URL to the first image in the post for OG thumbnail */
  thumbnailUrl?: string | null
  /** Tags/hashtags for the post */
  tags?: string[] | null
}

// Font URLs (TTF format required by Satori)
// Fonts are served from the main site (public/fonts/)
const FONT_BASE_URL = 'https://greengale.app/fonts'
const FONT_REGULAR_URL = `${FONT_BASE_URL}/iAWriterQuattroS-Regular.ttf`
const FONT_BOLD_URL = `${FONT_BASE_URL}/iAWriterQuattroS-Bold.ttf`
const FONT_TITLE_URL = `${FONT_BASE_URL}/IBMPlexSans-Bold.ttf`

// Cache fonts in memory to avoid re-fetching
let fontRegularData: ArrayBuffer | null = null
let fontBoldData: ArrayBuffer | null = null
let fontTitleData: ArrayBuffer | null = null

// Emoji cache to avoid re-fetching
const emojiCache = new Map<string, string>()

// Constants for emoji handling (from official Twemoji)
const U200D = String.fromCharCode(8205) // Zero Width Joiner
const UFE0Fg = /\uFE0F/g // Variation Selector

/**
 * Convert unicode string to codepoint string
 * Handles surrogate pairs correctly
 * Based on https://github.com/twitter/twemoji
 */
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

/**
 * Get emoji codepoint for Twemoji lookup
 * Removes variation selectors unless emoji contains zero-width joiner
 */
function getIconCode(char: string): string {
  return toCodePoint(char.indexOf(U200D) < 0 ? char.replace(UFE0Fg, '') : char)
}

/**
 * Convert emoji character to Twemoji CDN URL
 * Based on https://github.com/twitter/twemoji
 */
function getEmojiUrl(emoji: string): string {
  const code = getIconCode(emoji)
  // Use cdnjs (same as official Satori implementation)
  return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${code.toLowerCase()}.svg`
}

/**
 * Load emoji as SVG data URL for Satori
 */
async function loadEmoji(emoji: string): Promise<string | null> {
  // Check cache first (use normalized key)
  const cacheKey = getIconCode(emoji)
  const cached = emojiCache.get(cacheKey)
  if (cached) return cached

  try {
    const url = getEmojiUrl(emoji)
    const response = await fetch(url)

    if (!response.ok) {
      console.warn(`Failed to load emoji ${emoji} from ${url}: ${response.status}`)
      return null
    }

    // Get SVG text directly
    const svgText = await response.text()
    const base64 = btoa(svgText)
    const dataUrl = `data:image/svg+xml;base64,${base64}`

    // Cache the result
    emojiCache.set(cacheKey, dataUrl)

    return dataUrl
  } catch (e) {
    console.warn(`Error loading emoji ${emoji}:`, e)
    return null
  }
}

/**
 * Regex to detect if a grapheme contains emoji
 */
const EMOJI_DETECT_REGEX = /\p{Emoji}/u

/**
 * Extract all emoji graphemes from text using Intl.Segmenter
 * This correctly handles compound emojis (skin tones, flags, ZWJ sequences)
 */
function extractEmojis(text: string): string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const emojis: string[] = []
  const seen = new Set<string>()

  for (const { segment } of segmenter.segment(text)) {
    // Check if this grapheme contains emoji and we haven't seen it
    if (EMOJI_DETECT_REGEX.test(segment) && !seen.has(segment)) {
      // Skip if it's just a number or basic ASCII
      if (!/^[0-9#*]$/.test(segment)) {
        emojis.push(segment)
        seen.add(segment)
      }
    }
  }

  return emojis
}

/**
 * Build graphemeImages map for all emojis in text
 */
async function buildEmojiMap(text: string): Promise<Record<string, string>> {
  const emojis = extractEmojis(text)
  if (emojis.length === 0) return {}

  const map: Record<string, string> = {}

  await Promise.all(
    emojis.map(async (emoji) => {
      const dataUrl = await loadEmoji(emoji)
      if (dataUrl) {
        map[emoji] = dataUrl
      }
    })
  )

  return map
}

/**
 * Satori loadAdditionalAsset callback for emoji support (fallback)
 */
async function loadAdditionalAsset(
  languageCode: string,
  segment: string
): Promise<string | Array<{ name: string; data: ArrayBuffer; weight: number; style: string }>> {
  if (languageCode === 'emoji') {
    const emojiData = await loadEmoji(segment)
    if (emojiData) {
      return emojiData
    }
  }
  return []
}

interface BaseFonts {
  regular: ArrayBuffer
  bold: ArrayBuffer
  title: ArrayBuffer
}

// Font configuration for different scripts
interface FontSpec {
  name: string
  detect: (text: string) => boolean
}

// Define script detection patterns and their corresponding Google Fonts
const SCRIPT_FONTS: FontSpec[] = [
  {
    // Arabic script (Arabic, Persian, Urdu, etc.)
    // Using Cairo - good Satori compatibility
    name: 'Cairo',
    detect: (text: string) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text),
  },
  {
    // Hebrew script
    name: 'Noto Sans Hebrew',
    detect: (text: string) => /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(text),
  },
  {
    // Korean (Hangul)
    // Must be before CJK entry to ensure Korean gets its own font
    name: 'Noto Sans KR',
    detect: (text: string) => /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/.test(text),
  },
  {
    // CJK (Chinese, Japanese)
    // Using Noto Sans SC for Chinese/Japanese shared ideographs
    name: 'Noto Sans SC',
    detect: (text: string) => /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/.test(text),
  },
  {
    // Thai script
    name: 'Noto Sans Thai',
    detect: (text: string) => /[\u0E00-\u0E7F]/.test(text),
  },
  {
    // Devanagari (Hindi, Sanskrit, etc.)
    name: 'Noto Sans Devanagari',
    detect: (text: string) => /[\u0900-\u097F]/.test(text),
  },
  {
    // Bengali script
    name: 'Noto Sans Bengali',
    detect: (text: string) => /[\u0980-\u09FF]/.test(text),
  },
  {
    // Tamil script
    name: 'Noto Sans Tamil',
    detect: (text: string) => /[\u0B80-\u0BFF]/.test(text),
  },
  {
    // Cyrillic (Russian, Ukrainian, etc.)
    name: 'Noto Sans',
    detect: (text: string) => /[\u0400-\u04FF]/.test(text),
  },
  {
    // Greek script
    name: 'Noto Sans',
    detect: (text: string) => /[\u0370-\u03FF]/.test(text),
  },
]

/**
 * Extract unique non-ASCII characters from text
 */
function getNonLatinChars(text: string): string {
  // Match any character outside basic ASCII printable range
  const nonLatin = text.match(/[^\x20-\x7E]/g)
  if (!nonLatin) return ''
  // Return unique characters
  return [...new Set(nonLatin)].join('')
}

/**
 * Detect which scripts are present in the text and need fallback fonts
 */
function detectRequiredFonts(text: string): FontSpec[] {
  return SCRIPT_FONTS.filter(font => font.detect(text))
}

async function loadBaseFonts(): Promise<BaseFonts> {
  const [regular, bold, title] = await Promise.all([
    fontRegularData ?? fetch(FONT_REGULAR_URL).then(res => res.arrayBuffer()),
    fontBoldData ?? fetch(FONT_BOLD_URL).then(res => res.arrayBuffer()),
    fontTitleData ?? fetch(FONT_TITLE_URL).then(res => res.arrayBuffer()),
  ])

  fontRegularData = regular
  fontBoldData = bold
  fontTitleData = title

  return { regular, bold, title }
}

interface FontEntry {
  name: string
  data: ArrayBuffer
  weight: 400 | 700
  style: 'normal'
}

/**
 * Load fallback fonts for non-Latin scripts using Google Fonts API with text subsetting
 * This only downloads the glyphs needed for the specific text, keeping the font size small
 */
async function loadFallbackFonts(text: string): Promise<FontEntry[]> {
  const nonLatinChars = getNonLatinChars(text)
  if (!nonLatinChars) return []

  const requiredFonts = detectRequiredFonts(text)
  if (requiredFonts.length === 0) return []

  const fonts: FontEntry[] = []

  // Load each required font with text subsetting
  await Promise.all(
    requiredFonts.map(async (fontSpec) => {
      try {
        // Load regular weight (400)
        const regularData = await loadGoogleFont({
          family: fontSpec.name,
          weight: 400,
          text: nonLatinChars,
        })

        if (regularData) {
          fonts.push({
            name: fontSpec.name,
            data: regularData,
            weight: 400 as const,
            style: 'normal' as const,
          })
        }

        // Load bold weight (700)
        const boldData = await loadGoogleFont({
          family: fontSpec.name,
          weight: 700,
          text: nonLatinChars,
        })

        if (boldData) {
          fonts.push({
            name: fontSpec.name,
            data: boldData,
            weight: 700 as const,
            style: 'normal' as const,
          })
        }
      } catch (e) {
        // Font loading failed, continue without this font
        console.warn(`Failed to load font ${fontSpec.name}:`, e)
      }
    })
  )

  return fonts
}

/**
 * Build the fonts array for ImageResponse
 * Dynamically includes fallback fonts based on the text content
 */
async function buildFontsArray(baseFonts: BaseFonts, text: string): Promise<FontEntry[]> {
  const fonts: FontEntry[] = [
    {
      name: 'iA Writer Quattro',
      data: baseFonts.regular,
      weight: 400 as const,
      style: 'normal' as const,
    },
    {
      name: 'iA Writer Quattro',
      data: baseFonts.bold,
      weight: 700 as const,
      style: 'normal' as const,
    },
    {
      name: 'IBM Plex Sans',
      data: baseFonts.title,
      weight: 700 as const,
      style: 'normal' as const,
    },
  ]

  // Load fallback fonts for any non-Latin characters
  const fallbackFonts = await loadFallbackFonts(text)
  fonts.push(...fallbackFonts)

  return fonts
}

/**
 * Generate an OpenGraph image for a blog post
 * Returns a PNG image response (1200x630)
 */
export async function generateOGImage(data: OGImageData): Promise<Response> {
  const { title, subtitle, authorName, authorHandle, authorAvatar, themePreset, customColors, thumbnailUrl, tags } = data

  // Resolve theme colors (supports both presets and custom colors)
  const colors = resolveThemeColors(themePreset, customColors)
  const isDark = isDarkTheme(colors)

  // Load base fonts
  const baseFonts = await loadBaseFonts()

  // Collect all text that might need fallback fonts (include tags)
  const allText = [title, subtitle, authorName, authorHandle, ...(tags || [])].filter(Boolean).join('')

  // Build fonts array with fallback fonts for non-Latin scripts
  const fonts = await buildFontsArray(baseFonts, allText)

  // Build emoji map for any emojis in the text
  const graphemeImages = await buildEmojiMap(allText)

  // Build the image HTML using workers-og JSX-like syntax
  const html = buildImageHtml({
    title,
    subtitle,
    authorName,
    authorHandle,
    authorAvatar,
    colors,
    isDark,
    thumbnailUrl,
    tags,
  })

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts,
    graphemeImages,
    loadAdditionalAsset,
  })
}

/**
 * Generate an OpenGraph image for the site homepage or generic pages
 * Returns a PNG image response (1200x630)
 */
export async function generateHomepageOGImage(): Promise<Response> {
  // Use default GreenGale colors
  const colors = resolveThemeColors()
  const isDark = isDarkTheme(colors)

  // Homepage only uses Latin text, no fallback fonts or emojis needed
  const baseFonts = await loadBaseFonts()
  const fonts = await buildFontsArray(baseFonts, '')
  const html = buildHomepageHtml(colors, isDark)

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts,
  })
}

export interface ProfileOGImageData {
  displayName: string
  handle: string
  avatarUrl?: string | null
  description?: string | null
  postsCount?: number
  themePreset?: string | null
  customColors?: { background?: string; text?: string; accent?: string } | null
  publicationName?: string | null
}

/**
 * Generate an OpenGraph image for a user profile
 * Returns a PNG image response (1200x630)
 */
export async function generateProfileOGImage(data: ProfileOGImageData): Promise<Response> {
  // Use publication theme colors, falling back to default GreenGale colors
  const colors = resolveThemeColors(data.themePreset, data.customColors)
  const isDark = isDarkTheme(colors)

  // Load base fonts
  const baseFonts = await loadBaseFonts()

  // Collect all text that might need fallback fonts
  const allText = [data.displayName, data.handle, data.description, data.publicationName].filter(Boolean).join('')

  // Build fonts array with fallback fonts for non-Latin scripts
  const fonts = await buildFontsArray(baseFonts, allText)

  // Build emoji map for any emojis in the text
  const graphemeImages = await buildEmojiMap(allText)

  const html = buildProfileHtml(data, colors, isDark)

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts,
    graphemeImages,
    loadAdditionalAsset,
  })
}

interface BuildHtmlOptions {
  title: string
  subtitle?: string | null
  authorName: string
  authorHandle: string
  authorAvatar?: string | null
  colors: ThemeColors
  isDark: boolean
  /** URL to the first image in the post for OG thumbnail */
  thumbnailUrl?: string | null
  /** Tags/hashtags for the post */
  tags?: string[] | null
}

function escapeHtml(text: string): string {
  // Satori renders HTML entities literally (e.g., &lt; shows as "&lt;" not "<"),
  // so we cannot use entity escaping. Instead, we strip angle brackets only when
  // they could form HTML tags (< followed by a letter or /). Bare < and > in
  // text like "<2%" or "a > b" are safe — HTML parsers treat them as text when
  // they don't form valid tag syntax.
  return text.replace(/<(?=[a-zA-Z/])/g, '\u2039')
}

/**
 * Build vignette as multiple stacked layers to reduce banding artifacts
 * Dark themes use pure black to avoid colored banding artifacts
 */
function buildVignetteLayers(vignetteColor: string, isDark: boolean): string {
  // Parse rgba color to extract RGB and alpha
  const rgbaMatch = vignetteColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)

  let r: string, g: string, b: string, maxAlpha: number

  if (!rgbaMatch) {
    // Fallback
    r = '0'; g = '0'; b = '0'; maxAlpha = 0.3
  } else if (isDark) {
    // For dark themes, use pure black to avoid colored banding
    r = '0'; g = '0'; b = '0'
    maxAlpha = 0.25
  } else {
    // Light themes can use the theme color
    r = rgbaMatch[1]
    g = rgbaMatch[2]
    b = rgbaMatch[3]
    maxAlpha = parseFloat(rgbaMatch[4] || '1')
  }

  // Create multiple stacked layers, each with a simple gradient
  const layers = [
    { alpha: maxAlpha * 0.175, start: '55%', end: '100%' },
    { alpha: maxAlpha * 0.15, start: '45%', end: '95%' },
    { alpha: maxAlpha * 0.1, start: '35%', end: '90%' },
  ]

  return layers.map(layer =>
    `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background: radial-gradient(ellipse at center, transparent ${layer.start}, rgba(${r}, ${g}, ${b}, ${layer.alpha.toFixed(3)}) ${layer.end});"></div>`
  ).join('\n    ')
}

function buildImageHtml(options: BuildHtmlOptions): string {
  const { title, subtitle, authorName, authorHandle, authorAvatar, colors, isDark, thumbnailUrl, tags } = options

  // Truncate title if too long (shorter limit when thumbnail is present)
  const maxTitleLength = thumbnailUrl ? 80 : 100
  const displayTitle = title.length > maxTitleLength ? title.slice(0, maxTitleLength - 3) + '...' : title
  const maxSubtitleLength = thumbnailUrl ? 120 : 150
  const displaySubtitle = subtitle && subtitle.length > maxSubtitleLength ? subtitle.slice(0, maxSubtitleLength - 3) + '...' : subtitle

  // Calculate title font size based on length (increased sizes)
  const titleFontSize = displayTitle.length > 60 ? 52 : displayTitle.length > 40 ? 58 : 66

  // Author initial for fallback avatar
  const authorInitial = (authorName || authorHandle).charAt(0).toUpperCase()

  // Font families
  const fontFamily = "'iA Writer Quattro', sans-serif"
  const titleFontFamily = "'IBM Plex Sans', sans-serif"

  // Build avatar element (72px size)
  const avatarHtml = authorAvatar
    ? `<img src="${escapeHtml(authorAvatar)}" width="72" height="72" style="border-radius: 36px; margin-right: 20px;" />`
    : `<div style="display: flex; width: 72px; height: 72px; border-radius: 36px; margin-right: 20px; background: ${colors.accent}; align-items: center; justify-content: center; color: ${isDark ? colors.background : '#ffffff'}; font-size: 30px; font-weight: 700; font-family: ${fontFamily};">${authorInitial}</div>`

  // Build subtitle element (increased font size)
  const subtitleHtml = displaySubtitle
    ? `<div style="display: flex; font-size: 32px; color: ${colors.textSecondary}; line-height: 1.4; font-family: ${fontFamily};">${escapeHtml(displaySubtitle)}</div>`
    : ''

  // Build tags element (pill badges, max 4 tags)
  const displayTags = tags?.slice(0, 4) || []
  const tagsHtml = displayTags.length > 0
    ? `<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px;">
        ${displayTags.map(tag =>
          `<div style="display: flex; padding: 6px 14px; border-radius: 9999px; font-size: 20px; background: ${colors.accent}20; color: ${colors.accent}; font-family: ${fontFamily};">${escapeHtml(tag)}</div>`
        ).join('')}
        ${tags && tags.length > 4 ? `<div style="display: flex; padding: 6px 14px; font-size: 20px; color: ${colors.textSecondary}; font-family: ${fontFamily};">+${tags.length - 4} more</div>` : ''}
       </div>`
    : ''

  // Build thumbnail element (280x280 square, vertically centered on the right)
  // Content area is from y=60 to y=470 (410px height), so center the thumbnail in that space
  // Center position: 60 + (410 - 280) / 2 = 125px from top
  const thumbnailHtml = thumbnailUrl
    ? `<div style="display: flex; position: absolute; top: 125px; right: 60px; width: 280px; height: 280px; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 16px rgba(0, 0, 0, ${isDark ? '0.5' : '0.2'});">
         <img src="${escapeHtml(thumbnailUrl)}" width="280" height="280" style="width: 280px; height: 280px; object-fit: cover;" />
       </div>`
    : ''

  // Adjust content area right margin when thumbnail is present (280 + 20 gap + 60 padding = 360)
  const contentRightPadding = thumbnailUrl ? '360px' : '60px'

  // Build grid pattern using repeating linear gradients (more compatible with Satori)
  const gridPatternHtml = `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background-image: repeating-linear-gradient(0deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px);"></div>`

  // Vignette overlay - use multiple stacked layers for smoother rendering
  const vignetteHtml = buildVignetteLayers(colors.vignetteColor, isDark)

  return `<div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background: ${colors.background}; padding: 60px; font-family: ${fontFamily}; position: relative;">
    ${gridPatternHtml}
    ${vignetteHtml}
    <div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 16px; background: ${colors.accent};"></div>
    ${thumbnailHtml}
    <div style="display: flex; flex-direction: column; justify-content: center; position: absolute; top: 60px; left: 60px; right: ${contentRightPadding}; bottom: 160px;">
      <div style="display: flex; font-size: ${titleFontSize}px; font-weight: 700; color: ${colors.text}; line-height: 1.2; margin-bottom: ${subtitle ? '16px' : '0'}; font-family: ${titleFontFamily};">${escapeHtml(displayTitle)}</div>
      ${subtitleHtml}
      ${tagsHtml}
    </div>
    <div style="display: flex; align-items: center; position: absolute; bottom: 60px; left: 60px;">
      ${avatarHtml}
      <div style="display: flex; flex-direction: column;">
        <div style="display: flex; font-size: 32px; font-weight: 600; color: ${colors.text}; font-family: ${fontFamily};">${escapeHtml(authorName)}</div>
        <div style="display: flex; font-size: 24px; color: ${colors.textSecondary}; font-family: ${fontFamily};">@${escapeHtml(authorHandle)}</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; position: absolute; bottom: 60px; right: 60px; color: ${colors.accent};">
      <svg width="38" height="38" viewBox="0 0 24 24" style="margin-right: 12px;">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
      </svg>
      <span style="font-size: 32px; font-weight: 700; font-family: ${titleFontFamily};">GreenGale</span>
    </div>
  </div>`
}

/**
 * Build HTML for homepage/site OG image
 */
function buildHomepageHtml(colors: ThemeColors, isDark: boolean): string {
  const fontFamily = "'iA Writer Quattro', sans-serif"
  const titleFontFamily = "'IBM Plex Sans', sans-serif"

  // Build grid pattern
  const gridPatternHtml = `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background-image: repeating-linear-gradient(0deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px);"></div>`

  // Vignette overlay
  const vignetteHtml = buildVignetteLayers(colors.vignetteColor, isDark)

  return `<div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background: ${colors.background}; font-family: ${fontFamily}; position: relative;">
    ${gridPatternHtml}
    ${vignetteHtml}
    <div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 16px; background: ${colors.accent};"></div>
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; position: absolute; top: 0; left: 0; right: 0; bottom: 0;">
      <div style="display: flex; align-items: center; margin-bottom: 24px;">
        <svg width="80" height="80" viewBox="0 0 24 24" style="margin-right: 20px; color: ${colors.accent};">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
        </svg>
        <span style="font-size: 72px; font-weight: 700; color: ${colors.text}; font-family: ${titleFontFamily};">GreenGale</span>
      </div>
      <div style="display: flex; font-size: 32px; color: ${colors.textSecondary}; font-family: ${fontFamily};">A markdown blog platform on AT Protocol</div>
    </div>
  </div>`
}

/**
 * Build HTML for user profile OG image
 */
function buildProfileHtml(data: ProfileOGImageData, colors: ThemeColors, isDark: boolean): string {
  const { displayName, handle, avatarUrl, description, postsCount, publicationName } = data
  const fontFamily = "'iA Writer Quattro', sans-serif"
  const titleFontFamily = "'IBM Plex Sans', sans-serif"

  // Author initial for fallback avatar
  const authorInitial = (displayName || handle).charAt(0).toUpperCase()

  // Build avatar element (120px for profile - larger than post)
  const avatarHtml = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" width="120" height="120" style="border-radius: 60px; margin-bottom: 24px;" />`
    : `<div style="display: flex; width: 120px; height: 120px; border-radius: 60px; margin-bottom: 24px; background: ${colors.accent}; align-items: center; justify-content: center; color: ${isDark ? colors.background : '#ffffff'}; font-size: 48px; font-weight: 700; font-family: ${fontFamily};">${authorInitial}</div>`

  // Truncate description if too long
  const displayDescription = description && description.length > 120
    ? description.slice(0, 117) + '...'
    : description

  // Build description element
  const descriptionHtml = displayDescription
    ? `<div style="display: flex; font-size: 28px; color: ${colors.textSecondary}; line-height: 1.4; font-family: ${fontFamily}; text-align: center; max-width: 800px;">${escapeHtml(displayDescription)}</div>`
    : ''

  // Build posts count element
  const postsHtml = postsCount !== undefined
    ? `<div style="display: flex; font-size: 24px; color: ${colors.textSecondary}; font-family: ${fontFamily}; margin-top: 16px;">${postsCount} ${postsCount === 1 ? 'post' : 'posts'}</div>`
    : ''

  // Determine primary title and whether to show "by Display Name" line
  const primaryTitle = publicationName || displayName || handle
  const showByLine = publicationName && displayName && publicationName !== displayName

  // Build grid pattern
  const gridPatternHtml = `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background-image: repeating-linear-gradient(0deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px);"></div>`

  // Vignette overlay
  const vignetteHtml = buildVignetteLayers(colors.vignetteColor, isDark)

  return `<div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background: ${colors.background}; font-family: ${fontFamily}; position: relative;">
    ${gridPatternHtml}
    ${vignetteHtml}
    <div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 16px; background: ${colors.accent};"></div>
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; position: absolute; top: 60px; left: 60px; right: 60px; bottom: 100px;">
      ${avatarHtml}
      <div style="display: flex; font-size: 48px; font-weight: 700; color: ${colors.text}; font-family: ${titleFontFamily}; margin-bottom: 8px;">${escapeHtml(primaryTitle)}</div>
      <div style="display: flex; font-size: 28px; color: ${colors.textSecondary}; font-family: ${fontFamily}; margin-bottom: ${showByLine ? '8' : '16'}px;">@${escapeHtml(handle)}</div>
      ${showByLine ? `<div style="display: flex; font-size: 24px; color: ${colors.textSecondary}; font-family: ${fontFamily}; margin-bottom: 16px;">by ${escapeHtml(displayName)}</div>` : ''}
      ${descriptionHtml}
      ${postsHtml}
    </div>
    <div style="display: flex; align-items: center; position: absolute; bottom: 60px; right: 60px; color: ${colors.accent};">
      <svg width="38" height="38" viewBox="0 0 24 24" style="margin-right: 12px;">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
      </svg>
      <span style="font-size: 32px; font-weight: 700; font-family: ${titleFontFamily};">GreenGale</span>
    </div>
  </div>`
}
