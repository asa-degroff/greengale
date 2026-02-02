import { useEffect, useRef } from 'react'

/**
 * RSS feed link configuration
 */
export interface RSSFeedConfig {
  /** Title for the RSS feed (shown in browser RSS menu) */
  title: string
  /** URL to the RSS feed */
  href: string
}

/**
 * Configuration for document metadata (title, canonical URL, meta tags)
 */
export interface DocumentMetaConfig {
  /** Page title (will have " - GreenGale" appended if not already present) */
  title?: string
  /** Canonical URL for the page */
  canonical?: string
  /** Meta description */
  description?: string
  /** OpenGraph image URL */
  ogImage?: string
  /** OpenGraph type (defaults to 'website') */
  ogType?: 'website' | 'article'
  /** Whether to add noindex meta tag */
  noindex?: boolean
  /** RSS feed link for feed discovery */
  rssFeed?: RSSFeedConfig
}

const SITE_NAME = 'GreenGale'
const BASE_URL = 'https://greengale.app'
const APPVIEW_URL = 'https://greengale.asadegroff.workers.dev'

/**
 * Helper to create or update a meta tag
 */
function setMetaTag(name: string, content: string, property = false): HTMLMetaElement {
  const attr = property ? 'property' : 'name'
  let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null

  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute(attr, name)
    document.head.appendChild(meta)
  }

  meta.content = content
  return meta
}

/**
 * Helper to remove a meta tag
 */
function removeMetaTag(name: string, property = false): void {
  const attr = property ? 'property' : 'name'
  const meta = document.querySelector(`meta[${attr}="${name}"]`)
  meta?.remove()
}

/**
 * Helper to create or update a link tag
 */
function setLinkTag(rel: string, href: string): HTMLLinkElement {
  let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null

  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    document.head.appendChild(link)
  }

  link.href = href
  return link
}

/**
 * Helper to remove a link tag
 */
function removeLinkTag(rel: string): void {
  const link = document.querySelector(`link[rel="${rel}"]`)
  link?.remove()
}

/**
 * Helper to set an RSS feed link tag (for feed discovery)
 */
function setRSSFeedLink(href: string, title: string): HTMLLinkElement {
  // Use a specific selector to find existing RSS link
  let link = document.querySelector('link[rel="alternate"][type="application/rss+xml"]') as HTMLLinkElement | null

  if (!link) {
    link = document.createElement('link')
    link.rel = 'alternate'
    link.type = 'application/rss+xml'
    document.head.appendChild(link)
  }

  link.href = href
  link.title = title
  return link
}

/**
 * Helper to remove the RSS feed link tag
 */
function removeRSSFeedLink(): void {
  const link = document.querySelector('link[rel="alternate"][type="application/rss+xml"]')
  link?.remove()
}

/**
 * Hook to manage document metadata (title, canonical, meta tags)
 * Automatically cleans up on unmount
 *
 * @example
 * // Post page
 * useDocumentMeta({
 *   title: post.title,
 *   canonical: `https://greengale.app/${handle}/${rkey}`,
 *   description: post.subtitle,
 *   ogImage: `https://greengale.asadegroff.workers.dev/og/${handle}/${rkey}.png`,
 *   ogType: 'article',
 * })
 *
 * @example
 * // Author page
 * useDocumentMeta({
 *   title: `${author.displayName || author.handle}'s Blog`,
 *   canonical: `https://greengale.app/${handle}`,
 *   description: publication?.description || author.description,
 * })
 */
export function useDocumentMeta(config: DocumentMetaConfig): void {
  const prevTitleRef = useRef<string | null>(null)

  useEffect(() => {
    // Store original title on first mount
    if (prevTitleRef.current === null) {
      prevTitleRef.current = document.title
    }

    // Set title
    if (config.title) {
      const fullTitle = config.title.includes(SITE_NAME)
        ? config.title
        : `${config.title} - ${SITE_NAME}`
      document.title = fullTitle
      setMetaTag('og:title', config.title, true)
    }

    // Set canonical URL
    if (config.canonical) {
      setLinkTag('canonical', config.canonical)
      setMetaTag('og:url', config.canonical, true)
    }

    // Set description
    if (config.description) {
      setMetaTag('description', config.description)
      setMetaTag('og:description', config.description, true)
    }

    // Set OG image
    if (config.ogImage) {
      setMetaTag('og:image', config.ogImage, true)
    }

    // Set OG type
    setMetaTag('og:type', config.ogType || 'website', true)

    // Set OG site name
    setMetaTag('og:site_name', SITE_NAME, true)

    // Set noindex if requested
    if (config.noindex) {
      setMetaTag('robots', 'noindex, nofollow')
    }

    // Set RSS feed link for feed discovery
    if (config.rssFeed) {
      setRSSFeedLink(config.rssFeed.href, config.rssFeed.title)
    }

    // Cleanup on unmount
    return () => {
      // Restore original title
      document.title = prevTitleRef.current || SITE_NAME

      // Remove canonical link (pages should set their own)
      removeLinkTag('canonical')

      // Remove meta tags we added
      removeMetaTag('description')
      removeMetaTag('og:title', true)
      removeMetaTag('og:description', true)
      removeMetaTag('og:url', true)
      removeMetaTag('og:image', true)
      removeMetaTag('og:type', true)
      removeMetaTag('og:site_name', true)

      if (config.noindex) {
        removeMetaTag('robots')
      }

      // Remove RSS feed link
      if (config.rssFeed) {
        removeRSSFeedLink()
      }
    }
  }, [
    config.title,
    config.canonical,
    config.description,
    config.ogImage,
    config.ogType,
    config.noindex,
    config.rssFeed?.href,
    config.rssFeed?.title,
  ])
}

/**
 * Build a canonical URL for a post
 */
export function buildPostCanonical(handle: string, rkey: string): string {
  return `${BASE_URL}/${handle}/${rkey}`
}

/**
 * Build a canonical URL for an author page
 */
export function buildAuthorCanonical(handle: string): string {
  return `${BASE_URL}/${handle}`
}

/**
 * Build the canonical URL for the homepage
 */
export function buildHomeCanonical(): string {
  return BASE_URL
}

/**
 * Build an OG image URL for a post
 */
export function buildPostOgImage(handle: string, rkey: string): string {
  return `${APPVIEW_URL}/og/${handle}/${rkey}.png`
}

/**
 * Build an OG image URL for an author profile
 */
export function buildAuthorOgImage(handle: string): string {
  return `${APPVIEW_URL}/og/profile/${handle}.png`
}

/**
 * Build the OG image URL for the homepage
 */
export function buildHomeOgImage(): string {
  return `${APPVIEW_URL}/og/site.png`
}

/**
 * Build the RSS feed URL for an author
 */
export function buildAuthorRSSFeed(handle: string): string {
  return `${BASE_URL}/${handle}/rss`
}

/**
 * Build the RSS feed URL for the site-wide recent posts
 */
export function buildRecentRSSFeed(): string {
  return `${BASE_URL}/rss`
}
