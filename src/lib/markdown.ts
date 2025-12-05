import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeReact from 'rehype-react'
import { createElement, Fragment, type ReactNode } from 'react'

// Extended sanitization schema to allow KaTeX and code highlighting
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'span',
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
    'annotation',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['className', 'style'],
    span: ['className', 'style', 'aria-hidden'],
    code: ['className'],
    pre: ['className'],
    div: ['className'],
  },
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
    .use(rehypeReact, {
      createElement,
      Fragment,
      components: {
        // Custom components can be added here
        a: ({ href, children, ...props }: { href?: string; children?: ReactNode }) => {
          // External links open in new tab
          const isExternal = href?.startsWith('http')
          return createElement(
            'a',
            {
              href,
              ...props,
              ...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
            },
            children
          )
        },
        img: ({ src, alt, ...props }: { src?: string; alt?: string }) => {
          return createElement('img', {
            src,
            alt,
            loading: 'lazy',
            ...props,
          })
        },
      },
    })

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
