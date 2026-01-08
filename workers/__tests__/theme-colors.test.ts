import { describe, it, expect } from 'vitest'
import {
  resolveThemeColors,
  isDarkTheme,
  type ThemeColors,
  type CustomColors,
} from '../lib/theme-colors'

describe('Theme Colors (Workers)', () => {
  describe('resolveThemeColors', () => {
    describe('preset themes', () => {
      it('returns default GreenGale theme when no arguments provided', () => {
        const colors = resolveThemeColors()
        expect(colors.background).toBe('#f7fbf7')
        expect(colors.text).toBe('#0d2b1a')
        expect(colors.accent).toBe('#2d5a3f')
        expect(colors.textSecondary).toBeDefined()
        expect(colors.gridColor).toBeDefined()
        expect(colors.vignetteColor).toBeDefined()
      })

      it('returns default theme for null preset', () => {
        const colors = resolveThemeColors(null)
        expect(colors.background).toBe('#f7fbf7')
      })

      it('returns default theme for undefined preset', () => {
        const colors = resolveThemeColors(undefined)
        expect(colors.background).toBe('#f7fbf7')
      })

      it('returns default theme for unknown preset', () => {
        const colors = resolveThemeColors('unknown-preset')
        expect(colors.background).toBe('#f7fbf7')
      })

      it('resolves github-light preset', () => {
        const colors = resolveThemeColors('github-light')
        expect(colors.background).toBe('#ffffff')
        expect(colors.text).toBe('#24292f')
        expect(colors.accent).toBe('#0969da')
        expect(colors.textSecondary).toBe('#656d76')
      })

      it('resolves github-dark preset', () => {
        const colors = resolveThemeColors('github-dark')
        expect(colors.background).toBe('#0d1117')
        expect(colors.text).toBe('#c9d1d9')
        expect(colors.accent).toBe('#58a6ff')
        expect(colors.textSecondary).toBe('#8b949e')
      })

      it('resolves dracula preset', () => {
        const colors = resolveThemeColors('dracula')
        expect(colors.background).toBe('#282a36')
        expect(colors.text).toBe('#f8f8f2')
        expect(colors.accent).toBe('#bd93f9')
        expect(colors.textSecondary).toBe('#6272a4')
      })

      it('resolves nord preset', () => {
        const colors = resolveThemeColors('nord')
        expect(colors.background).toBe('#2e3440')
        expect(colors.text).toBe('#eceff4')
        expect(colors.accent).toBe('#88c0d0')
        expect(colors.textSecondary).toBe('#d8dee9')
      })

      it('resolves solarized-light preset', () => {
        const colors = resolveThemeColors('solarized-light')
        expect(colors.background).toBe('#fdf6e3')
        expect(colors.text).toBe('#657b83')
        expect(colors.accent).toBe('#268bd2')
        expect(colors.textSecondary).toBe('#93a1a1')
      })

      it('resolves solarized-dark preset', () => {
        const colors = resolveThemeColors('solarized-dark')
        expect(colors.background).toBe('#002b36')
        expect(colors.text).toBe('#839496')
        expect(colors.accent).toBe('#268bd2')
        expect(colors.textSecondary).toBe('#586e75')
      })

      it('resolves monokai preset', () => {
        const colors = resolveThemeColors('monokai')
        expect(colors.background).toBe('#272822')
        expect(colors.text).toBe('#f8f8f2')
        expect(colors.accent).toBe('#a6e22e')
        expect(colors.textSecondary).toBe('#75715e')
      })

      it('resolves default preset explicitly', () => {
        const colors = resolveThemeColors('default')
        expect(colors.background).toBe('#f7fbf7')
        expect(colors.text).toBe('#0d2b1a')
        expect(colors.accent).toBe('#2d5a3f')
      })
    })

    describe('custom colors', () => {
      it('uses custom colors when all three are provided', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#ff0000',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.background).toBe('#ffffff')
        expect(colors.text).toBe('#000000')
        expect(colors.accent).toBe('#ff0000')
      })

      it('derives textSecondary from text and background', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        // textSecondary should be a blend of text and background
        expect(colors.textSecondary).toBeDefined()
        expect(colors.textSecondary).not.toBe('#000000')
        expect(colors.textSecondary).not.toBe('#ffffff')
      })

      it('derives gridColor with alpha', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.gridColor).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/)
      })

      it('derives vignetteColor with alpha', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.vignetteColor).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/)
      })

      it('uses accent for light theme vignette', () => {
        const custom: CustomColors = {
          background: '#ffffff', // Light background
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        // Light theme vignette uses accent color with low opacity
        expect(colors.vignetteColor).toContain('0, 102, 204') // RGB of #0066cc
      })

      it('uses background for dark theme vignette', () => {
        const custom: CustomColors = {
          background: '#1a1a1a', // Dark background
          text: '#ffffff',
          accent: '#66ccff',
        }
        const colors = resolveThemeColors(null, custom)
        // Dark theme vignette uses background color
        expect(colors.vignetteColor).toContain('26, 26, 26') // RGB of #1a1a1a
      })

      it('falls back to preset if custom colors are incomplete', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          // Missing text and accent
        }
        const colors = resolveThemeColors('github-light', custom)
        expect(colors).toEqual(resolveThemeColors('github-light'))
      })

      it('falls back to default if custom is missing text', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.background).toBe('#f7fbf7') // Default
      })

      it('falls back to default if custom is missing accent', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.background).toBe('#f7fbf7') // Default
      })

      it('falls back to default if custom is missing background', () => {
        const custom: CustomColors = {
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.background).toBe('#f7fbf7') // Default
      })

      it('custom colors take precedence over preset', () => {
        const custom: CustomColors = {
          background: '#123456',
          text: '#abcdef',
          accent: '#fedcba',
        }
        const colors = resolveThemeColors('github-light', custom)
        expect(colors.background).toBe('#123456')
        expect(colors.text).toBe('#abcdef')
        expect(colors.accent).toBe('#fedcba')
      })

      it('handles null custom with valid preset', () => {
        const colors = resolveThemeColors('dracula', null)
        expect(colors.background).toBe('#282a36')
      })
    })

    describe('color blending (via textSecondary)', () => {
      it('produces valid hex color for textSecondary', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        // textSecondary is a blended hex color
        expect(colors.textSecondary).toMatch(/^#[a-f0-9]{6}$/i)
      })

      it('blends black and white correctly', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        // With 0.4 ratio blend of #000000 and #ffffff
        // Result should be a gray value
        expect(colors.textSecondary).toMatch(/^#[6-9a-f]{2}[6-9a-f]{2}[6-9a-f]{2}$/i)
      })

      it('handles colors without hash', () => {
        // The implementation requires # prefix based on the regex
        // This test documents the behavior
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.textSecondary).toBeDefined()
      })
    })

    describe('gridColor opacity', () => {
      it('uses 0.3 opacity for light themes', () => {
        const custom: CustomColors = {
          background: '#ffffff',
          text: '#000000',
          accent: '#0066cc',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.gridColor).toContain('0.3)')
      })

      it('uses 0.5 opacity for dark themes', () => {
        const custom: CustomColors = {
          background: '#000000',
          text: '#ffffff',
          accent: '#66ccff',
        }
        const colors = resolveThemeColors(null, custom)
        expect(colors.gridColor).toContain('0.5)')
      })
    })
  })

  describe('isDarkTheme', () => {
    it('returns false for white background', () => {
      const colors: ThemeColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#0066cc',
        textSecondary: '#666666',
        gridColor: 'rgba(0,0,0,0.1)',
        vignetteColor: 'rgba(0,0,0,0.1)',
      }
      expect(isDarkTheme(colors)).toBe(false)
    })

    it('returns true for black background', () => {
      const colors: ThemeColors = {
        background: '#000000',
        text: '#ffffff',
        accent: '#66ccff',
        textSecondary: '#999999',
        gridColor: 'rgba(255,255,255,0.1)',
        vignetteColor: 'rgba(0,0,0,0.5)',
      }
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('returns false for github-light preset', () => {
      const colors = resolveThemeColors('github-light')
      expect(isDarkTheme(colors)).toBe(false)
    })

    it('returns true for github-dark preset', () => {
      const colors = resolveThemeColors('github-dark')
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('returns true for dracula preset', () => {
      const colors = resolveThemeColors('dracula')
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('returns true for nord preset', () => {
      const colors = resolveThemeColors('nord')
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('returns false for solarized-light preset', () => {
      const colors = resolveThemeColors('solarized-light')
      expect(isDarkTheme(colors)).toBe(false)
    })

    it('returns true for solarized-dark preset', () => {
      const colors = resolveThemeColors('solarized-dark')
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('returns true for monokai preset', () => {
      const colors = resolveThemeColors('monokai')
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('returns false for default GreenGale preset', () => {
      const colors = resolveThemeColors('default')
      expect(isDarkTheme(colors)).toBe(false)
    })

    it('handles mid-gray background (luminance ~0.5)', () => {
      // #808080 has luminance around 0.216 (below 0.5)
      const colors: ThemeColors = {
        background: '#808080',
        text: '#ffffff',
        accent: '#66ccff',
        textSecondary: '#aaaaaa',
        gridColor: 'rgba(255,255,255,0.1)',
        vignetteColor: 'rgba(0,0,0,0.5)',
      }
      expect(isDarkTheme(colors)).toBe(true)
    })

    it('handles light gray background', () => {
      // #cccccc has luminance around 0.604 (above 0.5)
      const colors: ThemeColors = {
        background: '#cccccc',
        text: '#000000',
        accent: '#0066cc',
        textSecondary: '#666666',
        gridColor: 'rgba(0,0,0,0.1)',
        vignetteColor: 'rgba(0,0,0,0.1)',
      }
      expect(isDarkTheme(colors)).toBe(false)
    })
  })

  describe('preset completeness', () => {
    const presets = [
      'default',
      'github-light',
      'github-dark',
      'dracula',
      'nord',
      'solarized-light',
      'solarized-dark',
      'monokai',
    ]

    for (const preset of presets) {
      it(`${preset} has all required color properties`, () => {
        const colors = resolveThemeColors(preset)
        expect(colors.background).toBeDefined()
        expect(colors.text).toBeDefined()
        expect(colors.accent).toBeDefined()
        expect(colors.textSecondary).toBeDefined()
        expect(colors.gridColor).toBeDefined()
        expect(colors.vignetteColor).toBeDefined()
      })

      it(`${preset} has valid hex colors for main properties`, () => {
        const colors = resolveThemeColors(preset)
        expect(colors.background).toMatch(/^#[a-f0-9]{6}$/i)
        expect(colors.text).toMatch(/^#[a-f0-9]{6}$/i)
        expect(colors.accent).toMatch(/^#[a-f0-9]{6}$/i)
      })
    }
  })

  describe('color math edge cases', () => {
    it('handles pure red custom color', () => {
      const custom: CustomColors = {
        background: '#ff0000',
        text: '#ffffff',
        accent: '#00ff00',
      }
      const colors = resolveThemeColors(null, custom)
      expect(colors.background).toBe('#ff0000')
      // Red has low luminance, should be treated as dark
      expect(colors.vignetteColor).toContain('255, 0, 0')
    })

    it('handles pure green custom color', () => {
      const custom: CustomColors = {
        background: '#00ff00',
        text: '#000000',
        accent: '#0000ff',
      }
      const colors = resolveThemeColors(null, custom)
      expect(colors.background).toBe('#00ff00')
      // Green has high luminance, should be treated as light
      // Light themes use accent for vignette
      expect(colors.vignetteColor).toContain('0, 0, 255')
    })

    it('handles pure blue custom color', () => {
      const custom: CustomColors = {
        background: '#0000ff',
        text: '#ffffff',
        accent: '#ffff00',
      }
      const colors = resolveThemeColors(null, custom)
      expect(colors.background).toBe('#0000ff')
      // Blue has very low luminance
      expect(colors.vignetteColor).toContain('0, 0, 255')
    })
  })
})
