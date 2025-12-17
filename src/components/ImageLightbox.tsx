import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContentLabelValue } from '@/lib/image-upload'
import { getLabelWarningText } from '@/lib/image-labels'

interface ImageLightboxProps {
  src: string
  alt?: string
  labels?: ContentLabelValue[]
  onClose: () => void
}

export function ImageLightbox({ src, alt, labels, onClose }: ImageLightboxProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const hasLabels = labels && labels.length > 0
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    // Prevent body scroll while lightbox is open
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  // Show content warning screen if image has labels
  if (hasLabels && !acknowledged) {
    return createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="text-center p-8 max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Warning icon */}
          <svg
            className="w-16 h-16 mx-auto mb-4 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>

          <h2 className="text-xl font-bold text-white mb-2">Content Warning</h2>
          <p className="text-white/80 mb-2">
            This image has been marked as containing:
          </p>
          <p className="text-amber-400 font-medium mb-6">
            {getLabelWarningText(labels)}
          </p>

          <div className="flex gap-4 justify-center">
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setAcknowledged(true)}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors"
            >
              View Image
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors rounded-full hover:bg-white/10"
        aria-label="Close"
      >
        <svg
          className="w-8 h-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Image container */}
      <figure
        className="max-w-[95vw] max-h-[95vh] p-4"
        onClick={(e) => e.stopPropagation()}
        role="group"
        aria-label={alt ? `Image: ${alt}` : 'Image'}
      >
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
        {alt && (
          <figcaption className="mt-3 p-3 bg-black/50 rounded-lg max-w-2xl mx-auto">
            <span className="block text-xs font-medium text-white/50 uppercase tracking-wide mb-1">
              Image description
            </span>
            <p className="text-white/90 text-sm leading-relaxed">{alt}</p>
          </figcaption>
        )}
      </figure>
    </div>,
    document.body
  )
}
