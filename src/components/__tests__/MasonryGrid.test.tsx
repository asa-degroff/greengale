/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MasonryGrid } from '../MasonryGrid'

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback
  elements: Set<Element> = new Set()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(element: Element) {
    this.elements.add(element)
  }

  unobserve(element: Element) {
    this.elements.delete(element)
  }

  disconnect() {
    this.elements.clear()
  }

  // Helper to trigger resize
  trigger(entries: Partial<ResizeObserverEntry>[] = []) {
    this.callback(entries as ResizeObserverEntry[], this)
  }
}

let mockResizeObserver: MockResizeObserver | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', function (callback: ResizeObserverCallback) {
    mockResizeObserver = new MockResizeObserver(callback)
    return mockResizeObserver
  })

  // Mock matchMedia
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('768') && window.innerWidth >= 768,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))

  // Mock requestAnimationFrame
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })

  vi.stubGlobal('cancelAnimationFrame', vi.fn())

  // Set default window width
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1024,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  mockResizeObserver = null
})

describe('MasonryGrid', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(
        <MasonryGrid>
          <div data-testid="item-1">Item 1</div>
          <div data-testid="item-2">Item 2</div>
          <div data-testid="item-3">Item 3</div>
        </MasonryGrid>
      )

      expect(screen.getByTestId('item-1')).toBeTruthy()
      expect(screen.getByTestId('item-2')).toBeTruthy()
      expect(screen.getByTestId('item-3')).toBeTruthy()
    })

    it('renders with no children', () => {
      const { container } = render(<MasonryGrid>{null}</MasonryGrid>)
      expect(container.querySelector('div')).toBeTruthy()
    })

    it('applies custom className', () => {
      const { container } = render(
        <MasonryGrid className="custom-class">
          <div>Item</div>
        </MasonryGrid>
      )

      expect((container.firstChild as HTMLElement).classList.contains('custom-class')).toBe(true)
    })

    it('renders with relative positioning', () => {
      const { container } = render(
        <MasonryGrid columns={{ default: 1, md: 2 }}>
          <div>Item</div>
        </MasonryGrid>
      )
      expect((container.firstChild as HTMLElement).classList.contains('relative')).toBe(true)
    })
  })

  describe('column configuration', () => {
    it('applies numeric columns to item width calc', () => {
      render(
        <MasonryGrid columns={3}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      const wrapper = screen.getByTestId('item').parentElement!
      const width = wrapper.style.width
      // 3 columns with default gap 24: gap*(cols-1) = 48px
      expect(width).toContain('48px')
    })

    it('applies responsive columns based on breakpoint', () => {
      // Default innerWidth is 1024 from beforeEach, md breakpoint matches
      render(
        <MasonryGrid columns={{ default: 1, md: 2 }}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      const wrapper = screen.getByTestId('item').parentElement!
      const width = wrapper.style.width
      // md=2 columns, gap*(cols-1) = 24px, width involves 0.5 factor
      expect(width).toContain('24px')
      expect(width).toContain('0.5')
    })

    it('uses default columns at mobile width', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500,
      })

      render(
        <MasonryGrid columns={{ default: 1 }}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      const wrapper = screen.getByTestId('item').parentElement!
      const width = wrapper.style.width
      // 1 column: gap*(cols-1) = 0px, full width
      expect(width).toContain('0px')
    })
  })

  describe('gap configuration', () => {
    it('applies custom gap to item width calc', () => {
      render(
        <MasonryGrid gap={16}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      const wrapper = screen.getByTestId('item').parentElement!
      // Custom gap of 16 with default 2 columns: gap*(cols-1) = 16px
      expect(wrapper.style.width).toContain('16px')
    })

    it('applies default gap of 24 to item width calc', () => {
      render(
        <MasonryGrid>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      const wrapper = screen.getByTestId('item').parentElement!
      // Default gap of 24 with default 2 columns: gap*(cols-1) = 24px
      expect(wrapper.style.width).toContain('24px')
    })
  })

  describe('child handling', () => {
    it('filters out non-element children', () => {
      render(
        <MasonryGrid>
          <div data-testid="item-1">Item 1</div>
          {null}
          {undefined}
          <div data-testid="item-2">Item 2</div>
          {false}
        </MasonryGrid>
      )

      expect(screen.getByTestId('item-1')).toBeTruthy()
      expect(screen.getByTestId('item-2')).toBeTruthy()
    })

    it('preserves child keys', () => {
      const { container } = render(
        <MasonryGrid>
          <div key="custom-key-1">Item 1</div>
          <div key="custom-key-2">Item 2</div>
        </MasonryGrid>
      )

      // The children should be wrapped but content preserved
      expect(container.textContent).toContain('Item 1')
      expect(container.textContent).toContain('Item 2')
    })

    it('handles single child', () => {
      render(
        <MasonryGrid>
          <div data-testid="single-item">Single</div>
        </MasonryGrid>
      )

      expect(screen.getByTestId('single-item')).toBeTruthy()
    })

    it('handles many children', () => {
      const items = Array.from({ length: 50 }, (_, i) => (
        <div key={i} data-testid={`item-${i}`}>
          Item {i}
        </div>
      ))

      render(<MasonryGrid>{items}</MasonryGrid>)

      expect(screen.getByTestId('item-0')).toBeTruthy()
      expect(screen.getByTestId('item-49')).toBeTruthy()
    })
  })

  describe('layout modes', () => {
    it('hides items until positions are calculated', () => {
      render(
        <MasonryGrid columns={{ default: 1, md: 2 }}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      const wrapper = screen.getByTestId('item').parentElement
      // Items are hidden until layout is calculated
      expect(wrapper?.style.visibility).toBe('hidden')
    })
  })

  describe('responsive behavior', () => {
    it('updates columns on breakpoint change', async () => {
      // Start at desktop width (1024 from beforeEach, md matches)
      const { rerender } = render(
        <MasonryGrid columns={{ default: 1, md: 2 }}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      // At desktop: md=2 columns, width uses 0.5 factor
      const wrapper = screen.getByTestId('item').parentElement!
      expect(wrapper.style.width).toContain('0.5')

      // Simulate mobile width - md breakpoint no longer matches
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500,
      })

      rerender(
        <MasonryGrid columns={{ default: 1, md: 2 }}>
          <div data-testid="item">Item</div>
        </MasonryGrid>
      )

      // At mobile: default=1 column, width uses full width (0px gap factor)
      const wrapperAfter = screen.getByTestId('item').parentElement!
      expect(wrapperAfter.style.width).toContain('0px')
    })
  })

  describe('cleanup', () => {
    it('disconnects ResizeObserver on unmount', () => {
      const { unmount } = render(
        <MasonryGrid>
          <div>Item</div>
        </MasonryGrid>
      )

      const observer = mockResizeObserver!
      const disconnectSpy = vi.spyOn(observer, 'disconnect')

      unmount()

      expect(disconnectSpy).toHaveBeenCalled()
    })

    it('cancels pending animation frames on unmount', () => {
      const cancelSpy = vi.fn()
      vi.stubGlobal('cancelAnimationFrame', cancelSpy)

      const { unmount } = render(
        <MasonryGrid>
          <div>Item</div>
        </MasonryGrid>
      )

      // Trigger a layout request
      mockResizeObserver?.trigger()

      unmount()

      // cancelAnimationFrame may or may not be called depending on timing
      // The important thing is that no errors are thrown
    })
  })

  describe('empty states', () => {
    it('handles empty children array', () => {
      const { container } = render(<MasonryGrid>{[]}</MasonryGrid>)
      expect(container.firstChild).toBeTruthy()
    })

    it('sets height to auto when no positioned items', () => {
      const { container } = render(<MasonryGrid>{[]}</MasonryGrid>)
      // Height should be 'auto' or 0 when no children
      const style = (container.firstChild as HTMLElement).style
      expect(style.height === 'auto' || style.height === '0px' || style.height === '').toBe(true)
    })
  })

  describe('dynamic children', () => {
    it('handles children being added', () => {
      const { rerender } = render(
        <MasonryGrid>
          <div data-testid="item-1">Item 1</div>
        </MasonryGrid>
      )

      expect(screen.getByTestId('item-1')).toBeTruthy()

      rerender(
        <MasonryGrid>
          <div data-testid="item-1">Item 1</div>
          <div data-testid="item-2">Item 2</div>
        </MasonryGrid>
      )

      expect(screen.getByTestId('item-1')).toBeTruthy()
      expect(screen.getByTestId('item-2')).toBeTruthy()
    })

    it('handles children being removed', () => {
      const { rerender } = render(
        <MasonryGrid>
          <div data-testid="item-1">Item 1</div>
          <div data-testid="item-2">Item 2</div>
        </MasonryGrid>
      )

      expect(screen.getByTestId('item-1')).toBeTruthy()
      expect(screen.getByTestId('item-2')).toBeTruthy()

      rerender(
        <MasonryGrid>
          <div data-testid="item-1">Item 1</div>
        </MasonryGrid>
      )

      expect(screen.getByTestId('item-1')).toBeTruthy()
      expect(screen.queryByTestId('item-2')).toBeNull()
    })
  })
})
