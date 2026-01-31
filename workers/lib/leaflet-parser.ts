/**
 * Leaflet Content Parser
 *
 * Extracts plaintext from Leaflet's block-based content structure.
 * Used to index site.standard.document records from Leaflet for search.
 */

interface LeafletBlock {
  $type: string
  block?: {
    $type: string
    plaintext?: string
    code?: string
    children?: LeafletListItem[]
  }
}

interface LeafletListItem {
  $type?: string
  content?: {
    $type?: string
    plaintext?: string
  }
  children?: LeafletListItem[]
}

interface LeafletContent {
  $type?: string
  pages?: Array<{
    $type?: string
    blocks?: LeafletBlock[]
  }>
}

/**
 * Extract plaintext from Leaflet content structure.
 *
 * Handles block types:
 * - pub.leaflet.blocks.text → plaintext
 * - pub.leaflet.blocks.blockquote → plaintext
 * - pub.leaflet.blocks.unorderedList → children[].content.plaintext (recursive)
 * - pub.leaflet.blocks.orderedList → children[].content.plaintext (recursive)
 *
 * Skips: images, horizontalRule, and other non-text blocks
 */
export function extractLeafletContent(content: unknown): string {
  const leaflet = content as LeafletContent
  if (!leaflet?.pages) return ''

  const textParts: string[] = []

  for (const page of leaflet.pages) {
    if (!page.blocks) continue

    for (const blockWrapper of page.blocks) {
      const block = blockWrapper.block
      if (!block) continue

      // Extract plaintext from text-based blocks
      if (block.plaintext) {
        textParts.push(block.plaintext)
      }

      // Extract from list items (unorderedList, orderedList)
      if (block.children) {
        extractListItems(block.children, textParts)
      }
    }
  }

  return textParts.filter(t => t.trim()).join('\n\n')
}

/**
 * Recursively extract text from list items
 */
function extractListItems(items: LeafletListItem[], output: string[]): void {
  for (const item of items) {
    if (item.content?.plaintext) {
      output.push(item.content.plaintext)
    }
    if (item.children?.length) {
      extractListItems(item.children, output)
    }
  }
}

/**
 * Check if content object is Leaflet format
 */
export function isLeafletContent(content: unknown): boolean {
  const obj = content as Record<string, unknown> | undefined
  return obj?.$type === 'pub.leaflet.content'
}
