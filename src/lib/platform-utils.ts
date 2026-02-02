/**
 * Platform detection utilities for external blog sites
 */

export interface PlatformInfo {
  icon: string
  name: string
}

/**
 * Get platform info for known external sites
 */
export function getPlatformInfo(url: string): PlatformInfo | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('leaflet.pub')) return { icon: '/icons/platforms/leaflet.png', name: 'Leaflet' }
    if (hostname.includes('offprint.app')) return { icon: '/icons/platforms/offprint.png', name: 'Offprint' }
    if (hostname.includes('pckt.blog')) return { icon: '/icons/platforms/pckt.png', name: 'pckt' }
    if (hostname.includes('blento.app')) return { icon: '/icons/platforms/blento.png', name: 'Blento' }
    return null
  } catch {
    return null
  }
}

/**
 * Extract domain from URL for display (removes www. prefix)
 */
export function getExternalDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
