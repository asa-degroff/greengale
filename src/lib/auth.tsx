import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import {
  BrowserOAuthClient,
  OAuthSession,
  AtprotoDohHandleResolver,
} from '@atproto/oauth-client-browser'
import { migrateSiteStandardPublication } from './atproto'
import { markFromPWA, tryBridgeSession, isIOSStandalone } from './pwa-session-bridge'

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
    // Use DNS over HTTPS for handle resolution instead of Bluesky's resolver.
    // This properly resolves did:web handles via DNS TXT records (_atproto.{handle})
    // and .well-known/atproto-did endpoints, which Bluesky's resolver doesn't support
    // for non-Bluesky handles.
    // Note: Use /resolve (JSON API) not /dns-query (binary wireformat)
    const handleResolver = new AtprotoDohHandleResolver({
      dohEndpoint: 'https://dns.google/resolve',
    })
    oauthClient = await BrowserOAuthClient.load({
      clientId: CLIENT_ID,
      handleResolver,
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
  // For did:web, derive the handle directly from the DID
  // did:web:example.com -> example.com
  // did:web:example.com:path:to:resource -> example.com (domain only)
  if (did.startsWith('did:web:')) {
    const webPart = did.slice('did:web:'.length)
    // Handle is the domain part (before any path segments indicated by colons)
    // Also decode percent-encoded characters (e.g., %3A for port numbers)
    const domain = decodeURIComponent(webPart.split(':')[0])
    return domain || null
  }

  // For did:plc and others, try Bluesky's API
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

      // On iOS standalone PWA, try to bridge session from Safari's Cache Storage
      if (isRecheck && isIOSStandalone()) {
        const bridged = await tryBridgeSession()
        if (bridged) {
          console.log('[Auth] Session bridged from Safari, continuing with init...')
        }
      }

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

    // On iOS standalone PWA, redirect-based auth opens the system browser
    // which can't redirect back to the PWA. Instead, get the auth URL directly
    // and open it in Safari. Safari completes the OAuth flow, exports the
    // session to Cache Storage, and the PWA picks it up on visibility change.
    // Desktop PWAs can handle redirects fine, so use normal flow there.
    const isIOSPWA = isIOSStandalone()

    // IMPORTANT: On iOS, window.open() must be called synchronously in response
    // to the user gesture. Any await before window.open() will cause iOS to block
    // the popup. So we open the window FIRST with a blank page, then navigate it
    // to the OAuth URL after the async operations complete.
    let popup: Window | null = null
    if (isIOSPWA) {
      popup = window.open('about:blank', '_blank')
      if (!popup) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: 'Please allow popups for this site to sign in',
        }))
        return
      }
      // Show a loading message in the popup while we prepare the OAuth URL
      // Uses dark green theme colors to match the app
      popup.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="theme-color" content="#0f1e14">
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: #0f1e14;
                color: #a8d4ae;
              }
              .loading { text-align: center; }
              .spinner {
                width: 32px;
                height: 32px;
                border: 3px solid #1a3d24;
                border-top-color: #4a9960;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin: 0 auto 16px;
              }
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
              p { margin: 0; font-size: 15px; }
            </style>
          </head>
          <body>
            <div class="loading">
              <div class="spinner"></div>
              <p>Preparing login...</p>
            </div>
          </body>
        </html>
      `)
    }

    try {
      console.log('[Auth] Starting login for handle:', handle)
      const client = await getOAuthClient()

      // Ensure the redirect_uri matches the current origin (important for
      // preview deployments where the default would be the production URL)
      const redirectUri = `${window.location.origin}/auth/callback` as `https://${string}`

      if (isIOSPWA && popup) {
        console.log('[Auth] iOS standalone mode: navigating popup to OAuth URL')
        await markFromPWA() // Mark so callback knows to export session for PWA (uses Cache Storage)
        const url = await client.authorize(handle, {
          scope: OAUTH_SCOPE,
          redirect_uri: redirectUri,
        })
        // Check if popup was closed while we were preparing
        if (popup.closed) {
          throw new Error('Login window was closed. Please try again.')
        }
        popup.location.href = url.href
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
