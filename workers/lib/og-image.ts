// OG image generation using workers-og (Satori + resvg-wasm)
import { ImageResponse } from 'workers-og'
import { resolveThemeColors, isDarkTheme, type ThemeColors } from './theme-colors'

export interface OGImageData {
  title: string
  subtitle?: string | null
  authorName: string
  authorHandle: string
  authorAvatar?: string | null
  themePreset?: string | null
  customColors?: { background?: string; text?: string; accent?: string } | null
}

// Font URLs (TTF format required by Satori)
// Fonts are served from the main site (public/fonts/)
const FONT_BASE_URL = 'https://greengale.app/fonts'
const FONT_REGULAR_URL = `${FONT_BASE_URL}/iAWriterQuattroS-Regular.ttf`
const FONT_BOLD_URL = `${FONT_BASE_URL}/iAWriterQuattroS-Bold.ttf`

// Noto Sans SC for CJK (Chinese, Japanese, Korean) fallback
// Hosted locally in public/fonts/ directory
const NOTO_SANS_SC_REGULAR_URL = `${FONT_BASE_URL}/NotoSansSC-Regular.ttf`
const NOTO_SANS_SC_BOLD_URL = `${FONT_BASE_URL}/NotoSansSC-Bold.ttf`

// Cache fonts in memory to avoid re-fetching
let fontRegularData: ArrayBuffer | null = null
let fontBoldData: ArrayBuffer | null = null
let notoRegularData: ArrayBuffer | null = null
let notoBoldData: ArrayBuffer | null = null

interface BaseFonts {
  regular: ArrayBuffer
  bold: ArrayBuffer
}

/**
 * Check if text contains CJK (Chinese, Japanese, Korean) characters
 */
function containsCJK(text: string): boolean {
  // Unicode ranges for CJK characters:
  // CJK Unified Ideographs: 4E00-9FFF
  // CJK Unified Ideographs Extension A: 3400-4DBF
  // Hiragana: 3040-309F
  // Katakana: 30A0-30FF
  // Hangul Syllables: AC00-D7AF
  // Hangul Jamo: 1100-11FF
  const cjkPattern = /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u1100-\u11FF]/
  return cjkPattern.test(text)
}

async function loadBaseFonts(): Promise<BaseFonts> {
  const [regular, bold] = await Promise.all([
    fontRegularData ?? fetch(FONT_REGULAR_URL).then(res => res.arrayBuffer()),
    fontBoldData ?? fetch(FONT_BOLD_URL).then(res => res.arrayBuffer()),
  ])

  fontRegularData = regular
  fontBoldData = bold

  return { regular, bold }
}

async function loadCJKFonts(): Promise<{ notoRegular: ArrayBuffer; notoBold: ArrayBuffer }> {
  const [notoRegular, notoBold] = await Promise.all([
    notoRegularData ?? fetch(NOTO_SANS_SC_REGULAR_URL).then(res => res.arrayBuffer()),
    notoBoldData ?? fetch(NOTO_SANS_SC_BOLD_URL).then(res => res.arrayBuffer()),
  ])

  notoRegularData = notoRegular
  notoBoldData = notoBold

  return { notoRegular, notoBold }
}

/**
 * Build the fonts array for ImageResponse
 * Only includes CJK fonts if needed (to avoid loading 20MB of font data unnecessarily)
 */
function buildFontsArray(baseFonts: BaseFonts, cjkFonts?: { notoRegular: ArrayBuffer; notoBold: ArrayBuffer }) {
  const fonts = [
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
  ]

  if (cjkFonts) {
    fonts.push(
      {
        name: 'Noto Sans SC',
        data: cjkFonts.notoRegular,
        weight: 400 as const,
        style: 'normal' as const,
      },
      {
        name: 'Noto Sans SC',
        data: cjkFonts.notoBold,
        weight: 700 as const,
        style: 'normal' as const,
      },
    )
  }

  return fonts
}

/**
 * Generate an OpenGraph image for a blog post
 * Returns a PNG image response (1200x630)
 */
export async function generateOGImage(data: OGImageData): Promise<Response> {
  const { title, subtitle, authorName, authorHandle, authorAvatar, themePreset, customColors } = data

  // Resolve theme colors (supports both presets and custom colors)
  const colors = resolveThemeColors(themePreset, customColors)
  const isDark = isDarkTheme(colors)

  // Load base fonts (CJK fonts disabled - too large for worker limits)
  const baseFonts = await loadBaseFonts()

  // Build the image HTML using workers-og JSX-like syntax
  const html = buildImageHtml({
    title,
    subtitle,
    authorName,
    authorHandle,
    authorAvatar,
    colors,
    isDark,
  })

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: buildFontsArray(baseFonts),
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

  // Homepage only uses Latin text, no CJK needed
  const baseFonts = await loadBaseFonts()
  const html = buildHomepageHtml(colors, isDark)

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: buildFontsArray(baseFonts),
  })
}

export interface ProfileOGImageData {
  displayName: string
  handle: string
  avatarUrl?: string | null
  description?: string | null
  postsCount?: number
}

/**
 * Generate an OpenGraph image for a user profile
 * Returns a PNG image response (1200x630)
 */
export async function generateProfileOGImage(data: ProfileOGImageData): Promise<Response> {
  // Use default GreenGale colors
  const colors = resolveThemeColors()
  const isDark = isDarkTheme(colors)

  // Load base fonts (CJK fonts disabled - too large for worker limits)
  const baseFonts = await loadBaseFonts()
  const html = buildProfileHtml(data, colors, isDark)

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: buildFontsArray(baseFonts),
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
}

function escapeHtml(text: string): string {
  // Only escape < and > to prevent HTML tag injection
  // Other entities (&, ", ') are NOT escaped because Satori renders
  // HTML entities literally instead of decoding them
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
  const { title, subtitle, authorName, authorHandle, authorAvatar, colors, isDark } = options

  // Truncate title if too long
  const displayTitle = title.length > 100 ? title.slice(0, 97) + '...' : title
  const displaySubtitle = subtitle && subtitle.length > 150 ? subtitle.slice(0, 147) + '...' : subtitle

  // Calculate title font size based on length (increased sizes)
  const titleFontSize = displayTitle.length > 60 ? 52 : displayTitle.length > 40 ? 58 : 66

  // Author initial for fallback avatar
  const authorInitial = (authorName || authorHandle).charAt(0).toUpperCase()

  // Font family - use iA Writer Quattro
  const fontFamily = "'iA Writer Quattro', sans-serif"

  // Build avatar element (72px size)
  const avatarHtml = authorAvatar
    ? `<img src="${escapeHtml(authorAvatar)}" width="72" height="72" style="border-radius: 36px; margin-right: 20px;" />`
    : `<div style="display: flex; width: 72px; height: 72px; border-radius: 36px; margin-right: 20px; background: ${colors.accent}; align-items: center; justify-content: center; color: ${isDark ? colors.background : '#ffffff'}; font-size: 30px; font-weight: 700; font-family: ${fontFamily};">${authorInitial}</div>`

  // Build subtitle element (increased font size)
  const subtitleHtml = displaySubtitle
    ? `<div style="display: flex; font-size: 32px; color: ${colors.textSecondary}; line-height: 1.4; font-family: ${fontFamily};">${escapeHtml(displaySubtitle)}</div>`
    : ''

  // Build grid pattern using repeating linear gradients (more compatible with Satori)
  const gridPatternHtml = `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background-image: repeating-linear-gradient(0deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px);"></div>`

  // Vignette overlay - use multiple stacked layers for smoother rendering
  const vignetteHtml = buildVignetteLayers(colors.vignetteColor, isDark)

  return `<div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background: ${colors.background}; padding: 60px; font-family: ${fontFamily}; position: relative;">
    ${gridPatternHtml}
    ${vignetteHtml}
    <div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 16px; background: ${colors.accent};"></div>
    <div style="display: flex; flex-direction: column; justify-content: center; position: absolute; top: 60px; left: 60px; right: 60px; bottom: 160px;">
      <div style="display: flex; font-size: ${titleFontSize}px; font-weight: 700; color: ${colors.text}; line-height: 1.2; margin-bottom: ${subtitle ? '16px' : '0'}; font-family: ${fontFamily};">${escapeHtml(displayTitle)}</div>
      ${subtitleHtml}
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
      <span style="font-size: 32px; font-weight: 600; font-family: ${fontFamily};">GreenGale</span>
    </div>
  </div>`
}

/**
 * Build HTML for homepage/site OG image
 */
function buildHomepageHtml(colors: ThemeColors, isDark: boolean): string {
  const fontFamily = "'iA Writer Quattro', sans-serif"

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
        <span style="font-size: 72px; font-weight: 700; color: ${colors.text}; font-family: ${fontFamily};">GreenGale</span>
      </div>
      <div style="display: flex; font-size: 32px; color: ${colors.textSecondary}; font-family: ${fontFamily};">A markdown blog platform on AT Protocol</div>
    </div>
  </div>`
}

/**
 * Build HTML for user profile OG image
 */
function buildProfileHtml(data: ProfileOGImageData, colors: ThemeColors, isDark: boolean): string {
  const { displayName, handle, avatarUrl, description, postsCount } = data
  const fontFamily = "'iA Writer Quattro', sans-serif"

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
      <div style="display: flex; font-size: 48px; font-weight: 700; color: ${colors.text}; font-family: ${fontFamily}; margin-bottom: 8px;">${escapeHtml(displayName || handle)}</div>
      <div style="display: flex; font-size: 28px; color: ${colors.textSecondary}; font-family: ${fontFamily}; margin-bottom: 16px;">@${escapeHtml(handle)}</div>
      ${descriptionHtml}
      ${postsHtml}
    </div>
    <div style="display: flex; align-items: center; position: absolute; bottom: 60px; right: 60px; color: ${colors.accent};">
      <svg width="38" height="38" viewBox="0 0 24 24" style="margin-right: 12px;">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
      </svg>
      <span style="font-size: 32px; font-weight: 600; font-family: ${fontFamily};">GreenGale</span>
    </div>
  </div>`
}
