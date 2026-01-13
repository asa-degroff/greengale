/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTTSSettings, type TTSSettings } from '../useTTSSettings'
import { DEFAULT_VOICE } from '../tts'

describe('useTTSSettings', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('Default Values', () => {
    it('returns default settings when localStorage is empty', () => {
      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings).toEqual({
        voice: DEFAULT_VOICE,
        pitch: 1.0,
        speed: 1.0,
        autoScroll: true,
      })
    })

    it('has autoScroll enabled by default', () => {
      const { result } = renderHook(() => useTTSSettings())
      expect(result.current.settings.autoScroll).toBe(true)
    })
  })

  describe('Loading Settings', () => {
    it('loads settings from localStorage', () => {
      const savedSettings: TTSSettings = {
        voice: 'af_sky',
        pitch: 1.1,
        speed: 1.5,
        autoScroll: false,
      }
      localStorage.setItem('tts-settings', JSON.stringify(savedSettings))

      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings).toEqual(savedSettings)
    })

    it('uses default for missing autoScroll field (migration)', () => {
      // Simulate old settings without autoScroll
      const oldSettings = {
        voice: 'af_sky',
        pitch: 1.1,
        speed: 1.5,
      }
      localStorage.setItem('tts-settings', JSON.stringify(oldSettings))

      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings.voice).toBe('af_sky')
      expect(result.current.settings.autoScroll).toBe(true) // Default value
    })

    it('handles invalid JSON in localStorage', () => {
      localStorage.setItem('tts-settings', 'invalid json')

      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings).toEqual({
        voice: DEFAULT_VOICE,
        pitch: 1.0,
        speed: 1.0,
        autoScroll: true,
      })
    })

    it('validates pitch value', () => {
      const invalidSettings = {
        voice: 'af_sky',
        pitch: 999, // Invalid
        speed: 1.0,
        autoScroll: true,
      }
      localStorage.setItem('tts-settings', JSON.stringify(invalidSettings))

      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings.pitch).toBe(1.0) // Falls back to default
    })

    it('validates speed value', () => {
      const invalidSettings = {
        voice: 'af_sky',
        pitch: 1.0,
        speed: 999, // Invalid
        autoScroll: true,
      }
      localStorage.setItem('tts-settings', JSON.stringify(invalidSettings))

      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings.speed).toBe(1.0) // Falls back to default
    })

    it('validates autoScroll is boolean', () => {
      const invalidSettings = {
        voice: 'af_sky',
        pitch: 1.0,
        speed: 1.0,
        autoScroll: 'yes', // Invalid - should be boolean
      }
      localStorage.setItem('tts-settings', JSON.stringify(invalidSettings))

      const { result } = renderHook(() => useTTSSettings())

      expect(result.current.settings.autoScroll).toBe(true) // Falls back to default
    })
  })

  describe('setAutoScroll', () => {
    it('updates autoScroll setting', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setAutoScroll(false)
      })

      expect(result.current.settings.autoScroll).toBe(false)
    })

    it('persists autoScroll to localStorage', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setAutoScroll(false)
      })

      const stored = JSON.parse(localStorage.getItem('tts-settings') || '{}')
      expect(stored.autoScroll).toBe(false)
    })

    it('preserves other settings when updating autoScroll', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setVoice('af_sky')
        result.current.setPitch(1.1)
        result.current.setSpeed(1.5)
      })

      act(() => {
        result.current.setAutoScroll(false)
      })

      expect(result.current.settings).toEqual({
        voice: 'af_sky',
        pitch: 1.1,
        speed: 1.5,
        autoScroll: false,
      })
    })
  })

  describe('setVoice', () => {
    it('updates voice setting', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setVoice('af_sky')
      })

      expect(result.current.settings.voice).toBe('af_sky')
    })

    it('persists to localStorage', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setVoice('af_sky')
      })

      const stored = JSON.parse(localStorage.getItem('tts-settings') || '{}')
      expect(stored.voice).toBe('af_sky')
    })
  })

  describe('setPitch', () => {
    it('updates pitch setting', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setPitch(1.1)
      })

      expect(result.current.settings.pitch).toBe(1.1)
    })
  })

  describe('setSpeed', () => {
    it('updates speed setting', () => {
      const { result } = renderHook(() => useTTSSettings())

      act(() => {
        result.current.setSpeed(1.5)
      })

      expect(result.current.settings.speed).toBe(1.5)
    })
  })
})
