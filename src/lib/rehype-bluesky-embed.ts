/**
 * Rehype plugin for transforming Bluesky embed blockquotes
 *
 * WhiteWind and other AT Protocol blogs use the official Bluesky embed format:
 * ```html
 * <blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:xxx/app.bsky.feed.post/rkey">
 *   ...post content...
 *   <a href="https://bsky.app/profile/...">[image or embed]</a>
 * </blockquote>
 * <script async src="https://embed.bsky.app/static/embed.js"></script>
 * ```
 *
 * This plugin transforms those blockquotes into our BlueskyEmbed component placeholders
 * (since the embed.js script gets stripped by sanitization).
 */

import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'
import type { Plugin } from 'unified'

/**
 * Regex to parse AT URIs
 * Format: at://did:plc:xxx/app.bsky.feed.post/rkey
 */
const AT_URI_REGEX = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9]+)$/

export interface RehypeBlueskyEmbedOptions {
  /**
   * Whether to enable Bluesky embed transformation
   * @default true
   */
  enabled?: boolean
}

/**
 * Check if a hast element is a Bluesky embed blockquote
 */
function isBlueskyEmbedBlockquote(node: Element): boolean {
  if (node.tagName !== 'blockquote') return false

  const className = node.properties?.className
  if (!className) return false

  // className can be a string or array
  const classes = Array.isArray(className) ? className : [className]
  return classes.some((c) => String(c) === 'bluesky-embed')
}

/**
 * Parse an AT URI and extract handle (DID) and rkey
 */
function parseAtUri(uri: string): { handle: string; rkey: string } | null {
  const match = uri.match(AT_URI_REGEX)
  if (!match) return null

  const [, handle, rkey] = match
  return { handle, rkey }
}

/**
 * Rehype plugin that transforms Bluesky embed blockquotes into BlueskyEmbed placeholders
 */
export const rehypeBlueskyEmbed: Plugin<[RehypeBlueskyEmbedOptions?], Root> = (
  options = {}
) => {
  const { enabled = true } = options

  return (tree: Root) => {
    if (!enabled) return

    visit(tree, 'element', (node: Element, index, parent) => {
      // Check if this is a Bluesky embed blockquote
      if (!isBlueskyEmbedBlockquote(node)) return

      // Get the AT URI from data-bluesky-uri attribute
      const atUri = node.properties?.dataBlueskyUri
      if (!atUri || typeof atUri !== 'string') return

      // Parse the AT URI
      const parsed = parseAtUri(atUri)
      if (!parsed) return

      // Create the custom element placeholder
      // This survives sanitization (added to allowlist in markdown.ts)
      // and gets rendered as BlueskyEmbed component in MarkdownRenderer
      const placeholder: Element = {
        type: 'element',
        tagName: 'bsky-embed',
        properties: {
          handle: parsed.handle,
          rkey: parsed.rkey,
        },
        children: [],
      }

      // Replace the blockquote with the placeholder
      if (parent && typeof index === 'number' && 'children' in parent) {
        ;(parent.children as Element[])[index] = placeholder
      }
    })
  }
}

export default rehypeBlueskyEmbed
