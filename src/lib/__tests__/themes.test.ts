import { describe, it, expect } from 'vitest'
import {
  getContrastRatio,
  checkContrast,
  validateCustomColors,
  correctCustomColorsContrast,
  deriveThemeColors,
  getPresetColors,
  THEME_PRESETS,
  type CustomColors,
} from '../themes'

describe('Theme System', () => {
  describe('getContrastRatio', () => {
    it('returns 21:1 for black on white', () => {
      const ratio = getContrastRatio('#000000', '#ffffff')
      expect(ratio).not.toBeNull()
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('returns 1:1 for same colors', () => {
      const ratio = getContrastRatio('#ff0000', '#ff0000')
      expect(ratio).not.toBeNull()
      expect(ratio).toBeCloseTo(1, 0)
    })

    it('handles hex colors without hash', () => {
      const ratio = getContrastRatio('000000', 'ffffff')
      expect(ratio).not.toBeNull()
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('handles CSS color names', () => {
      const ratio = getContrastRatio('black', 'white')
      expect(ratio).not.toBeNull()
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('handles rgb() format', () => {
      const ratio = getContrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')
      expect(ratio).not.toBeNull()
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('returns null for invalid colors', () => {
      const ratio = getContrastRatio('notacolor', '#ffffff')
      expect(ratio).toBeNull()
    })

    it('is symmetric (order does not matter)', () => {
      const ratio1 = getContrastRatio('#000000', '#ffffff')
      const ratio2 = getContrastRatio('#ffffff', '#000000')
      expect(ratio1).toEqual(ratio2)
    })
  })

  describe('checkContrast', () => {
    it('returns AAA level for 7:1+ contrast', () => {
      const result = checkContrast('#000000', '#ffffff')
      expect(result).not.toBeNull()
      expect(result!.level).toBe('AAA')
      expect(result!.passes).toBe(true)
    })

    it('returns AA level for 4.5:1 - 7:1 contrast', () => {
      // Gray on white has ~4.5:1 contrast
      const result = checkContrast('#767676', '#ffffff')
      expect(result).not.toBeNull()
      expect(result!.level).toBe('AA')
      expect(result!.passes).toBe(true)
    })

    it('returns AA-large level for 3:1 - 4.5:1 contrast', () => {
      // #808080 (gray) on white has ~3.9:1 contrast
      const result = checkContrast('#808080', '#ffffff')
      expect(result).not.toBeNull()
      expect(result!.level).toBe('AA-large')
      expect(result!.passes).toBe(false)
    })

    it('returns fail level for <3:1 contrast', () => {
      // Very light gray on white has <3:1 contrast
      const result = checkContrast('#cccccc', '#ffffff')
      expect(result).not.toBeNull()
      expect(result!.level).toBe('fail')
      expect(result!.passes).toBe(false)
    })

    it('returns null for invalid colors', () => {
      const result = checkContrast('invalid', '#ffffff')
      expect(result).toBeNull()
    })
  })

  describe('validateCustomColors', () => {
    it('validates good contrast colors', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#0066cc',
      }
      const result = validateCustomColors(colors)
      expect(result.isValid).toBe(true)
      expect(result.textContrast?.passes).toBe(true)
      expect(result.accentContrast).not.toBeNull()
    })

    it('fails for low contrast text', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#cccccc', // Too light
        accent: '#0066cc',
      }
      const result = validateCustomColors(colors)
      expect(result.isValid).toBe(false)
      expect(result.textContrast?.passes).toBe(false)
    })

    it('fails for low contrast accent', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#ffff00', // Yellow on white is low contrast
      }
      const result = validateCustomColors(colors)
      expect(result.isValid).toBe(false)
      expect(result.accentContrast!.ratio).toBeLessThan(3)
    })

    it('handles missing colors gracefully', () => {
      const colors: CustomColors = {
        background: '#ffffff',
      }
      const result = validateCustomColors(colors)
      expect(result.textContrast).toBeNull()
      expect(result.accentContrast).toBeNull()
    })
  })

  describe('correctCustomColorsContrast', () => {
    it('returns original colors if already meeting contrast', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#0066cc',
      }
      const corrected = correctCustomColorsContrast(colors)
      expect(corrected.text).toBe('#000000')
      expect(corrected.accent).toBe('#0066cc')
    })

    it('adjusts low contrast text to meet 4.5:1', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#cccccc', // Too light
        accent: '#0066cc',
      }
      const corrected = correctCustomColorsContrast(colors)

      // Check the corrected text now meets contrast
      const contrast = checkContrast(corrected.text!, colors.background!)
      expect(contrast).not.toBeNull()
      expect(contrast!.passes).toBe(true)
    })

    it('adjusts low contrast accent to meet 3:1', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#ffff00', // Yellow is low contrast
      }
      const corrected = correctCustomColorsContrast(colors)

      // Check the corrected accent now meets 3:1
      const ratio = getContrastRatio(corrected.accent!, colors.background!)
      expect(ratio).not.toBeNull()
      expect(ratio!).toBeGreaterThanOrEqual(3)
    })

    it('handles missing background gracefully', () => {
      const colors: CustomColors = {
        text: '#000000',
        accent: '#0066cc',
      }
      const corrected = correctCustomColorsContrast(colors)
      expect(corrected).toEqual(colors)
    })

    it('works with dark backgrounds', () => {
      const colors: CustomColors = {
        background: '#1a1a1a',
        text: '#333333', // Too dark on dark bg
        accent: '#0066cc',
      }
      const corrected = correctCustomColorsContrast(colors)

      // Check the corrected text now meets contrast
      const contrast = checkContrast(corrected.text!, colors.background!)
      expect(contrast).not.toBeNull()
      expect(contrast!.passes).toBe(true)
    })
  })

  describe('deriveThemeColors', () => {
    it('derives full color palette from 3 colors', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#0066cc',
      }
      const derived = deriveThemeColors(colors)

      expect(derived).not.toBeNull()
      expect(derived!.background).toBe('#ffffff')
      expect(derived!.text).toBe('#000000')
      expect(derived!.accent).toBe('#0066cc')
      expect(derived!.textSecondary).toBeDefined()
      expect(derived!.border).toBeDefined()
      expect(derived!.codeBackground).toBeDefined()
      expect(derived!.link).toBe('#0066cc')
      expect(derived!.linkHover).toBeDefined()
    })

    it('uses custom code background if provided', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        text: '#000000',
        accent: '#0066cc',
        codeBackground: '#f0f0f0',
      }
      const derived = deriveThemeColors(colors)

      expect(derived).not.toBeNull()
      expect(derived!.codeBackground).toBe('#f0f0f0')
    })

    it('returns null for incomplete colors', () => {
      const colors: CustomColors = {
        background: '#ffffff',
        // Missing text and accent
      }
      const derived = deriveThemeColors(colors)
      expect(derived).toBeNull()
    })

    it('returns null for invalid colors', () => {
      const colors: CustomColors = {
        background: 'notacolor',
        text: '#000000',
        accent: '#0066cc',
      }
      const derived = deriveThemeColors(colors)
      expect(derived).toBeNull()
    })

    it('works with dark theme colors', () => {
      const colors: CustomColors = {
        background: '#1a1a1a',
        text: '#ffffff',
        accent: '#66ccff',
      }
      const derived = deriveThemeColors(colors)

      expect(derived).not.toBeNull()
      // Text secondary should be between text and bg
      expect(derived!.textSecondary).toBeDefined()
      // Border should be lighter than bg for dark themes
      expect(derived!.border).toBeDefined()
    })
  })

  describe('getPresetColors', () => {
    it('returns colors for github-light preset', () => {
      const colors = getPresetColors('github-light')
      expect(colors.background).toBe('#ffffff')
      expect(colors.text).toBe('#24292f')
      expect(colors.accent).toBe('#0969da')
    })

    it('returns colors for github-dark preset', () => {
      const colors = getPresetColors('github-dark')
      expect(colors.background).toBe('#0d1117')
      expect(colors.text).toBe('#c9d1d9')
      expect(colors.accent).toBe('#58a6ff')
    })

    it('returns github-light colors for default preset', () => {
      const colors = getPresetColors('default')
      expect(colors).toEqual(getPresetColors('github-light'))
    })

    it('returns dark default colors for custom preset', () => {
      const colors = getPresetColors('custom')
      expect(colors.background).toBe('#0c0908')
      expect(colors.text).toBe('#ebf4ff')
      expect(colors.accent).toBe('#2e7f4d')
    })

    it('returns valid colors for all presets', () => {
      for (const preset of THEME_PRESETS) {
        const colors = getPresetColors(preset)
        expect(colors.background).toBeDefined()
        expect(colors.text).toBeDefined()
        expect(colors.accent).toBeDefined()
        expect(colors.link).toBeDefined()
        expect(colors.codeBackground).toBeDefined()
      }
    })
  })

  describe('THEME_PRESETS', () => {
    it('contains all expected presets', () => {
      expect(THEME_PRESETS).toContain('default')
      expect(THEME_PRESETS).toContain('github-light')
      expect(THEME_PRESETS).toContain('github-dark')
      expect(THEME_PRESETS).toContain('dracula')
      expect(THEME_PRESETS).toContain('nord')
      expect(THEME_PRESETS).toContain('solarized-light')
      expect(THEME_PRESETS).toContain('solarized-dark')
      expect(THEME_PRESETS).toContain('monokai')
      expect(THEME_PRESETS).toContain('custom')
    })

    it('has 9 presets', () => {
      expect(THEME_PRESETS).toHaveLength(9)
    })
  })

  describe('Preset Contrast Validation', () => {
    it('all presets meet WCAG AA contrast requirements', () => {
      const presetsToTest = THEME_PRESETS.filter(p => p !== 'default' && p !== 'custom')

      for (const preset of presetsToTest) {
        const colors = getPresetColors(preset)
        const textContrast = checkContrast(colors.background, colors.text)

        expect(textContrast).not.toBeNull()
        expect(textContrast!.passes).toBe(true)
      }
    })
  })
})
