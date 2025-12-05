import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDarkMode } from '@/lib/useDarkMode'
import { useAuth } from '@/lib/auth'
import { useThemePreference } from '@/lib/useThemePreference'
import { THEME_PRESETS, THEME_LABELS, type ThemePreset } from '@/lib/themes'
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

function SettingsIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loginHandle.trim()) {
      await onLogin(loginHandle.trim().replace('@', ''))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        value={loginHandle}
        onChange={(e) => setLoginHandle(e.target.value)}
        placeholder="handle.bsky.social"
        className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
        autoFocus
      />
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
  const { isDark, toggleTheme } = useDarkMode()
  const location = useLocation()
  const { isAuthenticated, isWhitelisted, isLoading, handle, login, logout, error } = useAuth()
  const { forceDefaultTheme, setForceDefaultTheme, activePostTheme, preferredTheme, setPreferredTheme } = useThemePreference()

  const navLinks = [
    { to: '/', label: 'Home', icon: HomeIcon },
  ]

  const externalLinks = [
    { href: 'https://bsky.app', label: 'Bluesky' },
    { href: 'https://atproto.com', label: 'AT Protocol' },
  ]

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-[var(--sidebar-border)]">
        <Link to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
          <Logo className="w-8 h-8" />
          <span className="text-lg font-bold text-[var(--site-text)]">GreenGale</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
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

        {/* New Post - only for whitelisted users */}
        {isAuthenticated && isWhitelisted && (
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
          <p className="px-3 mb-2 text-xs font-medium uppercase tracking-wider text-[var(--site-text-secondary)]">
            Links
          </p>
          <a
            href="https://bsky.app/profile/greengale.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)]"
          >
            <BlueskyIcon className="w-4 h-4" />
            <span>@greengale.app</span>
          </a>
          {externalLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)]"
            >
              <ExternalLinkIcon className="w-4 h-4" />
              <span>{link.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-[var(--sidebar-border)] space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-3 px-3 py-2 text-[var(--site-text-secondary)]">
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
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
                {isWhitelisted ? (
                  <p className="text-xs text-[var(--site-accent)]">Beta Access</p>
                ) : (
                  <p className="text-xs text-[var(--site-text-secondary)]">Read Only</p>
                )}
              </div>
              <ChevronDownIcon className={`w-4 h-4 text-[var(--site-text-secondary)] transition-transform ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            {/* Settings Dropdown */}
            {showSettings && (
              <div className="mt-1 mx-2 p-2 rounded-lg bg-[var(--site-bg-secondary)] border border-[var(--site-border)]">
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
            )}

            {handle && (
              <Link
                to={`/${handle}`}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
              >
                <BookIcon className="w-5 h-5" />
                <span>My Blog</span>
              </Link>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              <LogoutIcon className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </>
        ) : showLoginForm ? (
          <LoginForm
            onLogin={login}
            onCancel={() => setShowLoginForm(false)}
            isLoading={isLoading}
            error={error}
          />
        ) : (
          <>
            <button
              onClick={() => setShowLoginForm(true)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              <UserIcon className="w-5 h-5" />
              <span>Sign In</span>
            </button>

            {/* Settings for non-authenticated users */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              <SettingsIcon className="w-5 h-5" />
              <span>Settings</span>
              <ChevronDownIcon className={`w-4 h-4 ml-auto text-[var(--site-text-secondary)] transition-transform ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            {showSettings && (
              <div className="mt-1 mx-2 p-2 rounded-lg bg-[var(--site-bg-secondary)] border border-[var(--site-border)]">
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
            )}
          </>
        )}

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        {/* Theme Override Toggle - show when viewing a post with non-default theme */}
        {activePostTheme && activePostTheme !== 'default' && (
          <button
            onClick={() => setForceDefaultTheme(!forceDefaultTheme)}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors ${
              forceDefaultTheme
                ? 'bg-[var(--site-accent)] text-white'
                : 'sidebar-link hover:bg-[var(--site-bg-secondary)]'
            }`}
            aria-label={forceDefaultTheme ? 'Use post themes' : 'Use default styling'}
          >
            <PaletteIcon className="w-5 h-5" />
            <span>{forceDefaultTheme ? 'Using Default' : 'Use Default Style'}</span>
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen">
      {/* Background effects */}
      <div className="grid-background" aria-hidden="true" />
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
            <span className="font-bold text-[var(--site-text)]">GreenGale</span>
          </Link>
        </div>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-[var(--site-bg-secondary)] text-[var(--site-text-secondary)]"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
        </button>
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
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen relative z-10">
        {children}
      </main>
    </div>
  )
}
