import { useState, useMemo, useCallback } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { AuthorCard } from './AuthorCard'
import { TableOfContents } from './TableOfContents'
import { TableOfContentsMobile } from './TableOfContentsMobile'
import { BlueskyInteractions } from './BlueskyInteractions'
import { AudioPlayer } from './AudioPlayer'
import { getCustomColorStyles, correctCustomColorsContrast, type Theme } from '@/lib/themes'
import { useThemePreference } from '@/lib/useThemePreference'
import { extractHeadings } from '@/lib/extractHeadings'
import { useScrollSpy } from '@/lib/useScrollSpy'
import { useTTS } from '@/lib/useTTS'
import { extractTextForTTS } from '@/lib/tts'
import type { AuthorProfile, BlogEntry } from '@/lib/atproto'

interface BlogViewerProps {
  content: string
  title?: string
  subtitle?: string
  createdAt?: string
  theme?: Theme
  latex?: boolean
  author?: AuthorProfile
  source?: 'whitewind' | 'greengale'
  blobs?: BlogEntry['blobs']
  postUrl?: string
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
  blobs,
  postUrl,
}: BlogViewerProps) {
  const { forceDefaultTheme } = useThemePreference()
  const [showRaw, setShowRaw] = useState(false)

  // TTS hook
  const tts = useTTS()
  const isTTSActive = tts.state.status !== 'idle'
  const isTTSLoading = tts.state.status === 'loading-model'

  const handleListenClick = useCallback(() => {
    if (isTTSActive) {
      tts.stop()
    } else {
      const text = extractTextForTTS(content)
      if (text.trim()) {
        tts.start(text)
      }
    }
  }, [content, isTTSActive, tts])

  // Determine if this post has special content that benefits from a raw view
  // Only show toggle for LaTeX or ```svg code blocks (content our plugins transform)
  const hasSpecialContent = useMemo(() => {
    return latex || hasSvgCodeBlock(content)
  }, [latex, content])

  // Extract headings for table of contents
  const headings = useMemo(() => extractHeadings(content), [content])
  const headingIds = useMemo(() => headings.map((h) => h.id), [headings])
  const { activeId } = useScrollSpy(headingIds)

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
      <div className={`max-w-3xl mx-auto px-4 py-8 ${isTTSActive ? 'pb-24' : ''}`}>
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
          <div className="flex items-center gap-2">
            {/* Listen Button */}
            <button
              onClick={handleListenClick}
              disabled={isTTSLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isTTSActive ? 'Stop listening' : 'Listen to this post'}
            >
              {isTTSLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Loading...</span>
                </>
              ) : isTTSActive ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                  </svg>
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  <span>Listen</span>
                </>
              )}
            </button>

            {/* Raw/Formatted Toggle */}
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
        </div>

        {/* Content */}
        {showRaw ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm p-4 rounded-lg bg-[var(--theme-code-bg)] text-[var(--theme-text)] overflow-x-auto">
            {content}
          </pre>
        ) : (
          <div className="prose max-w-none">
            <MarkdownRenderer
              content={content}
              enableLatex={latex}
              blobs={blobs}
              currentSentence={tts.state.currentSentence}
              onSentenceClick={isTTSActive && !isTTSLoading ? tts.seek : undefined}
            />
          </div>
        )}

        {/* Bluesky Interactions */}
        {postUrl && (
          <BlueskyInteractions postUrl={postUrl} postTitle={title} />
        )}
      </div>

      {/* Desktop Table of Contents - only show when there's enough room */}
      {/* At 1700px+: content (768px) centered in main area (viewport-256px sidebar) leaves enough space */}
      {headings.length > 0 && (
        <aside className="hidden min-[1610px]:block fixed right-8 top-24 w-64 toc-desktop">
          <TableOfContents headings={headings} activeId={activeId} />
        </aside>
      )}

      {/* Mobile Table of Contents - show when desktop TOC is hidden */}
      {headings.length > 0 && (
        <div className="min-[1610px]:hidden">
          <TableOfContentsMobile headings={headings} activeId={activeId} />
        </div>
      )}

      {/* Audio Player (also handles loading state) */}
      {isTTSActive && (
        <AudioPlayer
          state={tts.state}
          playbackState={tts.playbackState}
          onPause={tts.pause}
          onResume={tts.resume}
          onStop={tts.stop}
          onPlaybackRateChange={tts.setPlaybackRate}
        />
      )}
    </article>
  )
}
