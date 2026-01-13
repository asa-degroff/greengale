import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { ImageLightbox } from './ImageLightbox'
import { ContentWarningImage } from './ContentWarningImage'
import { ImageWithAlt } from './ImageWithAlt'
import { BlueskyEmbed } from './BlueskyEmbed'
import type { BlogEntry } from '@/lib/atproto'
import type { ContentLabelValue } from '@/lib/image-upload'
import {
  extractCidFromBlobUrl,
  getBlobLabelsMap,
  getBlobAltMap,
  getLabelValues,
} from '@/lib/image-labels'

interface MarkdownRendererProps {
  content: string
  enableLatex?: boolean
  enableSvg?: boolean
  className?: string
  /** Disable lightbox for images (e.g., in editor preview) */
  disableLightbox?: boolean
  /** Blob metadata for image labels and alt text */
  blobs?: BlogEntry['blobs']
  /** Current sentence being spoken by TTS (for highlighting) */
  currentSentence?: string | null
  /** Callback when user clicks on a sentence (for TTS seek) */
  onSentenceClick?: (text: string) => void
  /** Whether to auto-scroll to the current sentence (default: true) */
  autoScroll?: boolean
}

// Normalize text for comparison (collapse whitespace, lowercase)
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Strip trailing punctuation for comparison (periods added by TTS extraction)
function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?:]+$/, '')
}

// Apply TTS text transformations for matching (same as extractTextForTTS in tts.ts)
// This normalizes DOM text to match how TTS processes it (parentheses → commas, etc.)
function normalizeTTSText(text: string): string {
  return text
    .replace(/\(/g, ', ')
    .replace(/\)/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/,\s*:/g, ':')
    .replace(/(^|[\n])(\s*),\s*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Word-based fuzzy matching for TTS highlight - handles cases where inline code
// is removed from TTS text but still present in DOM (e.g., `user_handle` in DOM
// but missing from TTS sentence)
function wordsMatch(content: string, sentence: string, threshold = 0.6): boolean {
  // Extract significant words (3+ chars) from both strings
  const contentWords = new Set(
    content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
  const sentenceWords = sentence
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)

  if (sentenceWords.length === 0) return false

  const matchCount = sentenceWords.filter((w) => contentWords.has(w)).length
  return matchCount / sentenceWords.length >= threshold
}

export function MarkdownRenderer({
  content,
  enableLatex = false,
  enableSvg = true,
  className = '',
  disableLightbox = false,
  blobs,
  currentSentence,
  onSentenceClick,
  autoScroll = true,
}: MarkdownRendererProps) {
  const [rendered, setRendered] = useState<ReactNode>(null)
  const [error, setError] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{
    src: string
    alt: string
    labels?: ContentLabelValue[]
  } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Track which images have been revealed by the user (to skip warning in lightbox)
  const revealedImagesRef = useRef<Set<string>>(new Set())

  // Track last highlighted element index for proximity-based matching
  const lastHighlightIndexRef = useRef<number>(-1)

  // Build lookup maps for blob metadata
  const labelsMap = useMemo(() => getBlobLabelsMap(blobs), [blobs])
  const altMap = useMemo(() => getBlobAltMap(blobs), [blobs])

  // Handle opening lightbox for an image
  const openLightbox = useCallback(
    (src: string, alt: string) => {
      if (disableLightbox) return
      const cid = extractCidFromBlobUrl(src)
      const imageLabels = cid ? labelsMap.get(cid) : undefined
      // Skip labels if user already revealed the image on the page
      const wasRevealed = revealedImagesRef.current.has(src)
      setLightboxImage({
        src,
        alt,
        labels: wasRevealed ? undefined : (imageLabels ? getLabelValues(imageLabels) : undefined),
      })
    },
    [disableLightbox, labelsMap]
  )

  // Mark an image as revealed
  const markImageRevealed = useCallback((src: string) => {
    revealedImagesRef.current.add(src)
  }, [])

  // Handle clicks on images to open lightbox and text blocks for TTS seek
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement

      // Handle image clicks for lightbox
      if (target.tagName === 'IMG' && !disableLightbox) {
        const img = target as HTMLImageElement
        e.preventDefault()
        openLightbox(img.src, img.alt || '')
        return
      }

      // Handle text clicks for TTS seek
      if (onSentenceClick) {
        // Find the closest block-level element
        const blockElement = target.closest(
          'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd'
        )
        if (blockElement) {
          const text = blockElement.textContent?.trim()
          if (text) {
            onSentenceClick(text)
          }
        }
      }
    },
    [disableLightbox, openLightbox, onSentenceClick]
  )

  // Create custom img component that wraps labeled images
  const CustomImage = useMemo(() => {
    return function CustomImg(props: Record<string, unknown>) {
      const { src, alt } = props
      const srcStr = typeof src === 'string' ? src : ''
      const altStr = typeof alt === 'string' ? alt : ''

      if (!srcStr) return null

      const cid = extractCidFromBlobUrl(srcStr)
      // Get alt text from blob metadata if available, fall back to markdown alt
      const blobAlt = cid ? altMap.get(cid) : undefined
      const finalAlt = blobAlt || altStr
      // Check for content labels
      const imageLabels = cid ? labelsMap.get(cid) : undefined
      const labelValues = imageLabels ? getLabelValues(imageLabels) : []

      if (labelValues.length > 0) {
        return (
          <ContentWarningImage
            src={srcStr}
            alt={finalAlt}
            labels={labelValues}
            onClick={() => openLightbox(srcStr, finalAlt)}
            onReveal={() => markImageRevealed(srcStr)}
          />
        )
      }

      // Use ImageWithAlt for accessible alt text display
      return (
        <ImageWithAlt
          src={srcStr}
          alt={finalAlt}
          onClick={() => openLightbox(srcStr, finalAlt)}
        />
      )
    }
  }, [labelsMap, altMap, openLightbox, markImageRevealed])

  // Create custom span component that handles Bluesky embeds
  const CustomSpan = useMemo(() => {
    return function CustomSpanComponent(props: Record<string, unknown>) {
      const { children, className, ...restProps } = props
      const classStr = typeof className === 'string' ? className : ''

      // Check if this is a Bluesky embed placeholder
      // Format: bluesky-embed bsky-h-{base64url(handle)} bsky-r-{rkey}
      if (classStr.includes('bluesky-embed')) {
        const classes = classStr.split(' ')
        const handleClass = classes.find(c => c.startsWith('bsky-h-'))
        const rkeyClass = classes.find(c => c.startsWith('bsky-r-'))

        if (handleClass && rkeyClass) {
          // Decode the base64url-encoded handle
          const encodedHandle = handleClass.replace('bsky-h-', '')
          const rkey = rkeyClass.replace('bsky-r-', '')

          try {
            // Restore base64 padding and decode
            const base64 = encodedHandle.replace(/-/g, '+').replace(/_/g, '/')
            const padding = (4 - (base64.length % 4)) % 4
            const paddedBase64 = base64 + '='.repeat(padding)
            const handle = atob(paddedBase64)

            console.log('[CustomSpan] Bluesky embed decoded:', { handle, rkey })
            return <BlueskyEmbed handle={handle} rkey={rkey} />
          } catch (e) {
            console.error('[CustomSpan] Failed to decode Bluesky embed:', e)
          }
        }
      }

      // Default: render as a normal span
      return <span className={classStr} {...(restProps as React.HTMLAttributes<HTMLSpanElement>)}>{children as ReactNode}</span>
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const result = await renderMarkdown(content, {
          enableLatex,
          enableSvg,
          components: { img: CustomImage, span: CustomSpan },
        })
        if (!cancelled) {
          setRendered(result)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render markdown')
        }
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [content, enableLatex, enableSvg, blobs, CustomImage, CustomSpan])

  // Handle initial hash navigation after content renders
  useEffect(() => {
    if (rendered && window.location.hash) {
      const id = window.location.hash.slice(1)
      const element = document.getElementById(id)
      if (element) {
        // Small delay to ensure DOM is fully painted
        requestAnimationFrame(() => {
          element.scrollIntoView()
        })
      }
    }
  }, [rendered])

  // Highlight the current sentence being spoken by TTS
  useEffect(() => {
    const container = contentRef.current
    if (!container || !currentSentence) {
      // Clear any existing highlights when no sentence
      if (container) {
        container.querySelectorAll('.tts-highlight').forEach((el) => {
          el.classList.remove('tts-highlight')
        })
      }
      // Reset proximity tracking when TTS stops
      lastHighlightIndexRef.current = -1
      return
    }

    const normalizedSentence = normalizeText(currentSentence)
    if (!normalizedSentence) return

    // Also prepare sentence without trailing punctuation (for list items where
    // extractTextForTTS adds periods that aren't in the original markdown)
    const sentenceNoPunct = stripTrailingPunctuation(normalizedSentence)

    // Find block-level elements that could contain the sentence
    // Convert to array for index-based proximity tracking
    const blockElements = Array.from(
      container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd')
    )

    let bestMatch: Element | null = null
    let bestMatchIndex = -1
    let bestScore = 0

    const lastIndex = lastHighlightIndexRef.current

    for (let i = 0; i < blockElements.length; i++) {
      const element = blockElements[i]
      const textContent = element.textContent || ''
      const normalizedContent = normalizeText(textContent)
      const contentNoPunct = stripTrailingPunctuation(normalizedContent)

      // Also normalize DOM content with TTS transformations (parentheses → commas)
      // This allows matching TTS text against original DOM text
      const ttsNormalizedContent = normalizeTTSText(textContent)
      const ttsContentNoPunct = stripTrailingPunctuation(ttsNormalizedContent)

      // Check if this element contains the sentence (try multiple matching strategies)
      const matches =
        normalizedContent.includes(normalizedSentence) || // exact match
        normalizedContent.includes(sentenceNoPunct) || // sentence without trailing punct
        contentNoPunct === sentenceNoPunct || // exact match after stripping punct from both
        ttsNormalizedContent.includes(normalizedSentence) || // match with TTS normalization
        ttsNormalizedContent.includes(sentenceNoPunct) || // TTS normalized without punct
        ttsContentNoPunct === sentenceNoPunct || // TTS normalized exact match
        // Fuzzy word matching as fallback - handles inline code removal where TTS
        // strips `code` but DOM still contains the text
        wordsMatch(normalizedContent, sentenceNoPunct)

      if (matches) {
        // Base score: prefer shorter matches (more specific)
        const baseScore = 1 / textContent.length

        // Proximity bonus: prefer elements near the last highlight
        // This helps with short sentences that match multiple locations
        let proximityBonus = 0
        if (lastIndex >= 0) {
          if (i === lastIndex + 1) {
            // Immediately after last highlight - strong bonus
            proximityBonus = 0.5
          } else if (i > lastIndex && i <= lastIndex + 3) {
            // Within 3 elements after - moderate bonus
            proximityBonus = 0.3
          } else if (i === lastIndex) {
            // Same element (multi-sentence paragraph) - small bonus
            proximityBonus = 0.1
          }
          // Elements before or far after get no bonus but aren't penalized
        } else {
          // No previous highlight (TTS just started) - strongly prefer elements
          // near the start of the document. This prevents matching a similar
          // heading further down when the title/intro matches multiple places.
          if (i < 5) {
            proximityBonus = 0.5 * (1 - i / 5) // 0.5, 0.4, 0.3, 0.2, 0.1
          }
        }

        const score = baseScore + proximityBonus

        if (score > bestScore) {
          bestScore = score
          bestMatch = element
          bestMatchIndex = i
        }
      }
    }

    // Clear previous highlights
    container.querySelectorAll('.tts-highlight').forEach((el) => {
      el.classList.remove('tts-highlight')
    })

    // Apply new highlight and update position tracking
    if (bestMatch) {
      bestMatch.classList.add('tts-highlight')
      lastHighlightIndexRef.current = bestMatchIndex
      // Scroll into view if auto-scroll is enabled
      if (autoScroll) {
        bestMatch.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    }
  }, [currentSentence, autoScroll])

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        <p className="font-medium">Error rendering content</p>
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  if (!rendered) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-full mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6 mb-4"></div>
      </div>
    )
  }

  return (
    <>
      <div
        ref={contentRef}
        className={`markdown-body ${className} ${onSentenceClick ? 'tts-seekable' : ''}`}
        onClick={handleContentClick}
        style={disableLightbox && !onSentenceClick ? undefined : { cursor: 'default' }}
      >
        {rendered}
      </div>

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          labels={lightboxImage.labels}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  )
}
