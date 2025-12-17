import { useState, useEffect, useRef } from 'react'
import type { ContentLabelValue } from '@/lib/image-upload'
import { getLabelWarningText } from '@/lib/image-labels'

interface ContentWarningImageProps {
  src: string
  alt: string
  labels: ContentLabelValue[]
  className?: string
  onClick?: () => void
  /** Called when the user reveals the image */
  onReveal?: () => void
}

export function ContentWarningImage({
  src,
  alt,
  labels,
  className = '',
  onClick,
  onReveal,
}: ContentWarningImageProps) {
  const [revealed, setRevealed] = useState(false)
  const [showAltText, setShowAltText] = useState(false)
  const hasAlt = alt && alt.trim().length > 0
  const containerRef = useRef<HTMLSpanElement>(null)

  // Close alt text panel when clicking outside
  useEffect(() => {
    if (!showAltText) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowAltText(false)
      }
    }

    // Delay adding listener to avoid immediate trigger from the opening click
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showAltText])

  const handleReveal = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setRevealed(true)
    onReveal?.()
  }

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

  const handleAltKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setShowAltText(!showAltText)
    }
    if (e.key === 'Escape') {
      setShowAltText(false)
    }
  }

  if (revealed) {
    // Show image with ALT badge (same as ImageWithAlt but inline to avoid circular deps)
    return (
      <span ref={containerRef} className="image-with-alt-container inline-block relative">
        <img
          src={src}
          alt={alt}
          className={`cursor-zoom-in ${className}`}
          onClick={handleImageClick}
        />

        {hasAlt && (
          <>
            <button
              type="button"
              onClick={handleAltBadgeClick}
              onKeyDown={handleAltKeyDown}
              className="alt-badge absolute bottom-2 left-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-black/70 text-white rounded hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
              aria-label={showAltText ? 'Hide image description' : 'Show image description'}
              aria-expanded={showAltText}
            >
              ALT
            </button>

            {showAltText && (
              <span
                role="tooltip"
                className="absolute bottom-10 left-2 right-2 p-2 text-sm bg-black/90 text-white rounded-lg shadow-lg max-h-32 overflow-y-auto"
              >
                <span className="block font-medium text-xs text-white/60 mb-1">
                  Image description:
                </span>
                <span className="block">{alt}</span>
              </span>
            )}
          </>
        )}
      </span>
    )
  }

  // Use span elements with block display to avoid hydration errors
  // (divs cannot be nested inside p tags, which markdown uses for images)
  return (
    <span className={`content-warning-container block relative overflow-hidden rounded-lg ${className}`}>
      {/* Blurred background image */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="w-full blur-[20px] brightness-50 scale-110 select-none pointer-events-none"
      />

      {/* Warning overlay */}
      <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
        <span className="block text-center p-4 max-w-xs">
          {/* Warning icon */}
          <svg
            className="w-8 h-8 mx-auto mb-2 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>

          <span className="block text-white font-medium text-sm mb-1">
            {getLabelWarningText(labels)}
          </span>

          <span className="block text-white/60 text-xs mb-3">
            This image may contain sensitive content
          </span>

          <button
            type="button"
            onClick={handleReveal}
            className="px-4 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            Show Image
          </button>
        </span>
      </span>
    </span>
  )
}
