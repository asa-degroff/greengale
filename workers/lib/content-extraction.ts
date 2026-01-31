/**
 * Content Extraction Library
 *
 * Extracts plaintext content from various blog post formats for embedding generation.
 * Supports GreenGale, WhiteWind (markdown), and site.standard.document (various formats).
 */

export interface ExtractedContent {
  /** Plaintext content suitable for embedding */
  text: string
  /** Document structure (headings with levels) */
  headings: Array<{ text: string; level: number }>
  /** Approximate word count */
  wordCount: number
  /** Content format detected */
  format: 'markdown' | 'leaflet' | 'textContent' | 'unknown'
  /** Whether content was successfully extracted */
  success: boolean
}

export interface ContentChunk {
  /** Chunk text */
  text: string
  /** Zero-based chunk index */
  chunkIndex: number
  /** Total number of chunks */
  totalChunks: number
  /** Section heading (if chunk starts with one) */
  heading?: string
}

// Collections we support
const MARKDOWN_COLLECTIONS = [
  'app.greengale.document',
  'app.greengale.blog.entry',
  'com.whtwnd.blog.entry',
]

/**
 * Extract plaintext content from a post record for embedding
 */
export function extractContent(
  record: Record<string, unknown>,
  collection: string
): ExtractedContent {
  // GreenGale and WhiteWind use markdown
  if (MARKDOWN_COLLECTIONS.includes(collection)) {
    const markdown = (record.content as string) || ''
    return extractFromMarkdown(markdown)
  }

  // site.standard.document has multiple possible formats
  if (collection === 'site.standard.document') {
    return extractFromSiteStandard(record)
  }

  // Unknown collection
  return {
    text: '',
    headings: [],
    wordCount: 0,
    format: 'unknown',
    success: false,
  }
}

/**
 * Extract content from site.standard.document
 * Prefers textContent if available, otherwise parses content union
 */
function extractFromSiteStandard(record: Record<string, unknown>): ExtractedContent {
  // Prefer textContent (plaintext, explicitly for indexing)
  const textContent = record.textContent as string | undefined
  if (textContent && textContent.trim().length > 0) {
    return {
      text: textContent.trim(),
      headings: [],
      wordCount: countWords(textContent),
      format: 'textContent',
      success: true,
    }
  }

  // Parse content union
  const content = record.content as Record<string, unknown> | undefined
  if (!content) {
    return {
      text: '',
      headings: [],
      wordCount: 0,
      format: 'unknown',
      success: false,
    }
  }

  const contentType = content.$type as string | undefined

  // Leaflet.pub format
  if (contentType === 'pub.leaflet.content') {
    return extractFromLeaflet(content)
  }

  // GreenGale content reference (points to app.greengale.document)
  if (contentType === 'app.greengale.document#contentRef') {
    // Content is in another record - we don't have access here
    return {
      text: '',
      headings: [],
      wordCount: 0,
      format: 'unknown',
      success: false,
    }
  }

  // Try generic extraction for unknown formats
  return extractFromGeneric(content)
}

/**
 * Extract content from markdown (GreenGale/WhiteWind)
 */
function extractFromMarkdown(markdown: string): ExtractedContent {
  const headings: Array<{ text: string; level: number }> = []
  const lines = markdown.split('\n')
  const outputLines: string[] = []

  let inCodeBlock = false
  let inLatexBlock = false

  for (const line of lines) {
    // Track code blocks
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    // Track LaTeX blocks
    if (line.startsWith('$$')) {
      inLatexBlock = !inLatexBlock
      continue
    }
    if (inLatexBlock) continue

    // Extract headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = stripInlineFormatting(headingMatch[2])
      headings.push({ text, level })
      outputLines.push(text)
      continue
    }

    // Skip horizontal rules
    if (/^[-*_]{3,}$/.test(line.trim())) continue

    // Process regular lines
    let processed = line
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/, '')
      .replace(/^[\s]*\d+\.\s+/, '')
      // Remove blockquote markers
      .replace(/^>\s*/, '')

    // Strip inline formatting
    processed = stripInlineFormatting(processed)

    if (processed.trim()) {
      outputLines.push(processed.trim())
    }
  }

  const text = outputLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  return {
    text,
    headings,
    wordCount: countWords(text),
    format: 'markdown',
    success: text.length > 0,
  }
}

/**
 * Extract content from Leaflet's block-based format
 */
function extractFromLeaflet(content: Record<string, unknown>): ExtractedContent {
  const headings: Array<{ text: string; level: number }> = []
  const textParts: string[] = []

  const pages = content.pages as Array<Record<string, unknown>> | undefined
  if (!pages) {
    return {
      text: '',
      headings: [],
      wordCount: 0,
      format: 'leaflet',
      success: false,
    }
  }

  for (const page of pages) {
    const blocks = page.blocks as Array<Record<string, unknown>> | undefined
    if (!blocks) continue

    for (const blockWrapper of blocks) {
      // Leaflet wraps blocks: { $type: "...#block", block: { ... } }
      const block = (blockWrapper.block as Record<string, unknown>) || blockWrapper
      const blockType = block.$type as string

      if (blockType === 'pub.leaflet.blocks.text') {
        const plaintext = block.plaintext as string
        if (plaintext?.trim()) {
          textParts.push(plaintext.trim())
        }
      } else if (blockType === 'pub.leaflet.blocks.header') {
        const plaintext = block.plaintext as string
        const level = (block.level as number) || 2
        if (plaintext?.trim()) {
          headings.push({ text: plaintext.trim(), level })
          textParts.push(plaintext.trim())
        }
      } else if (blockType === 'pub.leaflet.blocks.image') {
        const alt = block.alt as string
        if (alt?.trim()) {
          textParts.push(`[Image: ${alt.trim()}]`)
        }
      } else if (blockType === 'pub.leaflet.blocks.quote') {
        const plaintext = block.plaintext as string
        if (plaintext?.trim()) {
          textParts.push(plaintext.trim())
        }
      }
      // Skip code blocks - they don't embed well semantically
    }
  }

  const text = textParts.join('\n\n').trim()

  return {
    text,
    headings,
    wordCount: countWords(text),
    format: 'leaflet',
    success: text.length > 0,
  }
}

/**
 * Generic content extraction for unknown formats
 */
function extractFromGeneric(content: Record<string, unknown>): ExtractedContent {
  // Try common field names
  const possibleFields = ['text', 'body', 'markdown', 'plaintext', 'content']

  for (const field of possibleFields) {
    const value = content[field]
    if (typeof value === 'string' && value.trim()) {
      let text = value

      // Strip HTML if present
      if (text.includes('<') && text.includes('>')) {
        text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      }

      // Strip markdown if it looks like markdown
      if (text.includes('#') || text.includes('*') || text.includes('[')) {
        const extracted = extractFromMarkdown(text)
        return { ...extracted, format: 'unknown' }
      }

      return {
        text: text.trim(),
        headings: [],
        wordCount: countWords(text),
        format: 'unknown',
        success: true,
      }
    }
  }

  // Try blocks array
  const blocks = content.blocks as Array<Record<string, unknown>> | undefined
  if (blocks?.length) {
    const texts = blocks
      .map(b => (b.text as string) || (b.plaintext as string) || '')
      .filter(Boolean)

    if (texts.length) {
      const text = texts.join('\n\n')
      return {
        text,
        headings: [],
        wordCount: countWords(text),
        format: 'unknown',
        success: true,
      }
    }
  }

  return {
    text: '',
    headings: [],
    wordCount: 0,
    format: 'unknown',
    success: false,
  }
}

/**
 * Strip inline markdown formatting
 */
function stripInlineFormatting(text: string): string {
  return text
    // Remove images, keep alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => (alt ? `[Image: ${alt}]` : ''))
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bold/italic
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove inline LaTeX
    .replace(/\$[^$]+\$/g, '')
    .trim()
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

/**
 * Estimate token count (rough: ~4 chars per token for English)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Generate SHA-256 hash of content for change detection
 * Returns first 16 hex characters (64 bits)
 *
 * Version prefix ensures hash changes if extraction logic changes:
 * - v1: Initial version
 */
const CONTENT_HASH_VERSION = 'v1'

export async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder()
  // Include version prefix so hash changes if extraction logic changes
  const data = encoder.encode(`${CONTENT_HASH_VERSION}:${text}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Chunk content by heading structure for long posts
 * Respects heading boundaries and adds context overlap
 */
export function chunkByHeadings(
  extracted: ExtractedContent,
  title?: string,
  subtitle?: string,
  options: {
    maxTokens?: number
    minTokens?: number
    overlapTokens?: number
  } = {}
): ContentChunk[] {
  const { maxTokens = 800, minTokens = 100, overlapTokens = 50 } = options

  // If short enough, return single chunk
  const totalTokens = estimateTokens(extracted.text)
  if (totalTokens <= maxTokens) {
    const text = [title, subtitle, extracted.text].filter(Boolean).join('\n\n')
    return [
      {
        text,
        chunkIndex: 0,
        totalChunks: 1,
      },
    ]
  }

  // Split text into sections based on headings
  const lines = extracted.text.split('\n')
  const sections: Array<{ heading?: string; lines: string[] }> = []
  let currentSection: { heading?: string; lines: string[] } = { lines: [] }

  // Add preamble (title + subtitle) to first section
  if (title) currentSection.lines.push(title)
  if (subtitle) currentSection.lines.push(subtitle)

  for (const line of lines) {
    // Check if line is a heading (matches one of our extracted headings)
    const isHeading = extracted.headings.some(h => line.trim() === h.text)

    if (isHeading && currentSection.lines.length > 0) {
      // Start new section
      sections.push(currentSection)
      currentSection = { heading: line.trim(), lines: [line] }
    } else {
      currentSection.lines.push(line)
    }
  }

  // Push final section
  if (currentSection.lines.length > 0) {
    sections.push(currentSection)
  }

  // Merge small sections and split large ones
  const chunks: ContentChunk[] = []
  let currentChunk: string[] = []
  let currentHeading: string | undefined

  for (const section of sections) {
    const sectionText = section.lines.join('\n')
    const sectionTokens = estimateTokens(sectionText)
    const currentTokens = estimateTokens(currentChunk.join('\n'))

    // If adding this section exceeds max, flush current chunk
    if (currentTokens + sectionTokens > maxTokens && currentTokens >= minTokens) {
      chunks.push({
        text: currentChunk.join('\n').trim(),
        chunkIndex: chunks.length,
        totalChunks: -1, // Set after
        heading: currentHeading,
      })

      // Start new chunk with overlap from previous
      const overlapLines = getOverlapLines(currentChunk, overlapTokens)
      currentChunk = [...overlapLines, ...section.lines]
      currentHeading = section.heading
    } else {
      currentChunk.push(...section.lines)
      if (!currentHeading && section.heading) {
        currentHeading = section.heading
      }
    }
  }

  // Flush remaining
  if (currentChunk.length > 0) {
    const text = currentChunk.join('\n').trim()
    if (estimateTokens(text) >= minTokens || chunks.length === 0) {
      chunks.push({
        text,
        chunkIndex: chunks.length,
        totalChunks: -1,
        heading: currentHeading,
      })
    } else if (chunks.length > 0) {
      // Merge with previous chunk if too small
      chunks[chunks.length - 1].text += '\n\n' + text
    }
  }

  // Update totalChunks
  for (const chunk of chunks) {
    chunk.totalChunks = chunks.length
  }

  return chunks
}

/**
 * Get last N tokens worth of lines for overlap
 */
function getOverlapLines(lines: string[], targetTokens: number): string[] {
  const result: string[] = []
  let tokens = 0

  for (let i = lines.length - 1; i >= 0 && tokens < targetTokens; i--) {
    result.unshift(lines[i])
    tokens += estimateTokens(lines[i])
  }

  return result
}
