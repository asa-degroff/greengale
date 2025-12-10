import { useState, useMemo } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { AuthorCard } from './AuthorCard'
import { getCustomColorStyles, correctCustomColorsContrast, type Theme } from '@/lib/themes'
import { useThemePreference } from '@/lib/useThemePreference'
import type { AuthorProfile } from '@/lib/atproto'

interface BlogViewerProps {
  content: string
  title?: string
  subtitle?: string
  createdAt?: string
  theme?: Theme
  latex?: boolean
  author?: AuthorProfile
  source?: 'whitewind' | 'greengale'
}

// Check if content has SVG code blocks that will be transformed by remark-svg
// Matches: ```svg or ```xml followed by <svg (matching remark-svg plugin logic)
function hasSvgCodeBlock(content: string): boolean {
  // Direct svg language code block
  if (/^```svg\s*$/m.test(content)) {
    return true
  }
  // XML code block containing SVG (must start with <svg after the fence)
  const xmlBlockMatch = content.match(/^```xml\s*\n\s*(<svg[\s>])/m)
  return !!xmlBlockMatch
}

export function BlogViewer({
  content,
  title,
  subtitle,
  createdAt,
  theme,
  latex = false,
  author,
  source,
}: BlogViewerProps) {
  const { forceDefaultTheme } = useThemePreference()
  const [showRaw, setShowRaw] = useState(false)

  // Determine if this post has special content that benefits from a raw view
  // Only show toggle for LaTeX or ```svg code blocks (content our plugins transform)
  const hasSpecialContent = useMemo(() => {
    return latex || hasSvgCodeBlock(content)
  }, [latex, content])

  // Custom color overrides (inline styles) - theme preset is now applied globally via data-active-theme
  // Don't apply custom styles if user has "Use Default Style" enabled
  // Apply contrast correction to ensure readability for externally-created posts
  const correctedColors = theme?.custom ? correctCustomColorsContrast(theme.custom) : undefined
  const customStyles = forceDefaultTheme ? {} : getCustomColorStyles(correctedColors)

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <article
      style={customStyles}
      className="min-h-screen text-[var(--theme-text)]"
    >
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          {title && (
            <h1 className="text-3xl md:text-4xl font-bold mb-2 text-[var(--theme-text)]">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-xl text-[var(--theme-text-secondary)] mb-4">
              {subtitle}
            </p>
          )}
          <div className="flex items-center gap-4 text-sm text-[var(--theme-text-secondary)]">
            {formattedDate && <time dateTime={createdAt}>{formattedDate}</time>}
            {source && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--theme-code-bg)]">
                {source === 'whitewind' ? 'WhiteWind' : 'GreenGale'}
              </span>
            )}
          </div>
        </header>

        {/* Author and View Toggle */}
        <div className="mb-8 flex items-center justify-between">
          {author ? (
            <AuthorCard author={author} />
          ) : (
            <div /> /* Spacer when no author */
          )}
          {hasSpecialContent && (
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-secondary)] transition-colors"
              title={showRaw ? 'Show formatted view' : 'Show raw markdown'}
            >
              {showRaw ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                  <span>Formatted</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                  </svg>
                  <span>Raw</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Content */}
        {showRaw ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm p-4 rounded-lg bg-[var(--theme-code-bg)] text-[var(--theme-text)] overflow-x-auto">
            {content}
          </pre>
        ) : (
          <div className="prose max-w-none">
            <MarkdownRenderer content={content} enableLatex={latex} />
          </div>
        )}
      </div>
    </article>
  )
}
