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
// For production, use the deployed client metadata
const CLIENT_ID = import.meta.env.DEV
  ? `http://localhost?redirect_uri=${encodeURIComponent('http://127.0.0.1:5173/auth/callback')}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
  : `https://greengale.app/client-metadata.json`

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

  // Initialize - check for existing session
  useEffect(() => {
    async function init() {
      try {
        console.log('[Auth] Initializing, getting OAuth client...')
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

          // Get handle - for now we'll resolve it later or use the DID
          // The session.sub is the DID
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
              // Don't block auth if migration fails - it will retry next login
            }
          }

          // Fix site.standard URL issues (publication URL and document paths)
          // Uses localStorage to track completion per user (v1 = initial fix)
          const urlFixKey = `site-standard-url-fix-v1-${did}`
          if (!localStorage.getItem(urlFixKey)) {
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
              // Mark as complete even if no fixes were needed
              localStorage.setItem(urlFixKey, new Date().toISOString())
            } catch (urlFixError) {
              console.error('[Auth] URL fix error:', urlFixError)
              // Don't block auth if URL fix fails - it will retry next login
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
        } else {
          setState((s) => ({ ...s, isLoading: false }))
        }
      } catch (error) {
        console.error('Auth init error:', error)
        // Don't show the error on init - just mark as not loading
        // The user hasn't tried to log in yet
        setState((s) => ({
          ...s,
          isLoading: false,
          error: null,
        }))
      }
    }

    init()
  }, [])

  const login = useCallback(async (handle: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }))

    try {
      console.log('[Auth] Starting login for handle:', handle)
      console.log('[Auth] Getting OAuth client...')
      const client = await getOAuthClient()
      console.log('[Auth] OAuth client loaded, calling signIn...')
      await client.signIn(handle, {
        scope: OAUTH_SCOPE,
      })
      console.log('[Auth] signIn completed (should have redirected)')
      // The page will redirect, so we don't need to handle the response here
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
