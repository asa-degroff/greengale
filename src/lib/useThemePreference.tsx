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
  /** User preference to force default theme on all posts */
  forceDefaultTheme: boolean
  /** The current post's theme (null when not viewing a post) */
  activePostTheme: ThemePreset | null
  /** The effective theme to apply (respects forceDefaultTheme override) */
  effectiveTheme: ThemePreset
}

interface ThemePreferenceContextValue extends ThemePreferenceState {
  setForceDefaultTheme: (force: boolean) => void
  setActivePostTheme: (theme: ThemePreset | null) => void
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null)

const STORAGE_KEY = 'force-default-theme'

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [forceDefaultTheme, setForceDefaultThemeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const [activePostTheme, setActivePostTheme] = useState<ThemePreset | null>(null)

  // Compute effective theme
  const effectiveTheme: ThemePreset = forceDefaultTheme
    ? 'default'
    : activePostTheme || 'default'

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-active-theme', effectiveTheme)

    return () => {
      // Reset to default when unmounting (shouldn't happen, but safety)
      document.documentElement.setAttribute('data-active-theme', 'default')
    }
  }, [effectiveTheme])

  const setForceDefaultTheme = useCallback((force: boolean) => {
    setForceDefaultThemeState(force)
    try {
      if (force) {
        localStorage.setItem(STORAGE_KEY, 'true')
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage not available
    }
  }, [])

  return (
    <ThemePreferenceContext.Provider
      value={{
        forceDefaultTheme,
        activePostTheme,
        effectiveTheme,
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
