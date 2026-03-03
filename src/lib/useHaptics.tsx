import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { WebHaptics } from 'web-haptics'
import type { HapticInput, TriggerOptions } from 'web-haptics'

const STORAGE_KEY = 'haptics-enabled'

interface HapticsContextValue {
  trigger: (input?: HapticInput, options?: TriggerOptions) => void
  isSupported: boolean
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

const HapticsContext = createContext<HapticsContextValue>({
  trigger: () => {},
  isSupported: false,
  enabled: true,
  setEnabled: () => {},
})

function getStoredPreference(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

export function HapticsProvider({ children }: { children: ReactNode }) {
  const instanceRef = useRef<WebHaptics | null>(null)
  const [enabled, setEnabledState] = useState(getStoredPreference)

  useEffect(() => {
    instanceRef.current = new WebHaptics()
    return () => {
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
  }, [])

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
    try {
      localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // ignore
    }
  }, [])

  const trigger = useCallback(
    (input?: HapticInput, options?: TriggerOptions) => {
      if (!enabled) return
      instanceRef.current?.trigger(input, options)
    },
    [enabled],
  )

  return (
    <HapticsContext.Provider
      value={{
        trigger,
        isSupported: WebHaptics.isSupported,
        enabled,
        setEnabled,
      }}
    >
      {children}
    </HapticsContext.Provider>
  )
}

export function useHaptics() {
  return useContext(HapticsContext)
}
