import { parse, oklch, formatHex, interpolate, type Oklch } from 'culori'

export type BackgroundTexture = 'grid' | 'floral' | 'clouds'

export const BACKGROUND_TEXTURES: BackgroundTexture[] = ['grid', 'floral', 'clouds']

export const TEXTURE_LABELS: Record<BackgroundTexture, string> = {
  grid: 'Grid',
  floral: 'Floral',
  clouds: 'Clouds',
}

/**
 * Derive OKLCH variants from a base color by shifting hue and lightness
 */
function deriveVariant(base: Oklch, hueDelta: number, lightDelta: number, chromaDelta = 0): string {
  const variant: Oklch = {
    mode: 'oklch',
    l: Math.max(0, Math.min(1, (base.l ?? 0) + lightDelta)),
    c: Math.max(0, (base.c ?? 0) + chromaDelta),
    h: ((base.h ?? 0) + hueDelta + 360) % 360,
  }
  return formatHex(variant) ?? '#888888'
}

/**
 * Simple seeded PRNG (mulberry32) for deterministic pseudo-random placement.
 * Returns a function that yields values in [0, 1).
 */
function seededRandom(seed: number) {
  let t = seed | 0
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Motif definition SVG generators. Each returns SVG elements centered at origin.
 */
type MotifFn = (p: string[]) => string

const motifs: MotifFn[] = [
  // 5-petal flower (rose-like)
  (p) => `
    <ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[0]}"/>
    <ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[1]}" transform="rotate(72)"/>
    <ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[2]}" transform="rotate(144)"/>
    <ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[0]}" transform="rotate(216)"/>
    <ellipse cx="0" cy="-7" rx="3.5" ry="7" fill="${p[1]}" transform="rotate(288)"/>
    <circle cx="0" cy="0" r="2.5" fill="${p[3]}"/>`,

  // 6-petal flower (daisy-like)
  (p) => `
    <ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[4]}"/>
    <ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[5]}" transform="rotate(60)"/>
    <ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[4]}" transform="rotate(120)"/>
    <ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[5]}" transform="rotate(180)"/>
    <ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[4]}" transform="rotate(240)"/>
    <ellipse cx="0" cy="-5" rx="2.5" ry="5" fill="${p[5]}" transform="rotate(300)"/>
    <circle cx="0" cy="0" r="1.8" fill="${p[6]}"/>`,

  // 4-petal flower (simple cross)
  (p) => `
    <ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[2]}"/>
    <ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[5]}" transform="rotate(90)"/>
    <ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[2]}" transform="rotate(180)"/>
    <ellipse cx="0" cy="-6" rx="3" ry="6" fill="${p[5]}" transform="rotate(270)"/>
    <circle cx="0" cy="0" r="2" fill="${p[6]}"/>`,

  // Tulip (3 overlapping petals)
  (p) => `
    <ellipse cx="0" cy="-5" rx="4" ry="7" fill="${p[1]}"/>
    <ellipse cx="-3" cy="-3" rx="3.5" ry="6" fill="${p[0]}" transform="rotate(-15)"/>
    <ellipse cx="3" cy="-3" rx="3.5" ry="6" fill="${p[2]}" transform="rotate(15)"/>
    <rect x="-0.6" y="0" width="1.2" height="6" rx="0.6" fill="${p[7]}"/>`,

  // Small bud / rosebud
  (p) => `
    <ellipse cx="0" cy="-3" rx="2.5" ry="4" fill="${p[0]}"/>
    <ellipse cx="-1.5" cy="-1" rx="2" ry="3.5" fill="${p[4]}"/>
    <ellipse cx="1.5" cy="-1" rx="2" ry="3.5" fill="${p[5]}"/>
    <rect x="-0.5" y="1" width="1" height="5" rx="0.5" fill="${p[7]}"/>`,

  // Berry cluster (3 circles)
  (p) => `
    <circle cx="-2" cy="-1.5" r="2.2" fill="${p[0]}"/>
    <circle cx="2" cy="-1.5" r="2.2" fill="${p[1]}"/>
    <circle cx="0" cy="1.5" r="2.2" fill="${p[2]}"/>
    <circle cx="0" cy="0" r="0.8" fill="${p[3]}"/>`,

  // Sprig (leaf pair on stem)
  (p) => `
    <rect x="-0.4" y="-8" width="0.8" height="16" rx="0.4" fill="${p[7]}"/>
    <path d="M0,-6 Q5,-10 0,-14 Q-1,-10 0,-6Z" fill="${p[4]}"/>
    <path d="M0,-1 Q-5,-5 0,-9 Q1,-5 0,-1Z" fill="${p[5]}"/>`,

  // Single leaf
  (p) => `
    <path d="M0,0 Q5,-9 0,-18 Q-5,-9 0,0Z" fill="${p[7]}"/>
    <line x1="0" y1="0" x2="0" y2="-16" stroke="${p[4]}" stroke-width="0.4" opacity="0.5"/>`,

  // Dot cluster (scattered small dots)
  (p) => `
    <circle cx="-2" cy="-3" r="1.2" fill="${p[3]}"/>
    <circle cx="2.5" cy="-1" r="1" fill="${p[6]}"/>
    <circle cx="0" cy="2" r="1.4" fill="${p[3]}"/>
    <circle cx="-3" cy="1" r="0.8" fill="${p[6]}"/>`,

  // Star flower (8 thin petals)
  (p) => `
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(45)"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}" transform="rotate(90)"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(135)"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}" transform="rotate(180)"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(225)"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[1]}" transform="rotate(270)"/>
    <ellipse cx="0" cy="-5" rx="1.2" ry="5" fill="${p[2]}" transform="rotate(315)"/>
    <circle cx="0" cy="0" r="2" fill="${p[6]}"/>`,
]

// Motif weights: flowers are less common than filler (leaves, dots, berries)
// [motifIndex, weight]
const motifWeights: [number, number][] = [
  [0, 3],  // 5-petal
  [1, 3],  // 6-petal
  [2, 2],  // 4-petal
  [3, 2],  // tulip
  [4, 3],  // bud
  [5, 4],  // berry
  [6, 5],  // sprig
  [7, 6],  // leaf
  [8, 5],  // dots
  [9, 2],  // star flower
]

const totalWeight = motifWeights.reduce((s, [, w]) => s + w, 0)

function pickMotif(rand: () => number): number {
  let r = rand() * totalWeight
  for (const [idx, w] of motifWeights) {
    r -= w
    if (r <= 0) return idx
  }
  return 7 // fallback to leaf
}

/**
 * Generate a floral SVG pattern as a data URI.
 * Uses all 4 theme colors with OKLCH-derived variants for a rich palette.
 * Motifs are placed with seeded pseudo-random positions, rotations, and scales
 * across a large tile to avoid visible grid repetition.
 */
export function generateFloralPattern(
  background: string,
  text: string,
  accent: string,
  codeBackground: string,
): string {
  const bgParsed = parse(background)
  const textParsed = parse(text)
  const accentParsed = parse(accent)
  const codeBgParsed = parse(codeBackground)

  if (!bgParsed || !textParsed || !accentParsed || !codeBgParsed) return ''

  const bgOklch = oklch(bgParsed) as Oklch
  const textOklch = oklch(textParsed) as Oklch
  const accentOklch = oklch(accentParsed) as Oklch
  const codeBgOklch = oklch(codeBgParsed) as Oklch

  if (!bgOklch || !textOklch || !accentOklch || !codeBgOklch) return ''

  const isDark = (bgOklch.l ?? 0) < 0.5

  // Pull all colors toward the background so they're subtle
  const subtleMix = isDark ? 0.75 : 0.8

  const mixTowardBg = (color: string) => {
    const mixed = interpolate([parse(color)!, bgParsed], 'oklch')(subtleMix)
    return mixed ? formatHex(mixed) ?? color : color
  }

  // Split-complementary palette: 3 hue anchors from the accent color
  // Split-complementary palette: 3 hue anchors from the accent color
  // Anchor A: accent hue, Anchor B: +150°, Anchor C: -150°
  // Each anchor gets lightness/chroma variants, plus green-ish stem colors
  const baseChroma = accentOklch.c ?? 0.1

  // For center/pistil: use text color only if it has meaningful chroma,
  // otherwise derive from accent at 75° (midway between anchors A and B)
  const textIsChromatic = (textOklch.c ?? 0) > 0.03
  const centerSource = textIsChromatic ? textOklch : accentOklch
  const centerHueShift = textIsChromatic ? 0 : 75

  const palette = [
    mixTowardBg(deriveVariant(accentOklch, 0, 0)),                           // 0: anchor A base
    mixTowardBg(deriveVariant(accentOklch, 15, 0.05)),                       // 1: anchor A warm
    mixTowardBg(deriveVariant(accentOklch, 150, 0, baseChroma * 0.2)),       // 2: anchor B base
    mixTowardBg(deriveVariant(accentOklch, 165, -0.04)),                     // 3: anchor B shifted
    mixTowardBg(deriveVariant(accentOklch, -150, 0.03, baseChroma * 0.15)),  // 4: anchor C base
    mixTowardBg(deriveVariant(accentOklch, -135, -0.02)),                    // 5: anchor C shifted
    mixTowardBg(deriveVariant(centerSource, centerHueShift, 0.03, -0.02)),   // 6: center/pistil color
    mixTowardBg(deriveVariant(accentOklch, 140, -0.05, -baseChroma * 0.3)),  // 7: stems/leaves (green-ish)
  ]

  const W = 400
  const H = 400
  const rand = seededRandom(31415)
  const MOTIF_COUNT = 200

  // Place motifs using Poisson-like rejection: track placed positions and
  // skip if too close to an existing one to avoid overlaps
  const placed: { x: number; y: number; r: number }[] = []
  const MIN_DIST = 5

  const elements: string[] = []

  for (let attempt = 0; attempt < MOTIF_COUNT * 4 && elements.length < MOTIF_COUNT; attempt++) {
    const x = rand() * W
    const y = rand() * H
    const motifIdx = pickMotif(rand)
    const scale = 0.4 + rand() * 0.7 // 0.4–1.1
    const rotation = rand() * 360
    const effectiveRadius = (motifIdx <= 4 || motifIdx === 9 ? 12 : 8) * scale

    // Check minimum distance to existing motifs
    let tooClose = false
    for (const p of placed) {
      const dx = Math.abs(x - p.x)
      const dy = Math.abs(y - p.y)
      // Wrap-aware distance (tile repeats)
      const wdx = Math.min(dx, W - dx)
      const wdy = Math.min(dy, H - dy)
      if (Math.sqrt(wdx * wdx + wdy * wdy) < (effectiveRadius + p.r + MIN_DIST * (0.5 + rand() * 0.5))) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    placed.push({ x, y, r: effectiveRadius })

    // Shuffle palette per-motif for color variety
    const shuffled = [...palette]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    const motifSvg = motifs[motifIdx](shuffled)
    const g = (tx: number, ty: number) =>
      `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${rotation.toFixed(0)}) scale(${scale.toFixed(2)})">${motifSvg}</g>`

    elements.push(g(x, y))

    // Wrap near edges so motifs tile seamlessly
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${elements.join('')}</svg>`

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * Derive the cloud color for the clouds background texture.
 * Light themes: white clouds. Dark themes: blend between bg and text.
 */
export function deriveCloudColor(background: string, text: string): string {
  const bgParsed = parse(background)
  const textParsed = parse(text)

  if (!bgParsed || !textParsed) return '#ffffff'

  const bgOklch = oklch(bgParsed) as Oklch
  if (!bgOklch) return '#ffffff'

  const isDark = (bgOklch.l ?? 0) < 0.5

  if (isDark) {
    const mid = interpolate([bgParsed, textParsed], 'oklch')(0.2)
    return mid ? formatHex(mid) ?? '#333333' : '#333333'
  }
  return '#ffffff'
}

/**
 * Derive subtle sky gradient tints from the background and accent colors.
 * Returns two colors: a warm tint (bottom/horizon) and a cool tint (top/zenith),
 * both very desaturated and close to the background color.
 */
export function deriveSkyGradient(
  background: string,
  accent: string,
): { top: string; bottom: string } {
  const bgParsed = parse(background)
  const accentParsed = parse(accent)

  if (!bgParsed || !accentParsed) return { top: background, bottom: background }

  const bgOklch = oklch(bgParsed) as Oklch
  const accentOklch = oklch(accentParsed) as Oklch
  if (!bgOklch || !accentOklch) return { top: background, bottom: background }

  const isDark = (bgOklch.l ?? 0) < 0.5
  const accentHue = accentOklch.h ?? 240

  // Very subtle chroma — just enough to tint
  const tintChroma = isDark ? 0.015 : 0.012

  // Top: cool tint (accent hue shifted toward blue/cool)
  const topTint: Oklch = {
    mode: 'oklch',
    l: Math.max(0, Math.min(1, (bgOklch.l ?? 0) + (isDark ? 0.03 : -0.02))),
    c: tintChroma,
    h: (accentHue + 30) % 360, // shift toward cooler
  }

  // Bottom: warm tint (accent hue shifted toward warm/horizon)
  const bottomTint: Oklch = {
    mode: 'oklch',
    l: Math.max(0, Math.min(1, (bgOklch.l ?? 0) + (isDark ? 0.01 : -0.01))),
    c: tintChroma * 0.8,
    h: (accentHue - 40 + 360) % 360, // shift toward warmer
  }

  return {
    top: formatHex(topTint) ?? background,
    bottom: formatHex(bottomTint) ?? background,
  }
}
