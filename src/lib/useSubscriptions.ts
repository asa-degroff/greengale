import { useState, useCallback, useEffect, useRef } from 'react'
import {
  getSubscriptions,
  subscribeToPublication,
  unsubscribeFromPublication,
  type Subscription,
} from '@/lib/atproto'

interface SubscriptionsState {
  subscriptions: Subscription[]
  loading: boolean
  loaded: boolean
  /** DIDs of all subscribed publications */
  subscribedDids: string[]
  /** Check if subscribed to a specific publication DID */
  isSubscribed: (did: string) => boolean
  /** Subscribe to a publication */
  subscribe: (publicationUri: string, publicationDid: string) => Promise<void>
  /** Unsubscribe from a publication */
  unsubscribe: (publicationDid: string) => Promise<void>
  /** Refresh subscriptions from PDS */
  refresh: () => Promise<void>
}

// Module-level cache so subscriptions persist across mounts
let cachedSubscriptions: Subscription[] | null = null
let cachedDid: string | null = null

export function useSubscriptions(
  session: { did: string; fetchHandler: (url: string, options: RequestInit) => Promise<Response> } | undefined
): SubscriptionsState {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => {
    if (session?.did && session.did === cachedDid && cachedSubscriptions) {
      return cachedSubscriptions
    }
    return []
  })
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(() => {
    return session?.did === cachedDid && cachedSubscriptions !== null
  })
  const loadingRef = useRef(false)

  const fetchSubscriptions = useCallback(async () => {
    if (!session || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const subs = await getSubscriptions(session)
      setSubscriptions(subs)
      cachedSubscriptions = subs
      cachedDid = session.did
    } catch (err) {
      console.warn('Failed to load subscriptions:', err)
    } finally {
      setLoading(false)
      setLoaded(true)
      loadingRef.current = false
    }
  }, [session])

  // Load on mount if not cached
  useEffect(() => {
    if (!session) return
    if (session.did !== cachedDid || !cachedSubscriptions) {
      fetchSubscriptions()
    }
  }, [session?.did]) // eslint-disable-line react-hooks/exhaustive-deps

  const subscribe = useCallback(async (publicationUri: string, publicationDid: string) => {
    if (!session) return
    const rkey = await subscribeToPublication(session, publicationUri)
    const newSub: Subscription = { rkey, publicationUri, publicationDid }
    setSubscriptions(prev => {
      const updated = [...prev, newSub]
      cachedSubscriptions = updated
      return updated
    })
  }, [session])

  const unsubscribe = useCallback(async (publicationDid: string) => {
    if (!session) return
    const sub = subscriptions.find(s => s.publicationDid === publicationDid)
    if (!sub) return
    await unsubscribeFromPublication(session, sub.rkey)
    setSubscriptions(prev => {
      const updated = prev.filter(s => s.publicationDid !== publicationDid)
      cachedSubscriptions = updated
      return updated
    })
  }, [session, subscriptions])

  const isSubscribed = useCallback((did: string) => {
    return subscriptions.some(s => s.publicationDid === did)
  }, [subscriptions])

  const subscribedDids = subscriptions.map(s => s.publicationDid)

  return {
    subscriptions,
    loading,
    loaded,
    subscribedDids,
    isSubscribed,
    subscribe,
    unsubscribe,
    refresh: fetchSubscriptions,
  }
}
