import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser'

// For development, use loopback client ID
// For production, use the deployed client metadata
const CLIENT_ID = import.meta.env.DEV
  ? `http://localhost?redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}&scope=${encodeURIComponent('atproto transition:generic')}`
  : `https://greengale-app.pages.dev/client-metadata.json`

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:8787'
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
    oauthClient = await BrowserOAuthClient.load({
      clientId: CLIENT_ID,
      handleResolver: 'https://bsky.social',
    })
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
        const client = await getOAuthClient()
        const result = await client.init()

        if (result?.session) {
          const did = result.session.did
          const whitelisted = await checkWhitelist(did)

          // Get handle - for now we'll resolve it later or use the DID
          // The session.sub is the DID
          const resolvedHandle = await resolveHandleFromDid(did)

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
      const client = await getOAuthClient()
      await client.signIn(handle, {
        scope: 'atproto transition:generic',
      })
      // The page will redirect, so we don't need to handle the response here
    } catch (error) {
      console.error('Login error:', error)
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
