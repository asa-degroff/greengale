import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { ImageLightbox } from './ImageLightbox'
import { ContentWarningImage } from './ContentWarningImage'
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
}

export function MarkdownRenderer({
  content,
  enableLatex = false,
  enableSvg = true,
  className = '',
  disableLightbox = false,
  blobs,
}: MarkdownRendererProps) {
  const [rendered, setRendered] = useState<ReactNode>(null)
  const [error, setError] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{
    src: string
    alt: string
    labels?: ContentLabelValue[]
  } | null>(null)

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

  // Handle clicks on images to open lightbox
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disableLightbox) return

      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement
        e.preventDefault()
        openLightbox(img.src, img.alt || '')
      }
    },
    [disableLightbox, openLightbox]
  )

  // Create custom img component that wraps labeled images
  const CustomImage = useMemo(() => {
    return function CustomImg(props: Record<string, unknown>) {
      const { src, alt, ...rest } = props
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

      return (
        <img
          src={srcStr}
          alt={finalAlt}
          className="cursor-zoom-in"
          {...rest}
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
        className={`markdown-body ${className}`}
        onClick={handleContentClick}
        style={disableLightbox ? undefined : { cursor: 'default' }}
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
