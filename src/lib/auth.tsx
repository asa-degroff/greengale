import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser'
import { migrateSiteStandardPublication, fixSiteStandardUrls } from './atproto'

// Minimal OAuth scopes: blog entry collections + V2 document collection + publication + site.standard + blob uploads
const OAUTH_SCOPE =
  'atproto repo?collection=app.greengale.blog.entry&collection=app.greengale.document&collection=app.greengale.publication&collection=com.whtwnd.blog.entry&collection=site.standard.publication&collection=site.standard.document blob:image/*'

// For development, use loopback client ID
// Client ID must use "localhost", redirect_uri must use "127.0.0.1" per AT Protocol OAuth spec
// For production, use the current origin's client-metadata.json so the client_id origin
// matches the redirect_uri origin (required by AT Protocol OAuth spec)
const CLIENT_ID = import.meta.env.DEV
  ? `http://localhost?redirect_uri=${encodeURIComponent('http://127.0.0.1:5173/auth/callback')}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
  : `${window.location.origin}/client-metadata.json`

const API_BASE = import.meta.env.DEV
  ? 'http://127.0.0.1:8788'
  : 'https://greengale.asadegroff.workers.dev'

interface AuthState {
  isLoading: boolean
  isAuthenticated: boolean
  isWhitelisted: boolean
  session: OAuthSession | null
  did: string | null
  handle: string | null
  error: string | null
}

interface AuthContextValue extends AuthState {
  login: (handle: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

let oauthClient: BrowserOAuthClient | null = null

async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (!oauthClient) {
    console.log('[Auth] Loading BrowserOAuthClient with clientId:', CLIENT_ID)
    oauthClient = await BrowserOAuthClient.load({
      clientId: CLIENT_ID,
      handleResolver: 'https://bsky.social',
    })
    console.log('[Auth] BrowserOAuthClient loaded successfully')
  }
  return oauthClient
}

async function checkWhitelist(did: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE}/xrpc/app.greengale.auth.checkWhitelist?did=${encodeURIComponent(did)}`
    )
    if (!response.ok) return false
    const data = await response.json()
    return data.whitelisted === true
  } catch {
    return false
  }
}

async function resolveHandleFromDid(did: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    )
    if (!response.ok) return null
    const data = await response.json()
    return data.handle || null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    isWhitelisted: false,
    session: null,
    did: null,
    handle: null,
    error: null,
  })

  // Session initialization logic, reusable for re-checks
  const initSession = useCallback(async (isRecheck = false) => {
    try {
      console.log(`[Auth] ${isRecheck ? 'Re-checking' : 'Initializing'}, getting OAuth client...`)
      const client = await getOAuthClient()
      console.log('[Auth] OAuth client loaded, calling init...')
      const result = await client.init()
      console.log('[Auth] init result:', result)

      if (result?.session) {
        const did = result.session.did
        console.log('[Auth] Session found for DID:', did)
        console.log('[Auth] Checking whitelist...')
        const whitelisted = await checkWhitelist(did)
        console.log('[Auth] Whitelist result:', whitelisted)

        console.log('[Auth] Resolving handle...')
        const resolvedHandle = await resolveHandleFromDid(did)
        console.log('[Auth] Handle resolved:', resolvedHandle)

        // Run migration for site.standard.publication records
        // Uses localStorage to track completion per user
        const migrationKey = `site-standard-migrated-v1-${did}`
        if (!localStorage.getItem(migrationKey)) {
          console.log('[Auth] Running site.standard.publication migration...')
          try {
            const migrationResult = await migrateSiteStandardPublication(result.session)
            if (migrationResult.migrated) {
              console.log('[Auth] Migration completed successfully')
            } else if (migrationResult.error) {
              console.warn('[Auth] Migration failed:', migrationResult.error)
            } else {
              console.log('[Auth] No migration needed')
            }
            // Mark as complete even if no migration was needed
            localStorage.setItem(migrationKey, new Date().toISOString())
          } catch (migrationError) {
            console.error('[Auth] Migration error:', migrationError)
          }
        }

        // Fix site.standard URL issues
        const urlFixKey = `site-standard-url-fix-v1-${did}`
        if (!localStorage.getItem(urlFixKey) && resolvedHandle) {
          console.log('[Auth] Checking site.standard URLs...')
          try {
            const urlFixResult = await fixSiteStandardUrls(result.session, resolvedHandle)
            if (urlFixResult.publicationFixed || urlFixResult.documentsFixed > 0) {
              console.log(`[Auth] URL fix completed: publication=${urlFixResult.publicationFixed}, documents=${urlFixResult.documentsFixed}`)
            } else if (urlFixResult.error) {
              console.warn('[Auth] URL fix failed:', urlFixResult.error)
            } else {
              console.log('[Auth] No URL fixes needed')
            }
            localStorage.setItem(urlFixKey, new Date().toISOString())
          } catch (urlFixError) {
            console.error('[Auth] URL fix error:', urlFixError)
          }
        }

        console.log('[Auth] Setting authenticated state')
        setState({
          isLoading: false,
          isAuthenticated: true,
          isWhitelisted: whitelisted,
          session: result.session,
          did,
          handle: resolvedHandle,
          error: null,
        })
      } else if (!isRecheck) {
        setState((s) => ({ ...s, isLoading: false }))
      }
    } catch (error) {
      console.error('Auth init error:', error)
      if (!isRecheck) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: null,
        }))
      }
    }
  }, [])

  // Initialize - check for existing session on mount
  useEffect(() => {
    initSession(false)
  }, [initSession])

  // Re-check session when app returns to foreground.
  // In standalone PWA mode, after authorize() + window.open(), the state is
  // isLoading=true. When the user returns from the browser, we re-check to
  // pick up the session stored by the browser's callback.
  // We listen for both visibilitychange (mobile: app switch) and focus
  // (desktop: window focus) since switching windows on desktop doesn't
  // necessarily trigger visibilitychange.
  useEffect(() => {
    const recheckIfNeeded = () => {
      setState((current) => {
        if (!current.isAuthenticated) {
          console.log('[Auth] App regained focus/visibility, re-checking session...')
          initSession(true)
        }
        return current
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') recheckIfNeeded()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', recheckIfNeeded)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', recheckIfNeeded)
    }
  }, [initSession])

  const login = useCallback(async (handle: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }))

    try {
      console.log('[Auth] Starting login for handle:', handle)
      const client = await getOAuthClient()

      // In standalone PWA mode, redirect-based auth opens the system browser
      // which can't redirect back. Instead, get the auth URL directly and
      // open it in a new window. The browser completes the OAuth flow and
      // stores the session in shared IndexedDB. The PWA picks it up on
      // visibility change via initRestore().
      const isStandalone =
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(display-mode: standalone)').matches) ||
        (navigator as unknown as { standalone?: boolean }).standalone === true

      // Ensure the redirect_uri matches the current origin (important for
      // preview deployments where the default would be the production URL)
      const redirectUri = `${window.location.origin}/auth/callback` as `https://${string}`

      if (isStandalone) {
        console.log('[Auth] Standalone mode: using authorize() + window.open()')
        const url = await client.authorize(handle, {
          scope: OAUTH_SCOPE,
          redirect_uri: redirectUri,
        })
        window.open(url.href, '_blank')
        // Keep loading state - visibilitychange handler will pick up the
        // session when the user returns to the PWA
      } else {
        console.log('[Auth] Using redirect mode')
        await client.signIn(handle, {
          scope: OAUTH_SCOPE,
          redirect_uri: redirectUri,
        })
        // In redirect mode, the page navigates away and this never resolves
      }
    } catch (error) {
      console.error('[Auth] Login error:', error)
      setState((s) => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to login',
      }))
    }
  }, [])

  const logout = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }))

    try {
      if (state.session) {
        const client = await getOAuthClient()
        await client.revoke(state.session.did)
      }

      setState({
        isLoading: false,
        isAuthenticated: false,
        isWhitelisted: false,
        session: null,
        did: null,
        handle: null,
        error: null,
      })
    } catch (error) {
      console.error('Logout error:', error)
      setState((s) => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to logout',
      }))
    }
  }, [state.session])

  const refresh = useCallback(async () => {
    if (!state.did) return

    try {
      const whitelisted = await checkWhitelist(state.did)
      setState((s) => ({ ...s, isWhitelisted: whitelisted }))
    } catch (error) {
      console.error('Refresh error:', error)
    }
  }, [state.did])

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Export internal utilities for testing
export const __test__ = {
  checkWhitelist,
  resolveHandleFromDid,
  OAUTH_SCOPE,
  API_BASE,
}
