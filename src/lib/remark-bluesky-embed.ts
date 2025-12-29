/**
 * Remark plugin for embedding Bluesky posts
 *
 * Transforms standalone Bluesky post links (alone in a paragraph) into
 * embed placeholders that get rendered as interactive post cards.
 *
 * Usage in markdown:
 * ```
 * Check out this post:
 *
 * https://bsky.app/profile/user.bsky.social/post/abc123
 *
 * Pretty cool, right?
 * ```
 *
 * The link above (alone in its paragraph) will become an embedded post card.
 * Links within text remain as normal links.
 */

import { visit } from 'unist-util-visit'
import type { Root, Paragraph, Html, Text, Link } from 'mdast'
import type { Plugin } from 'unified'

/**
 * Regex to match Bluesky post URLs
 * Captures: [1] = handle or DID, [2] = rkey
 */
const BLUESKY_POST_URL_REGEX =
  /^https?:\/\/bsky\.app\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)$/

export interface RemarkBlueskyEmbedOptions {
  /**
   * Whether to enable Bluesky embed transformation
   * @default true
   */
  enabled?: boolean
}

/**
 * Check if a paragraph contains only a single link (possibly with whitespace)
 * Returns the URL if found, or null otherwise
 */
function getStandaloneLinkUrl(paragraph: Paragraph): string | null {
  // Filter out text nodes that are only whitespace
  const meaningfulChildren = paragraph.children.filter((child) => {
    if (child.type === 'text') {
      return (child as Text).value.trim().length > 0
    }
    return true
  })

  // Should have exactly one meaningful child
  if (meaningfulChildren.length !== 1) {
    return null
  }

  const child = meaningfulChildren[0]

  // Case 1: It's a link node (from markdown syntax or GFM autolink)
  if (child.type === 'link') {
    return (child as Link).url
  }

  // Case 2: It's a text node containing just a URL (in case autolink didn't trigger)
  if (child.type === 'text') {
    const trimmed = (child as Text).value.trim()
    // Check if the entire text is a URL
    if (trimmed.match(/^https?:\/\/\S+$/)) {
      return trimmed
    }
  }

  return null
}

/**
 * Parse a Bluesky URL and extract handle and rkey
 */
function parseBlueskyUrl(url: string): { handle: string; rkey: string } | null {
  const match = url.match(BLUESKY_POST_URL_REGEX)
  if (!match) {
    return null
  }

  const [, handle, rkey] = match
  return { handle, rkey }
}

/**
 * Remark plugin that transforms standalone Bluesky post URLs into embed placeholders
 */
export const remarkBlueskyEmbed: Plugin<[RemarkBlueskyEmbedOptions?], Root> = (
  options = {}
) => {
  const { enabled = true } = options

  return (tree: Root) => {
    if (!enabled) {
      return
    }

    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      // Check if this paragraph contains only a single link/URL
      const url = getStandaloneLinkUrl(node)
      if (!url) {
        return
      }

      // Debug: log detected standalone links
      console.log('[remarkBlueskyEmbed] Found standalone URL:', url)

      // Check if the link is a Bluesky post URL
      const parsed = parseBlueskyUrl(url)
      if (!parsed) {
        console.log('[remarkBlueskyEmbed] URL did not match Bluesky pattern')
        return
      }

      console.log('[remarkBlueskyEmbed] Transforming to embed:', parsed)

      // Create an HTML placeholder node for the embed
      // The MarkdownRenderer will replace this with the BlueskyEmbed component
      // Encode handle and rkey in class names since data attributes get stripped by sanitization
      // Format: bluesky-embed bsky-h-{base64url(handle)} bsky-r-{rkey}
      const encodedHandle = btoa(parsed.handle).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      const htmlNode: Html = {
        type: 'html',
        value: `<span class="bluesky-embed bsky-h-${encodedHandle} bsky-r-${parsed.rkey}"></span>`,
      }

      // Replace the paragraph with the HTML node
      if (parent && typeof index === 'number') {
        parent.children[index] = htmlNode
      }
    })
  }
}

export default remarkBlueskyEmbed
