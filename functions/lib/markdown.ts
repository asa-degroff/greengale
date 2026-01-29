// Server-side markdown to HTML renderer for edge runtime
// Simple regex-based conversion - no external dependencies for Cloudflare compatibility

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Simple markdown to HTML converter for bot prerendering
 * Handles basic markdown syntax without external dependencies
 */
export function renderMarkdownToHtml(content: string): string {
  let html = content

  // Escape HTML first (we'll unescape our own tags)
  html = escapeHtml(html)

  // Code blocks (must be before other processing)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`
  )

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Headings
  html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')

  // Bold and italic (must handle ** before *)
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  // Images (before links since image syntax includes link syntax)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" loading="lazy">'
  )

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>'
  )

  // Blockquotes
  html = html.replace(/^&gt;\s+(.*)$/gm, '<blockquote>$1</blockquote>')
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n')

  // Horizontal rules
  html = html.replace(/^[-*_]{3,}$/gm, '<hr>')

  // Unordered lists
  html = html.replace(/^[\t ]*[-*+]\s+(.*)$/gm, '<li>$1</li>')

  // Ordered lists
  html = html.replace(/^[\t ]*\d+\.\s+(.*)$/gm, '<li>$1</li>')

  // Wrap consecutive <li> elements in <ul> (simplified)
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g, (match) => {
    return '<ul>' + match + '</ul>'
  })

  // Paragraphs - wrap remaining text blocks
  const lines = html.split('\n')
  const result: string[] = []
  let inParagraph = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      if (inParagraph) {
        result.push('</p>')
        inParagraph = false
      }
      result.push('')
      continue
    }

    // Check if this line is already a block element
    const isBlockElement = /^<(h[1-6]|p|div|ul|ol|li|blockquote|pre|hr|table|thead|tbody|tr|th|td)[\s>]/i.test(trimmed) ||
                          /^<\/(h[1-6]|p|div|ul|ol|li|blockquote|pre|table|thead|tbody|tr|th|td)>/i.test(trimmed)

    if (isBlockElement) {
      if (inParagraph) {
        result.push('</p>')
        inParagraph = false
      }
      result.push(line)
    } else {
      if (!inParagraph) {
        result.push('<p>')
        inParagraph = true
      }
      result.push(line)
    }
  }

  if (inParagraph) {
    result.push('</p>')
  }

  return result.join('\n')
}

/**
 * Extract plain text from markdown (for meta descriptions)
 */
export function extractText(markdown: string, maxLength = 200): string {
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
