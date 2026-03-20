// Background texture rendering for OG images
// Generates SVG backgrounds for floral and cloud textures,
// rasterized by resvg inside the workers-og pipeline.

import type { ThemeColors } from './theme-colors'

// ── Color utilities (hex-only, no culori dependency) ──

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!match) return null
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`
}

function blendHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  return rgbToHex(
    ca.r + (cb.r - ca.r) * t,
    ca.g + (cb.g - ca.g) * t,
    ca.b + (cb.b - ca.b) * t,
  )
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0.5
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
}

/** Check if a hex color is near-white (high luminance, low saturation) */
function isNearWhite(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  const lum = relativeLuminance(hex)
  // Check luminance > 0.85 and low color variation (near-achromatic)
  const maxC = Math.max(rgb.r, rgb.g, rgb.b)
  const minC = Math.min(rgb.r, rgb.g, rgb.b)
  return lum > 0.85 && (maxC - minC) < 20
}

// ── Simple OKLCH approximation for hue shifting ──
// Full OKLCH requires culori; instead we rotate hue in HSL space
// which is good enough for OG image tinting.

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ]
}

function shiftHue(hex: string, hueDelta: number, sDelta = 0, lDelta = 0): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const [r, g, b] = hslToRgb(
    h + hueDelta,
    Math.max(0, Math.min(1, s + sDelta)),
    Math.max(0, Math.min(1, l + lDelta)),
  )
  return rgbToHex(r, g, b)
}

// ── Cloud color derivation (mirrors frontend deriveCloudColor) ──

export function deriveCloudColor(background: string, text: string): string {
  const isDark = relativeLuminance(background) < 0.5
  if (isDark) return blendHex(background, text, 0.2)
  if (isNearWhite(background)) return blendHex(background, text, 0.12)
  return '#ffffff'
}

// ── Sky gradient derivation (mirrors frontend deriveSkyGradient) ──

export function deriveSkyGradient(
  background: string,
  accent: string,
): { top: string; bottom: string } {
  const isDark = relativeLuminance(background) < 0.5

  // Create subtle tints by shifting the accent hue and blending heavily toward background
  const coolTint = shiftHue(accent, 30, 0, isDark ? 0.03 : -0.02)
  const warmTint = shiftHue(accent, -40, 0, isDark ? 0.01 : -0.01)

  // Blend 95% toward background for very subtle tinting
  return {
    top: blendHex(coolTint, background, 0.92),
    bottom: blendHex(warmTint, background, 0.95),
  }
}

// ── Cloud SVG generation ──

/**
 * Generate a 1200×630 SVG with a sky gradient and soft cloud formations.
 * Uses feGaussianBlur + radial gradients (no feTurbulence/feDisplacementMap
 * since resvg doesn't support those).
 */
export function generateCloudSVG(colors: ThemeColors): string {
  const cloudColor = deriveCloudColor(colors.background, colors.text)
  const sky = deriveSkyGradient(colors.background, colors.accent)

  // Cloud formations — each is a group of blurred ellipses
  // Positioned to look natural at 1200×630
  const clouds = [
    // Large cloud, upper-left area
    { filter: 'lg', ellipses: [
      { cx: 250, cy: 160, rx: 170, ry: 65 },
      { cx: 360, cy: 145, rx: 130, ry: 55 },
      { cx: 300, cy: 185, rx: 150, ry: 50 },
      { cx: 200, cy: 155, rx: 100, ry: 45 },
    ]},
    // Medium cloud, right side
    { filter: 'md', ellipses: [
      { cx: 920, cy: 200, rx: 140, ry: 55 },
      { cx: 1010, cy: 190, rx: 110, ry: 45 },
      { cx: 870, cy: 215, rx: 95, ry: 40 },
    ]},
    // Small cloud, center-high
    { filter: 'sm', ellipses: [
      { cx: 620, cy: 110, rx: 90, ry: 35 },
      { cx: 680, cy: 100, rx: 70, ry: 30 },
    ]},
    // Large cloud, lower-center
    { filter: 'lg', ellipses: [
      { cx: 550, cy: 420, rx: 180, ry: 70 },
      { cx: 680, cy: 410, rx: 150, ry: 60 },
      { cx: 470, cy: 435, rx: 120, ry: 50 },
      { cx: 620, cy: 450, rx: 140, ry: 45 },
    ]},
    // Small wispy cloud, far right
    { filter: 'md', ellipses: [
      { cx: 1100, cy: 350, rx: 100, ry: 40 },
      { cx: 1150, cy: 340, rx: 75, ry: 30 },
    ]},
    // Small cloud, lower-left
    { filter: 'sm', ellipses: [
      { cx: 120, cy: 480, rx: 85, ry: 35 },
      { cx: 180, cy: 470, rx: 65, ry: 28 },
      { cx: 90, cy: 490, rx: 60, ry: 25 },
    ]},
  ]

  const cloudGroups = clouds.map(cloud => {
    const ellipses = cloud.ellipses.map(e =>
      `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="url(#cg)"/>`
    ).join('')
    return `<g filter="url(#blur-${cloud.filter})">${ellipses}</g>`
  }).join('\n  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${sky.top}"/>
      <stop offset="40%" stop-color="${colors.background}"/>
      <stop offset="60%" stop-color="${colors.background}"/>
      <stop offset="100%" stop-color="${sky.bottom}"/>
    </linearGradient>
    <filter id="blur-sm" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
    <filter id="blur-md" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    <filter id="blur-lg" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="25"/>
    </filter>
    <radialGradient id="cg" cx="30%" cy="30%">
      <stop offset="0%" stop-color="${cloudColor}" stop-opacity="0.4"/>
      <stop offset="25%" stop-color="${cloudColor}" stop-opacity="0.3"/>
      <stop offset="50%" stop-color="${cloudColor}" stop-opacity="0.18"/>
      <stop offset="75%" stop-color="${cloudColor}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${cloudColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  ${cloudGroups}
</svg>`
}

// ── Floral SVG generation ──
// Ported from src/lib/background-textures.ts, simplified for worker context.
// Uses HSL hue shifting instead of OKLCH (avoids culori dependency in worker).

function seededRandom(seed: number) {
  let t = seed | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

type MotifFn = (p: string[]) => string

const motifs: MotifFn[] = [
  // 5-petal flower
  (p) => `<ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[0]}"/><ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[1]}" transform="rotate(72)"/><ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[2]}" transform="rotate(144)"/><ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[0]}" transform="rotate(216)"/><ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[1]}" transform="rotate(288)"/><circle cx="0" cy="0" r="2.5" fill="${p[3]}"/>`,
  // 6-petal flower
  (p) => `<ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[4]}"/><ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[5]}" transform="rotate(60)"/><ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[4]}" transform="rotate(120)"/><ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[5]}" transform="rotate(180)"/><ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[4]}" transform="rotate(240)"/><ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[5]}" transform="rotate(300)"/><circle cx="0" cy="0" r="1.8" fill="${p[6]}"/>`,
  // 4-petal cross
  (p) => `<ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[2]}"/><ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[5]}" transform="rotate(90)"/><ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[2]}" transform="rotate(180)"/><ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[5]}" transform="rotate(270)"/><circle cx="0" cy="0" r="2" fill="${p[6]}"/>`,
  // Tulip
  (p) => `<ellipse cx="0" cy="-5" rx="4" ry="7" fill="${p[1]}"/><ellipse cx="-3" cy="-3" rx="3.5" ry="6" fill="${p[0]}" transform="rotate(-15)"/><ellipse cx="3" cy="-3" rx="3.5" ry="6" fill="${p[2]}" transform="rotate(15)"/><rect x="-0.6" y="0" width="1.2" height="6" rx="0.6" fill="${p[7]}"/>`,
  // Bud
  (p) => `<ellipse cx="0" cy="-3" rx="2.5" ry="4" fill="${p[0]}"/><ellipse cx="-1.5" cy="-1" rx="2" ry="3.5" fill="${p[4]}"/><ellipse cx="1.5" cy="-1" rx="2" ry="3.5" fill="${p[5]}"/><rect x="-0.5" y="1" width="1" height="5" rx="0.5" fill="${p[7]}"/>`,
  // Berry cluster
  (p) => `<circle cx="-2" cy="-1.5" r="2.2" fill="${p[0]}"/><circle cx="2" cy="-1.5" r="2.2" fill="${p[1]}"/><circle cx="0" cy="1.5" r="2.2" fill="${p[2]}"/><circle cx="0" cy="0" r="0.8" fill="${p[3]}"/>`,
  // Sprig
  (p) => `<rect x="-0.4" y="-8" width="0.8" height="16" rx="0.4" fill="${p[7]}"/><path d="M0,-6 Q5,-10 0,-14 Q-1,-10 0,-6Z" fill="${p[4]}"/><path d="M0,-1 Q-5,-5 0,-9 Q1,-5 0,-1Z" fill="${p[5]}"/>`,
  // Leaf
  (p) => `<path d="M0,0 Q5,-9 0,-18 Q-5,-9 0,0Z" fill="${p[7]}"/><line x1="0" y1="0" x2="0" y2="-16" stroke="${p[4]}" stroke-width="0.4" opacity="0.5"/>`,
  // Dot cluster
  (p) => `<circle cx="-2" cy="-3" r="1.2" fill="${p[3]}"/><circle cx="2.5" cy="-1" r="1" fill="${p[6]}"/><circle cx="0" cy="2" r="1.4" fill="${p[3]}"/><circle cx="-3" cy="1" r="0.8" fill="${p[6]}"/>`,
  // Star flower
  (p) => `<ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(45)"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}" transform="rotate(90)"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(135)"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}" transform="rotate(180)"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(225)"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}" transform="rotate(270)"/><ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(315)"/><circle cx="0" cy="0" r="2" fill="${p[6]}"/>`,
]

const motifWeights: [number, number][] = [
  [0, 3], [1, 3], [2, 2], [3, 2], [4, 3],
  [5, 4], [6, 5], [7, 6], [8, 5], [9, 2],
]
const totalWeight = motifWeights.reduce((s, [, w]) => s + w, 0)

function pickMotif(rand: () => number): number {
  let r = rand() * totalWeight
  for (const [idx, w] of motifWeights) {
    r -= w
    if (r <= 0) return idx
  }
  return 7
}

/**
 * Derive an 8-color palette from the theme colors using HSL hue shifting.
 * Simplified version of the frontend OKLCH-based palette generation.
 */
function deriveFloralPalette(colors: ThemeColors): string[] {
  const isDark = relativeLuminance(colors.background) < 0.5
  const subtleMix = isDark ? 0.75 : 0.8
  const mix = (c: string) => blendHex(c, colors.background, subtleMix)

  return [
    mix(colors.accent),                              // 0: accent base
    mix(shiftHue(colors.accent, 15, 0, 0.03)),       // 1: accent warm
    mix(shiftHue(colors.accent, 150, -0.1)),          // 2: split-comp B
    mix(shiftHue(colors.accent, 165, -0.05, -0.03)), // 3: split-comp B shifted
    mix(shiftHue(colors.accent, -150, -0.05, 0.02)), // 4: split-comp C
    mix(shiftHue(colors.accent, -135, -0.08)),        // 5: split-comp C shifted
    mix(shiftHue(colors.accent, 75, -0.1, 0.02)),    // 6: center/pistil
    mix(shiftHue(colors.accent, 140, -0.15, -0.04)), // 7: stems/leaves
  ]
}

/**
 * Generate a 1200×630 SVG with a tiled floral pattern.
 * Uses SVG <pattern> for seamless tiling, which resvg supports.
 */
export function generateFloralSVG(colors: ThemeColors): string {
  const palette = deriveFloralPalette(colors)
  const W = 250, H = 250
  const rand = seededRandom(31415)
  const MOTIF_COUNT = 80

  const placed: { x: number; y: number; r: number }[] = []
  const MIN_DIST = 5
  const elements: string[] = []

  for (let attempt = 0; attempt < MOTIF_COUNT * 4 && elements.length < MOTIF_COUNT; attempt++) {
    const x = rand() * W
    const y = rand() * H
    const motifIdx = pickMotif(rand)
    const scale = 0.4 + rand() * 0.7
    const rotation = rand() * 360
    const effectiveRadius = (motifIdx <= 4 || motifIdx === 9 ? 12 : 8) * scale

    let tooClose = false
    for (const p of placed) {
      const dx = Math.abs(x - p.x)
      const dy = Math.abs(y - p.y)
      const wdx = Math.min(dx, W - dx)
      const wdy = Math.min(dy, H - dy)
      if (Math.sqrt(wdx * wdx + wdy * wdy) < (effectiveRadius + p.r + MIN_DIST * (0.5 + rand() * 0.5))) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    placed.push({ x, y, r: effectiveRadius })

    const shuffled = [...palette]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    const motifSvg = motifs[motifIdx](shuffled)
    const g = (tx: number, ty: number) =>
      `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${rotation.toFixed(0)}) scale(${scale.toFixed(2)})">${motifSvg}</g>`

    elements.push(g(x, y))

    const nearR = x + effectiveRadius > W
    const nearL = x - effectiveRadius < 0
    const nearB = y + effectiveRadius > H
    const nearT = y - effectiveRadius < 0
    if (nearR) elements.push(g(x - W, y))
    if (nearL) elements.push(g(x + W, y))
    if (nearB) elements.push(g(x, y - H))
    if (nearT) elements.push(g(x, y + H))
    if (nearR && nearB) elements.push(g(x - W, y - H))
    if (nearR && nearT) elements.push(g(x - W, y + H))
    if (nearL && nearB) elements.push(g(x + W, y - H))
    if (nearL && nearT) elements.push(g(x + W, y + H))
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="floral" width="${W}" height="${H}" patternUnits="userSpaceOnUse">
      ${elements.join('')}
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="${colors.background}"/>
  <rect width="1200" height="630" fill="url(#floral)"/>
</svg>`
}

// ── Background HTML builder for OG images ──

export type BackgroundTexture = 'grid' | 'floral' | 'clouds'

/**
 * Build the background layer HTML for an OG image.
 * - grid: CSS repeating-linear-gradient (rendered by Satori)
 * - floral/clouds: SVG embedded as <img> data URI (rendered by resvg)
 */
export function buildBackgroundHtml(
  texture: BackgroundTexture,
  colors: ThemeColors,
): string {
  switch (texture) {
    case 'clouds': {
      const svg = generateCloudSVG(colors)
      const base64 = btoa(svg)
      return `<img src="data:image/svg+xml;base64,${base64}" width="1200" height="630" style="position: absolute; top: 0; left: 0; width: 1200px; height: 630px;" />`
    }
    case 'floral': {
      const svg = generateFloralSVG(colors)
      const base64 = btoa(svg)
      return `<img src="data:image/svg+xml;base64,${base64}" width="1200" height="630" style="position: absolute; top: 0; left: 0; width: 1200px; height: 630px;" />`
    }
    case 'grid':
    default:
      return `<div style="display: flex; position: absolute; top: 0; left: 0; width: 1200px; height: 630px; background-image: repeating-linear-gradient(0deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, ${colors.gridColor}, ${colors.gridColor} 1px, transparent 1px, transparent 24px);"></div>`
  }
}
