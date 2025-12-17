import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { ImageLightbox } from './ImageLightbox'

interface MarkdownRendererProps {
  content: string
  enableLatex?: boolean
  enableSvg?: boolean
  className?: string
  /** Disable lightbox for images (e.g., in editor preview) */
  disableLightbox?: boolean
}

export function MarkdownRenderer({
  content,
  enableLatex = false,
  enableSvg = true,
  className = '',
  disableLightbox = false,
}: MarkdownRendererProps) {
  const [rendered, setRendered] = useState<ReactNode>(null)
  const [error, setError] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null)

  // Handle clicks on images to open lightbox
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disableLightbox) return

      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement
        e.preventDefault()
        setLightboxImage({ src: img.src, alt: img.alt || '' })
      }
    },
    [disableLightbox]
  )

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const result = await renderMarkdown(content, { enableLatex, enableSvg })
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
  }, [content, enableLatex, enableSvg])

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
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  )
}
