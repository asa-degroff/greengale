// Theme color resolution for workers (server-side)
// Mirrors frontend presets from src/lib/themes.ts

export interface ThemeColors {
  background: string
  text: string
  accent: string
  textSecondary: string
  gridColor: string
  vignetteColor: string
}

export interface CustomColors {
  background?: string
  text?: string
  accent?: string
}

const PRESET_COLORS: Record<string, ThemeColors> = {
  // GreenGale default green theme - matches the site's green color palette
  default: {
    background: '#f7fbf7', // Mint Creme - oklch(99% 0.06 155)
    text: '#0d2b1a', // Black Metal - oklch(10% 0.124 158)
    accent: '#2d5a3f', // Ficus Elastica - oklch(42% 0.103 157)
    textSecondary: '#3d6b4f', // O Tannenbaum - oklch(38% 0.106 157)
    gridColor: 'rgba(164, 207, 178, 0.3)', // Big Spender with opacity
    vignetteColor: 'rgba(45, 90, 63, 0.08)', // O Tannenbaum with low opacity
  },
  'github-light': {
    background: '#ffffff',
    text: '#24292f',
    accent: '#0969da',
    textSecondary: '#656d76',
    gridColor: 'rgba(208, 215, 222, 0.4)',
    vignetteColor: 'rgba(9, 105, 218, 0.05)',
  },
  'github-dark': {
    background: '#0d1117',
    text: '#c9d1d9',
    accent: '#58a6ff',
    textSecondary: '#8b949e',
    gridColor: 'rgba(48, 54, 61, 0.6)',
    vignetteColor: 'rgba(13, 17, 23, 0.5)',
  },
  dracula: {
    background: '#282a36',
    text: '#f8f8f2',
    accent: '#bd93f9',
    textSecondary: '#6272a4',
    gridColor: 'rgba(68, 71, 90, 0.5)',
    vignetteColor: 'rgba(40, 42, 54, 0.6)',
  },
  nord: {
    background: '#2e3440',
    text: '#eceff4',
    accent: '#88c0d0',
    textSecondary: '#d8dee9',
    gridColor: 'rgba(76, 86, 106, 0.5)',
    vignetteColor: 'rgba(46, 52, 64, 0.6)',
  },
  'solarized-light': {
    background: '#fdf6e3',
    text: '#657b83',
    accent: '#268bd2',
    textSecondary: '#93a1a1',
    gridColor: 'rgba(238, 232, 213, 0.6)',
    vignetteColor: 'rgba(38, 139, 210, 0.05)',
  },
  'solarized-dark': {
    background: '#002b36',
    text: '#839496',
    accent: '#268bd2',
    textSecondary: '#586e75',
    gridColor: 'rgba(7, 54, 66, 0.6)',
    vignetteColor: 'rgba(0, 43, 54, 0.6)',
  },
  monokai: {
    background: '#272822',
    text: '#f8f8f2',
    accent: '#a6e22e',
    textSecondary: '#75715e',
    gridColor: 'rgba(62, 61, 50, 0.5)',
    vignetteColor: 'rgba(39, 40, 34, 0.6)',
  },
}

const DEFAULT_COLORS = PRESET_COLORS['default']

/**
 * Resolve theme colors from a preset name or custom colors
 * Falls back to GreenGale default if preset not found
 */
export function resolveThemeColors(
  preset?: string | null,
  custom?: CustomColors | null
): ThemeColors {
  // If custom colors are provided, derive secondary text and grid/vignette from them
  if (custom?.background && custom?.text && custom?.accent) {
    const isDark = getRelativeLuminance(custom.background) < 0.5
    return {
      background: custom.background,
      text: custom.text,
      accent: custom.accent,
      // Derive secondary text (simplified - just use same as text with opacity effect via color)
      textSecondary: blendColors(custom.text, custom.background, 0.4),
      // Derive grid color from border (blend of text and background)
      gridColor: addAlpha(blendColors(custom.text, custom.background, 0.7), isDark ? 0.5 : 0.3),
      // Derive vignette from accent (light themes) or background (dark themes)
      vignetteColor: isDark
        ? addAlpha(custom.background, 0.6)
        : addAlpha(custom.accent, 0.05),
    }
  }

  // Look up preset
  if (preset && PRESET_COLORS[preset]) {
    return PRESET_COLORS[preset]
  }

  // Default to GreenGale green theme
  return DEFAULT_COLORS
}

/**
 * Check if theme colors are dark (background luminance < 0.5)
 */
export function isDarkTheme(colors: ThemeColors): boolean {
  return getRelativeLuminance(colors.background) < 0.5
}

/**
 * Calculate relative luminance of a hex color
 */
function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0.5

  const toLinear = (c: number) => {
    const srgb = c / 255
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!match) return null
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  }
}

/**
 * Blend two hex colors
 */
function blendColors(color1: string, color2: string, ratio: number): string {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)
  if (!rgb1 || !rgb2) return color1

  const r = Math.round(rgb1.r * (1 - ratio) + rgb2.r * ratio)
  const g = Math.round(rgb1.g * (1 - ratio) + rgb2.g * ratio)
  const b = Math.round(rgb1.b * (1 - ratio) + rgb2.b * ratio)

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Add alpha to a hex color, returning rgba()
 */
function addAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}
