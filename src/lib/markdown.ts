import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeReact from 'rehype-react'
import * as prod from 'react/jsx-runtime'
import { type ReactNode } from 'react'
import { remarkSvg } from './remark-svg'
import { remarkBlueskyEmbed } from './remark-bluesky-embed'
import { rehypeHeadingIds } from './rehype-heading-ids'

// Production JSX runtime for rehype-react v8+
const production = {
  Fragment: prod.Fragment,
  jsx: prod.jsx,
  jsxs: prod.jsxs,
}

// Extended sanitization schema to allow KaTeX, code highlighting, and inline SVGs
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // Ensure div is allowed (for Bluesky embeds and SVG containers)
    'div',
    // KaTeX HTML elements
    'span',
    // SVG elements (for KaTeX and inline SVG blocks)
    'svg',
    'g',
    'defs',
    'symbol',
    'use',
    'title',
    'desc',
    'circle',
    'ellipse',
    'line',
    'path',
    'polygon',
    'polyline',
    'rect',
    'text',
    'tspan',
    'textPath',
    'linearGradient',
    'radialGradient',
    'stop',
    'pattern',
    'clipPath',
    'mask',
    'marker',
    'filter',
    'feGaussianBlur',
    'feOffset',
    'feMerge',
    'feMergeNode',
    'feBlend',
    'feColorMatrix',
    'feFlood',
    'feComposite',
    // SVG animation elements
    'animate',
    'animateTransform',
    'animateMotion',
    'set',
    'mpath',
    // Style element (for SVG internal stylesheets, already sanitized by remark-svg)
    'style',
    // MathML elements (for accessibility)
    'math',
    'semantics',
    'mrow',
    'mi',
    'mo',
    'mn',
    'msup',
    'msub',
    'mfrac',
    'mroot',
    'msqrt',
    'mtext',
    'mover',
    'munder',
    'munderover',
    'mtable',
    'mtr',
    'mtd',
    'mspace',
    'mpadded',
    'mstyle',
    'annotation',
    'annotation-xml',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['className', 'style', 'transform'],
    span: ['className', 'style', 'aria-hidden', 'data-*', 'data-handle', 'data-rkey'],
    code: ['className'],
    pre: ['className'],
    div: ['className', 'style', 'data-*'],
    // Allow id attributes on headings for TOC anchor links
    h1: ['id'],
    h2: ['id'],
    h3: ['id'],
    h4: ['id'],
    h5: ['id'],
    h6: ['id'],
    // Ensure img tags preserve src and alt attributes
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    // SVG attributes (for KaTeX and inline SVG blocks)
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style', 'className', 'x', 'y'],
    g: ['fill', 'stroke', 'transform', 'opacity', 'className', 'id', 'style'],
    defs: ['className', 'id', 'style'],
    symbol: ['viewBox', 'preserveAspectRatio', 'id', 'className'],
    use: ['href', 'x', 'y', 'width', 'height', 'className'],
    title: ['className'],
    desc: ['className'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'className', 'id', 'style', 'transform'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'className', 'id', 'style', 'transform'],
    line: ['x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width', 'fill', 'opacity', 'className', 'id', 'style', 'transform'],
    path: ['d', 'stroke', 'stroke-width', 'fill', 'fill-rule', 'clip-rule', 'opacity', 'className', 'id', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'style', 'transform'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'className', 'id', 'style', 'transform'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'className', 'id', 'style', 'transform'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'className', 'id', 'style', 'transform'],
    text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'font-style', 'fill', 'stroke', 'opacity', 'className', 'id', 'letter-spacing'],
    tspan: ['x', 'y', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'font-style', 'fill', 'className'],
    textPath: ['href', 'startOffset', 'method', 'spacing', 'className'],
    linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
    radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
    stop: ['offset', 'stop-color', 'stop-opacity', 'className', 'style'],
    pattern: ['id', 'x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform', 'href'],
    clipPath: ['id', 'clipPathUnits', 'className'],
    mask: ['id', 'x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits', 'className'],
    marker: ['id', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox', 'preserveAspectRatio'],
    filter: ['id', 'x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits'],
    feGaussianBlur: ['in', 'stdDeviation', 'result'],
    feOffset: ['in', 'dx', 'dy', 'result'],
    feMerge: ['result'],
    feMergeNode: ['in'],
    feBlend: ['in', 'in2', 'mode', 'result'],
    feColorMatrix: ['in', 'type', 'values', 'result'],
    feFlood: ['flood-color', 'flood-opacity', 'result'],
    feComposite: ['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result'],
    // SVG animation attributes
    animate: ['attributeName', 'attributeType', 'from', 'to', 'by', 'values', 'dur', 'begin', 'end', 'min', 'max', 'restart', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate'],
    animateTransform: ['attributeName', 'attributeType', 'type', 'from', 'to', 'by', 'values', 'dur', 'begin', 'end', 'min', 'max', 'restart', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate'],
    animateMotion: ['path', 'keyPoints', 'rotate', 'origin', 'dur', 'begin', 'end', 'min', 'max', 'restart', 'repeatCount', 'repeatDur', 'fill', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate'],
    set: ['attributeName', 'attributeType', 'to', 'dur', 'begin', 'end', 'min', 'max', 'restart', 'repeatCount', 'repeatDur', 'fill'],
    mpath: ['href'],
    // Style element (CSS type attribute)
    style: ['type'],
    // MathML attributes
    math: ['xmlns', 'display', 'className', 'style'],
    mrow: ['className'],
    mi: ['className', 'mathvariant'],
    mo: ['className', 'fence', 'stretchy', 'symmetric', 'largeop', 'movablelimits', 'separator', 'form', 'minsize', 'maxsize'],
    mn: ['className'],
    mfrac: ['className', 'linethickness'],
    msup: ['className'],
    msub: ['className'],
    mroot: ['className'],
    msqrt: ['className'],
    mtext: ['className'],
    mover: ['className', 'accent'],
    munder: ['className', 'accentunder'],
    munderover: ['className', 'accent', 'accentunder'],
    mtable: ['className', 'columnalign', 'rowalign'],
    mtr: ['className'],
    mtd: ['className', 'columnalign'],
    mspace: ['className', 'width', 'height', 'depth'],
    mpadded: ['className', 'width', 'height', 'depth', 'lspace', 'voffset'],
    mstyle: ['className', 'displaystyle', 'scriptlevel'],
    semantics: ['className'],
    annotation: ['encoding', 'className'],
  },
  // Allow data-* attributes globally for KaTeX
  clobberPrefix: '',
  clobber: [],
  // Allow blob: URLs for images (used for local preview of uploaded images)
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'blob'],
  },
}

export interface RenderOptions {
  enableLatex?: boolean
  enableSvg?: boolean
  /** Custom React components to use for specific HTML elements */
  components?: Record<string, React.ComponentType<Record<string, unknown>>>
}

/**
 * Render markdown content to React elements
 */
export async function renderMarkdown(
  content: string,
  options: RenderOptions = {}
): Promise<ReactNode> {
  const { enableLatex = false, enableSvg = true, components } = options

  // Build the processor pipeline
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Transform standalone Bluesky URLs into embed placeholders
    .use(remarkBlueskyEmbed)

  // Add math support if enabled
  if (enableLatex) {
    processor = processor.use(remarkMath)
  }

  // Add SVG block support if enabled
  // This transforms ```svg blocks into sanitized inline SVG
  if (enableSvg) {
    processor = processor.use(remarkSvg)
  }

  // Convert to rehype (HTML AST)
  // allowDangerousHtml is needed for raw HTML nodes (SVG blocks, Bluesky embeds)
  processor = processor.use(remarkRehype, { allowDangerousHtml: true })

  // Parse raw HTML into proper hast nodes
  // This must come before sanitization so the HTML can be properly analyzed
  // Required for both SVG blocks and Bluesky embed placeholders
  processor = processor.use(rehypeRaw)

  // Add KaTeX rendering if math is enabled
  if (enableLatex) {
    processor = processor.use(rehypeKatex)
  }

  // Add IDs to headings for TOC anchor navigation
  processor = processor.use(rehypeHeadingIds)

  processor = processor
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeReact, components ? { ...production, components } : production)

  const file = await processor.process(content)
  return file.result as ReactNode
}

/**
 * Extract plain text from markdown (for previews)
 */
export function extractText(markdown: string, maxLength = 200): string {
  // Simple extraction - remove markdown syntax
  const text = markdown
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]+`/g, '')
    // Remove images
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= maxLength) {
    return text
  }

  // Truncate at word boundary
  const truncated = text.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...'
}

/**
 * Extract the first heading from markdown
 */
export function extractTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : undefined
}

/**
 * Extract the first image URL from markdown
 */
export function extractFirstImage(markdown: string): string | undefined {
  const match = markdown.match(/!\[.*?\]\(([^)]+)\)/)
  return match ? match[1] : undefined
}
