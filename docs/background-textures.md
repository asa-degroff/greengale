# Background Textures

GreenGale offers three background texture options — **Grid**, **Floral**, and **Clouds** — selectable from the sidebar. Each texture adapts to the active theme's color palette, working seamlessly with both built-in presets and custom post themes.

## Texture Options

| Texture | Rendering | Description |
|---------|-----------|-------------|
| **Grid** | CSS background-image | Graph paper grid (default). Optionally animated via WebGPU ("Wavy Mode"). |
| **Floral** | Procedural SVG data URI | Dense botanical pattern of flowers, buds, leaves, and berries. |
| **Clouds** | SVG filters + CSS animation | Floating clouds drifting across a subtly tinted sky gradient. |

Users select a texture from the **Background** button group in the sidebar. The choice is persisted in `localStorage` under the key `background-texture`.

## Architecture

```
Sidebar.tsx                    useThemePreference.tsx           index.css
┌─────────────────┐           ┌──────────────────────┐        ┌──────────────────┐
│ Texture selector │──state──▶│ Resolves theme colors │───────▶│ .bg-texture      │
│ buttons          │          │ Sets CSS variables:   │        │ [data-texture=*] │
│                  │          │  --texture-image      │        │ .bg-texture-clouds│
│ Renders:         │          │  --cloud-color        │        └──────────────────┘
│  .bg-texture     │          │  --sky-tint-top/bottom│
│  OR CloudField   │          └──────────────────────┘
│  OR AnimatedGrid │                    │
└─────────────────┘           background-textures.ts
                              ┌──────────────────────┐
                              │ generateFloralPattern │
                              │ deriveCloudColor      │
                              │ deriveSkyGradient     │
                              └──────────────────────┘
```

### Key Files

- `src/lib/background-textures.ts` — SVG generation, color derivation, type definitions
- `src/lib/useThemePreference.tsx` — State management, CSS variable application, light/dark reactivity
- `src/components/Sidebar.tsx` — UI selection and conditional rendering
- `src/components/AnimatedCloud.tsx` — Cloud SVG component and CloudField layout
- `src/index.css` — Texture layer styling and content backdrop

## Floral Pattern

The floral texture is a procedurally generated 400×400px SVG tile that repeats seamlessly. It is generated entirely client-side from the active theme's colors and set as a CSS `background-image` data URI.

### Color Derivation

Colors are derived in OKLCH color space from four theme inputs: background, text, accent, and code background.

1. **Split-complementary harmony**: Three anchor hues are computed from the accent color — the accent itself, +150°, and -150°.
2. **8-color palette**: Each anchor generates two variants (lighter/darker). A stem/leaf green and a pistil/center color complete the set.
3. **Subtlety mixing**: All colors are mixed 75–80% toward the background color, keeping motifs low-contrast and decorative rather than distracting.

### Motifs

Ten SVG shapes are randomly placed, weighted to favor smaller filler elements:

| Category | Motifs | Weight |
|----------|--------|--------|
| Flowers | 5-petal rose, 6-petal daisy, 4-petal cross, tulip, star flower | ~10 |
| Fillers | Bud, berry cluster, sprig, single leaf, dot cluster | ~28 |

Each motif is placed at a random rotation and scale (0.4–1.1×), with colors shuffled from the palette.

### Placement Algorithm

- **Target density**: 200 motifs per 400×400 tile
- **Poisson-like rejection**: Tracks placed positions and radii; rejects placements that overlap within 5px + random spacing
- **Seamless wrapping**: Motifs near tile edges are duplicated at opposite edges (8-way) to eliminate visible seams
- **Deterministic PRNG**: Uses a seeded mulberry32 random generator (seed 31415) so the pattern is identical across page loads

### CSS Application

```css
.bg-texture[data-texture="floral"] {
  background-image: var(--texture-image, none);
  background-size: 400px 400px;
  background-repeat: repeat;
}
```

## Clouds

The clouds texture renders animated SVG clouds floating across a subtly tinted sky.

### Cloud Rendering (AnimatedCloud.tsx)

Each cloud is a collection of overlapping ellipses filled with radial gradients, processed through SVG filters:

1. **Radial gradients** provide smooth opacity falloff from core to edge (multiple stops to prevent banding)
2. **feTurbulence** generates fractal noise unique to each cloud (via seed)
3. **feGaussianBlur** softens the source shapes
4. **feDisplacementMap** distorts edges using the noise, creating organic irregularity
5. **Post-displacement blur** smooths out contour artifacts from the displacement sampling

Filters use `colorInterpolationFilters="sRGB"` to prevent the dark halo artifact that occurs when blending semi-transparent shapes in linearRGB space.

Three cloud variants exist — **large**, **medium**, and **small** — each with different ellipse counts and arrangements. A separate "wisp" filter layer adds extra-diffuse outer edges.

### Cloud Color

Cloud color is derived by `deriveCloudColor(background, text)`:

| Background | Cloud Color |
|------------|-------------|
| Dark (L < 0.5) | 20% blend toward text color |
| Near-white (L > 0.95, C < 0.02) | 12% blend toward text color (subtle gray) |
| Light/pastel | White (#ffffff) |

### Sky Gradient

The background is a vertical gradient with subtle tints derived from the accent color:

- **Top**: Cool tint (accent hue + 30°, very low chroma)
- **Bottom**: Warm tint (accent hue - 40°, very low chroma)

```css
.bg-texture-clouds {
  background: linear-gradient(
    to bottom,
    var(--sky-tint-top) 0%,
    var(--site-bg) 40%,
    var(--site-bg) 60%,
    var(--sky-tint-bottom) 100%
  );
}
```

### CloudField Layout

`CloudField` manages 8 (compact) or 12 (fullscreen) cloud instances arranged in layered depth:

- **Far background**: Large, slow (110–130s), subtle opacity (0.15–0.20)
- **Mid layer**: Moderate size and pace (85–100s), medium opacity (0.22–0.30)
- **Foreground**: Largest, faster (65–75s), strongest opacity (0.30–0.38)
- **Accent**: Small clouds for variety

Clouds animate via CSS `transform: translateX()` (compositor-only, no SVG re-rasterization per frame). Each cloud gets a random negative `animation-delay` so they start at staggered positions.

## Content Backdrop

Both floral and clouds textures are visually busy, so a semi-transparent backdrop is applied behind post content for readability:

```css
.content-backdrop::before {
  background-color: var(--backdrop-color);
  mask-image: linear-gradient(
    to bottom,
    transparent,
    black 3rem,
    black calc(100% - 3rem),
    transparent
  );
}
```

The backdrop fades in/out at the top and bottom edges. The backdrop color is set directly from `--site-bg` in sRGB to avoid color interpolation artifacts.

## Theme Reactivity

When the user toggles light/dark mode (with the default theme), a `MutationObserver` watches for changes to the `data-site-theme` attribute on `<html>`. On change:

1. CSS variables (`--site-bg`, `--site-text`, etc.) update via the theme system
2. `applyTextureColors()` is called after a `requestAnimationFrame` to read fresh computed styles
3. The floral pattern is regenerated with the new palette; cloud/sky colors are re-derived
4. All updates happen in `useLayoutEffect` to prevent visual flash
