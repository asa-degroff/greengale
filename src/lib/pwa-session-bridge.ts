/**
 * PWA Session Bridge for iOS
 *
 * On iOS, IndexedDB is isolated between Safari and PWA standalone mode.
 * This module uses Cache Storage (which IS shared) to bridge the OAuth
 * session from Safari back to the PWA.
 *
 * Flow:
 * 1. PWA opens OAuth URL via window.open() in Safari
 * 2. OAuth completes in Safari, session stored in Safari's IndexedDB
 * 3. Safari exports session to Cache Storage
 * 4. PWA imports session from Cache Storage into PWA's IndexedDB
 * 5. PWA calls client.init() which now finds the session
 */

const CACHE_NAME = 'greengale-pwa-session-bridge'
const CACHE_KEY = '/pwa-session-bridge'
const PWA_FLAG_KEY = '/pwa-origin-flag'
const SESSION_TTL_MS = 10 * 60 * 1000 // 10 minutes

// AT Protocol OAuth client IndexedDB structure
const INDEXEDDB_NAME = '@atproto-oauth-client'
const INDEXEDDB_VERSION = 1

export interface ExportedSession {
  version: 1
  createdAt: string
  expiresAt: string
  sub: string // DID
  dpopKey: {
    keyId: string
    privateKey: JsonWebKey
    publicKey: JsonWebKey
    algorithm: { name: string; namedCurve: string }
  }
  tokenSet: {
    iss: string
    sub: string
    aud: string
    scope: string
    refresh_token?: string
    access_token: string
    token_type: 'DPoP'
    expires_at?: string
  }
}

/**
 * Detect if running on iOS in standalone PWA mode
 */
export function isIOSStandalone(): boolean {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  const isStandalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true

  return isIOS && isStandalone
}

/**
 * Check if the current OAuth callback originated from a PWA
 * Uses Cache Storage because it's shared between Safari and PWA on iOS
 */
export async function isFromPWA(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(PWA_FLAG_KEY)
    if (!response) return false

    const data = await response.json()
    // Check if flag is still valid (10 minute TTL)
    if (new Date(data.expiresAt) < new Date()) {
      await cache.delete(PWA_FLAG_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Mark that the current OAuth flow originated from a PWA
 * Uses Cache Storage because it's shared between Safari and PWA on iOS
 */
export async function markFromPWA(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    const response = new Response(JSON.stringify({ pwa: true, expiresAt }), {
      headers: { 'Content-Type': 'application/json' },
    })
    await cache.put(PWA_FLAG_KEY, response)
    console.log('[PWA Bridge] PWA origin flag set in Cache Storage')
  } catch (error) {
    console.error('[PWA Bridge] Failed to set PWA flag:', error)
  }
}

/**
 * Clear the PWA origin marker
 */
export async function clearFromPWA(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.delete(PWA_FLAG_KEY)
  } catch {
    // Ignore errors
  }
}

/**
 * Read the current session from AT Protocol's IndexedDB
 */
export async function readSessionFromIndexedDB(): Promise<ExportedSession | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(INDEXEDDB_NAME, INDEXEDDB_VERSION)

    request.onerror = () => {
      console.error('[PWA Bridge] Failed to open IndexedDB')
      resolve(null)
    }

    request.onsuccess = async () => {
      try {
        const db = request.result

        // Read the session sub from localStorage
        const subKey = Object.keys(localStorage).find((k) =>
          k.startsWith('@@atproto/oauth-client-browser(')
        )
        if (!subKey) {
          console.log('[PWA Bridge] No session sub found in localStorage')
          db.close()
          resolve(null)
          return
        }

        const sub = localStorage.getItem(subKey)
        if (!sub) {
          db.close()
          resolve(null)
          return
        }

        // Read session from sessions store
        const sessionTx = db.transaction('sessions', 'readonly')
        const sessionStore = sessionTx.objectStore('sessions')
        const sessionRequest = sessionStore.get(sub)

        sessionRequest.onsuccess = async () => {
          const sessionData = sessionRequest.result
          if (!sessionData) {
            console.log('[PWA Bridge] No session data found')
            db.close()
            resolve(null)
            return
          }

          // Read DPoP key from keys store
          const keyTx = db.transaction('keys', 'readonly')
          const keyStore = keyTx.objectStore('keys')
          const keyRequest = keyStore.get(sub)

          keyRequest.onsuccess = async () => {
            const keyData = keyRequest.result
            if (!keyData) {
              console.log('[PWA Bridge] No key data found')
              db.close()
              resolve(null)
              return
            }

            try {
              // Export the CryptoKey pair to JWK format
              const privateKey = await crypto.subtle.exportKey(
                'jwk',
                keyData.dpopKey.privateKey
              )
              const publicKey = await crypto.subtle.exportKey(
                'jwk',
                keyData.dpopKey.publicKey
              )

              const now = new Date()
              const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)

              const exported: ExportedSession = {
                version: 1,
                createdAt: now.toISOString(),
                expiresAt: expiresAt.toISOString(),
                sub,
                dpopKey: {
                  keyId: keyData.dpopKey.keyId,
                  privateKey,
                  publicKey,
                  algorithm: {
                    name: keyData.dpopKey.privateKey.algorithm.name,
                    namedCurve: (
                      keyData.dpopKey.privateKey.algorithm as EcKeyAlgorithm
                    ).namedCurve,
                  },
                },
                tokenSet: {
                  iss: sessionData.tokenSet.iss,
                  sub: sessionData.tokenSet.sub,
                  aud: sessionData.tokenSet.aud,
                  scope: sessionData.tokenSet.scope,
                  refresh_token: sessionData.tokenSet.refresh_token,
                  access_token: sessionData.tokenSet.access_token,
                  token_type: 'DPoP',
                  expires_at: sessionData.tokenSet.expires_at,
                },
              }

              db.close()
              resolve(exported)
            } catch (error) {
              console.error('[PWA Bridge] Failed to export keys:', error)
              db.close()
              resolve(null)
            }
          }

          keyRequest.onerror = () => {
            console.error('[PWA Bridge] Failed to read key data')
            db.close()
            resolve(null)
          }
        }

        sessionRequest.onerror = () => {
          console.error('[PWA Bridge] Failed to read session data')
          db.close()
          resolve(null)
        }
      } catch (error) {
        console.error('[PWA Bridge] Error reading from IndexedDB:', error)
        resolve(null)
      }
    }
  })
}

/**
 * Export session to Cache Storage for PWA to pick up
 */
export async function exportSessionToCache(
  session: ExportedSession
): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const response = new Response(JSON.stringify(session), {
      headers: { 'Content-Type': 'application/json' },
    })
    await cache.put(CACHE_KEY, response)
    console.log('[PWA Bridge] Session exported to Cache Storage')
    return true
  } catch (error) {
    console.error('[PWA Bridge] Failed to export session to cache:', error)
    return false
  }
}

/**
 * Import session from Cache Storage
 */
export async function importSessionFromCache(): Promise<ExportedSession | null> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(CACHE_KEY)
    if (!response) {
      console.log('[PWA Bridge] No session found in Cache Storage')
      return null
    }

    const session: ExportedSession = await response.json()

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      console.log('[PWA Bridge] Cached session has expired')
      await clearSessionCache()
      return null
    }

    console.log('[PWA Bridge] Session imported from Cache Storage')
    return session
  } catch (error) {
    console.error('[PWA Bridge] Failed to import session from cache:', error)
    return null
  }
}

/**
 * Inject session into AT Protocol's IndexedDB
 */
export async function injectSessionToIndexedDB(
  session: ExportedSession
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.open(INDEXEDDB_NAME, INDEXEDDB_VERSION)

    request.onerror = () => {
      console.error('[PWA Bridge] Failed to open IndexedDB for injection')
      resolve(false)
    }

    request.onupgradeneeded = () => {
      // Create stores if they don't exist
      const db = request.result
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions')
      }
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys')
      }
      if (!db.objectStoreNames.contains('states')) {
        db.createObjectStore('states')
      }
    }

    request.onsuccess = async () => {
      try {
        const db = request.result

        // Import the CryptoKey pair from JWK format
        // Keys must be extractable: true for AT Protocol client to re-export them
        const privateKey = await crypto.subtle.importKey(
          'jwk',
          session.dpopKey.privateKey,
          {
            name: session.dpopKey.algorithm.name,
            namedCurve: session.dpopKey.algorithm.namedCurve,
          },
          true, // extractable
          ['sign']
        )
        const publicKey = await crypto.subtle.importKey(
          'jwk',
          session.dpopKey.publicKey,
          {
            name: session.dpopKey.algorithm.name,
            namedCurve: session.dpopKey.algorithm.namedCurve,
          },
          true, // extractable
          ['verify']
        )

        // Write session to sessions store
        const sessionTx = db.transaction('sessions', 'readwrite')
        const sessionStore = sessionTx.objectStore('sessions')

        const sessionData = {
          dpopKeyId: session.dpopKey.keyId,
          tokenSet: session.tokenSet,
        }

        await new Promise<void>((res, rej) => {
          const req = sessionStore.put(sessionData, session.sub)
          req.onsuccess = () => res()
          req.onerror = () => rej(req.error)
        })

        // Write key to keys store
        const keyTx = db.transaction('keys', 'readwrite')
        const keyStore = keyTx.objectStore('keys')

        const keyData = {
          dpopKey: {
            keyId: session.dpopKey.keyId,
            privateKey,
            publicKey,
          },
        }

        await new Promise<void>((res, rej) => {
          const req = keyStore.put(keyData, session.sub)
          req.onsuccess = () => res()
          req.onerror = () => rej(req.error)
        })

        // Set localStorage pointer so AT Protocol client knows which session to use
        const subKey = `@@atproto/oauth-client-browser(${session.tokenSet.aud})`
        localStorage.setItem(subKey, session.sub)

        db.close()
        console.log('[PWA Bridge] Session injected into IndexedDB')
        resolve(true)
      } catch (error) {
        console.error('[PWA Bridge] Failed to inject session:', error)
        resolve(false)
      }
    }
  })
}

/**
 * Clear the session from Cache Storage
 */
export async function clearSessionCache(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.delete(CACHE_KEY)
    console.log('[PWA Bridge] Session cache cleared')
  } catch (error) {
    console.error('[PWA Bridge] Failed to clear session cache:', error)
  }
}

/**
 * Attempt to bridge the session from Safari to PWA
 * Returns true if a session was successfully bridged
 */
export async function tryBridgeSession(): Promise<boolean> {
  if (!isIOSStandalone()) {
    return false
  }

  console.log('[PWA Bridge] iOS standalone mode detected, checking for cached session...')

  const session = await importSessionFromCache()
  if (!session) {
    return false
  }

  const success = await injectSessionToIndexedDB(session)
  if (success) {
    await clearSessionCache()
    return true
  }

  return false
}
