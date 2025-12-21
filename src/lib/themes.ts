import { parse, formatHex, oklch, interpolate, type Oklch, rgb } from 'culori'

export type ThemePreset =
  | 'default'
  | 'github-light'
  | 'github-dark'
  | 'dracula'
  | 'nord'
  | 'solarized-light'
  | 'solarized-dark'
  | 'monokai'
  | 'custom'

export interface CustomColors {
  background?: string
  text?: string
  accent?: string
  codeBackground?: string
}

/**
 * Contrast validation result
 */
export interface ContrastResult {
  ratio: number
  passes: boolean
  level: 'fail' | 'AA-large' | 'AA' | 'AAA'
}

/**
 * Calculate relative luminance of a color (WCAG 2.1 formula)
 */
function getRelativeLuminance(color: string): number | null {
  const parsed = parse(color)
  if (!parsed) return null

  const rgbColor = rgb(parsed)
  if (!rgbColor) return null

  const r = rgbColor.r ?? 0
  const g = rgbColor.g ?? 0
  const b = rgbColor.b ?? 0

  // Convert to sRGB and apply gamma correction
  const toLinear = (c: number) => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  const rLin = toLinear(r)
  const gLin = toLinear(g)
  const bLin = toLinear(b)

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin
}

/**
 * Calculate WCAG contrast ratio between two colors
 * Returns a value between 1 and 21
 */
export function getContrastRatio(color1: string, color2: string): number | null {
  const l1 = getRelativeLuminance(color1)
  const l2 = getRelativeLuminance(color2)

  if (l1 === null || l2 === null) return null

  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)

  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Check if contrast ratio meets WCAG requirements
 * - 3:1 minimum for large text (AA-large)
 * - 4.5:1 minimum for normal text (AA)
 * - 7:1 for enhanced contrast (AAA)
 */
export function checkContrast(color1: string, color2: string): ContrastResult | null {
  const ratio = getContrastRatio(color1, color2)
  if (ratio === null) return null

  let level: ContrastResult['level'] = 'fail'
  if (ratio >= 7) {
    level = 'AAA'
  } else if (ratio >= 4.5) {
    level = 'AA'
  } else if (ratio >= 3) {
    level = 'AA-large'
  }

  return {
    ratio,
    passes: ratio >= 4.5, // We require AA level for normal text
    level,
  }
}

/**
 * Validate custom colors for accessibility
 * Returns an object with validation results for each color pair
 */
export function validateCustomColors(colors: CustomColors): {
  textContrast: ContrastResult | null
  accentContrast: ContrastResult | null
  isValid: boolean
} {
  const { background, text, accent } = colors

  const textContrast = background && text ? checkContrast(background, text) : null
  const accentContrast = background && accent ? checkContrast(background, accent) : null

  // Theme is valid if both text and accent meet minimum contrast (4.5:1 for text, 3:1 for accent)
  const isValid =
    (textContrast?.passes ?? false) &&
    (accentContrast ? accentContrast.ratio >= 3 : false)

  return {
    textContrast,
    accentContrast,
    isValid,
  }
}

/**
 * Adjust a foreground color's luminance to meet minimum contrast against a background
 * Preserves hue and chroma as much as possible, only adjusting lightness
 * Returns the adjusted color or original if already meets contrast
 */
function adjustColorForContrast(
  foreground: string,
  background: string,
  minContrast: number
): string {
  const currentContrast = getContrastRatio(foreground, background)
  if (currentContrast !== null && currentContrast >= minContrast) {
    return foreground // Already meets contrast
  }

  const fgParsed = parse(foreground)
  const bgParsed = parse(background)
  if (!fgParsed || !bgParsed) return foreground

  const fgOklch = oklch(fgParsed) as Oklch
  const bgOklch = oklch(bgParsed) as Oklch
  if (!fgOklch || !bgOklch) return foreground

  const bgLightness = bgOklch.l ?? 0
  const isDarkBg = bgLightness < 0.5

  // Binary search for the right lightness value
  let minL = 0
  let maxL = 1
  let bestColor = foreground

  // Determine search direction: if dark bg, we want lighter fg and vice versa
  if (isDarkBg) {
    minL = bgLightness + 0.1 // Start above background
    maxL = 1
  } else {
    minL = 0
    maxL = bgLightness - 0.1 // Stay below background
  }

  // Binary search for minimum lightness change that meets contrast
  for (let i = 0; i < 20; i++) {
    const midL = (minL + maxL) / 2
    const testColor: Oklch = {
      mode: 'oklch',
      l: midL,
      c: fgOklch.c ?? 0,
      h: fgOklch.h,
    }
    const testHex = formatHex(testColor)
    if (!testHex) break

    const testContrast = getContrastRatio(testHex, background)
    if (testContrast === null) break

    if (testContrast >= minContrast) {
      bestColor = testHex
      // Try to find a value closer to original lightness
      if (isDarkBg) {
        maxL = midL // Try darker (closer to original if fg was dark)
      } else {
        minL = midL // Try lighter (closer to original if fg was light)
      }
    } else {
      // Need more contrast
      if (isDarkBg) {
        minL = midL // Need lighter
      } else {
        maxL = midL // Need darker
      }
    }
  }

  return bestColor
}

/**
 * Correct custom colors to ensure minimum contrast requirements are met
 * Adjusts text to 4.5:1 and accent to 3:1 against background
 * Preserves hue and saturation, only adjusting luminance as needed
 */
export function correctCustomColorsContrast(colors: CustomColors): CustomColors {
  const { background, text, accent, codeBackground } = colors

  if (!background) return colors

  const corrected: CustomColors = {
    background,
    codeBackground,
  }

  // Correct text color (4.5:1 minimum for AA)
  if (text) {
    corrected.text = adjustColorForContrast(text, background, 4.5)
  }

  // Correct accent color (3:1 minimum for UI components)
  if (accent) {
    corrected.accent = adjustColorForContrast(accent, background, 3)
  }

  return corrected
}

export interface Theme {
  preset?: ThemePreset
  custom?: CustomColors
}

export const THEME_PRESETS: ThemePreset[] = [
  'default',
  'github-light',
  'github-dark',
  'dracula',
  'nord',
  'solarized-light',
  'solarized-dark',
  'monokai',
  'custom',
]

export const THEME_LABELS: Record<ThemePreset, string> = {
  default: 'Default',
  'github-light': 'GitHub Light',
  'github-dark': 'GitHub Dark',
  dracula: 'Dracula',
  nord: 'Nord',
  'solarized-light': 'Solarized Light',
  'solarized-dark': 'Solarized Dark',
  monokai: 'Monokai',
  custom: 'Custom',
}

/**
 * Base colors for each preset (for UI pre-fill)
 */
export interface PresetColors {
  background: string
  text: string
  accent: string
  link: string
  codeBackground: string
}

const PRESET_COLORS: Record<Exclude<ThemePreset, 'default' | 'custom'>, PresetColors> = {
  'github-light': {
    background: '#ffffff',
    text: '#24292f',
    accent: '#0969da',
    link: '#0969da',
    codeBackground: '#f6f8fa',
  },
  'github-dark': {
    background: '#0d1117',
    text: '#c9d1d9',
    accent: '#58a6ff',
    link: '#58a6ff',
    codeBackground: '#161b22',
  },
  dracula: {
    background: '#282a36',
    text: '#f8f8f2',
    accent: '#bd93f9',
    link: '#8be9fd',
    codeBackground: '#1e1f29',
  },
  nord: {
    background: '#2e3440',
    text: '#eceff4',
    accent: '#88c0d0',
    link: '#88c0d0',
    codeBackground: '#3b4252',
  },
  'solarized-light': {
    background: '#fdf6e3',
    text: '#657b83',
    accent: '#268bd2',
    link: '#268bd2',
    codeBackground: '#eee8d5',
  },
  'solarized-dark': {
    background: '#002b36',
    text: '#839496',
    accent: '#268bd2',
    link: '#268bd2',
    codeBackground: '#073642',
  },
  monokai: {
    background: '#272822',
    text: '#f8f8f2',
    accent: '#a6e22e',
    link: '#66d9ef',
    codeBackground: '#1e1f1c',
  },
}

/**
 * Get the base colors for a preset (for UI pre-fill in custom theme editor)
 */
export function getPresetColors(preset: ThemePreset): PresetColors {
  if (preset === 'default' || preset === 'custom') {
    return PRESET_COLORS['github-light']
  }
  return PRESET_COLORS[preset]
}

/**
 * Full theme colors derived from custom colors
 */
export interface FullThemeColors {
  background: string
  text: string
  textSecondary: string
  accent: string
  border: string
  codeBackground: string
  codeText: string
  blockquoteBorder: string
  blockquoteText: string
  link: string
  linkHover: string
}

/**
 * Full site-wide colors including sidebar and background effects
 */
export interface FullSiteColors extends FullThemeColors {
  bgSecondary: string
  accentHover: string
  sidebarBg: string
  gridColor: string
  vignetteColor: string
}

/**
 * Derive a full theme color palette from 3-4 base colors using OKLCH
 */
export function deriveThemeColors(custom: CustomColors): FullThemeColors | null {
  if (!custom.background || !custom.text || !custom.accent) {
    return null
  }

  const bg = parse(custom.background)
  const text = parse(custom.text)
  const accent = parse(custom.accent)

  if (!bg || !text || !accent) {
    return null
  }

  // Convert to OKLCH for perceptually uniform manipulation
  const bgOklch = oklch(bg) as Oklch
  const accentOklch = oklch(accent) as Oklch

  if (!bgOklch || !accentOklch) {
    return null
  }

  // Determine if theme is dark (background lightness < 0.5)
  const isDark = (bgOklch.l ?? 0) < 0.5

  // Derive secondary text by interpolating between text and background
  const textSecondaryColor = interpolate([text, bg], 'oklch')(0.4)
  const textSecondary = textSecondaryColor ? formatHex(textSecondaryColor) : custom.text

  // Derive border by shifting background lightness
  const borderOklch: Oklch = {
    mode: 'oklch',
    l: isDark ? (bgOklch.l ?? 0) + 0.1 : (bgOklch.l ?? 0) - 0.1,
    c: bgOklch.c ?? 0,
    h: bgOklch.h,
  }
  const border = formatHex(borderOklch) ?? custom.background

  // Derive code background (use custom or derive from bg)
  let codeBackground: string
  if (custom.codeBackground) {
    codeBackground = custom.codeBackground
  } else {
    const codeBgOklch: Oklch = {
      mode: 'oklch',
      l: isDark ? (bgOklch.l ?? 0) + 0.05 : (bgOklch.l ?? 0) - 0.03,
      c: bgOklch.c ?? 0,
      h: bgOklch.h,
    }
    codeBackground = formatHex(codeBgOklch) ?? custom.background
  }

  // Derive link hover by shifting accent lightness
  const linkHoverOklch: Oklch = {
    mode: 'oklch',
    l: isDark ? (accentOklch.l ?? 0) + 0.1 : (accentOklch.l ?? 0) - 0.1,
    c: accentOklch.c ?? 0,
    h: accentOklch.h,
  }
  const linkHover = formatHex(linkHoverOklch) ?? custom.accent

  return {
    background: custom.background,
    text: custom.text,
    textSecondary,
    accent: custom.accent,
    border,
    codeBackground,
    codeText: custom.text,
    blockquoteBorder: border,
    blockquoteText: textSecondary,
    link: custom.accent,
    linkHover,
  }
}

/**
 * Derive full site-wide colors including sidebar and background effects
 */
export function deriveFullSiteColors(custom: CustomColors): FullSiteColors | null {
  const themeColors = deriveThemeColors(custom)
  if (!themeColors) return null

  const bg = parse(custom.background!)
  const accent = parse(custom.accent!)

  if (!bg || !accent) return null

  const bgOklch = oklch(bg) as Oklch
  const accentOklch = oklch(accent) as Oklch

  if (!bgOklch || !accentOklch) return null

  const isDark = (bgOklch.l ?? 0) < 0.5

  // Derive bgSecondary (slightly different from bg for contrast)
  const bgSecondaryOklch: Oklch = {
    mode: 'oklch',
    l: isDark ? (bgOklch.l ?? 0) + 0.03 : (bgOklch.l ?? 0) - 0.02,
    c: bgOklch.c ?? 0,
    h: bgOklch.h,
  }
  const bgSecondary = formatHex(bgSecondaryOklch) ?? custom.background!

  // Derive accent hover
  const accentHoverOklch: Oklch = {
    mode: 'oklch',
    l: isDark ? (accentOklch.l ?? 0) + 0.1 : (accentOklch.l ?? 0) - 0.1,
    c: accentOklch.c ?? 0,
    h: accentOklch.h,
  }
  const accentHover = formatHex(accentHoverOklch) ?? custom.accent!

  // Sidebar bg is same as bgSecondary
  const sidebarBg = bgSecondary

  // Grid color: border with low opacity (as rgba string)
  // Parse border color and create rgba
  const borderColor = parse(themeColors.border)
  const borderRgb = borderColor ? formatHex(borderColor) : themeColors.border
  const gridColor = `${borderRgb}40` // 25% opacity

  // Vignette color: different approach for light vs dark themes
  // Light themes: use accent color with very low opacity (subtle colored glow)
  // Dark themes: use background color with higher opacity (darkening vignette)
  const accentHex = formatHex(accent) ?? custom.accent!
  const bgHex = formatHex(bg) ?? custom.background!
  const vignetteColor = isDark ? `${bgHex}99` : `${accentHex}0d` // 60% bg for dark, 5% accent for light

  return {
    ...themeColors,
    bgSecondary,
    accentHover,
    sidebarBg,
    gridColor,
    vignetteColor,
  }
}

/**
 * Get the effective theme preset to use
 */
export function getEffectiveTheme(theme?: Theme): ThemePreset {
  return theme?.preset || 'default'
}

/**
 * Apply custom colors as CSS custom properties
 * Derives all 11 theme variables from the 3-4 input colors
 */
export function getCustomColorStyles(custom?: CustomColors): React.CSSProperties {
  if (!custom) return {}

  const colors = deriveThemeColors(custom)
  if (!colors) {
    // Fallback to simple mapping if derivation fails
    const styles: React.CSSProperties & Record<string, string> = {}
    if (custom.background) styles['--theme-bg'] = custom.background
    if (custom.text) styles['--theme-text'] = custom.text
    if (custom.accent) {
      styles['--theme-accent'] = custom.accent
      styles['--theme-link'] = custom.accent
    }
    if (custom.codeBackground) styles['--theme-code-bg'] = custom.codeBackground
    return styles
  }

  return {
    '--theme-bg': colors.background,
    '--theme-text': colors.text,
    '--theme-text-secondary': colors.textSecondary,
    '--theme-accent': colors.accent,
    '--theme-border': colors.border,
    '--theme-code-bg': colors.codeBackground,
    '--theme-code-text': colors.codeText,
    '--theme-blockquote-border': colors.blockquoteBorder,
    '--theme-blockquote-text': colors.blockquoteText,
    '--theme-link': colors.link,
    '--theme-link-hover': colors.linkHover,
  } as React.CSSProperties
}

/**
 * Check if a theme is dark (default follows site theme, so we check separately)
 */
export function isDarkTheme(preset: ThemePreset): boolean {
  if (preset === 'default') {
    // Default theme follows site theme - check current site theme
    return document.documentElement.getAttribute('data-site-theme') === 'dark'
  }
  return ['github-dark', 'dracula', 'nord', 'solarized-dark', 'monokai'].includes(preset)
}
