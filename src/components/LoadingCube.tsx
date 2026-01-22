import { memo } from 'react'

interface LoadingCubeProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * A 3D animated cube loading indicator
 * Features: rotating cube with glowing edges, pulsing faces, and particle effects
 */
export const LoadingCube = memo(function LoadingCube({ size = 'md', className = '' }: LoadingCubeProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
  }

  const cubeSize = {
    sm: 16,
    md: 32,
    lg: 48,
  }

  const s = cubeSize[size]

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div
        className={`${sizeClasses[size]} relative`}
        style={{
          perspective: s * 4,
          perspectiveOrigin: '50% 50%',
        }}
      >
        {/* The rotating cube container */}
        <div
          className="absolute inset-0 animate-cube-rotate"
          style={{
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Front face */}
          <div
            className="absolute inset-0 animate-cube-face-pulse"
            style={{
              transform: `translateZ(${s / 2}px)`,
              background: 'linear-gradient(135deg, var(--site-accent) 0%, var(--site-accent-hover, var(--site-accent)) 100%)',
              opacity: 0.9,
              boxShadow: `0 0 ${s / 4}px var(--site-accent), inset 0 0 ${s / 4}px rgba(255,255,255,0.2)`,
              borderRadius: 2,
            }}
          />
          {/* Back face */}
          <div
            className="absolute inset-0 animate-cube-face-pulse"
            style={{
              transform: `rotateY(180deg) translateZ(${s / 2}px)`,
              background: 'linear-gradient(135deg, var(--site-accent) 0%, var(--site-accent-hover, var(--site-accent)) 100%)',
              opacity: 0.9,
              boxShadow: `0 0 ${s / 4}px var(--site-accent), inset 0 0 ${s / 4}px rgba(255,255,255,0.2)`,
              borderRadius: 2,
              animationDelay: '0.2s',
            }}
          />
          {/* Right face */}
          <div
            className="absolute inset-0 animate-cube-face-pulse"
            style={{
              transform: `rotateY(90deg) translateZ(${s / 2}px)`,
              background: 'linear-gradient(135deg, var(--site-accent) 0%, var(--site-accent-hover, var(--site-accent)) 100%)',
              opacity: 0.7,
              boxShadow: `0 0 ${s / 4}px var(--site-accent), inset 0 0 ${s / 4}px rgba(255,255,255,0.2)`,
              borderRadius: 2,
              animationDelay: '0.4s',
            }}
          />
          {/* Left face */}
          <div
            className="absolute inset-0 animate-cube-face-pulse"
            style={{
              transform: `rotateY(-90deg) translateZ(${s / 2}px)`,
              background: 'linear-gradient(135deg, var(--site-accent) 0%, var(--site-accent-hover, var(--site-accent)) 100%)',
              opacity: 0.7,
              boxShadow: `0 0 ${s / 4}px var(--site-accent), inset 0 0 ${s / 4}px rgba(255,255,255,0.2)`,
              borderRadius: 2,
              animationDelay: '0.6s',
            }}
          />
          {/* Top face */}
          <div
            className="absolute inset-0 animate-cube-face-pulse"
            style={{
              transform: `rotateX(90deg) translateZ(${s / 2}px)`,
              background: 'linear-gradient(135deg, var(--site-accent) 0%, var(--site-accent-hover, var(--site-accent)) 100%)',
              opacity: 0.5,
              boxShadow: `0 0 ${s / 4}px var(--site-accent), inset 0 0 ${s / 4}px rgba(255,255,255,0.3)`,
              borderRadius: 2,
              animationDelay: '0.8s',
            }}
          />
          {/* Bottom face */}
          <div
            className="absolute inset-0 animate-cube-face-pulse"
            style={{
              transform: `rotateX(-90deg) translateZ(${s / 2}px)`,
              background: 'linear-gradient(135deg, var(--site-accent) 0%, var(--site-accent-hover, var(--site-accent)) 100%)',
              opacity: 0.5,
              boxShadow: `0 0 ${s / 4}px var(--site-accent), inset 0 0 ${s / 4}px rgba(255,255,255,0.3)`,
              borderRadius: 2,
              animationDelay: '1s',
            }}
          />

          {/* Glowing edges - corners */}
          {[...Array(8)].map((_, i) => {
            const x = i % 2 === 0 ? -1 : 1
            const y = Math.floor(i / 2) % 2 === 0 ? -1 : 1
            const z = Math.floor(i / 4) === 0 ? -1 : 1
            return (
              <div
                key={i}
                className="absolute animate-cube-corner-glow"
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: `0 0 ${s / 4}px var(--site-accent), 0 0 ${s / 2}px var(--site-accent)`,
                  transform: `translate3d(${(s / 2 - 2) * x}px, ${(s / 2 - 2) * y}px, ${(s / 2) * z}px)`,
                  left: '50%',
                  top: '50%',
                  marginLeft: -2,
                  marginTop: -2,
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            )
          })}
        </div>

        {/* Shadow beneath the cube */}
        <div
          className="absolute animate-cube-shadow"
          style={{
            width: s * 0.8,
            height: s * 0.2,
            left: '50%',
            bottom: -s * 0.3,
            marginLeft: -s * 0.4,
            background: 'var(--site-accent)',
            borderRadius: '50%',
            filter: `blur(${s / 8}px)`,
            opacity: 0.3,
          }}
        />

        {/* Floating particles */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-cube-particle"
            style={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: 'var(--site-accent)',
              boxShadow: `0 0 4px var(--site-accent)`,
              left: '50%',
              top: '50%',
              animationDelay: `${i * 0.5}s`,
              '--particle-angle': `${i * 60}deg`,
              '--particle-distance': `${s * 0.8}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  )
})

/**
 * A simpler inline loading cube for buttons and small spaces
 */
export const LoadingCubeInline = memo(function LoadingCubeInline({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="w-2 h-2 bg-current animate-cube-bounce"
          style={{
            animationDelay: `${i * 0.15}s`,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  )
})
