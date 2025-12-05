import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDarkMode } from '@/lib/useDarkMode'

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

function ExternalLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  )
}

function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <circle cx="16" cy="16" r="14" className="fill-[var(--site-accent)]" />
      <path
        d="M16 8c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0 14c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z"
        fill="white"
        fillOpacity="0.3"
      />
      <path
        d="M16 10v8M12 14l4-4 4 4"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface SidebarProps {
  children: React.ReactNode
}

export function Sidebar({ children }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isDark, toggleTheme } = useDarkMode()
  const location = useLocation()

  const navLinks = [
    { to: '/', label: 'Home', icon: HomeIcon },
  ]

  const externalLinks = [
    { href: 'https://bsky.app', label: 'Bluesky' },
    { href: 'https://atproto.com', label: 'AT Protocol' },
  ]

  const SidebarContent = () => (
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

        <div className="pt-4 mt-4 border-t border-[var(--sidebar-border)]">
          <p className="px-3 mb-2 text-xs font-medium uppercase tracking-wider text-[var(--site-text-secondary)]">
            Links
          </p>
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

      {/* Theme Toggle */}
      <div className="p-4 border-t border-[var(--sidebar-border)]">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
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
        <SidebarContent />
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block fixed top-0 left-0 bottom-0 w-64 z-30 sidebar">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen relative z-10">
        {children}
      </main>
    </div>
  )
}
