export type ThemePreset =
  | 'default'
  | 'github-light'
  | 'github-dark'
  | 'dracula'
  | 'nord'
  | 'solarized-light'
  | 'solarized-dark'
  | 'monokai'

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
}

/**
 * Get the effective theme preset to use
 */
export function getEffectiveTheme(theme?: Theme): ThemePreset {
  return theme?.preset || 'default'
}

/**
 * Apply custom colors as CSS custom properties
 */
export function getCustomColorStyles(custom?: CustomColors): React.CSSProperties {
  if (!custom) return {}

  const styles: React.CSSProperties & Record<string, string> = {}

  if (custom.background) {
    styles['--theme-bg'] = custom.background
  }
  if (custom.text) {
    styles['--theme-text'] = custom.text
  }
  if (custom.accent) {
    styles['--theme-accent'] = custom.accent
    styles['--theme-link'] = custom.accent
  }
  if (custom.codeBackground) {
    styles['--theme-code-bg'] = custom.codeBackground
  }

  return styles
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
