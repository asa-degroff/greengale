/**
 * Hook for persisting TTS settings to localStorage.
 * Settings include voice, pitch, playback speed, and auto-scroll preference.
 */

import { useState, useCallback } from 'react'
import type { PlaybackRate, PitchRate } from './tts'
import { DEFAULT_VOICE, PLAYBACK_RATES, PITCH_RATES } from './tts'

const STORAGE_KEY = 'tts-settings'

export interface TTSSettings {
  voice: string
  pitch: PitchRate
  speed: PlaybackRate
  autoScroll: boolean
}

const DEFAULT_SETTINGS: TTSSettings = {
  voice: DEFAULT_VOICE,
  pitch: 1.0,
  speed: 1.0,
  autoScroll: true,
}

function loadSettings(): TTSSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored)

    // Validate each field and use defaults for invalid values
    return {
      voice: typeof parsed.voice === 'string' && parsed.voice ? parsed.voice : DEFAULT_SETTINGS.voice,
      pitch: PITCH_RATES.includes(parsed.pitch) ? parsed.pitch : DEFAULT_SETTINGS.pitch,
      speed: PLAYBACK_RATES.includes(parsed.speed) ? parsed.speed : DEFAULT_SETTINGS.speed,
      autoScroll: typeof parsed.autoScroll === 'boolean' ? parsed.autoScroll : DEFAULT_SETTINGS.autoScroll,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: TTSSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage not available (private browsing, quota exceeded, etc.)
  }
}

export function useTTSSettings() {
  const [settings, setSettingsState] = useState<TTSSettings>(loadSettings)

  const setVoice = useCallback((voice: string) => {
    setSettingsState((prev) => {
      const next = { ...prev, voice }
      saveSettings(next)
      return next
    })
  }, [])

  const setPitch = useCallback((pitch: PitchRate) => {
    setSettingsState((prev) => {
      const next = { ...prev, pitch }
      saveSettings(next)
      return next
    })
  }, [])

  const setSpeed = useCallback((speed: PlaybackRate) => {
    setSettingsState((prev) => {
      const next = { ...prev, speed }
      saveSettings(next)
      return next
    })
  }, [])

  const setAutoScroll = useCallback((autoScroll: boolean) => {
    setSettingsState((prev) => {
      const next = { ...prev, autoScroll }
      saveSettings(next)
      return next
    })
  }, [])

  return {
    settings,
    setVoice,
    setPitch,
    setSpeed,
    setAutoScroll,
  }
}
