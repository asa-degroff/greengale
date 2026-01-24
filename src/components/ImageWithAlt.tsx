import { useState, useEffect, useRef } from 'react'

interface ImageWithAltProps {
  src: string
  alt: string
  className?: string
  onClick?: () => void
}

/**
 * Image component with accessible alt text display
 *
 * Shows a small "ALT" badge when alt text is available.
 * Users can hover/click to view the full alt text.
 * Follows WCAG guidelines for image accessibility.
 */
export function ImageWithAlt({
  src,
  alt,
  className = '',
  onClick,
}: ImageWithAltProps) {
  const [showAltText, setShowAltText] = useState(false)
  const hasAlt = alt && alt.trim().length > 0
  const containerRef = useRef<HTMLSpanElement>(null)

  // Close alt text panel when clicking outside
  useEffect(() => {
    if (!showAltText) return

    // Track whether listener was added to ensure proper cleanup
    let listenerAdded = false

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowAltText(false)
      }
    }

    // Use requestAnimationFrame to defer to next frame, avoiding immediate trigger
    // from the opening click while ensuring deterministic cleanup
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('click', handleClickOutside)
      listenerAdded = true
    })

    return () => {
      cancelAnimationFrame(rafId)
      if (listenerAdded) {
        document.removeEventListener('click', handleClickOutside)
      }
    }
  }, [showAltText])

  const handleImageClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault()
      onClick()
    }
  }

  const handleAltBadgeClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowAltText(!showAltText)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setShowAltText(!showAltText)
    }
    if (e.key === 'Escape') {
      setShowAltText(false)
    }
  }

  // For images without alt text, render a simple img with empty alt for decorative images
  if (!hasAlt) {
    return (
      <img
        src={src}
        alt=""
        role="presentation"
        className={`cursor-zoom-in ${className}`}
        onClick={handleImageClick}
        decoding="async"
      />
    )
  }

  return (
    <span ref={containerRef} className="image-with-alt-container inline-block relative">
      <img
        src={src}
        alt={alt}
        className={`cursor-zoom-in ${className}`}
        onClick={handleImageClick}
        decoding="async"
      />

      {/* ALT badge - visible indicator that alt text is available */}
      <button
        type="button"
        onClick={handleAltBadgeClick}
        onKeyDown={handleKeyDown}
        className="alt-badge absolute bottom-2 left-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-black/70 text-white rounded hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
        aria-label={showAltText ? 'Hide image description' : 'Show image description'}
        aria-expanded={showAltText}
        aria-controls="alt-text-panel"
      >
        ALT
      </button>

      {/* Alt text panel - shown when badge is clicked */}
      {showAltText && (
        <span
          id="alt-text-panel"
          role="tooltip"
          className="absolute bottom-10 left-2 right-2 p-2 text-sm bg-black/90 text-white rounded-lg shadow-lg max-h-32 overflow-y-auto"
        >
          <span className="block font-medium text-xs text-white/60 mb-1">
            Image description:
          </span>
          <span className="block">{alt}</span>
        </span>
      )}
    </span>
  )
}
