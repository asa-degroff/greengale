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
}

// Font URLs (TTF format required by Satori)
// Fonts are served from the main site (public/fonts/)
const FONT_BASE_URL = 'https://greengale.app/fonts'
const FONT_REGULAR_URL = `${FONT_BASE_URL}/iAWriterQuattroS-Regular.ttf`
const FONT_BOLD_URL = `${FONT_BASE_URL}/iAWriterQuattroS-Bold.ttf`

// Cache fonts in memory to avoid re-fetching
let fontRegularData: ArrayBuffer | null = null
let fontBoldData: ArrayBuffer | null = null

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  // Fetch fonts in parallel if not cached
  const [regular, bold] = await Promise.all([
    fontRegularData ?? fetch(FONT_REGULAR_URL).then(res => res.arrayBuffer()),
    fontBoldData ?? fetch(FONT_BOLD_URL).then(res => res.arrayBuffer()),
  ])

  // Cache for subsequent requests
  fontRegularData = regular
  fontBoldData = bold

  return { regular, bold }
}

/**
 * Generate an OpenGraph image for a blog post
 * Returns a PNG image response (1200x630)
 */
export async function generateOGImage(data: OGImageData): Promise<Response> {
  const { title, subtitle, authorName, authorHandle, authorAvatar, themePreset } = data

  // Resolve theme colors
  const colors = resolveThemeColors(themePreset)
  const isDark = isDarkTheme(colors)

  // Load fonts
  const fonts = await loadFonts()

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
    fonts: [
      {
        name: 'iA Writer Quattro',
        data: fonts.regular,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'iA Writer Quattro',
        data: fonts.bold,
        weight: 700,
        style: 'normal',
      },
    ],
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
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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

  // Calculate title font size based on length
  const titleFontSize = displayTitle.length > 60 ? 42 : displayTitle.length > 40 ? 48 : 56

  // Author initial for fallback avatar
  const authorInitial = (authorName || authorHandle).charAt(0).toUpperCase()

  // Font family - use iA Writer Quattro
  const fontFamily = "'iA Writer Quattro', sans-serif"

  // Build avatar element
  const avatarHtml = authorAvatar
    ? `<img src="${escapeHtml(authorAvatar)}" width="56" height="56" style="border-radius: 28px; margin-right: 16px;" />`
    : `<div style="display: flex; width: 56px; height: 56px; border-radius: 28px; margin-right: 16px; background: ${colors.accent}; align-items: center; justify-content: center; color: ${isDark ? colors.background : '#ffffff'}; font-size: 24px; font-weight: 700; font-family: ${fontFamily};">${authorInitial}</div>`

  // Build subtitle element
  const subtitleHtml = displaySubtitle
    ? `<div style="display: flex; font-size: 28px; color: ${colors.textSecondary}; line-height: 1.4; font-family: ${fontFamily};">${escapeHtml(displaySubtitle)}</div>`
    : ''

  // Build grid pattern using repeating linear gradients (more compatible with Satori)
  const gridPatternHtml = `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background-image: repeating-linear-gradient(0deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px);"></div>`

  // Vignette overlay - use multiple stacked layers for smoother rendering
  const vignetteHtml = buildVignetteLayers(colors.vignetteColor, isDark)

  return `<div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background: ${colors.background}; padding: 60px; font-family: ${fontFamily}; position: relative;">
    ${gridPatternHtml}
    ${vignetteHtml}
    <div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 6px; background: ${colors.accent};"></div>
    <div style="display: flex; flex-direction: column; flex: 1; justify-content: center; position: relative;">
      <div style="display: flex; font-size: ${titleFontSize}px; font-weight: 700; color: ${colors.text}; line-height: 1.2; margin-bottom: ${subtitle ? '16px' : '0'}; font-family: ${fontFamily};">${escapeHtml(displayTitle)}</div>
      ${subtitleHtml}
    </div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 40px; position: relative;">
      <div style="display: flex; align-items: center;">
        ${avatarHtml}
        <div style="display: flex; flex-direction: column;">
          <div style="display: flex; font-size: 22px; font-weight: 600; color: ${colors.text}; font-family: ${fontFamily};">${escapeHtml(authorName)}</div>
          <div style="display: flex; font-size: 18px; color: ${colors.textSecondary}; font-family: ${fontFamily};">@${escapeHtml(authorHandle)}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; color: ${colors.accent};">
        <svg width="32" height="32" viewBox="0 0 24 24" style="margin-right: 10px;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
        </svg>
        <span style="font-size: 24px; font-weight: 600; font-family: ${fontFamily};">GreenGale</span>
      </div>
    </div>
  </div>`
}
