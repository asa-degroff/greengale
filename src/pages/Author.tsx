import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { BlogCard } from '@/components/BlogCard'
import { useAuth } from '@/lib/auth'
import {
  getAuthorProfile,
  listBlogEntries,
  getPublication,
  savePublication,
  fixSiteStandardUrls,
  type BlogEntry,
  type AuthorProfile,
  type Publication,
} from '@/lib/atproto'
import { useRecentAuthors } from '@/lib/useRecentAuthors'
import { useThemePreference } from '@/lib/useThemePreference'
import {
  THEME_PRESETS,
  THEME_LABELS,
  type ThemePreset,
  type CustomColors,
  getPresetColors,
  getEffectiveTheme,
  deriveThemeColors,
  validateCustomColors,
  correctCustomColorsContrast,
} from '@/lib/themes'
import {
  useDocumentMeta,
  buildAuthorCanonical,
  buildAuthorOgImage,
} from '@/lib/useDocumentMeta'

// Recent palettes storage (shared with Editor)
const RECENT_PALETTES_KEY = 'recent-custom-palettes'
const MAX_RECENT_PALETTES = 10

interface SavedPalette {
  background: string
  text: string
  accent: string
  codeBackground?: string
}

function getRecentPalettes(): SavedPalette[] {
  try {
    const stored = localStorage.getItem(RECENT_PALETTES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentPalette(palette: SavedPalette): void {
  try {
    const existing = getRecentPalettes()
    const isDuplicate = existing.some(
      (p) =>
        p.background.toLowerCase() === palette.background.toLowerCase() &&
        p.text.toLowerCase() === palette.text.toLowerCase() &&
        p.accent.toLowerCase() === palette.accent.toLowerCase()
    )
    if (isDuplicate) return
    const updated = [palette, ...existing].slice(0, MAX_RECENT_PALETTES)
    localStorage.setItem(RECENT_PALETTES_KEY, JSON.stringify(updated))
  } catch {
    // Ignore storage errors
  }
}

export function AuthorPage() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [author, setAuthor] = useState<AuthorProfile | null>(null)
  const [entries, setEntries] = useState<BlogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { addRecentAuthor } = useRecentAuthors()

  // Publication state
  const [publication, setPublication] = useState<Publication | null>(null)
  const [showPublicationModal, setShowPublicationModal] = useState(false)
  const [pubName, setPubName] = useState('')
  const [pubDescription, setPubDescription] = useState('')
  const [pubTheme, setPubTheme] = useState<ThemePreset>('default')
  const [pubCustomColors, setPubCustomColors] = useState<CustomColors>({
    background: '#ffffff',
    text: '#24292f',
    accent: '#0969da',
    codeBackground: '',
  })
  const [pubSaving, setPubSaving] = useState(false)
  const [pubError, setPubError] = useState<string | null>(null)
  const [pubEnableSiteStandard, setPubEnableSiteStandard] = useState(false)
  const [pubShowInDiscover, setPubShowInDiscover] = useState(true)
  const [recentPalettes, setRecentPalettes] = useState<SavedPalette[]>([])
  // Orphaned records cleanup state
  const [orphanedRecords, setOrphanedRecords] = useState<Array<{ rkey: string; title: string }>>([])
  const [scanningOrphans, setScanningOrphans] = useState(false)
  const [deletingOrphans, setDeletingOrphans] = useState(false)
  const [orphanScanComplete, setOrphanScanComplete] = useState(false)
  // URL fix state
  const [fixingUrls, setFixingUrls] = useState(false)
  const [urlFixResult, setUrlFixResult] = useState<{ publicationFixed: boolean; documentsFixed: number } | null>(null)
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()

  // Check if custom colors have valid contrast
  const pubCustomColorsValidation = pubTheme === 'custom' ? validateCustomColors(pubCustomColors) : null
  const hasPubContrastError = pubTheme === 'custom' && pubCustomColorsValidation !== null && !pubCustomColorsValidation.isValid

  // Load recent palettes on mount
  useEffect(() => {
    setRecentPalettes(getRecentPalettes())
  }, [])

  // Check if current user is the author
  const isOwnProfile = session?.did && author?.did && session.did === author.did

  // Use the canonical handle from author data, or fall back to URL param
  const canonicalHandle = author?.handle || handle || ''

  // Set document metadata (title, canonical URL, OG tags)
  useDocumentMeta({
    title: publication?.name || author?.displayName || canonicalHandle
      ? `${publication?.name || author?.displayName || canonicalHandle}'s Blog`
      : undefined,
    canonical: canonicalHandle ? buildAuthorCanonical(canonicalHandle) : undefined,
    description: publication?.description || author?.description,
    ogImage: canonicalHandle ? buildAuthorOgImage(canonicalHandle) : undefined,
  })

  useEffect(() => {
    if (!handle) return

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [profileResult, entriesResult, publicationResult] = await Promise.all([
          getAuthorProfile(handle!),
          listBlogEntries(handle!, { viewerDid: session?.did }),
          getPublication(handle!).catch(() => null),
        ])

        // Check if handle has changed - redirect to canonical URL
        if (profileResult.handle.toLowerCase() !== handle!.toLowerCase()) {
          navigate(`/${profileResult.handle}`, { replace: true })
          return
        }

        setAuthor(profileResult)
        setEntries(entriesResult.entries)
        setPublication(publicationResult)

        // Apply publication theme if it exists
        if (publicationResult?.theme) {
          if (publicationResult.theme.custom) {
            setActivePostTheme('custom')
            setActiveCustomColors(correctCustomColorsContrast(publicationResult.theme.custom))
          } else {
            const themePreset = getEffectiveTheme(publicationResult.theme)
            setActivePostTheme(themePreset)
            setActiveCustomColors(null)
          }
        }

        // Track this author as recently viewed
        addRecentAuthor({
          handle: profileResult.handle,
          displayName: profileResult.displayName,
          avatarUrl: profileResult.avatar,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load author')
      } finally {
        setLoading(false)
      }
    }

    load()

    // Reset theme when leaving the page
    return () => {
      setActivePostTheme(null)
      setActiveCustomColors(null)
    }
  }, [handle, session?.did, addRecentAuthor, navigate, setActivePostTheme, setActiveCustomColors])

  // Open publication editor with current values
  const openPublicationEditor = useCallback(() => {
    if (publication) {
      setPubName(publication.name)
      setPubDescription(publication.description || '')
      if (publication.theme?.preset) {
        setPubTheme(publication.theme.preset)
      } else {
        setPubTheme('default')
      }
      if (publication.theme?.custom) {
        setPubCustomColors({
          background: publication.theme.custom.background || '#ffffff',
          text: publication.theme.custom.text || '#24292f',
          accent: publication.theme.custom.accent || '#0969da',
          codeBackground: publication.theme.custom.codeBackground || '',
        })
      }
      // Default to true unless explicitly disabled
      setPubEnableSiteStandard(publication.enableSiteStandard !== false)
      setPubShowInDiscover(publication.showInDiscover !== false)
    } else {
      // Default values for new publication
      setPubName(author?.displayName || '')
      setPubDescription('')
      setPubTheme('default')
      setPubCustomColors({
        background: '#ffffff',
        text: '#24292f',
        accent: '#0969da',
        codeBackground: '',
      })
      setPubEnableSiteStandard(true) // Enabled by default
      setPubShowInDiscover(true) // Discoverable by default
    }
    setPubError(null)
    setShowPublicationModal(true)
  }, [publication, author])

  // Save publication
  const handleSavePublication = async () => {
    if (!session || !pubName.trim()) return

    setPubSaving(true)
    setPubError(null)

    try {
      const newPublication: Publication = {
        name: pubName.trim(),
        url: `https://greengale.app/${handle}`,
        description: pubDescription.trim() || undefined,
        theme: pubTheme === 'default' && !pubCustomColors.background
          ? undefined
          : {
              preset: pubTheme,
              custom: pubTheme === 'custom' ? pubCustomColors : undefined,
            },
        enableSiteStandard: pubEnableSiteStandard || undefined,
        showInDiscover: pubShowInDiscover,
      }

      await savePublication(
        {
          did: session.did,
          fetchHandler: (url: string, options: RequestInit) => session.fetchHandler(url, options),
        },
        newPublication
      )

      // Save custom palette to recent palettes if using custom theme
      if (pubTheme === 'custom' && pubCustomColors.background && pubCustomColors.text && pubCustomColors.accent) {
        saveRecentPalette({
          background: pubCustomColors.background,
          text: pubCustomColors.text,
          accent: pubCustomColors.accent,
          codeBackground: pubCustomColors.codeBackground,
        })
        setRecentPalettes(getRecentPalettes())
      }

      setPublication(newPublication)
      setShowPublicationModal(false)

      // Apply the new theme immediately
      if (newPublication.theme) {
        if (newPublication.theme.custom) {
          setActivePostTheme('custom')
          setActiveCustomColors(correctCustomColorsContrast(newPublication.theme.custom))
        } else {
          const themePreset = getEffectiveTheme(newPublication.theme)
          setActivePostTheme(themePreset)
          setActiveCustomColors(null)
        }
      } else {
        // Reset to default if no theme
        setActivePostTheme(null)
        setActiveCustomColors(null)
      }
    } catch (err) {
      setPubError(err instanceof Error ? err.message : 'Failed to save publication')
    } finally {
      setPubSaving(false)
    }
  }

  // Scan for orphaned site.standard.document records
  const handleScanOrphans = async () => {
    if (!session) return

    setScanningOrphans(true)
    setOrphanedRecords([])
    setOrphanScanComplete(false)

    try {
      // Fetch all site.standard.document records
      const listResponse = await fetch(
        `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${session.did}&collection=site.standard.document&limit=100`
      )
      if (!listResponse.ok) {
        throw new Error('Failed to fetch site.standard.document records')
      }
      const listData = await listResponse.json()
      const siteStandardRecords = listData.records || []

      // Check each one for a corresponding app.greengale.document
      const orphans: Array<{ rkey: string; title: string }> = []

      for (const record of siteStandardRecords) {
        const rkey = record.uri.split('/').pop()
        const title = record.value?.title || 'Untitled'

        // Check if greengale document exists
        const checkResponse = await fetch(
          `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${session.did}&collection=app.greengale.document&rkey=${rkey}`
        )

        if (!checkResponse.ok) {
          // Record not found - this is an orphan
          orphans.push({ rkey, title })
        }
      }

      setOrphanedRecords(orphans)
      setOrphanScanComplete(true)
    } catch (err) {
      console.error('Error scanning for orphans:', err)
      setPubError(err instanceof Error ? err.message : 'Failed to scan for orphaned records')
    } finally {
      setScanningOrphans(false)
    }
  }

  // Delete orphaned site.standard.document records
  const handleDeleteOrphans = async () => {
    if (!session || orphanedRecords.length === 0) return

    setDeletingOrphans(true)

    try {
      for (const orphan of orphanedRecords) {
        await session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: 'site.standard.document',
            rkey: orphan.rkey,
          }),
        })
      }

      setOrphanedRecords([])
      setOrphanScanComplete(false)
    } catch (err) {
      console.error('Error deleting orphans:', err)
      setPubError(err instanceof Error ? err.message : 'Failed to delete orphaned records')
    } finally {
      setDeletingOrphans(false)
    }
  }

  // Fix site.standard URL issues (publication URL and document paths)
  const handleFixUrls = async () => {
    if (!session || !handle) return

    setFixingUrls(true)
    setUrlFixResult(null)
    setPubError(null)

    try {
      const result = await fixSiteStandardUrls(
        {
          did: session.did,
          fetchHandler: (url: string, options: RequestInit) => session.fetchHandler(url, options),
        },
        handle
      )

      setUrlFixResult(result)

      if (result.error) {
        setPubError(result.error)
      }

      // Clear the localStorage key to allow automatic re-check on next login
      localStorage.removeItem(`site-standard-url-fix-v1-${session.did}`)
    } catch (err) {
      console.error('Error fixing URLs:', err)
      setPubError(err instanceof Error ? err.message : 'Failed to fix URLs')
    } finally {
      setFixingUrls(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="animate-pulse">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 rounded-full bg-[var(--site-border)]"></div>
              <div>
                <div className="h-6 bg-[var(--site-border)] rounded w-48 mb-2"></div>
                <div className="h-4 bg-[var(--site-border)] rounded w-32"></div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 bg-[var(--site-border)] rounded-lg"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4 text-[var(--site-text)]">
              Error Loading Author
            </h1>
            <p className="text-[var(--site-text-secondary)] mb-6">{error}</p>
            <Link
              to="/"
              className="text-[var(--site-accent)] hover:underline"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Author Header */}
        {author && (
          <div className="mb-12">
            <div className="flex items-start gap-4 mb-4">
              {author.avatar ? (
                <img
                  src={author.avatar}
                  alt={author.displayName || author.handle}
                  className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[var(--site-accent)] flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                  {(author.displayName || author.handle).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-[var(--site-text)]">
                      {publication?.name || author.displayName || author.handle}
                    </h1>
                    <p className="text-[var(--site-text-secondary)]">
                      @{author.handle}
                    </p>
                  </div>
                  {isOwnProfile && (
                    <button
                      onClick={openPublicationEditor}
                      className="flex-shrink-0 px-3 py-1.5 text-sm border border-[var(--site-border)] rounded-md hover:bg-[var(--site-bg-secondary)] text-[var(--site-text)] transition-colors"
                    >
                      {publication ? 'Edit Publication' : 'Set Up Publication'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {publication?.description && (
              <p className="text-[var(--site-text)] max-w-2xl mb-3">
                {publication.description}
              </p>
            )}
            {author.description && (
              <p className="text-[var(--site-text-secondary)] max-w-2xl">
                {author.description}
              </p>
            )}
            <div className="mt-4">
              <a
                href={`https://bsky.app/profile/${author.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--site-accent)] hover:underline"
              >
                View on Bluesky →
              </a>
            </div>
          </div>
        )}

        {/* Blog Entries */}
        {entries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--site-text-secondary)]">
              No blog posts found for this author.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold mb-6 text-[var(--site-text)]">
              Blog Posts ({entries.length})
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {entries.map((entry) => (
                <BlogCard key={entry.uri} entry={entry} author={author || undefined} externalUrl={entry.externalUrl} tags={entry.tags} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Publication Editor Modal */}
      {showPublicationModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pt-14 lg:pt-0">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !pubSaving && setShowPublicationModal(false)}
          />
          {/* Dialog */}
          <div className="relative bg-[var(--site-bg)] border border-[var(--site-border)] rounded-lg shadow-xl max-w-lg w-full mx-4 p-6 max-h-[calc(90vh-3.5rem)] lg:max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--site-text)]">
                {publication ? 'Edit Publication' : 'Set Up Publication'}
              </h2>
              <button
                onClick={() => !pubSaving && setShowPublicationModal(false)}
                className="text-[var(--site-text-secondary)] hover:text-[var(--site-text)]"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Name field */}
              <div>
                <label className="block text-sm font-medium text-[var(--site-text)] mb-1">
                  Publication Name *
                </label>
                <input
                  type="text"
                  value={pubName}
                  onChange={(e) => setPubName(e.target.value)}
                  placeholder="My Blog"
                  maxLength={200}
                  className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
                />
              </div>

              {/* Description field */}
              <div>
                <label className="block text-sm font-medium text-[var(--site-text)] mb-1">
                  Description
                </label>
                <textarea
                  value={pubDescription}
                  onChange={(e) => setPubDescription(e.target.value)}
                  placeholder="A brief description of your publication..."
                  maxLength={1000}
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] resize-none"
                />
              </div>

              {/* Theme selector */}
              <div>
                <label className="block text-sm font-medium text-[var(--site-text)] mb-1">
                  Default Theme
                </label>
                <select
                  value={pubTheme}
                  onChange={(e) => {
                    const newTheme = e.target.value as ThemePreset
                    setPubTheme(newTheme)
                    // Update color pickers to reflect the selected preset's colors
                    if (newTheme !== 'custom') {
                      const presetColors = getPresetColors(newTheme)
                      setPubCustomColors({
                        background: presetColors.background,
                        text: presetColors.text,
                        accent: presetColors.accent,
                        codeBackground: presetColors.codeBackground,
                      })
                    }
                  }}
                  className="w-full px-3 py-2 border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
                >
                  {THEME_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {THEME_LABELS[preset]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--site-text-secondary)] mt-1">
                  Your profile and posts without their own theme will use this theme
                </p>
              </div>

              {/* Color customization */}
              <div className="space-y-3 p-4 border border-[var(--site-border)] rounded-md">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-[var(--site-text)]">
                    Customize Colors
                    {pubTheme !== 'custom' && (
                      <span className="ml-2 text-xs font-normal text-[var(--site-text-secondary)]">
                        (editing will switch to custom)
                      </span>
                    )}
                  </h3>
                </div>

                  {/* Recent Palettes */}
                  {recentPalettes.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-[var(--site-text-secondary)] mb-2">Recent palettes:</p>
                      <div className="flex flex-wrap gap-2">
                        {recentPalettes.map((palette, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => {
                              setPubTheme('custom')
                              setPubCustomColors({
                                background: palette.background,
                                text: palette.text,
                                accent: palette.accent,
                                codeBackground: palette.codeBackground || '',
                              })
                            }}
                            className="flex rounded overflow-hidden border border-[var(--site-border)] hover:border-[var(--site-accent)] transition-colors"
                            title={`Background: ${palette.background}, Text: ${palette.text}, Accent: ${palette.accent}`}
                          >
                            <div
                              className="w-6 h-6"
                              style={{ backgroundColor: palette.background }}
                            />
                            <div
                              className="w-6 h-6"
                              style={{ backgroundColor: palette.text }}
                            />
                            <div
                              className="w-6 h-6"
                              style={{ backgroundColor: palette.accent }}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Background</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={pubCustomColors.background || '#ffffff'}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, background: e.target.value }) }}
                          className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                        />
                        <input
                          type="text"
                          value={pubCustomColors.background || ''}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, background: e.target.value }) }}
                          className="w-24 px-2 py-1 text-sm border border-[var(--site-border)] rounded bg-[var(--site-bg)] text-[var(--site-text)]"
                          placeholder="#ffffff"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Text</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={pubCustomColors.text || '#24292f'}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, text: e.target.value }) }}
                          className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                        />
                        <input
                          type="text"
                          value={pubCustomColors.text || ''}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, text: e.target.value }) }}
                          className="w-24 px-2 py-1 text-sm border border-[var(--site-border)] rounded bg-[var(--site-bg)] text-[var(--site-text)]"
                          placeholder="#24292f"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--site-text-secondary)] mb-1">Accent</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={pubCustomColors.accent || '#0969da'}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, accent: e.target.value }) }}
                          className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                        />
                        <input
                          type="text"
                          value={pubCustomColors.accent || ''}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, accent: e.target.value }) }}
                          className="w-24 px-2 py-1 text-sm border border-[var(--site-border)] rounded bg-[var(--site-bg)] text-[var(--site-text)]"
                          placeholder="#0969da"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--site-text-secondary)] mb-1">
                        Code Block <span className="opacity-60">(optional)</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={pubCustomColors.codeBackground || (deriveThemeColors(pubCustomColors)?.codeBackground || '#f6f8fa')}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, codeBackground: e.target.value }) }}
                          className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                          style={{ backgroundColor: pubCustomColors.codeBackground || (deriveThemeColors(pubCustomColors)?.codeBackground || '#f6f8fa') }}
                        />
                        <input
                          type="text"
                          value={pubCustomColors.codeBackground || ''}
                          onChange={(e) => { setPubTheme('custom'); setPubCustomColors({ ...pubCustomColors, codeBackground: e.target.value }) }}
                          className="w-24 px-2 py-1 text-sm border border-[var(--site-border)] rounded bg-[var(--site-bg)] text-[var(--site-text)]"
                          placeholder="Auto"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Preview and Contrast Validation */}
                  {pubCustomColors.background && pubCustomColors.text && pubCustomColors.accent && (() => {
                    const validation = validateCustomColors(pubCustomColors)
                    return (
                      <div className="mt-4 pt-4 border-t border-[var(--site-border)]">
                        {/* Contrast warnings */}
                        {!validation.isValid && (
                          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <p className="text-yellow-600 dark:text-yellow-400 text-sm font-medium mb-2">
                              Low contrast warning
                            </p>
                            <ul className="text-xs text-yellow-600/80 dark:text-yellow-400/80 space-y-1">
                              {validation.textContrast && !validation.textContrast.passes && (
                                <li>
                                  Text contrast: {validation.textContrast.ratio.toFixed(1)}:1 (minimum 4.5:1 required)
                                </li>
                              )}
                              {validation.accentContrast && validation.accentContrast.ratio < 3 && (
                                <li>
                                  Accent contrast: {validation.accentContrast.ratio.toFixed(1)}:1 (minimum 3:1 required)
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-[var(--site-text-secondary)]">Preview:</p>
                          {validation.isValid && (
                            <span className="text-xs text-green-600 dark:text-green-400">
                              ✓ Contrast OK ({validation.textContrast?.ratio.toFixed(1)}:1)
                            </span>
                          )}
                        </div>
                        <div
                          className="p-4 rounded-lg"
                          style={{ backgroundColor: pubCustomColors.background }}
                        >
                          <p style={{ color: pubCustomColors.text }} className="text-sm mb-2">
                            This is how your text will look. <a href="#" onClick={(e) => e.preventDefault()} style={{ color: pubCustomColors.accent }} className="underline">Links appear like this.</a>
                          </p>
                          <div
                            className="px-3 py-2 rounded text-sm font-mono"
                            style={{
                              backgroundColor: pubCustomColors.codeBackground || deriveThemeColors(pubCustomColors)?.codeBackground || pubCustomColors.background,
                              color: pubCustomColors.text,
                            }}
                          >
                            const code = "block"
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>

              {/* Discovery Settings */}
              <div className="p-4 border border-[var(--site-border)] rounded-md bg-[var(--site-bg-secondary)]">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pubShowInDiscover}
                    onChange={(e) => setPubShowInDiscover(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-[var(--site-border)] text-[var(--site-accent)] focus:ring-[var(--site-accent)]"
                  />
                  <div>
                    <span className="text-sm font-medium text-[var(--site-text)]">
                      Show in Discover
                    </span>
                    <p className="text-xs text-[var(--site-text-secondary)] mt-0.5">
                      Allow your posts to appear on the homepage and discovery feeds.
                    </p>
                  </div>
                </label>
              </div>

              {/* site.standard Publishing */}
              <div className="p-4 border border-[var(--site-border)] rounded-md bg-[var(--site-bg-secondary)]">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pubEnableSiteStandard}
                    onChange={(e) => setPubEnableSiteStandard(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-[var(--site-border)] text-[var(--site-accent)] focus:ring-[var(--site-accent)]"
                  />
                  <div>
                    <span className="text-sm font-medium text-[var(--site-text)]">
                      Publish to standard.site
                    </span>
                    <p className="text-xs text-[var(--site-text-secondary)] mt-0.5">
                      Publish site.standard.publication record for cross-platform compatibility. Can also be toggled per-document in the post editor.
                    </p>
                  </div>
                </label>

                {/* Orphaned records cleanup */}
                <div className="mt-3 pt-3 border-t border-[var(--site-border)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-[var(--site-text-secondary)]">
                        Cleanup orphaned records
                      </span>
                    </div>
                    <button
                      onClick={handleScanOrphans}
                      disabled={scanningOrphans || deletingOrphans}
                      className="px-3 py-1 text-xs border border-[var(--site-border)] rounded hover:bg-[var(--site-bg)] text-[var(--site-text-secondary)] disabled:opacity-50"
                    >
                      {scanningOrphans ? 'Scanning...' : 'Scan'}
                    </button>
                  </div>

                  {orphanScanComplete && (
                    <div className="mt-2">
                      {orphanedRecords.length === 0 ? (
                        <p className="text-xs text-green-500">No orphaned records found.</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-500">
                            Found {orphanedRecords.length} orphaned record{orphanedRecords.length !== 1 ? 's' : ''}:
                          </p>
                          <ul className="text-xs text-[var(--site-text-secondary)] space-y-1 max-h-24 overflow-y-auto">
                            {orphanedRecords.map((r) => (
                              <li key={r.rkey} className="truncate">• {r.title}</li>
                            ))}
                          </ul>
                          <button
                            onClick={handleDeleteOrphans}
                            disabled={deletingOrphans}
                            className="px-3 py-1 text-xs bg-red-500/10 border border-red-500/30 text-red-500 rounded hover:bg-red-500/20 disabled:opacity-50"
                          >
                            {deletingOrphans ? 'Deleting...' : `Delete ${orphanedRecords.length} orphaned record${orphanedRecords.length !== 1 ? 's' : ''}`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* URL Fix */}
                <div className="pt-3 border-t border-[var(--site-border)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-[var(--site-text-secondary)]">
                        Fix standard.site URLs
                      </span>
                      <p className="text-xs text-[var(--site-text-secondary)] opacity-70 mt-0.5">
                        Fix publication URL and document paths
                      </p>
                    </div>
                    <button
                      onClick={handleFixUrls}
                      disabled={fixingUrls}
                      className="px-3 py-1 text-xs border border-[var(--site-border)] rounded hover:bg-[var(--site-bg)] text-[var(--site-text-secondary)] disabled:opacity-50"
                    >
                      {fixingUrls ? 'Fixing...' : 'Fix URLs'}
                    </button>
                  </div>

                  {urlFixResult && (
                    <div className="mt-2">
                      {urlFixResult.publicationFixed || urlFixResult.documentsFixed > 0 ? (
                        <p className="text-xs text-green-500">
                          Fixed: {urlFixResult.publicationFixed ? 'publication URL' : ''}{urlFixResult.publicationFixed && urlFixResult.documentsFixed > 0 ? ', ' : ''}{urlFixResult.documentsFixed > 0 ? `${urlFixResult.documentsFixed} document path${urlFixResult.documentsFixed !== 1 ? 's' : ''}` : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-green-500">No URL fixes needed.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Error message */}
              {pubError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-500">
                  {pubError}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => setShowPublicationModal(false)}
                  disabled={pubSaving}
                  className="px-4 py-2 text-sm border border-[var(--site-border)] rounded-md hover:bg-[var(--site-bg-secondary)] text-[var(--site-text)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePublication}
                  disabled={pubSaving || !pubName.trim() || hasPubContrastError}
                  className="px-4 py-2 text-sm bg-[var(--site-accent)] text-white rounded-md hover:opacity-90 disabled:opacity-50"
                  title={hasPubContrastError ? 'Fix contrast issues before saving' : !pubName.trim() ? 'Publication name is required' : undefined}
                >
                  {pubSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
