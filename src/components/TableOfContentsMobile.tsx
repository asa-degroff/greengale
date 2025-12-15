import { useState } from 'react'
import { TableOfContents } from './TableOfContents'
import type { TocHeading } from '@/lib/extractHeadings'

interface TableOfContentsMobileProps {
  headings: TocHeading[]
  activeId: string | null
}

export function TableOfContentsMobile({
  headings,
  activeId,
}: TableOfContentsMobileProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (headings.length === 0) {
    return null
  }

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="toc-mobile-overlay"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div className={`toc-mobile-drawer ${isOpen ? 'toc-mobile-drawer--open' : ''}`}>
        <div className="toc-mobile-header">
          <span className="toc-mobile-title">Contents</span>
          <button
            onClick={() => setIsOpen(false)}
            className="toc-mobile-close"
            aria-label="Close table of contents"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <TableOfContents
          headings={headings}
          activeId={activeId}
          className="toc-mobile-content"
          onNavigate={() => setIsOpen(false)}
        />
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`toc-mobile-toggle ${isOpen ? 'toc-mobile-toggle--hidden' : ''}`}
        aria-label="Open table of contents"
        aria-expanded={isOpen}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h16M4 18h7"
          />
        </svg>
      </button>
    </>
  )
}
