import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoadingCube } from '@/components/LoadingCube'
import { useAuth } from '@/lib/auth'
import {
  isFromPWA,
  clearFromPWA,
  readSessionFromIndexedDB,
  exportSessionToCache,
} from '@/lib/pwa-session-bridge'

type CallbackState = 'processing' | 'success-pwa' | 'error' | 'redirecting'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading } = useAuth()
  const [state, setState] = useState<CallbackState>('processing')
  const [error, setError] = useState<string | null>(null)
  const [fromPWA, setFromPWA] = useState<boolean | null>(null)
  const hasHandledAuth = useRef(false)

  // Check for OAuth errors and PWA flag on mount
  useEffect(() => {
    async function checkInitial() {
      const params = new URLSearchParams(window.location.search)
      const errorParam = params.get('error')
      const errorDescription = params.get('error_description')

      if (errorParam) {
        setError(errorDescription || errorParam)
        setState('error')
        return
      }

      // Check if this callback originated from a PWA
      const pwaFlag = await isFromPWA()
      setFromPWA(pwaFlag)
      if (pwaFlag) {
        console.log('[AuthCallback] PWA flow detected')
      }
      // Don't clear the flag yet - we'll clear it after successful export
    }
    checkInitial()
  }, [])

  // Handle auth state changes
  useEffect(() => {
    // Wait until we know if we're from PWA
    if (fromPWA === null) return
    // Don't run if there was an OAuth error
    if (state === 'error') return
    // Don't run twice
    if (hasHandledAuth.current) return

    async function handleAuthComplete(requireSession: boolean = false) {
      if (fromPWA) {
        // PWA flow: export session to Cache Storage for the PWA to pick up
        console.log('[AuthCallback] Auth complete, exporting session for PWA...')

        // Read and export the session
        const session = await readSessionFromIndexedDB()
        if (session) {
          const exported = await exportSessionToCache(session)
          if (exported) {
            await clearFromPWA()
            console.log('[AuthCallback] Session exported to cache, showing close message')
            setState('success-pwa')
            return
          }
        }

        // If requireSession is true and we have no session, this is an auth failure
        if (requireSession && !session) {
          await clearFromPWA()
          console.error('[AuthCallback] No session found after auth - login failed')
          setError('Login failed. Please try again.')
          setState('error')
          return
        }

        // If we couldn't export but auth was confirmed, still show success
        // The session is stored in Safari's IndexedDB at least
        await clearFromPWA()
        console.warn('[AuthCallback] Could not export session, but auth succeeded')
        setState('success-pwa')
      } else {
        // Normal browser flow: redirect to home
        setState('redirecting')
        navigate('/', { replace: true })
      }
    }

    if (isAuthenticated && !isLoading) {
      hasHandledAuth.current = true
      handleAuthComplete(false)
    } else if (!isAuthenticated && !isLoading && fromPWA !== null) {
      // Auth finished but not authenticated - wait a bit for IndexedDB sync
      // On iOS, the OAuth client might still be processing
      const timeout = setTimeout(async () => {
        if (!hasHandledAuth.current) {
          if (fromPWA) {
            hasHandledAuth.current = true
            // Must verify session exists - if not, it's a real auth failure
            await handleAuthComplete(true)
          }
        }
      }, 2000)
      return () => clearTimeout(timeout)
    }
  }, [isAuthenticated, isLoading, fromPWA, state, navigate])

  if (state === 'error') {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-[var(--site-text)]">
            Authentication Error
          </h1>
          <p className="text-[var(--site-text-secondary)] mb-6">{error}</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="px-6 py-2 bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (state === 'success-pwa') {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <div className="text-5xl mb-6">✓</div>
          <h1 className="text-2xl font-bold mb-4 text-[var(--site-text)]">
            Login Successful
          </h1>
          <p className="text-[var(--site-text-secondary)] mb-6">
            You're now signed in to GreenGale.
          </p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="px-6 py-2 bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors"
          >
            Continue to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] lg:min-h-screen flex items-center justify-center">
      <div className="text-center">
        <LoadingCube size="sm" className="mb-4" />
        <p className="text-[var(--site-text-secondary)]">Completing login...</p>
      </div>
    </div>
  )
}
