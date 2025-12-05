import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { ThemePreset } from './themes'

interface ThemePreferenceState {
  /** User's preferred theme for the site and posts with default theme */
  preferredTheme: ThemePreset
  /** User preference to force default theme on all posts */
  forceDefaultTheme: boolean
  /** The current post's theme (null when not viewing a post) */
  activePostTheme: ThemePreset | null
  /** The effective theme to apply (respects all overrides) */
  effectiveTheme: ThemePreset
}

interface ThemePreferenceContextValue extends ThemePreferenceState {
  setPreferredTheme: (theme: ThemePreset) => void
  setForceDefaultTheme: (force: boolean) => void
  setActivePostTheme: (theme: ThemePreset | null) => void
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null)

const FORCE_DEFAULT_KEY = 'force-default-theme'
const PREFERRED_THEME_KEY = 'preferred-theme'

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

  const [activePostTheme, setActivePostTheme] = useState<ThemePreset | null>(null)

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

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-active-theme', effectiveTheme)

    return () => {
      // Reset to default when unmounting (shouldn't happen, but safety)
      document.documentElement.setAttribute('data-active-theme', 'default')
    }
  }, [effectiveTheme])

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
        forceDefaultTheme,
        activePostTheme,
        effectiveTheme,
        setPreferredTheme,
        setForceDefaultTheme,
        setActivePostTheme,
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
