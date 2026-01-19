import { useEffect, useRef, useCallback } from 'react'
import gsap from 'gsap'

interface CylinderLogoProps {
  className?: string
}

const LETTERS = ['G', 'r', 'e', 'e', 'n', 'G', 'a', 'l', 'e']

// Cumulative rotation positions for each letter (degrees around the cylinder)
// More breathing room for e's, n, and l to prevent overlap
// G=wide, r=narrow, e=medium, e=medium, n=medium, G=wide, a=medium, l=narrow, e=medium
const LETTER_POSITIONS = [0, 7, 13, 20, 27, 35, 43, 48.5, 54]

// Initial offset to center the visible letters in view
const INITIAL_ROTATION_OFFSET = -27.5

// Pixels of drag per full rotation
const DRAG_DISTANCE_PER_ROTATION = 800

export function CylinderLogo({ className = '' }: CylinderLogoProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lettersRef = useRef<(HTMLSpanElement | null)[]>([])
  const animationRef = useRef<gsap.core.Tween | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartProgressRef = useRef(0)

  // Wrap progress to 0-1 range
  const wrapProgress = useCallback((p: number) => {
    return ((p % 1) + 1) % 1
  }, [])

  useEffect(() => {
    const letters = lettersRef.current.filter(Boolean) as HTMLSpanElement[]
    if (letters.length === 0) return

    // Wrap rotation values to keep them in visible range (-90 to 90)
    const wrapRotation = gsap.utils.wrap(-90, 90)

    // Calculate responsive radius based on container width
    const updateRadius = () => {
      const container = containerRef.current
      if (!container) return

      const containerWidth = container.offsetWidth
      // Radius scales with container, with min/max bounds
      const radius = Math.min(Math.max(containerWidth * 0.4, 80), 200)

      gsap.set(letters, {
        xPercent: -50,
        yPercent: -50,
        x: 0,
        y: 0,
        transformOrigin: `50% 50% ${-radius}px`,
      })
    }

    updateRadius()

    // Create the spinning animation (starts paused)
    animationRef.current = gsap.fromTo(
      letters,
      {
        rotationY: (i) => LETTER_POSITIONS[i] + INITIAL_ROTATION_OFFSET,
      },
      {
        rotationY: `-=${360}`,
        modifiers: {
          rotationY: (value) => wrapRotation(parseFloat(value)) + 'deg',
        },
        duration: 12,
        ease: 'none',
        repeat: -1,
        paused: true, // Start paused
      }
    )

    // Handle resize
    const handleResize = () => {
      updateRadius()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      animationRef.current?.kill()
    }
  }, [])

  // Mouse enter - start spinning
  const handleMouseEnter = useCallback(() => {
    if (!isDraggingRef.current && animationRef.current) {
      gsap.to(animationRef.current, { timeScale: 1, duration: 0.5 })
      animationRef.current.play()
    }
  }, [])

  // Mouse leave - stop spinning
  const handleMouseLeave = useCallback(() => {
    if (!isDraggingRef.current && animationRef.current) {
      gsap.to(animationRef.current, { timeScale: 0, duration: 0.5 })
    }
  }, [])

  // Drag start
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!animationRef.current) return

    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartProgressRef.current = animationRef.current.progress()

    // Pause auto-spin during drag
    animationRef.current.pause()
    gsap.killTweensOf(animationRef.current)

    // Capture pointer for drag outside element
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  // Drag move
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !animationRef.current) return

    const deltaX = dragStartXRef.current - e.clientX
    const progressDelta = deltaX / DRAG_DISTANCE_PER_ROTATION
    const newProgress = wrapProgress(dragStartProgressRef.current + progressDelta)

    animationRef.current.progress(newProgress)
  }, [wrapProgress])

  // Drag end
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return

    isDraggingRef.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

    // Check if still hovering to resume auto-spin
    const container = containerRef.current
    if (container) {
      const rect = container.getBoundingClientRect()
      const isHovering =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom

      if (isHovering && animationRef.current) {
        gsap.to(animationRef.current, { timeScale: 1, duration: 0.5 })
        animationRef.current.play()
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center cursor-grab active:cursor-grabbing ${className}`}
      style={{ perspective: '1000px' }}
      aria-label="GreenGale"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="relative pointer-events-none"
        style={{
          transformStyle: 'preserve-3d',
          width: '1px',
          height: '1em',
        }}
      >
        {LETTERS.map((letter, i) => (
          <span
            key={i}
            ref={(el) => {
              lettersRef.current[i] = el
            }}
            className="absolute left-1/2 top-1/2 select-none"
            style={{
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 'inherit',
              lineHeight: 1,
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'hidden',
              color: 'currentColor',
            }}
          >
            {letter}
          </span>
        ))}
      </div>
    </div>
  )
}
