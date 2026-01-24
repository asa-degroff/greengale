import { useState, useEffect } from 'react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'

export function OfflineIndicator() {
  const { isOnline, wasOffline } = useNetworkStatus()
  const [showReconnected, setShowReconnected] = useState(false)

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true)
      const timer = setTimeout(() => setShowReconnected(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isOnline, wasOffline])

  if (isOnline && !showReconnected) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      {!isOnline && (
        <div className="mt-2 px-4 py-2 bg-amber-600 text-white text-sm rounded-full shadow-lg pointer-events-auto flex items-center gap-2">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728" />
            <line x1="2" y1="2" x2="22" y2="22" strokeLinecap="round" />
          </svg>
          You're offline
        </div>
      )}
      {isOnline && showReconnected && (
        <div className="mt-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-full shadow-lg pointer-events-auto flex items-center gap-2 animate-fade-in">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Back online
        </div>
      )}
    </div>
  )
}
