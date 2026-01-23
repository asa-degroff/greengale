import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react'

interface CubeLogoProps {
  className?: string
}

const LETTERS = ['G', 'r', 'e', 'e', 'n', 'G', 'a', 'l', 'e']

const RESTING_X = -12
const RESTING_Y = 0

interface Rotation {
  x: number
  y: number
}

// The 6 faces of the cube as base rotations
const FACES: Rotation[] = [
  { x: 0, y: 0 },      // front
  { x: 0, y: 180 },    // back
  { x: 0, y: 90 },     // right
  { x: 0, y: -90 },    // left
  { x: -90, y: 0 },    // top
  { x: 90, y: 0 },     // bottom
]

function generateRestingOffsets(): Rotation[] {
  return LETTERS.map(() => ({
    x: (Math.random() - 0.5) * 20,
    y: (Math.random() - 0.5) * 20,
  }))
}

function generateFaceRotations(): Rotation[] {
  return LETTERS.map(() => {
    const face = FACES[Math.floor(Math.random() * FACES.length)]
    const spinAxis = Math.random() > 0.5 ? 'x' : 'y'
    const spinDir = Math.random() > 0.5 ? 1 : -1
    return {
      x: face.x + (spinAxis === 'x' ? 360 * spinDir : 0) + (Math.random() - 0.5) * 10,
      y: face.y + (spinAxis === 'y' ? 360 * spinDir : 0) + (Math.random() - 0.5) * 10,
    }
  })
}

type Phase = 'idle' | 'hop1' | 'pause1' | 'hop2' | 'pause2' | 'returning'

export const CubeLogo = memo(function CubeLogo({ className = '' }: CubeLogoProps) {
  const [rotations, setRotations] = useState<Rotation[] | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const containerRef = useRef<HTMLDivElement>(null)
  const [cubeSize, setCubeSize] = useState(15)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const restingAngles = useMemo(() =>
    generateRestingOffsets().map(offset => ({
      x: RESTING_X + offset.x,
      y: RESTING_Y + offset.y,
    })), []
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        setCubeSize(Math.max(8, height * 0.75))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [])

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName !== 'transform') return
    if (phase === 'hop1') {
      setPhase('pause1')
      pauseTimerRef.current = setTimeout(() => {
        setPhase('hop2')
        setRotations(generateFaceRotations())
      }, 150)
    } else if (phase === 'hop2') {
      setPhase('pause2')
      pauseTimerRef.current = setTimeout(() => {
        setPhase('returning')
        setRotations(null)
      }, 150)
    } else if (phase === 'returning') {
      setPhase('idle')
    }
  }, [phase])

  const triggerSpin = useCallback(() => {
    if (phase !== 'idle') return
    setPhase('hop1')
    setRotations(generateFaceRotations())
  }, [phase])

  const gap = Math.max(1, cubeSize * 0.12)
  const fontSize = Math.max(10, cubeSize * 0.8)
  const half = cubeSize / 2

  const getTransitionProps = (i: number) => {
    if (phase === 'hop1' || phase === 'hop2') {
      return {
        duration: 0.5,
        delay: i * 30,
      }
    }
    if (phase === 'returning') {
      return {
        duration: 0.6,
        delay: i * 25,
      }
    }
    return { duration: 0.5, delay: 0 }
  }

  return (
    <div
      ref={containerRef}
      className={`inline-flex items-center select-none ${className}`}
      style={{ perspective: cubeSize * 8, gap: `${gap}px` }}
      role="img"
      aria-label="GreenGale"
      onMouseEnter={triggerSpin}
      onClick={triggerSpin}
    >
      {LETTERS.map((letter, i) => {
        const rot = rotations?.[i]
        const rest = restingAngles[i]
        const rx = rot ? rot.x : rest.x
        const ry = rot ? rot.y : rest.y
        const isLast = i === LETTERS.length - 1
        const { duration, delay } = getTransitionProps(i)

        return (
          <div
            key={i}
            style={{
              width: cubeSize,
              height: cubeSize,
              perspective: cubeSize * 4,
            }}
          >
            <div
              className="cube-logo-inner"
              style={{
                width: cubeSize,
                height: cubeSize,
                position: 'relative',
                transformStyle: 'preserve-3d',
                transform: `rotateX(${rx}deg) rotateY(${ry}deg)`,
                transition: `transform ${duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94)`,
                transitionDelay: `${delay}ms`,
              }}
              onTransitionEnd={isLast ? handleTransitionEnd : undefined}
            >
              {/* Front */}
              <div
                style={{
                  position: 'absolute',
                  width: cubeSize,
                  height: cubeSize,
                  backfaceVisibility: 'hidden',
                  transform: `translateZ(${half}px)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--site-accent)',
                  opacity: 0.95,
                }}
              >
                <span
                  style={{
                    fontSize: `${fontSize}px`,
                    fontWeight: 600,
                    color: 'white',
                    fontFamily: 'var(--font-title)',
                    lineHeight: 1,
                  }}
                >
                  {letter}
                </span>
              </div>
              {/* Back */}
              <div
                style={{
                  position: 'absolute',
                  width: cubeSize,
                  height: cubeSize,
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(180deg) translateZ(${half}px)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--site-accent)',
                  opacity: 0.6,
                }}
              >
                <span
                  style={{
                    fontSize: `${fontSize}px`,
                    fontWeight: 600,
                    color: 'white',
                    fontFamily: 'var(--font-title)',
                    lineHeight: 1,
                  }}
                >
                  {letter}
                </span>
              </div>
              {/* Right */}
              <div
                style={{
                  position: 'absolute',
                  width: cubeSize,
                  height: cubeSize,
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(90deg) translateZ(${half}px)`,
                  backgroundColor: 'var(--site-accent)',
                  opacity: 0.5,
                }}
              />
              {/* Left */}
              <div
                style={{
                  position: 'absolute',
                  width: cubeSize,
                  height: cubeSize,
                  backfaceVisibility: 'hidden',
                  transform: `rotateY(-90deg) translateZ(${half}px)`,
                  backgroundColor: 'var(--site-accent)',
                  opacity: 0.5,
                }}
              />
              {/* Top */}
              <div
                style={{
                  position: 'absolute',
                  width: cubeSize,
                  height: cubeSize,
                  backfaceVisibility: 'hidden',
                  transform: `rotateX(90deg) translateZ(${half}px)`,
                  backgroundColor: 'var(--site-accent)',
                  opacity: 0.35,
                }}
              />
              {/* Bottom */}
              <div
                style={{
                  position: 'absolute',
                  width: cubeSize,
                  height: cubeSize,
                  backfaceVisibility: 'hidden',
                  transform: `rotateX(-90deg) translateZ(${half}px)`,
                  backgroundColor: 'var(--site-accent)',
                  opacity: 0.35,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
})
