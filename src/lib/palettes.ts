export const RECENT_PALETTES_KEY = 'recent-custom-palettes'
export const MAX_RECENT_PALETTES = 10

export interface SavedPalette {
  background: string
  text: string
  accent: string
  codeBackground?: string
}

export function getRecentPalettes(): SavedPalette[] {
  try {
    const stored = localStorage.getItem(RECENT_PALETTES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function saveRecentPalette(palette: SavedPalette): void {
  try {
    const existing = getRecentPalettes()

    // Check if this palette already exists (same colors)
    const isDuplicate = existing.some(
      (p) =>
        p.background.toLowerCase() === palette.background.toLowerCase() &&
        p.text.toLowerCase() === palette.text.toLowerCase() &&
        p.accent.toLowerCase() === palette.accent.toLowerCase()
    )

    if (isDuplicate) return

    // Add to front and limit to max
    const updated = [palette, ...existing].slice(0, MAX_RECENT_PALETTES)
    localStorage.setItem(RECENT_PALETTES_KEY, JSON.stringify(updated))
  } catch {
    // localStorage not available
  }
}
