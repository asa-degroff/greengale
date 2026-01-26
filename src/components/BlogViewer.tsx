import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
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
import { useTTSSettings } from '@/lib/useTTSSettings'
import { extractTextForTTSAsync, isDiscussionSentence } from '@/lib/tts'
import type { AuthorProfile, BlogEntry, VoiceTheme } from '@/lib/atproto'
import { DEFAULT_VOICE } from '@/lib/tts'

interface BlogViewerProps {
  content: string
  title?: string
  subtitle?: string
  createdAt?: string
  theme?: Theme
  latex?: boolean
  author?: AuthorProfile
  source?: 'whitewind' | 'greengale' | 'network'
  blobs?: BlogEntry['blobs']
  postUrl?: string
  tags?: string[]
  publicationVoiceTheme?: VoiceTheme
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

// Check if content has any fenced code blocks
function hasCodeBlock(content: string): boolean {
  return /^```\w*\s*$/m.test(content)
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
  tags,
  publicationVoiceTheme,
}: BlogViewerProps) {
  const { forceDefaultTheme } = useThemePreference()
  const [showRaw, setShowRaw] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  // TTS hooks
  const tts = useTTS()
  const ttsSettings = useTTSSettings()
  const isTTSActive = tts.state.status !== 'idle'
  const isTTSLoading = tts.state.status === 'loading-model'

  // Track whether TTS is currently reading the discussions section.
  // When in discussions mode, we pass currentSentence only to BlueskyInteractions
  // to prevent MarkdownRenderer from fuzzy-matching Bluesky post content.
  const inDiscussionsSectionRef = useRef(false)
  const [inDiscussionsSection, setInDiscussionsSection] = useState(false)

  useEffect(() => {
    const sentence = tts.state.currentSentence

    if (!sentence) {
      // TTS stopped - reset to main content mode
      inDiscussionsSectionRef.current = false
      setInDiscussionsSection(false)
      return
    }

    // Detect entry into discussions section by checking for marker sentences
    if (isDiscussionSentence(sentence) && !inDiscussionsSectionRef.current) {
      // Entering discussions section
      inDiscussionsSectionRef.current = true
      setInDiscussionsSection(true)
    }
    // Once in discussions mode, stay there until TTS stops.
    // Don't try to auto-detect "return to main" because discussion posts
    // often quote or reference text from the blog.
  }, [tts.state.currentSentence])

  const handleListenClick = useCallback(async () => {
    if (isTTSActive) {
      tts.stop()
    } else {
      const text = await extractTextForTTSAsync(content, blobs, postUrl)
      if (text.trim()) {
        // Apply settings precedence: Publication theme > User localStorage > Global defaults
        // Publication theme takes priority so authors can set the intended voice for their content
        const effectiveVoice = publicationVoiceTheme?.voice
          || ttsSettings.settings.voice
          || DEFAULT_VOICE

        const effectivePitch = (publicationVoiceTheme?.pitch as typeof ttsSettings.settings.pitch)
          || ttsSettings.settings.pitch
          || 1.0

        const effectiveSpeed = (publicationVoiceTheme?.speed as typeof ttsSettings.settings.speed)
          || ttsSettings.settings.speed
          || 1.0

        // Start TTS with effective settings
        tts.start(text, {
          voice: effectiveVoice,
          pitch: effectivePitch,
          speed: effectiveSpeed,
        })
      }
    }
  }, [content, blobs, postUrl, isTTSActive, tts, ttsSettings.settings, publicationVoiceTheme])

  // Callbacks that update both TTS and persist settings
  const handleVoiceChange = useCallback((voice: string) => {
    tts.setVoice(voice)
    ttsSettings.setVoice(voice)
  }, [tts, ttsSettings])

  const handlePitchChange = useCallback((pitch: Parameters<typeof tts.setPitch>[0]) => {
    tts.setPitch(pitch)
    ttsSettings.setPitch(pitch)
  }, [tts, ttsSettings])

  const handleSpeedChange = useCallback((speed: Parameters<typeof tts.setPlaybackRate>[0]) => {
    tts.setPlaybackRate(speed)
    ttsSettings.setSpeed(speed)
  }, [tts, ttsSettings])

  const handleAutoScrollChange = useCallback((autoScroll: boolean) => {
    ttsSettings.setAutoScroll(autoScroll)
  }, [ttsSettings])

  // Copy link handler - extracts primary URL (first in comma-separated list)
  const handleCopyLink = useCallback(async () => {
    if (!postUrl) return
    const primaryUrl = postUrl.split(',')[0]
    try {
      await navigator.clipboard.writeText(primaryUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy link:', err)
    }
  }, [postUrl])

  // Determine if this post has special content that benefits from a raw view
  // Show toggle for LaTeX, SVG code blocks, or any code blocks
  const hasSpecialContent = useMemo(() => {
    return latex || hasSvgCodeBlock(content) || hasCodeBlock(content)
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
      className="text-[var(--theme-text)]"
    >
      <div className={`max-w-3xl px-4 py-8 mx-auto ${headings.length > 0 ? 'min-[1350px]:max-[1609px]:mx-0 min-[1350px]:max-[1609px]:ml-[max(1rem,calc((100vw-1344px)/2))] min-[1350px]:max-[1609px]:mr-[320px]' : ''} ${isTTSActive ? 'pb-24' : ''}`}>
        {/* Header */}
        <header className="mb-8">
          {title && (
            <h1 className="text-3xl md:text-4xl font-bold font-title mb-2 text-[var(--theme-text)]">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-xl text-[var(--theme-text-secondary)] mb-4">
              {subtitle}
            </p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map((tag) => (
                <Link
                  key={tag}
                  to={`/tag/${encodeURIComponent(tag)}`}
                  className="inline-block px-3 py-1 rounded-full text-sm bg-[var(--theme-accent)]/10 text-[var(--theme-accent)] hover:bg-[var(--theme-accent)]/20 transition-colors"
                >
                  {tag}
                </Link>
              ))}
            </div>
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
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          {author ? (
            <AuthorCard author={author} />
          ) : (
            <div /> /* Spacer when no author */
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
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

            {/* Copy Link Button */}
            {postUrl && (
              <button
                onClick={handleCopyLink}
                className="flex items-center justify-center w-8 h-8 rounded-md border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-secondary)] transition-colors"
                title={linkCopied ? 'Link copied!' : 'Copy link to this post'}
              >
                {linkCopied ? (
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                  </svg>
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
              currentSentence={inDiscussionsSection ? null : tts.state.currentSentence}
              onSentenceClick={isTTSActive && !isTTSLoading ? tts.seek : undefined}
              autoScroll={ttsSettings.settings.autoScroll}
            />
          </div>
        )}

        {/* Bluesky Interactions */}
        {postUrl && (
          <BlueskyInteractions
            postUrl={postUrl}
            postTitle={title}
            currentSentence={inDiscussionsSection ? tts.state.currentSentence : null}
            onSentenceClick={isTTSActive && !isTTSLoading ? tts.seek : undefined}
          />
        )}
      </div>

      {/* Desktop Table of Contents - visible at 1350px+ */}
      {/* Between 1350-1610px: content slides left to accommodate TOC */}
      {/* Above 1610px: content centered with room for TOC */}
      {headings.length > 0 && (
        <aside className="hidden min-[1350px]:block fixed right-8 top-24 w-64 toc-desktop">
          <TableOfContents headings={headings} activeId={activeId} />
        </aside>
      )}

      {/* Mobile Table of Contents - below 1350px when desktop TOC hidden */}
      {headings.length > 0 && (
        <div className="min-[1350px]:hidden">
          <TableOfContentsMobile headings={headings} activeId={activeId} audioPlayerVisible={isTTSActive} />
        </div>
      )}

      {/* Audio Player (also handles loading state) */}
      {isTTSActive && (
        <AudioPlayer
          state={tts.state}
          playbackState={tts.playbackState}
          availableVoices={tts.availableVoices}
          currentVoice={tts.currentVoice}
          autoScroll={ttsSettings.settings.autoScroll}
          onPause={tts.pause}
          onResume={tts.resume}
          onStop={tts.stop}
          onPlaybackRateChange={handleSpeedChange}
          onPitchChange={handlePitchChange}
          onVoiceChange={handleVoiceChange}
          onAutoScrollChange={handleAutoScrollChange}
        />
      )}
    </article>
  )
}
