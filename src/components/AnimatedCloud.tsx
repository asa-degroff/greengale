interface AnimatedCloudProps {
  className?: string
  variant?: 'large' | 'medium' | 'small'
  seed?: number
}

export function AnimatedCloud({ className = '', variant = 'medium', seed = 42 }: AnimatedCloudProps) {
  return (
    <svg
      viewBox="0 0 200 120"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Main cloud filter - blur + displacement for organic softness */}
        <filter id={`cloud-main-${seed}`} x="-50%" y="-50%" width="200%" height="200%">
          {/* Generate noise for displacement */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015"
            numOctaves="4"
            seed={seed}
            result="noise"
          />

          {/* Blur for soft edges */}
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blurred" />

          {/* Displace edges with noise for organic irregularity */}
          <feDisplacementMap
            in="blurred"
            in2="noise"
            scale="8"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Wisp filter - extra soft and diffuse */}
        <filter id={`cloud-wisp-${seed}`} x="-60%" y="-60%" width="220%" height="220%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02"
            numOctaves="3"
            seed={seed + 100}
            result="noise"
          />

          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blurred" />

          <feDisplacementMap
            in="blurred"
            in2="noise"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Main gradient - very gentle falloff */}
        <radialGradient id={`cloud-gradient-${seed}`} cx="30%" cy="30%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="40%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="70%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>

        {/* Inner gradient for core density */}
        <radialGradient id={`cloud-gradient-inner-${seed}`} cx="35%" cy="35%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>

        {/* Wisp gradient - extremely soft */}
        <radialGradient id={`wisp-gradient-${seed}`} cx="50%" cy="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Render cloud with noise-dissolved edges */}
      <g>
        {renderCloudShapeWithDynamicFilters(variant, seed)}
      </g>
    </svg>
  )
}

// Helper to render cloud shapes with dynamic filter/gradient IDs
function renderCloudShapeWithDynamicFilters(variant: 'large' | 'medium' | 'small', seed: number) {
  const mf = `url(#cloud-main-${seed})`
  const wf = `url(#cloud-wisp-${seed})`
  const cg = `url(#cloud-gradient-${seed})`
  const cgi = `url(#cloud-gradient-inner-${seed})`
  const wg = `url(#wisp-gradient-${seed})`

  switch (variant) {
    case 'large':
      return (
        <>
          {/* Main cloud body with noise-dissolved edges */}
          <g filter={mf}>
            <ellipse cx="100" cy="70" rx="65" ry="40" fill={cg} />
            <ellipse cx="60" cy="75" rx="50" ry="35" fill={cg} />
            <ellipse cx="145" cy="72" rx="48" ry="33" fill={cg} />
            <ellipse cx="75" cy="45" rx="38" ry="28" fill={cg} />
            <ellipse cx="115" cy="40" rx="35" ry="26" fill={cg} />
            <ellipse cx="150" cy="50" rx="30" ry="22" fill={cg} />
            <ellipse cx="90" cy="55" rx="42" ry="30" fill={cgi} />
            <ellipse cx="130" cy="58" rx="38" ry="27" fill={cgi} />
            <ellipse cx="35" cy="80" rx="28" ry="20" fill={cg} />
            <ellipse cx="170" cy="78" rx="25" ry="18" fill={cg} />
            <ellipse cx="55" cy="55" rx="22" ry="16" fill={cg} />
          </g>
          {/* Wispy outer edges - extra diffuse */}
          <g filter={wf}>
            <ellipse cx="25" cy="85" rx="25" ry="18" fill={wg} />
            <ellipse cx="180" cy="82" rx="24" ry="16" fill={wg} />
            <ellipse cx="60" cy="38" rx="22" ry="14" fill={wg} />
            <ellipse cx="140" cy="32" rx="20" ry="13" fill={wg} />
            <ellipse cx="100" cy="28" rx="24" ry="15" fill={wg} />
          </g>
        </>
      )

    case 'small':
      return (
        <>
          <g filter={mf}>
            <ellipse cx="100" cy="65" rx="40" ry="25" fill={cg} />
            <ellipse cx="75" cy="68" rx="30" ry="20" fill={cg} />
            <ellipse cx="125" cy="67" rx="28" ry="19" fill={cg} />
            <ellipse cx="90" cy="52" rx="22" ry="15" fill={cg} />
            <ellipse cx="110" cy="50" rx="20" ry="14" fill={cg} />
          </g>
          <g filter={wf}>
            <ellipse cx="55" cy="72" rx="18" ry="12" fill={wg} />
            <ellipse cx="145" cy="70" rx="16" ry="11" fill={wg} />
          </g>
        </>
      )

    default: // medium
      return (
        <>
          <g filter={mf}>
            <ellipse cx="100" cy="65" rx="55" ry="35" fill={cg} />
            <ellipse cx="65" cy="70" rx="42" ry="30" fill={cg} />
            <ellipse cx="140" cy="68" rx="40" ry="28" fill={cg} />
            <ellipse cx="80" cy="48" rx="32" ry="24" fill={cg} />
            <ellipse cx="120" cy="45" rx="30" ry="22" fill={cg} />
            <ellipse cx="95" cy="55" rx="35" ry="25" fill={cgi} />
            <ellipse cx="45" cy="75" rx="24" ry="17" fill={cg} />
            <ellipse cx="160" cy="72" rx="22" ry="16" fill={cg} />
          </g>
          <g filter={wf}>
            <ellipse cx="30" cy="80" rx="24" ry="15" fill={wg} />
            <ellipse cx="175" cy="77" rx="22" ry="14" fill={wg} />
            <ellipse cx="65" cy="38" rx="20" ry="13" fill={wg} />
            <ellipse cx="140" cy="35" rx="18" ry="12" fill={wg} />
          </g>
        </>
      )
  }
}

// Cloud field component that manages multiple floating clouds
interface CloudFieldProps {
  className?: string
}

interface CloudInstance {
  id: number
  variant: 'large' | 'medium' | 'small'
  seed: number
  top: number // percentage
  size: number // scale factor
  duration: number // animation duration in seconds
  delay: number // initial delay
  opacity: number
}

export function CloudField({ className = '' }: CloudFieldProps) {
  // Predefined cloud instances for consistent rendering
  // These are positioned to create a pleasing parallax effect
  const clouds: CloudInstance[] = [
    // Far background - slower, smaller, more transparent
    { id: 1, variant: 'small', seed: 11, top: 15, size: 0.6, duration: 68, delay: 0, opacity: 0.25 },
    { id: 2, variant: 'small', seed: 22, top: 70, size: 0.5, duration: 75, delay: -30, opacity: 0.2 },

    // Mid layer
    { id: 3, variant: 'medium', seed: 33, top: 35, size: 0.8, duration: 52, delay: -15, opacity: 0.35 },
    { id: 4, variant: 'medium', seed: 44, top: 55, size: 0.75, duration: 57, delay: -38, opacity: 0.3 },

    // Foreground - larger, faster, more visible
    { id: 5, variant: 'large', seed: 55, top: 25, size: 1.1, duration: 42, delay: -8, opacity: 0.45 },
    { id: 6, variant: 'large', seed: 66, top: 50, size: 1.0, duration: 48, delay: -27, opacity: 0.4 },

    // Extra variety
    { id: 7, variant: 'small', seed: 77, top: 80, size: 0.55, duration: 63, delay: -45, opacity: 0.22 },
    { id: 8, variant: 'medium', seed: 88, top: 10, size: 0.7, duration: 60, delay: -22, opacity: 0.28 },
  ]

  return (
    <div
      className={`cloud-field ${className}`}
      aria-hidden="true"
    >
      {clouds.map((cloud) => (
        <div
          key={cloud.id}
          className="cloud-instance"
          style={{
            top: `${cloud.top}%`,
            // Scale is applied to the inner SVG to preserve animation transform
            width: `${180 * cloud.size}px`,
            height: `${120 * cloud.size}px`,
            opacity: cloud.opacity,
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        >
          <AnimatedCloud variant={cloud.variant} seed={cloud.seed} />
        </div>
      ))}
    </div>
  )
}
