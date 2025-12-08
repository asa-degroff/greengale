/**
 * Remark plugin for rendering SVG fence blocks
 *
 * Transforms markdown code blocks with `svg` language into sanitized
 * inline SVG elements.
 *
 * Usage in markdown:
 * ```svg
 * <svg viewBox="0 0 100 100">
 *   <circle cx="50" cy="50" r="40" fill="blue"/>
 * </svg>
 * ```
 */

import { visit } from 'unist-util-visit'
import type { Root, Code, Html } from 'mdast'
import type { Plugin } from 'unified'
import { sanitizeSvg, wrapSvg } from './svg-sanitizer'

export interface RemarkSvgOptions {
  /**
   * Whether to wrap SVG in a container div
   * @default true
   */
  wrapInContainer?: boolean
}

/**
 * Remark plugin that transforms ```svg code blocks into inline SVG
 */
export const remarkSvg: Plugin<[RemarkSvgOptions?], Root> = (
  options = {}
) => {
  const { wrapInContainer = true } = options

  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      // Only process svg code blocks
      if (node.lang !== 'svg') {
        return
      }

      // Sanitize the SVG content
      const sanitized = sanitizeSvg(node.value)

      if (!sanitized) {
        // If sanitization failed, replace with an error message
        const errorNode: Html = {
          type: 'html',
          value: '<div class="svg-error">Invalid or unsafe SVG content</div>',
        }
        if (parent && typeof index === 'number') {
          parent.children[index] = errorNode
        }
        return
      }

      // Create the HTML node with sanitized SVG
      const htmlNode: Html = {
        type: 'html',
        value: wrapInContainer ? wrapSvg(sanitized) : sanitized,
      }

      // Replace the code node with the HTML node
      if (parent && typeof index === 'number') {
        parent.children[index] = htmlNode
      }
    })
  }
}

export default remarkSvg
