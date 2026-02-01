import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDarkMode } from '@/lib/useDarkMode'
import { useAuth } from '@/lib/auth'
import { useThemePreference } from '@/lib/useThemePreference'
import { THEME_PRESETS, THEME_LABELS, type ThemePreset, getPresetColors, type CustomColors } from '@/lib/themes'
import { getRecentPalettes, type SavedPalette } from '@/lib/palettes'
import { useRecentAuthors } from '@/lib/useRecentAuthors'
import { AnimatedGridBackground } from '@/components/AnimatedGridBackground'
import { LoadingCubeInline } from '@/components/LoadingCube'
import { TextLogo } from '@/components/TextLogo'
import { SidebarSearch } from '@/components/SidebarSearch'
import { checkWebGPUSupport, type RGB } from '@/lib/webgpu-grid'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import logoImage from '/grey-logo.avif?url'

// Icons as inline SVGs
function MenuIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function CloseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SunIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function MoonIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function HomeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function PencilIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function LogoutIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline strokeLinecap="round" strokeLinejoin="round" points="16 17 21 12 16 7" />
      <line strokeLinecap="round" x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function ExternalLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  )
}

function ChainLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function BookIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function PaletteIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" />
    </svg>
  )
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function BlueskyIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 568 501" fill="currentColor">
      <path d="M123.121 33.6637C188.241 82.5526 258.281 181.681 284 234.873C309.719 181.681 379.759 82.5526 444.879 33.6637C491.866 -1.61183 568 -28.9064 568 57.9464C568 75.2916 558.055 203.659 552.222 224.501C531.947 296.954 458.067 315.434 392.347 304.249C507.222 323.8 536.444 388.56 473.333 453.32C353.473 576.312 301.061 422.461 287.631 383.039C285.169 391.291 284.017 395.095 284 394.018C283.983 395.095 282.831 391.291 280.369 383.039C266.939 422.461 214.527 576.312 94.6667 453.32C31.5556 388.56 60.7778 323.8 175.653 304.249C109.933 315.434 36.0535 296.954 15.7778 224.501C9.94525 203.659 0 75.2916 0 57.9464C0 -28.9064 76.1345 -1.61183 123.121 33.6637Z" />
    </svg>
  )
}

function GitHubIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function CoffeeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.013-.322-3.094c-.037-.351-.286-.695-.678-.678-.336.015-.718.3-.678.679l.228 2.185.949 9.112c.147 1.344 1.174 2.068 2.446 2.272.742.12 1.503.144 2.257.156.966.016 1.942.053 2.892-.122 1.408-.258 2.465-1.198 2.616-2.657.34-3.332.683-6.663 1.024-9.995l.215-2.087a.484.484 0 01.39-.426c.402-.078.787-.212 1.074-.518.455-.488.546-1.124.385-1.766zm-1.478.772c-.145.137-.363.201-.578.233-2.416.359-4.866.54-7.308.46-1.748-.06-3.477-.254-5.207-.498-.17-.024-.353-.055-.47-.18-.22-.236-.111-.71-.054-.995.052-.26.152-.609.463-.646.484-.057 1.046.148 1.526.22.577.088 1.156.159 1.737.212 2.48.226 5.002.19 7.472-.14.45-.06.899-.13 1.345-.21.399-.072.84-.206 1.08.206.166.281.188.657.162.974a.544.544 0 01-.169.364z" />
    </svg>
  )
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function Logo({ className = '' }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-md`}
      style={{
        backgroundColor: 'var(--site-accent)',
        WebkitMaskImage: `url(${logoImage})`,
        maskImage: `url(${logoImage})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  )
}

interface BlueskyActor {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

// Login form as a separate component to prevent re-renders from affecting input focus
function LoginForm({
  onLogin,
  onCancel,
  isLoading,
  error,
}: {
  onLogin: (handle: string) => Promise<void>
  onCancel: () => void
  isLoading: boolean
  error: string | null
}) {
  const [loginHandle, setLoginHandle] = useState('')
  const [results, setResults] = useState<BlueskyActor[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchActors = useCallback(async (query: string) => {
    const trimmed = query.replace(/^@/, '').trim()
    if (trimmed.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(trimmed)}&limit=8`
      )
      if (res.ok) {
        const data = await res.json()
        const actors: BlueskyActor[] = data.actors || []
        setResults(actors)
        setIsOpen(actors.length > 0)
        setSelectedIndex(-1)
      }
    } catch {
      // silently fail — user can still type manually
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setLoginHandle(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchActors(value), 300)
  }

  const selectActor = (actor: BlueskyActor) => {
    setLoginHandle(actor.handle)
    setIsOpen(false)
    setResults([])
    onLogin(actor.handle)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loginHandle.trim()) {
      setIsOpen(false)
      await onLogin(loginHandle.trim().replace(/^@/, ''))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      selectActor(results[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      setSelectedIndex(-1)
    }
  }

  // Click outside closes dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Re-focus shows existing results
  const handleFocus = () => {
    if (results.length > 0) setIsOpen(true)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div ref={containerRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={loginHandle}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="handle.bsky.social"
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="login-autocomplete-list"
          aria-activedescendant={selectedIndex >= 0 ? `login-option-${selectedIndex}` : undefined}
        />
        {loading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-[var(--site-text-secondary)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {isOpen && results.length > 0 && (
          <ul
            ref={listRef}
            id="login-autocomplete-list"
            role="listbox"
            className="absolute bottom-full mb-1 left-0 right-0 max-h-64 overflow-y-auto rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] shadow-lg z-50"
          >
            {results.map((actor, i) => (
              <li
                key={actor.did}
                id={`login-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
              >
                <button
                  type="button"
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--site-bg-secondary)] transition-colors ${
                    i === selectedIndex ? 'bg-[var(--site-bg-secondary)]' : ''
                  }`}
                  onClick={() => selectActor(actor)}
                  tabIndex={-1}
                >
                  {actor.avatar ? (
                    <img
                      src={actor.avatar}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[var(--site-bg-secondary)] flex items-center justify-center flex-shrink-0">
                      <UserIcon className="w-4 h-4 text-[var(--site-text-secondary)]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {actor.displayName && (
                      <div className="text-sm font-medium text-[var(--site-text)] truncate">
                        {actor.displayName}
                      </div>
                    )}
                    <div className="text-xs text-[var(--site-text-secondary)] truncate">
                      @{actor.handle}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-500 px-1">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 px-3 py-2 text-sm bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors disabled:opacity-50"
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

interface SidebarProps {
  children: React.ReactNode
}

export function Sidebar({ children }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLoginForm, setShowLoginForm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTheme, setShowTheme] = useState(false)
  const [showLinks, setShowLinks] = useState(false)
  const [showRecents, setShowRecents] = useState(false)
  const { isDark, toggleTheme } = useDarkMode()
  const location = useLocation()
  const { isAuthenticated, isLoading, handle, login, logout, error } = useAuth()
  const { forceDefaultTheme, setForceDefaultTheme, activePostTheme, activeCustomColors, preferredTheme, setPreferredTheme, preferredCustomColors, setPreferredCustomColors, effectiveTheme } = useThemePreference()
  const { recentAuthors } = useRecentAuthors()
  const { isOnline } = useNetworkStatus()

  // Easter egg: animated grid background
  const [animatedGridEnabled, setAnimatedGridEnabled] = useState(false)
  const [webGPUSupported, setWebGPUSupported] = useState(false)
  const [themeColors, setThemeColors] = useState<{ grid: RGB; bg: RGB }>({
    grid: [0.3, 0.35, 0.25],
    bg: [0.02, 0.01, 0.03],
  })
  const middleClickCount = useRef(0)
  const middleClickTimer = useRef<number | undefined>(undefined)

  // Check WebGPU support on mount
  useEffect(() => {
    checkWebGPUSupport().then(setWebGPUSupported)
  }, [])

  // Parse theme colors from CSS variables when theme changes
  useEffect(() => {
    const parseColor = (cssValue: string): RGB => {
      // Use a canvas to convert any CSS color to RGB
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      if (!ctx) return [0.3, 0.35, 0.25]

      ctx.fillStyle = cssValue
      ctx.fillRect(0, 0, 1, 1)
      const imageData = ctx.getImageData(0, 0, 1, 1).data

      return [
        imageData[0] / 255,
        imageData[1] / 255,
        imageData[2] / 255,
      ]
    }

    const updateColors = () => {
      const style = getComputedStyle(document.documentElement)
      const gridColorRaw = style.getPropertyValue('--grid-color').trim()
      const bgColorRaw = style.getPropertyValue('--site-bg').trim()

      setThemeColors({
        grid: parseColor(gridColorRaw),
        bg: parseColor(bgColorRaw),
      })
    }

    // Use requestAnimationFrame to ensure inline styles (for custom themes) are applied
    const frameId = requestAnimationFrame(() => {
      updateColors()
    })

    return () => cancelAnimationFrame(frameId)
  }, [effectiveTheme, isDark, preferredTheme, preferredCustomColors, activeCustomColors])

  // Triple middle-click detection for easter egg (global listener)
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Middle button = 1
      if (e.button !== 1) return

      middleClickCount.current++
      window.clearTimeout(middleClickTimer.current)

      if (middleClickCount.current >= 3) {
        setAnimatedGridEnabled((prev) => {
          console.log('[Easter Egg] Animated grid:', !prev ? 'enabled' : 'disabled')
          return !prev
        })
        middleClickCount.current = 0
      } else {
        middleClickTimer.current = window.setTimeout(() => {
          middleClickCount.current = 0
        }, 500)
      }
    }

    window.addEventListener('mousedown', handleMouseDown)
    return () => window.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // Disable text selection when animated grid is active (prevents interference with drag ripples)
  useEffect(() => {
    if (animatedGridEnabled) {
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.userSelect = ''
    }
    return () => {
      document.body.style.userSelect = ''
    }
  }, [animatedGridEnabled])

  // Local state for custom color inputs
  const [customColors, setCustomColors] = useState<CustomColors>(() => {
    if (preferredCustomColors) {
      return preferredCustomColors
    }
    // Default to GitHub Light colors
    const defaults = getPresetColors('github-light')
    return {
      background: defaults.background,
      text: defaults.text,
      accent: defaults.accent,
    }
  })

  // Recent palettes for quick custom theme selection
  const [recentPalettes, setRecentPalettes] = useState<SavedPalette[]>([])

  // Load recent palettes when theme section opens with custom selected
  useEffect(() => {
    if (showTheme && preferredTheme === 'custom') {
      setRecentPalettes(getRecentPalettes())
    }
  }, [showTheme, preferredTheme])

  const navLinks = [
    { to: '/', label: 'Home', icon: HomeIcon },
  ]

  const externalLinks = [
    { href: 'https://bsky.app/profile/greengale.app', label: '@greengale.app', icon: BlueskyIcon },
    { href: 'https://github.com/asa-degroff/greengale', label: 'GitHub', icon: GitHubIcon },
    { href: 'https://greengale.app/greengale.app/3md4qenz7b72o', label: 'Lexicon Docs', icon: BookIcon },
    { href: 'https://atproto.com', label: 'AT Protocol', icon: ExternalLinkIcon },
    { href: 'https://buymeacoffee.com/asadegroff', label: 'Donate', icon: CoffeeIcon },
  ]

  const legalLinks = [
    { to: '/terms', label: 'Terms' },
    { to: '/privacy', label: 'Privacy Policy' },
  ]

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-[var(--sidebar-border)]">
        <Link to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
          <Logo className="w-8 h-8" />
          <TextLogo className="h-5 text-[var(--site-text)]" />
          {!isOnline && (
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Offline">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728" />
              <line x1="2" y1="2" x2="22" y2="22" strokeLinecap="round" />
            </svg>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {/* Search */}
        <SidebarSearch onMobileClose={() => setMobileOpen(false)} />

        {navLinks.map((link) => {
          const Icon = link.icon
          const isActive = location.pathname === link.to
          return (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-[var(--site-accent)] text-white'
                  : 'sidebar-link hover:bg-[var(--site-bg-secondary)]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{link.label}</span>
            </Link>
          )
        })}

        {/* New Post - for authenticated users */}
        {isAuthenticated && (
          <Link
            to="/new"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              location.pathname === '/new'
                ? 'bg-[var(--site-accent)] text-white'
                : 'sidebar-link hover:bg-[var(--site-bg-secondary)]'
            }`}
          >
            <PencilIcon className="w-5 h-5" />
            <span>New Post</span>
          </Link>
        )}

        <div className="pt-4 mt-4 border-t border-[var(--sidebar-border)]">
          <button
            onClick={() => setShowLinks(!showLinks)}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
          >
            <ChainLinkIcon className="w-5 h-5" />
            <span>Links</span>
            <ChevronDownIcon className={`w-4 h-4 ml-auto text-[var(--site-text-secondary)] transition-transform ${showLinks ? 'rotate-180' : ''}`} />
          </button>
          {showLinks && (
            <div className="mt-1 space-y-1">
              {externalLinks.map((link) => {
                const Icon = link.icon
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2 pl-11 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)]"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{link.label}</span>
                  </a>
                )
              })}
              <div className="border-t border-[var(--sidebar-border)] my-1" />
              {legalLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 pl-11 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)]"
                >
                  <BookIcon className="w-4 h-4" />
                  <span>{link.label}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recents Section - only show if there are recent authors */}
        {recentAuthors.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowRecents(!showRecents)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              <ClockIcon className="w-5 h-5" />
              <span>Recents</span>
              <ChevronDownIcon className={`w-4 h-4 ml-auto text-[var(--site-text-secondary)] transition-transform ${showRecents ? 'rotate-180' : ''}`} />
            </button>
            {showRecents && (
              <div className="mt-1 space-y-1">
                {recentAuthors.map((author) => (
                  <Link
                    key={author.handle}
                    to={`/${author.handle}`}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 pl-11 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)]"
                  >
                    {author.avatarUrl ? (
                      <img
                        src={author.avatarUrl}
                        alt=""
                        className="w-5 h-5 rounded-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[var(--site-border)] flex items-center justify-center">
                        <UserIcon className="w-3 h-3 text-[var(--site-text-secondary)]" />
                      </div>
                    )}
                    <span className="truncate">{author.displayName || `@${author.handle}`}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-[var(--sidebar-border)] space-y-2">
        {/* Theme Row */}
        <button
          onClick={() => setShowTheme(!showTheme)}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
        >
          <PaletteIcon className="w-5 h-5" />
          <span>Theme</span>
          <ChevronDownIcon className={`w-4 h-4 ml-auto text-[var(--site-text-secondary)] transition-transform ${showTheme ? 'rotate-180' : ''}`} />
        </button>

        {showTheme && (
          <div className="mt-1 mx-2 p-2 rounded-lg bg-[var(--site-bg-secondary)] border border-[var(--site-border)]">
            {/* Light/Dark Toggle */}
            {effectiveTheme === 'default' && (
              <button
                onClick={toggleTheme}
                className="flex items-center gap-3 w-full px-2 py-1.5 rounded hover:bg-[var(--site-bg)] transition-colors"
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                <span className="text-sm text-[var(--site-text)]">{isDark ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            )}

            {/* Theme Override Toggle */}
            {activePostTheme && activePostTheme !== 'default' && (
              <button
                onClick={() => setForceDefaultTheme(!forceDefaultTheme)}
                className={`flex items-center gap-3 w-full px-2 py-1.5 rounded transition-colors ${
                  forceDefaultTheme
                    ? 'bg-[var(--site-accent)] text-white'
                    : 'hover:bg-[var(--site-bg)]'
                }`}
                aria-label={forceDefaultTheme ? 'Use post theme' : 'Use preferred theme'}
              >
                <PaletteIcon className="w-4 h-4" />
                <span className="text-sm">{forceDefaultTheme ? 'Use Post Style' : 'Use Preferred Style'}</span>
              </button>
            )}

            {/* Preferred Theme */}
            <div className="mt-2">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-[var(--site-text-secondary)]">
                Preferred Theme
              </p>
              <select
                value={preferredTheme}
                onChange={(e) => setPreferredTheme(e.target.value as ThemePreset)}
                className="w-full mt-1 px-2 py-1.5 text-base rounded border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
              >
                {THEME_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {THEME_LABELS[preset]}
                  </option>
                ))}
              </select>
              <p className="mt-1 px-2 text-xs text-[var(--site-text-secondary)]">
                Applies to home and posts with default theme. Overrides light/dark mode.
              </p>
            </div>

            {webGPUSupported && (
              <label className="flex items-center gap-2 px-2 mt-3 cursor-pointer">
                <span className="relative flex items-center justify-center w-5 h-5">
                  <input
                    type="checkbox"
                    checked={animatedGridEnabled}
                    onChange={(e) => setAnimatedGridEnabled(e.target.checked)}
                    className="peer appearance-none w-5 h-5 rounded border-2 border-[var(--site-border)] bg-[var(--site-bg)] checked:bg-[var(--site-accent)] checked:border-[var(--site-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] focus:ring-offset-0 transition-colors cursor-pointer"
                  />
                  <svg
                    className="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="text-sm text-[var(--site-text)]">Wavy Mode</span>
              </label>
            )}

            {preferredTheme === 'custom' && (
              <div className="mt-3 pt-3 border-t border-[var(--site-border)]">
                <p className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-[var(--site-text-secondary)]">
                  Custom Colors
                </p>
                {recentPalettes.length > 0 && (
                  <div className="mt-1.5 px-2">
                    <p className="text-xs text-[var(--site-text-secondary)] mb-1">Recent:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {recentPalettes.map((palette, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            const updated = {
                              background: palette.background,
                              text: palette.text,
                              accent: palette.accent,
                            }
                            setCustomColors(updated)
                            setPreferredCustomColors(updated)
                          }}
                          className="flex rounded overflow-hidden border border-[var(--site-border)] hover:border-[var(--site-accent)] transition-colors"
                          title={`${palette.background} / ${palette.text} / ${palette.accent}`}
                        >
                          <div className="w-5 h-5" style={{ backgroundColor: palette.background }} />
                          <div className="w-5 h-5" style={{ backgroundColor: palette.text }} />
                          <div className="w-5 h-5" style={{ backgroundColor: palette.accent }} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 px-2">
                    <input
                      type="color"
                      value={customColors.background || '#ffffff'}
                      onChange={(e) => {
                        const updated = { ...customColors, background: e.target.value }
                        setCustomColors(updated)
                        setPreferredCustomColors(updated)
                      }}
                      className="w-8 h-8 shrink-0 rounded cursor-pointer appearance-none border border-[var(--site-border)] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-0"
                    />
                    <span className="text-sm text-[var(--site-text)]">Background</span>
                  </div>
                  <div className="flex items-center gap-2 px-2">
                    <input
                      type="color"
                      value={customColors.text || '#24292f'}
                      onChange={(e) => {
                        const updated = { ...customColors, text: e.target.value }
                        setCustomColors(updated)
                        setPreferredCustomColors(updated)
                      }}
                      className="w-8 h-8 shrink-0 rounded cursor-pointer appearance-none border border-[var(--site-border)] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-0"
                    />
                    <span className="text-sm text-[var(--site-text)]">Text</span>
                  </div>
                  <div className="flex items-center gap-2 px-2">
                    <input
                      type="color"
                      value={customColors.accent || '#0969da'}
                      onChange={(e) => {
                        const updated = { ...customColors, accent: e.target.value }
                        setCustomColors(updated)
                        setPreferredCustomColors(updated)
                      }}
                      className="w-8 h-8 shrink-0 rounded cursor-pointer appearance-none border border-[var(--site-border)] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-0"
                    />
                    <span className="text-sm text-[var(--site-text)]">Accent</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* My Blog - standalone row for authenticated users */}
        {isAuthenticated && handle && (
          <Link
            to={`/${handle}`}
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
          >
            <BookIcon className="w-5 h-5" />
            <span>My Blog</span>
          </Link>
        )}

        {/* Account Section */}
        {isLoading ? (
          <div className="flex items-center gap-3 px-3 py-2 text-[var(--site-text-secondary)]">
            <LoadingCubeInline />
            <span>Loading...</span>
          </div>
        ) : isAuthenticated ? (
          <>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-3 px-3 py-2 w-full rounded-lg hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              <UserIcon className="w-5 h-5 text-[var(--site-text-secondary)]" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-[var(--site-text)] truncate">
                  @{handle}
                </p>
                <p className="text-xs text-[var(--site-text-secondary)]">Signed in</p>
              </div>
              <ChevronDownIcon className={`w-4 h-4 text-[var(--site-text-secondary)] transition-transform ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            {showSettings && (
              <div className="mt-1 ml-2 space-y-1">
                <button
                  onClick={logout}
                  className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
                >
                  <LogoutIcon className="w-5 h-5" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </>
        ) : showLoginForm ? (
          <LoginForm
            onLogin={login}
            onCancel={() => setShowLoginForm(false)}
            isLoading={isLoading}
            error={error}
          />
        ) : (
          <button
            onClick={() => setShowLoginForm(true)}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
          >
            <UserIcon className="w-5 h-5" />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen">
      {/* Background effects */}
      {animatedGridEnabled && webGPUSupported ? (
        <AnimatedGridBackground gridColor={themeColors.grid} bgColor={themeColors.bg} />
      ) : (
        <div className="grid-background" aria-hidden="true" />
      )}
      <div className="vignette-overlay" aria-hidden="true" />

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 px-4 flex items-center justify-between bg-[var(--site-bg)]/95 backdrop-blur-sm border-b border-[var(--site-border)]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-[var(--site-bg-secondary)] text-[var(--site-text-secondary)]"
            aria-label="Open menu"
          >
            <MenuIcon className="w-6 h-6" />
          </button>
          <Link to="/" className="flex items-center gap-2">
            <Logo className="w-7 h-7" />
            <TextLogo className="h-4 text-[var(--site-text)]" />
          </Link>
        </div>
        {/* Only show theme toggle when effective theme is default (light/dark mode matters) */}
        {effectiveTheme === 'default' && (
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-[var(--site-bg-secondary)] text-[var(--site-text-secondary)]"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
          </button>
        )}
      </header>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 drawer-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-64 sidebar transform transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-[var(--site-bg-secondary)] text-[var(--site-text-secondary)]"
          aria-label="Close menu"
        >
          <CloseIcon className="w-5 h-5" />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block fixed top-0 left-0 bottom-0 w-64 z-30 sidebar">
        {sidebarContent}
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 pt-14 lg:pt-0 relative z-10">
        {children}
      </main>
    </div>
  )
}
