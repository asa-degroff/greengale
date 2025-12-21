import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { ImageLightbox } from './ImageLightbox'
import { ContentWarningImage } from './ContentWarningImage'
import { ImageWithAlt } from './ImageWithAlt'
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

export function MarkdownRenderer({
  content,
  enableLatex = false,
  enableSvg = true,
  className = '',
  disableLightbox = false,
  blobs,
  currentSentence,
  onSentenceClick,
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

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const result = await renderMarkdown(content, {
          enableLatex,
          enableSvg,
          components: { img: CustomImage },
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
  }, [content, enableLatex, enableSvg, blobs, CustomImage])

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
      return
    }

    const normalizedSentence = normalizeText(currentSentence)
    if (!normalizedSentence) return

    // Also prepare sentence without trailing punctuation (for list items where
    // extractTextForTTS adds periods that aren't in the original markdown)
    const sentenceNoPunct = stripTrailingPunctuation(normalizedSentence)

    // Find block-level elements that could contain the sentence
    const blockElements = container.querySelectorAll(
      'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd'
    )

    let bestMatch: Element | null = null
    let bestScore = 0

    for (const element of blockElements) {
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
        ttsContentNoPunct === sentenceNoPunct // TTS normalized exact match

      if (matches) {
        // Prefer shorter matches (more specific)
        const score = 1 / textContent.length
        if (score > bestScore) {
          bestScore = score
          bestMatch = element
        }
      }
    }

    // Clear previous highlights
    container.querySelectorAll('.tts-highlight').forEach((el) => {
      el.classList.remove('tts-highlight')
    })

    // Apply new highlight and scroll into view
    if (bestMatch) {
      bestMatch.classList.add('tts-highlight')
      // Scroll into view with some margin from top
      bestMatch.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [currentSentence])

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
