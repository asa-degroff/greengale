import { useEffect, useCallback, useState, useRef } from 'react'
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

  // Zoom and pan state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isHeightConstrained, setIsHeightConstrained] = useState(false)
  const [isHoveringAltZone, setIsHoveringAltZone] = useState(false)

  // Touch/pinch state
  const [touchState, setTouchState] = useState<{
    initialDistance: number
    initialZoom: number
    centerX: number
    centerY: number
  } | null>(null)

  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Helper to clamp pan values to keep image visible
  const clampPan = useCallback((panX: number, panY: number, currentZoom: number) => {
    const img = imageRef.current
    if (!img) return { x: panX, y: panY }

    // Get the base displayed size of the image (at zoom=1)
    // We need to calculate this from natural dimensions and viewport constraints
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight

    if (!naturalWidth || !naturalHeight) return { x: panX, y: panY }

    // Calculate the displayed size at zoom=1 (fitting within viewport)
    const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight, 1)
    const baseWidth = naturalWidth * scale
    const baseHeight = naturalHeight * scale

    // Scaled size at current zoom
    const scaledWidth = baseWidth * currentZoom
    const scaledHeight = baseHeight * currentZoom

    // Calculate max pan - when scaled image is larger than viewport,
    // allow panning until image edge reaches viewport edge
    // When scaled image is smaller than viewport, no panning needed
    const maxPanX = Math.max(0, (scaledWidth - viewportWidth) / 2)
    const maxPanY = Math.max(0, (scaledHeight - viewportHeight) / 2)

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, panX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, panY)),
    }
  }, [])

  // Close on Escape key, reset zoom on 'r'
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'r' || e.key === 'R') {
        setZoom(1)
        setPan({ x: 0, y: 0 })
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

  // Determine if image is height-constrained
  const checkConstraint = useCallback(() => {
    const img = imageRef.current
    if (!img || !img.naturalWidth || !img.naturalHeight) return

    const windowAspect = window.innerWidth / window.innerHeight
    const imageAspect = img.naturalWidth / img.naturalHeight

    // If image aspect ratio is taller than window, it's height-constrained
    setIsHeightConstrained(imageAspect < windowAspect)
  }, [])

  useEffect(() => {
    const img = imageRef.current
    if (img) {
      if (img.complete) {
        checkConstraint()
      } else {
        img.addEventListener('load', checkConstraint)
        return () => img.removeEventListener('load', checkConstraint)
      }
    }
  }, [checkConstraint])

  useEffect(() => {
    window.addEventListener('resize', checkConstraint)
    return () => window.removeEventListener('resize', checkConstraint)
  }, [checkConstraint])

  // Handle scroll wheel zoom (zooms toward cursor position)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const delta = e.deltaY > 0 ? 0.9 : 1.1

    // Cursor position relative to viewport center
    const viewportCenterX = window.innerWidth / 2
    const viewportCenterY = window.innerHeight / 2
    const cursorRelX = e.clientX - viewportCenterX
    const cursorRelY = e.clientY - viewportCenterY

    setZoom((prevZoom) => {
      const newZoom = Math.min(Math.max(prevZoom * delta, 0.5), 10)
      const zoomRatio = newZoom / prevZoom

      // Adjust pan to keep the point under cursor stationary
      setPan((currentPan) => {
        const newPanX = cursorRelX * (1 - zoomRatio) + currentPan.x * zoomRatio
        const newPanY = cursorRelY * (1 - zoomRatio) + currentPan.y * zoomRatio
        return clampPan(newPanX, newPanY, newZoom)
      })

      return newZoom
    })
  }, [clampPan])

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left click
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }, [pan])

  // Handle drag move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    const newPan = {
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }
    setPan(clampPan(newPan.x, newPan.y, zoom))
  }, [isDragging, dragStart, zoom, clampPan])

  // Handle drag end
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Helper to get distance between two touch points
  const getTouchDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Helper to get center point between two touches
  const getTouchCenter = (touches: React.TouchList) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  })

  // Handle touch start (for both pan and pinch)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      e.preventDefault()
      const distance = getTouchDistance(e.touches)
      const center = getTouchCenter(e.touches)
      setTouchState({
        initialDistance: distance,
        initialZoom: zoom,
        centerX: center.x,
        centerY: center.y,
      })
    } else if (e.touches.length === 1) {
      // Single touch - start pan
      setIsDragging(true)
      setDragStart({
        x: e.touches[0].clientX - pan.x,
        y: e.touches[0].clientY - pan.y,
      })
    }
  }, [zoom, pan])

  // Handle touch move (for both pan and pinch)
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchState) {
      // Pinch zoom
      e.preventDefault()
      const newDistance = getTouchDistance(e.touches)
      const scale = newDistance / touchState.initialDistance
      const newZoom = Math.min(Math.max(touchState.initialZoom * scale, 0.5), 10)

      // Calculate zoom toward pinch center
      const viewportCenterX = window.innerWidth / 2
      const viewportCenterY = window.innerHeight / 2
      const pinchRelX = touchState.centerX - viewportCenterX
      const pinchRelY = touchState.centerY - viewportCenterY
      const zoomRatio = newZoom / zoom

      setZoom(newZoom)
      setPan((currentPan) => {
        const newPanX = pinchRelX * (1 - zoomRatio) + currentPan.x * zoomRatio
        const newPanY = pinchRelY * (1 - zoomRatio) + currentPan.y * zoomRatio
        return clampPan(newPanX, newPanY, newZoom)
      })
    } else if (e.touches.length === 1 && isDragging) {
      // Single touch pan
      const newPan = {
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      }
      setPan(clampPan(newPan.x, newPan.y, zoom))
    }
  }, [touchState, zoom, isDragging, dragStart, clampPan])

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    setTouchState(null)
    setIsDragging(false)
  }, [])

  // Reset zoom and pan when closing
  const handleClose = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    onClose()
  }, [onClose])

  // Handle background click (close only if not dragging and zoom is 1)
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isDragging) {
      if (zoom === 1) {
        handleClose()
      } else {
        // Reset zoom on background click when zoomed
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
    }
  }, [isDragging, zoom, handleClose])

  // Show content warning screen if image has labels
  if (hasLabels && !acknowledged) {
    return createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
        onClick={handleClose}
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
              onClick={handleClose}
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

  const showAltText = alt && (!isHeightConstrained || isHoveringAltZone)

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm select-none"
      onClick={handleBackgroundClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors rounded-full hover:bg-white/10 z-10"
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

      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/50 text-white/80 text-sm rounded-full z-10">
          {Math.round(zoom * 100)}%
        </div>
      )}

      {/* Image container */}
      <figure
        className="w-full h-full flex items-center justify-center overflow-hidden"
        role="group"
        aria-label={alt ? `Image: ${alt}` : 'Image'}
        onWheel={handleWheel}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt || ''}
          className="max-w-full max-h-full object-contain touch-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          draggable={false}
        />

        {/* Alt text hover zone and overlay */}
        {alt && (
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-8 pt-24 px-8 -mx-8"
            onMouseEnter={() => setIsHoveringAltZone(true)}
            onMouseLeave={() => setIsHoveringAltZone(false)}
          >
            <figcaption
              className={`bg-black/95 pt-16 pb-10 px-8 sm:px-16 transition-opacity duration-200 w-[95vw] sm:w-auto sm:max-w-3xl ${
                showAltText ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                maskImage: `
                  linear-gradient(to bottom, transparent, black 25%),
                  linear-gradient(to top, transparent, black 20%),
                  linear-gradient(to left, transparent, black 12%),
                  linear-gradient(to right, transparent, black 12%)
                `,
                maskComposite: 'intersect',
                WebkitMaskImage: `
                  linear-gradient(to bottom, transparent, black 25%),
                  linear-gradient(to top, transparent, black 20%),
                  linear-gradient(to left, transparent, black 12%),
                  linear-gradient(to right, transparent, black 12%)
                `,
                WebkitMaskComposite: 'source-in',
              }}
              onWheel={(e) => e.stopPropagation()}
            >
              <div>
                <span className="block text-xs font-medium text-white/50 uppercase tracking-wide mb-1">
                  Image description
                </span>
                <p className="text-white/90 text-sm leading-relaxed max-h-24 overflow-y-auto">
                  {alt}
                </p>
              </div>
            </figcaption>
          </div>
        )}
      </figure>
    </div>,
    document.body
  )
}
