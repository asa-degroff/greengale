import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeReact from 'rehype-react'
import * as prod from 'react/jsx-runtime'
import { type ReactNode } from 'react'

// Production JSX runtime for rehype-react v8+
const production = {
  Fragment: prod.Fragment,
  jsx: prod.jsx,
  jsxs: prod.jsxs,
}

// Extended sanitization schema to allow KaTeX and code highlighting
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // KaTeX HTML elements
    'span',
    'svg',
    'line',
    'path',
    'rect',
    'g',
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
    '*': ['className', 'style'],
    span: ['className', 'style', 'aria-hidden', 'data-*'],
    code: ['className'],
    pre: ['className'],
    div: ['className', 'style'],
    // SVG attributes for KaTeX
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style', 'className'],
    line: ['x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width', 'fill'],
    path: ['d', 'stroke', 'stroke-width', 'fill', 'fill-rule', 'clip-rule'],
    rect: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'stroke-width'],
    g: ['fill', 'stroke', 'transform'],
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
}

export interface RenderOptions {
  enableLatex?: boolean
}

/**
 * Render markdown content to React elements
 */
export async function renderMarkdown(
  content: string,
  options: RenderOptions = {}
): Promise<ReactNode> {
  const { enableLatex = false } = options

  // Build the processor pipeline
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)

  // Add math support if enabled
  if (enableLatex) {
    processor = processor.use(remarkMath)
  }

  processor = processor
    .use(remarkRehype, { allowDangerousHtml: false })

  // Add KaTeX rendering if math is enabled
  if (enableLatex) {
    processor = processor.use(rehypeKatex)
  }

  processor = processor
    .use(rehypeHighlight, { detect: true })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeReact, production)

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
