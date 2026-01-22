/**
 * Remark plugin for parsing @mentions and linking to GreenGale profiles
 *
 * Transforms @handle mentions in text into links to the user's GreenGale profile.
 * Only matches domain-style handles (e.g., @user.bsky.social, @someone.com).
 *
 * Usage in markdown:
 * ```
 * Check out @alice.bsky.social's latest post!
 * ```
 *
 * Becomes a link to /alice.bsky.social on GreenGale.
 *
 * Does NOT match:
 * - Email addresses (user@example.com)
 * - Mentions inside code blocks or inline code
 * - Invalid handle formats
 */

import { visit } from 'unist-util-visit'
import type { Root, Text, Link, PhrasingContent } from 'mdast'
import type { Plugin } from 'unified'

/**
 * Regex to match @mentions with domain-style handles
 *
 * Pattern breakdown:
 * - (?<=^|[\s\p{P}]) - Preceded by start of string, whitespace, or punctuation (but not alphanumeric to avoid emails)
 * - @ - The @ symbol
 * - ([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?) - First segment: starts/ends with alphanumeric, hyphens allowed in middle
 * - (?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+ - One or more additional segments separated by dots
 *
 * This ensures we match domain-style handles like user.bsky.social but not emails like user@example.com
 */
const MENTION_REGEX =
  /(?:^|(?<=[\s\p{P}]))@([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+)/gu

export interface RemarkMentionOptions {
  /**
   * Whether to enable mention parsing
   * @default true
   */
  enabled?: boolean

  /**
   * Base URL for profile links
   * @default '/'
   */
  baseUrl?: string
}

/**
 * Split text node into parts, replacing @mentions with link nodes
 */
function splitTextWithMentions(
  text: string,
  baseUrl: string
): PhrasingContent[] {
  const result: PhrasingContent[] = []
  let lastIndex = 0

  // Reset regex state
  MENTION_REGEX.lastIndex = 0

  let match
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const fullMatch = match[0]
    const handle = match[1]
    const matchStart = match.index

    // Add text before the mention
    if (matchStart > lastIndex) {
      result.push({
        type: 'text',
        value: text.slice(lastIndex, matchStart),
      } as Text)
    }

    // Add the mention as a link
    const link: Link = {
      type: 'link',
      url: `${baseUrl}${handle}`,
      children: [
        {
          type: 'text',
          value: fullMatch,
        } as Text,
      ],
    }
    result.push(link)

    lastIndex = matchStart + fullMatch.length
  }

  // Add remaining text after last mention
  if (lastIndex < text.length) {
    result.push({
      type: 'text',
      value: text.slice(lastIndex),
    } as Text)
  }

  return result
}

/**
 * Remark plugin that transforms @mentions into profile links
 */
export const remarkMention: Plugin<[RemarkMentionOptions?], Root> = (
  options = {}
) => {
  const { enabled = true, baseUrl = '/' } = options

  return (tree: Root) => {
    if (!enabled) return

    // Visit all text nodes, but skip those inside code blocks and links
    visit(
      tree,
      'text',
      (node: Text, index, parent) => {
        // Skip if no parent or index
        if (parent === null || parent === undefined) return
        if (index === null || index === undefined) return

        // Skip if inside a link (don't nest links)
        if (parent.type === 'link') return

        const text = node.value

        // Quick check: if no @ symbol, skip
        if (!text.includes('@')) return

        // Check if there are any mentions
        MENTION_REGEX.lastIndex = 0
        if (!MENTION_REGEX.test(text)) return

        // Split text and create new nodes
        const newNodes = splitTextWithMentions(text, baseUrl)

        // If we got the same single text node back, no changes needed
        if (
          newNodes.length === 1 &&
          newNodes[0].type === 'text' &&
          (newNodes[0] as Text).value === text
        ) {
          return
        }

        // Replace the text node with the new nodes
        if ('children' in parent && Array.isArray(parent.children)) {
          const currentIndex = index
          parent.children.splice(currentIndex, 1, ...newNodes)
          // Return the index to skip processing the newly inserted nodes
          return currentIndex + newNodes.length
        }
      }
    )
  }
}

export default remarkMention
