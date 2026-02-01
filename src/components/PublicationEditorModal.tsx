import { useState, useMemo } from 'react'
import { VoiceSettingsPreview } from '@/components/VoiceSettingsPreview'
import type { Publication } from '@/lib/atproto'
import { savePublication } from '@/lib/atproto'
import type { PitchRate, PlaybackRate } from '@/lib/tts'
import { DEFAULT_VOICE } from '@/lib/tts'
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
import { getRecentPalettes, saveRecentPalette, type SavedPalette } from '@/lib/palettes'

interface Session {
  did: string
  fetchHandler: (url: string, options: RequestInit) => Promise<Response>
}

interface PublicationEditorModalProps {
  publication: Publication | null
  handle: string
  session: Session
  onClose: () => void
  onSave: (publication: Publication) => void
  setActivePostTheme: (theme: ThemePreset | null) => void
  setActiveCustomColors: (colors: CustomColors | null) => void
}

const DEFAULT_CUSTOM_COLORS: CustomColors = {
  background: '#ffffff',
  text: '#24292f',
  accent: '#0969da',
  codeBackground: '',
}

export function PublicationEditorModal({
  publication,
  handle,
  session,
  onClose,
  onSave,
  setActivePostTheme,
  setActiveCustomColors,
}: PublicationEditorModalProps) {
  // Form state
  const [pubName, setPubName] = useState(publication?.name || '')
  const [pubDescription, setPubDescription] = useState(publication?.description || '')
  const [pubTheme, setPubTheme] = useState<ThemePreset>(
    publication?.theme?.preset || 'default'
  )
  const [pubCustomColors, setPubCustomColors] = useState<CustomColors>(
    publication?.theme?.custom || DEFAULT_CUSTOM_COLORS
  )
  const [pubEnableSiteStandard, setPubEnableSiteStandard] = useState(
    publication?.enableSiteStandard || false
  )
  const [pubShowInDiscover, setPubShowInDiscover] = useState(
    publication?.showInDiscover !== false
  )
  const [pubVoice, setPubVoice] = useState<string>(
    publication?.voiceTheme?.voice || DEFAULT_VOICE
  )
  const [pubPitch, setPubPitch] = useState<PitchRate>(
    (publication?.voiceTheme?.pitch as PitchRate) || 1.0
  )
  const [pubSpeed, setPubSpeed] = useState<PlaybackRate>(
    (publication?.voiceTheme?.speed as PlaybackRate) || 1.0
  )

  // UI state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentPalettes, setRecentPalettes] = useState<SavedPalette[]>(() => getRecentPalettes())

  // Orphaned records cleanup state
  const [orphanedRecords, setOrphanedRecords] = useState<Array<{ rkey: string; title: string }>>([])
  const [scanningOrphans, setScanningOrphans] = useState(false)
  const [deletingOrphans, setDeletingOrphans] = useState(false)
  const [orphanScanComplete, setOrphanScanComplete] = useState(false)

  // Memoized validation
  const pubCustomColorsValidation = useMemo(
    () => (pubTheme === 'custom' ? validateCustomColors(pubCustomColors) : null),
    [pubTheme, pubCustomColors]
  )
  const hasPubContrastError =
    pubTheme === 'custom' &&
    pubCustomColorsValidation !== null &&
    !pubCustomColorsValidation.isValid

  const handleSave = async () => {
    if (!pubName.trim()) return

    setSaving(true)
    setError(null)

    try {
      // Build voiceTheme only if user has customized settings (not all defaults)
      const hasCustomVoiceSettings =
        pubVoice !== DEFAULT_VOICE || pubPitch !== 1.0 || pubSpeed !== 1.0
      const voiceTheme = hasCustomVoiceSettings
        ? {
            voice: pubVoice !== DEFAULT_VOICE ? pubVoice : undefined,
            pitch: pubPitch !== 1.0 ? pubPitch : undefined,
            speed: pubSpeed !== 1.0 ? pubSpeed : undefined,
          }
        : undefined

      const newPublication: Publication = {
        name: pubName.trim(),
        url: `https://greengale.app/${handle}`,
        description: pubDescription.trim() || undefined,
        theme:
          pubTheme === 'default' && !pubCustomColors.background
            ? undefined
            : {
                preset: pubTheme,
                custom: pubTheme === 'custom' ? pubCustomColors : undefined,
              },
        enableSiteStandard: pubEnableSiteStandard || undefined,
        showInDiscover: pubShowInDiscover,
        voiceTheme,
      }

      await savePublication(
        {
          did: session.did,
          fetchHandler: (url: string, options: RequestInit) => session.fetchHandler(url, options),
        },
        newPublication
      )

      // Save custom palette to recent palettes if using custom theme
      if (
        pubTheme === 'custom' &&
        pubCustomColors.background &&
        pubCustomColors.text &&
        pubCustomColors.accent
      ) {
        saveRecentPalette({
          background: pubCustomColors.background,
          text: pubCustomColors.text,
          accent: pubCustomColors.accent,
          codeBackground: pubCustomColors.codeBackground,
        })
        setRecentPalettes(getRecentPalettes())
      }

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

      onSave(newPublication)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save publication')
    } finally {
      setSaving(false)
    }
  }

  const handleScanOrphans = async () => {
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

      // Filter to only records created by GreenGale (content.uri points to app.greengale.document)
      const greengaleRecords = siteStandardRecords.filter(
        (record: { value?: { content?: { uri?: string } } }) => {
          const contentUri = record.value?.content?.uri
          return contentUri && contentUri.includes('/app.greengale.document/')
        }
      )

      // Check each GreenGale-created record for a corresponding app.greengale.document
      const BATCH_SIZE = 10
      const orphans: Array<{ rkey: string; title: string }> = []

      for (let i = 0; i < greengaleRecords.length; i += BATCH_SIZE) {
        const batch = greengaleRecords.slice(i, i + BATCH_SIZE)

        const results = await Promise.all(
          batch.map(async (record: { uri: string; value?: { title?: string } }) => {
            const rkey = record.uri.split('/').pop()
            const title = record.value?.title || 'Untitled'

            const checkResponse = await fetch(
              `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${session.did}&collection=app.greengale.document&rkey=${rkey}`
            )

            return { rkey, title, isOrphan: !checkResponse.ok }
          })
        )

        for (const result of results) {
          if (result.isOrphan) {
            orphans.push({ rkey: result.rkey!, title: result.title })
          }
        }
      }

      setOrphanedRecords(orphans)
      setOrphanScanComplete(true)
    } catch (err) {
      console.error('Error scanning for orphans:', err)
      setError(err instanceof Error ? err.message : 'Failed to scan for orphaned records')
    } finally {
      setScanningOrphans(false)
    }
  }

  const handleDeleteOrphans = async () => {
    if (orphanedRecords.length === 0) return

    setDeletingOrphans(true)

    try {
      await Promise.all(
        orphanedRecords.map((orphan) =>
          session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo: session.did,
              collection: 'site.standard.document',
              rkey: orphan.rkey,
            }),
          })
        )
      )

      setOrphanedRecords([])
      setOrphanScanComplete(false)
    } catch (err) {
      console.error('Error deleting orphans:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete orphaned records')
    } finally {
      setDeletingOrphans(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pt-14 lg:pt-0">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !saving && onClose()}
      />
      {/* Dialog */}
      <div className="publication-modal relative bg-[var(--site-bg)] border border-[var(--site-border)] rounded-lg shadow-xl max-w-lg w-full mx-4 p-6 max-h-[calc(90vh-3.5rem)] lg:max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[var(--site-text)]">
            {publication ? 'Edit Publication' : 'Set Up Publication'}
          </h2>
          <button
            onClick={() => !saving && onClose()}
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
                      <div className="w-6 h-6" style={{ backgroundColor: palette.background }} />
                      <div className="w-6 h-6" style={{ backgroundColor: palette.text }} />
                      <div className="w-6 h-6" style={{ backgroundColor: palette.accent }} />
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
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, background: e.target.value })
                    }}
                    className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                  />
                  <input
                    type="text"
                    value={pubCustomColors.background || ''}
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, background: e.target.value })
                    }}
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
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, text: e.target.value })
                    }}
                    className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                  />
                  <input
                    type="text"
                    value={pubCustomColors.text || ''}
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, text: e.target.value })
                    }}
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
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, accent: e.target.value })
                    }}
                    className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                  />
                  <input
                    type="text"
                    value={pubCustomColors.accent || ''}
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, accent: e.target.value })
                    }}
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
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, codeBackground: e.target.value })
                    }}
                    className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                    style={{ backgroundColor: pubCustomColors.codeBackground || (deriveThemeColors(pubCustomColors)?.codeBackground || '#f6f8fa') }}
                  />
                  <input
                    type="text"
                    value={pubCustomColors.codeBackground || ''}
                    onChange={(e) => {
                      setPubTheme('custom')
                      setPubCustomColors({ ...pubCustomColors, codeBackground: e.target.value })
                    }}
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
                  <div className="p-4 rounded-lg" style={{ backgroundColor: pubCustomColors.background }}>
                    <p style={{ color: pubCustomColors.text }} className="text-sm mb-2">
                      This is how your text will look.{' '}
                      <a
                        href="#"
                        onClick={(e) => e.preventDefault()}
                        style={{ color: pubCustomColors.accent }}
                        className="underline"
                      >
                        Links appear like this.
                      </a>
                    </p>
                    <div
                      className="px-3 py-2 rounded text-sm font-mono"
                      style={{
                        backgroundColor:
                          pubCustomColors.codeBackground ||
                          deriveThemeColors(pubCustomColors)?.codeBackground ||
                          pubCustomColors.background,
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
                <span className="text-sm font-medium text-[var(--site-text)]">Show in Discover</span>
                <p className="text-xs text-[var(--site-text-secondary)] mt-0.5">
                  Allow your posts to appear on the homepage and discovery feeds.
                </p>
              </div>
            </label>
          </div>

          {/* Voice Settings */}
          <div className="p-4 border border-[var(--site-border)] rounded-md bg-[var(--site-bg-secondary)]">
            <h3 className="text-sm font-medium text-[var(--site-text)] mb-3">Voice Settings</h3>
            <p className="text-xs text-[var(--site-text-secondary)] mb-4">
              Set default voice for TTS playback. Readers can still adjust settings in their player.
            </p>
            <VoiceSettingsPreview
              voice={pubVoice}
              pitch={pubPitch}
              speed={pubSpeed}
              onVoiceChange={setPubVoice}
              onPitchChange={setPubPitch}
              onSpeedChange={setPubSpeed}
            />
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
                  Publish site.standard.publication record for cross-platform compatibility. Can also
                  be toggled per-document in the post editor.
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
                        Found {orphanedRecords.length} orphaned record
                        {orphanedRecords.length !== 1 ? 's' : ''}:
                      </p>
                      <ul className="text-xs text-[var(--site-text-secondary)] space-y-1 max-h-24 overflow-y-auto">
                        {orphanedRecords.map((r) => (
                          <li key={r.rkey} className="truncate">
                            • {r.title}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={handleDeleteOrphans}
                        disabled={deletingOrphans}
                        className="px-3 py-1 text-xs bg-red-500/10 border border-red-500/30 text-red-500 rounded hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingOrphans
                          ? 'Deleting...'
                          : `Delete ${orphanedRecords.length} orphaned record${orphanedRecords.length !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-500">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm border border-[var(--site-border)] rounded-md hover:bg-[var(--site-bg-secondary)] text-[var(--site-text)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !pubName.trim() || hasPubContrastError}
              className="px-4 py-2 text-sm bg-[var(--site-accent)] text-white rounded-md hover:opacity-90 disabled:opacity-50"
              title={
                hasPubContrastError
                  ? 'Fix contrast issues before saving'
                  : !pubName.trim()
                    ? 'Publication name is required'
                    : undefined
              }
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
