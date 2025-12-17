import { useState } from 'react'
import type { ContentLabelValue } from '@/lib/image-upload'
import { CONTENT_LABEL_OPTIONS } from '@/lib/image-labels'

interface ImageMetadataEditorProps {
  imageUrl: string
  imageName: string
  initialAlt: string
  initialLabels: ContentLabelValue[]
  onSave: (alt: string, labels: ContentLabelValue[]) => void
  onCancel: () => void
}

export function ImageMetadataEditor({
  imageUrl,
  imageName,
  initialAlt,
  initialLabels,
  onSave,
  onCancel,
}: ImageMetadataEditorProps) {
  const [alt, setAlt] = useState(initialAlt)
  const [labels, setLabels] = useState<Set<ContentLabelValue>>(new Set(initialLabels))

  const toggleLabel = (value: ContentLabelValue) => {
    setLabels((prev) => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      return next
    })
  }

  const handleSave = () => {
    onSave(alt.trim(), Array.from(labels))
  }

  return (
    <div className="border border-[var(--site-border)] rounded-lg overflow-hidden bg-[var(--site-bg)]">
      {/* Header with image preview */}
      <div className="flex items-start gap-3 p-3 bg-[var(--site-bg-secondary)]">
        <img
          src={imageUrl}
          alt=""
          className="w-16 h-16 object-cover rounded flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--site-text)] truncate">
            {imageName}
          </p>
          <p className="text-xs text-[var(--site-text-secondary)]">
            Edit image metadata
          </p>
        </div>
      </div>

      {/* Alt text input */}
      <div className="p-3 border-t border-[var(--site-border)]">
        <label className="block text-sm font-medium text-[var(--site-text)] mb-1">
          Alt Text
          <span className="text-xs text-[var(--site-text-secondary)] ml-2 font-normal">
            Describe this image for accessibility
          </span>
        </label>
        <textarea
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Describe what's in this image..."
          className="w-full px-3 py-2 text-sm border border-[var(--site-border)] rounded-md bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] resize-none"
          rows={5}
          maxLength={1000}
        />
        <p className="text-xs text-[var(--site-text-secondary)] mt-1 text-right">
          {alt.length}/1000
        </p>
      </div>

      {/* Content labels */}
      <div className="p-3 border-t border-[var(--site-border)]">
        <label className="block text-sm font-medium text-[var(--site-text)] mb-2">
          Content Labels
          <span className="text-xs text-[var(--site-text-secondary)] ml-2 font-normal">
            Mark sensitive content
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {CONTENT_LABEL_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                labels.has(option.value)
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-[var(--site-border)] hover:bg-[var(--site-bg-secondary)]'
              }`}
            >
              <input
                type="checkbox"
                checked={labels.has(option.value)}
                onChange={() => toggleLabel(option.value)}
                className="mt-0.5 accent-amber-500"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-[var(--site-text)] block">
                  {option.label}
                </span>
                <span className="text-xs text-[var(--site-text-secondary)]">
                  {option.description}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 p-3 border-t border-[var(--site-border)] bg-[var(--site-bg-secondary)]">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 text-sm bg-[var(--site-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
        >
          Save
        </button>
      </div>
    </div>
  )
}
