import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" d="m21 21-4.35-4.35" />
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

interface SidebarSearchProps {
  onMobileClose?: () => void
}

export function SidebarSearch({ onMobileClose }: SidebarSearchProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // Hide on home page (which has its own search)
  const isHomePage = location.pathname === '/'
  if (isHomePage) {
    return null
  }

  function handleExpand() {
    setIsExpanded(true)
    // Focus input after state update
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleCollapse() {
    setIsExpanded(false)
    setQuery('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}&type=posts`)
      handleCollapse()
      onMobileClose?.()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      handleCollapse()
    }
  }

  // Close on navigation
  useEffect(() => {
    handleCollapse()
  }, [location.pathname])

  if (!isExpanded) {
    return (
      <button
        onClick={handleExpand}
        className="flex items-center gap-3 w-full px-3 py-2 rounded-lg sidebar-link hover:bg-[var(--site-bg-secondary)] transition-colors"
      >
        <SearchIcon className="w-5 h-5" />
        <span>Search</span>
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 py-2">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search posts..."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
        />
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--site-text-secondary)]" />
        <button
          type="button"
          onClick={handleCollapse}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
    </form>
  )
}
