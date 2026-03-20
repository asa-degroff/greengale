import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { ThemePreset, CustomColors } from './themes'
import { deriveFullSiteColors, getPresetColors, DARK_THEME_PRESETS, isCustomColorsDark } from './themes'
import type { BackgroundTexture } from './background-textures'
import { generateFloralPattern, deriveCloudColor, deriveSkyGradient } from './background-textures'

// Background colors for each theme preset (used for theme-color meta tag)
// For 'default', we check the site theme (light/dark) separately
// For 'custom', the color is set dynamically based on custom colors
const THEME_BG_COLORS: Record<ThemePreset, string> = {
  'default': '#f0fff4', // Light mode default - will be overridden dynamically
  'github-light': '#ffffff',
  'github-dark': '#0d1117',
  'dracula': '#282a36',
  'nord': '#2e3440',
  'solarized-light': '#fdf6e3',
  'solarized-dark': '#002b36',
  'monokai': '#272822',
  'custom': '#ffffff', // Will be overridden by actual custom colors
}

// Dark mode background for default theme
// These must match the values in index.html inline script
const DEFAULT_DARK_BG = '#071910'  // oklch(4% 0.127 159) - dark green
const DEFAULT_LIGHT_BG = '#f0fff4' // oklch(99% 0.06 155) - mint creme

function updateThemeColor(theme: ThemePreset, customBg?: string) {
  let color: string
  if (theme === 'custom' && customBg) {
    color = customBg
  } else if (theme === 'default') {
    const isDark = document.documentElement.getAttribute('data-site-theme') === 'dark'
    color = isDark ? DEFAULT_DARK_BG : DEFAULT_LIGHT_BG
  } else {
    color = THEME_BG_COLORS[theme]
  }

  // Replace the meta element entirely instead of just updating the attribute.
  // iOS WebKit sometimes ignores attribute changes on existing meta tags and
  // doesn't repaint the status bar. Removing and reinserting forces a re-evaluation.
  const existing = document.querySelector('meta[name="theme-color"]')
  if (existing) existing.remove()
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  document.head.appendChild(meta)
}

interface ThemePreferenceState {
  /** User's preferred theme for the site and posts with default theme */
  preferredTheme: ThemePreset
  /** User's custom colors when preferredTheme is 'custom' */
  preferredCustomColors: CustomColors | null
  /** User preference to force default theme on all posts */
  forceDefaultTheme: boolean
  /** The current post's theme (null when not viewing a post) */
  activePostTheme: ThemePreset | null
  /** Custom colors for the current post (only when activePostTheme is 'custom') */
  activeCustomColors: CustomColors | null
  /** The effective theme to apply (respects all overrides) */
  effectiveTheme: ThemePreset
  /** User's preferred background texture (persisted) */
  backgroundTexture: BackgroundTexture
  /** The current post/publication's background texture (null when not viewing a post) */
  activePostTexture: BackgroundTexture | null
  /** The effective background texture to render (respects forceDefaultTheme) */
  effectiveBackgroundTexture: BackgroundTexture
}

interface ThemePreferenceContextValue extends ThemePreferenceState {
  setPreferredTheme: (theme: ThemePreset) => void
  setPreferredCustomColors: (colors: CustomColors | null) => void
  setForceDefaultTheme: (force: boolean) => void
  setActivePostTheme: (theme: ThemePreset | null) => void
  setActiveCustomColors: (colors: CustomColors | null) => void
  setBackgroundTexture: (texture: BackgroundTexture) => void
  setActivePostTexture: (texture: BackgroundTexture | null) => void
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null)

const FORCE_DEFAULT_KEY = 'force-default-theme'
const PREFERRED_THEME_KEY = 'preferred-theme'
const PREFERRED_CUSTOM_COLORS_KEY = 'preferred-custom-colors'
const BACKGROUND_TEXTURE_KEY = 'background-texture'

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preferredTheme, setPreferredThemeState] = useState<ThemePreset>(() => {
    try {
      const stored = localStorage.getItem(PREFERRED_THEME_KEY)
      return (stored as ThemePreset) || 'default'
    } catch {
      return 'default'
    }
  })

  const [forceDefaultTheme, setForceDefaultThemeState] = useState(() => {
    try {
      return localStorage.getItem(FORCE_DEFAULT_KEY) === 'true'
    } catch {
      return false
    }
  })

  const [preferredCustomColors, setPreferredCustomColorsState] = useState<CustomColors | null>(() => {
    try {
      const stored = localStorage.getItem(PREFERRED_CUSTOM_COLORS_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const [activePostTheme, setActivePostTheme] = useState<ThemePreset | null>(null)
  const [activeCustomColors, setActiveCustomColors] = useState<CustomColors | null>(null)
  const [activePostTexture, setActivePostTexture] = useState<BackgroundTexture | null>(null)

  const [backgroundTexture, setBackgroundTextureState] = useState<BackgroundTexture>(() => {
    try {
      const stored = localStorage.getItem(BACKGROUND_TEXTURE_KEY)
      return (stored as BackgroundTexture) || 'grid'
    } catch {
      return 'grid'
    }
  })

  // Compute effective theme:
  // 1. If forceDefaultTheme is true, use preferredTheme (user's choice)
  // 2. If viewing a post with 'default' theme, use preferredTheme
  // 3. If viewing a post with specific theme, use that theme
  // 4. If not viewing a post, use preferredTheme
  const effectiveTheme: ThemePreset = (() => {
    if (forceDefaultTheme) {
      // User wants to override all post themes
      return preferredTheme
    }
    if (activePostTheme === null) {
      // Not viewing a post - use preferred theme
      return preferredTheme
    }
    if (activePostTheme === 'default') {
      // Post uses default theme - apply user's preferred theme
      return preferredTheme
    }
    // Post has specific theme - use it
    return activePostTheme
  })()

  // Determine which custom colors to use:
  // - If forceDefaultTheme is true and user's preferred theme is custom, use preferredCustomColors
  // - If viewing a post with custom theme (and not forcing preferred), use activeCustomColors
  // - If user's preferred theme is custom (and not overridden by post), use preferredCustomColors
  const effectiveCustomColors = (() => {
    if (effectiveTheme !== 'custom') return null
    // If user is forcing their preferred theme and it's custom, use their colors
    if (forceDefaultTheme && preferredTheme === 'custom' && preferredCustomColors) {
      return preferredCustomColors
    }
    // If there's an active post with custom theme, use those colors
    if (activePostTheme === 'custom' && activeCustomColors) {
      return activeCustomColors
    }
    // Otherwise, if preferred theme is custom, use preferred colors
    if (preferredTheme === 'custom' && preferredCustomColors) {
      return preferredCustomColors
    }
    return null
  })()

  // Compute effective background texture, following the same logic as effectiveTheme:
  // 1. If forceDefaultTheme, use user's preferred texture
  // 2. If viewing a post with a texture set, use the post's texture
  // 3. If not viewing a post (or post has no texture), use user's preferred texture
  const effectiveBackgroundTexture: BackgroundTexture = (() => {
    if (forceDefaultTheme) return backgroundTexture
    if (activePostTexture !== null) return activePostTexture
    return backgroundTexture
  })()

  // Apply theme to document and update theme-color meta tag.
  // useLayoutEffect ensures DOM updates happen before the browser paints,
  // preventing a single-frame flash of wrong theme colors when navigating.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-active-theme', effectiveTheme)

    // Set data-theme-dark when the effective visual theme is dark (preset or custom).
    // For 'default' theme, the existing data-site-theme="dark" handles dark: styles.
    const isThemeDark =
      effectiveTheme === 'custom'
        ? effectiveCustomColors != null && isCustomColorsDark(effectiveCustomColors)
        : effectiveTheme !== 'default' && DARK_THEME_PRESETS.has(effectiveTheme)

    if (isThemeDark) {
      document.documentElement.setAttribute('data-theme-dark', '')
    } else {
      document.documentElement.removeAttribute('data-theme-dark')
    }

    // Apply theme colors to document root as inline styles
    // This ensures CSS variables are set with highest priority for all theme types
    const customColorProps: string[] = []
    const style = document.documentElement.style

    if (effectiveTheme === 'custom' && effectiveCustomColors) {
      // Custom theme: derive colors from user's custom colors
      const colors = deriveFullSiteColors(effectiveCustomColors)
      if (colors) {
        // Site-wide variables
        style.setProperty('--site-bg', colors.background)
        style.setProperty('--site-bg-secondary', colors.bgSecondary)
        style.setProperty('--site-text', colors.text)
        style.setProperty('--site-text-secondary', colors.textSecondary)
        style.setProperty('--site-border', colors.border)
        style.setProperty('--site-accent', colors.accent)
        style.setProperty('--site-accent-hover', colors.accentHover)
        style.setProperty('--sidebar-bg', colors.sidebarBg)
        style.setProperty('--sidebar-border', colors.border)
        style.setProperty('--grid-color', colors.gridColor)
        style.setProperty('--vignette-color', colors.vignetteColor)
        // Theme (article) variables
        style.setProperty('--theme-bg', colors.background)
        style.setProperty('--theme-text', colors.text)
        style.setProperty('--theme-text-secondary', colors.textSecondary)
        style.setProperty('--theme-accent', colors.accent)
        style.setProperty('--theme-border', colors.border)
        style.setProperty('--theme-code-bg', colors.codeBackground)
        style.setProperty('--theme-code-text', colors.codeText)
        style.setProperty('--theme-blockquote-border', colors.blockquoteBorder)
        style.setProperty('--theme-blockquote-text', colors.blockquoteText)
        style.setProperty('--theme-link', colors.link)
        style.setProperty('--theme-link-hover', colors.linkHover)

        // Track which properties we set for cleanup
        customColorProps.push(
          '--site-bg', '--site-bg-secondary', '--site-text', '--site-text-secondary',
          '--site-border', '--site-accent', '--site-accent-hover', '--sidebar-bg',
          '--sidebar-border', '--grid-color', '--vignette-color',
          '--theme-bg', '--theme-text', '--theme-text-secondary', '--theme-accent',
          '--theme-border', '--theme-code-bg', '--theme-code-text',
          '--theme-blockquote-border', '--theme-blockquote-text', '--theme-link', '--theme-link-hover'
        )

        updateThemeColor('custom', colors.background)
      } else {
        updateThemeColor(effectiveTheme)
      }
    } else if (effectiveTheme !== 'default') {
      // Preset theme: apply preset colors as inline styles to ensure they take priority
      // This fixes issues where TTS highlighting and other features need --theme-link
      const presetColors = getPresetColors(effectiveTheme)
      style.setProperty('--theme-link', presetColors.link)
      style.setProperty('--theme-accent', presetColors.accent)
      customColorProps.push('--theme-link', '--theme-accent')

      updateThemeColor(effectiveTheme)
    } else {
      // Default theme: CSS handles it via var(--site-accent)
      // Clear any leftover inline theme properties
      style.removeProperty('--theme-link')
      style.removeProperty('--theme-accent')

      updateThemeColor(effectiveTheme)
    }

    // Resolve current theme colors for texture generation
    const resolveTextureColors = () => {
      if (effectiveTheme === 'custom' && effectiveCustomColors) {
        const colors = deriveFullSiteColors(effectiveCustomColors)
        if (colors) {
          return {
            bg: colors.background,
            text: colors.text,
            accent: colors.accent,
            codeBg: colors.codeBackground,
          }
        }
      }
      // For preset/default themes, read from computed styles
      const computed = getComputedStyle(document.documentElement)
      return {
        bg: computed.getPropertyValue('--site-bg').trim(),
        text: computed.getPropertyValue('--site-text').trim(),
        accent: computed.getPropertyValue('--site-accent').trim(),
        codeBg: computed.getPropertyValue('--theme-code-bg').trim() || computed.getPropertyValue('--site-bg-secondary').trim(),
      }
    }

    // Apply background texture CSS variables (called on mount and on light/dark toggle)
    // --cloud-color is always set (used by homepage CloudField regardless of texture selection)
    const applyTextureColors = () => {
      const colors = resolveTextureColors()
      if (colors.bg) {
        // Always derive cloud color for the homepage search CloudField
        const cloudColor = deriveCloudColor(colors.bg, colors.text)
        style.setProperty('--cloud-color', cloudColor)

        // Always derive sky gradient tints for the clouds background
        const sky = deriveSkyGradient(colors.bg, colors.accent)
        style.setProperty('--sky-tint-top', sky.top)
        style.setProperty('--sky-tint-bottom', sky.bottom)

        if (effectiveBackgroundTexture === 'floral') {
          const pattern = generateFloralPattern(colors.bg, colors.text, colors.accent, colors.codeBg)
          if (pattern) {
            style.setProperty('--texture-image', pattern)
          }
        } else {
          style.removeProperty('--texture-image')
        }
      }
    }

    applyTextureColors()
    customColorProps.push('--cloud-color', '--sky-tint-top', '--sky-tint-bottom')
    if (effectiveBackgroundTexture === 'floral') customColorProps.push('--texture-image')

    // If using default theme, watch for site theme (light/dark) changes
    if (effectiveTheme === 'default') {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'data-site-theme') {
            updateThemeColor('default')
            // Regenerate texture colors after light/dark switch
            // Use rAF to ensure computed styles reflect the new theme
            requestAnimationFrame(() => applyTextureColors())
          }
        }
      })

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-site-theme'],
      })

      return () => {
        observer.disconnect()
        // Reset to default when unmounting (shouldn't happen, but safety)
        document.documentElement.setAttribute('data-active-theme', 'default')
        document.documentElement.removeAttribute('data-theme-dark')
      }
    }

    return () => {
      // Clean up custom color properties
      const style = document.documentElement.style
      for (const prop of customColorProps) {
        style.removeProperty(prop)
      }
      // Reset to default when unmounting (shouldn't happen, but safety)
      document.documentElement.setAttribute('data-active-theme', 'default')
      document.documentElement.removeAttribute('data-theme-dark')
    }
  }, [effectiveTheme, effectiveCustomColors, effectiveBackgroundTexture])

  const setPreferredTheme = useCallback((theme: ThemePreset) => {
    setPreferredThemeState(theme)
    try {
      if (theme === 'default') {
        localStorage.removeItem(PREFERRED_THEME_KEY)
      } else {
        localStorage.setItem(PREFERRED_THEME_KEY, theme)
      }
    } catch {
      // localStorage not available
    }
  }, [])

  const setPreferredCustomColors = useCallback((colors: CustomColors | null) => {
    setPreferredCustomColorsState(colors)
    try {
      if (colors) {
        localStorage.setItem(PREFERRED_CUSTOM_COLORS_KEY, JSON.stringify(colors))
      } else {
        localStorage.removeItem(PREFERRED_CUSTOM_COLORS_KEY)
      }
    } catch {
      // localStorage not available
    }
  }, [])

  const setBackgroundTexture = useCallback((texture: BackgroundTexture) => {
    setBackgroundTextureState(texture)
    try {
      if (texture === 'grid') {
        localStorage.removeItem(BACKGROUND_TEXTURE_KEY)
      } else {
        localStorage.setItem(BACKGROUND_TEXTURE_KEY, texture)
      }
    } catch {
      // localStorage not available
    }
  }, [])

  const setForceDefaultTheme = useCallback((force: boolean) => {
    setForceDefaultThemeState(force)
    try {
      if (force) {
        localStorage.setItem(FORCE_DEFAULT_KEY, 'true')
      } else {
        localStorage.removeItem(FORCE_DEFAULT_KEY)
      }
    } catch {
      // localStorage not available
    }
  }, [])

  return (
    <ThemePreferenceContext.Provider
      value={{
        preferredTheme,
        preferredCustomColors,
        forceDefaultTheme,
        activePostTheme,
        activeCustomColors,
        effectiveTheme,
        backgroundTexture,
        activePostTexture,
        effectiveBackgroundTexture,
        setPreferredTheme,
        setPreferredCustomColors,
        setForceDefaultTheme,
        setActivePostTheme,
        setActiveCustomColors,
        setBackgroundTexture,
        setActivePostTexture,
      }}
    >
      {children}
    </ThemePreferenceContext.Provider>
  )
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext)
  if (!context) {
    throw new Error('useThemePreference must be used within a ThemePreferenceProvider')
  }
  return context
}
