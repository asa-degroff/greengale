/**
 * Rehype plugin that wraps <table> elements in a scrollable container div.
 *
 * This prevents wide tables from overflowing the page or extending under
 * the fixed table of contents sidebar.
 */

import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'
import type { Plugin } from 'unified'

export const rehypeTableWrapper: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (
        node.tagName !== 'table' ||
        !parent ||
        index === undefined
      ) {
        return
      }

      // Don't double-wrap
      if (
        parent.type === 'element' &&
        (parent as Element).properties?.className &&
        (
          Array.isArray((parent as Element).properties!.className)
            ? ((parent as Element).properties!.className as string[]).includes('table-scroll-wrapper')
            : (parent as Element).properties!.className === 'table-scroll-wrapper'
        )
      ) {
        return
      }

      const wrapper: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll-wrapper'] },
        children: [node],
      }

      parent.children[index] = wrapper
    })
  }
}
