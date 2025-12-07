import { parse, formatHex, oklch, interpolate, type Oklch } from 'culori'

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
  codeBackground: string
}

const PRESET_COLORS: Record<Exclude<ThemePreset, 'default' | 'custom'>, PresetColors> = {
  'github-light': {
    background: '#ffffff',
    text: '#24292f',
    accent: '#0969da',
    codeBackground: '#f6f8fa',
  },
  'github-dark': {
    background: '#0d1117',
    text: '#c9d1d9',
    accent: '#58a6ff',
    codeBackground: '#161b22',
  },
  dracula: {
    background: '#282a36',
    text: '#f8f8f2',
    accent: '#bd93f9',
    codeBackground: '#1e1f29',
  },
  nord: {
    background: '#2e3440',
    text: '#eceff4',
    accent: '#88c0d0',
    codeBackground: '#3b4252',
  },
  'solarized-light': {
    background: '#fdf6e3',
    text: '#657b83',
    accent: '#268bd2',
    codeBackground: '#eee8d5',
  },
  'solarized-dark': {
    background: '#002b36',
    text: '#839496',
    accent: '#268bd2',
    codeBackground: '#073642',
  },
  monokai: {
    background: '#272822',
    text: '#f8f8f2',
    accent: '#a6e22e',
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

  // Vignette color: based on accent with very low opacity
  const accentHex = formatHex(accent) ?? custom.accent!
  const vignetteColor = isDark ? `${accentHex}0d` : `${accentHex}08` // 5% or 3% opacity

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
