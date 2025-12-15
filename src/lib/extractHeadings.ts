export interface TocHeading {
  id: string
  text: string
  level: number
}

/**
 * Generate a URL-friendly slug from text
 * Handles duplicates by appending numeric suffixes
 */
export function generateSlug(text: string, existingSlugs: Set<string>): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')          // Spaces to hyphens
    .replace(/-+/g, '-')           // Collapse multiple hyphens
    .replace(/^-|-$/g, '')         // Trim leading/trailing hyphens

  // Handle empty slug
  if (!slug) {
    slug = 'heading'
  }

  // Handle duplicates
  const baseSlug = slug
  let counter = 1
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${counter}`
    counter++
  }

  existingSlugs.add(slug)
  return slug
}

/**
 * Extract plain text from markdown heading content
 * Removes inline formatting like bold, italic, code, links
 */
function extractHeadingText(line: string): string {
  return line
    // Remove heading markers
    .replace(/^#{1,6}\s+/, '')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .trim()
}

/**
 * Extract headings from markdown content
 * Returns an array of heading metadata for TOC generation
 */
export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = []
  const existingSlugs = new Set<string>()
  const lines = markdown.split('\n')

  let inCodeBlock = false

  for (const line of lines) {
    // Track code blocks to avoid false positives
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }

    if (inCodeBlock) continue

    // Match ATX-style headings (# Heading)
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const text = extractHeadingText(line)

      if (text) {
        const id = generateSlug(text, existingSlugs)
        headings.push({ id, text, level })
      }
    }
  }

  return headings
}
