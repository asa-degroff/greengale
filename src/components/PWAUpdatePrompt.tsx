import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PWAUpdatePrompt() {
  const [dismissed, setDismissed] = useState(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error)
    },
  })

  useEffect(() => {
    if (needRefresh) setDismissed(false)
  }, [needRefresh])

  if (!needRefresh || dismissed) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-[var(--site-bg)] border border-[var(--site-border)] rounded-lg shadow-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M23 4v6h-6M1 20v-6h6" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-[var(--site-text)]">
              Update available
            </h3>
            <p className="mt-1 text-sm text-[var(--site-text-secondary)]">
              A new version of GreenGale is ready.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => updateServiceWorker(true)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors"
              >
                Update now
              </button>
              <button
                onClick={() => { setDismissed(true); setNeedRefresh(false) }}
                className="px-3 py-1.5 text-sm font-medium text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors"
              >
                Later
              </button>
            </div>
          </div>
          <button
            onClick={() => { setDismissed(true); setNeedRefresh(false) }}
            className="flex-shrink-0 p-1 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
