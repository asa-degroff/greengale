/**
 * Rehype plugin for adding IDs to heading elements
 *
 * Adds URL-friendly `id` attributes to h1-h6 elements for anchor navigation.
 * Uses the same slug generation logic as extractHeadings.ts to ensure consistency.
 */

import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'
import type { Plugin } from 'unified'
import { generateSlug } from './extractHeadings'

/**
 * Extract plain text from hast element children
 */
function extractText(node: Element): string {
  let text = ''

  function walk(children: typeof node.children) {
    for (const child of children) {
      if (child.type === 'text') {
        text += child.value
      } else if (child.type === 'element' && child.children) {
        walk(child.children)
      }
    }
  }

  walk(node.children)
  return text.trim()
}

/**
 * Rehype plugin that adds id attributes to heading elements
 */
export const rehypeHeadingIds: Plugin<[], Root> = () => {
  return (tree: Root) => {
    const existingSlugs = new Set<string>()

    visit(tree, 'element', (node: Element) => {
      // Only process h1-h6 elements
      if (!/^h[1-6]$/.test(node.tagName)) {
        return
      }

      // Skip if already has an id
      if (node.properties?.id) {
        existingSlugs.add(String(node.properties.id))
        return
      }

      // Extract text content
      const text = extractText(node)
      if (!text) return

      // Generate slug and add as id
      const id = generateSlug(text, existingSlugs)
      node.properties = node.properties || {}
      node.properties.id = id
    })
  }
}

export default rehypeHeadingIds
