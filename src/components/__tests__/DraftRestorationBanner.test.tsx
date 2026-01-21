/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DraftRestorationBanner } from '../DraftRestorationBanner'

describe('DraftRestorationBanner', () => {
  const mockOnUndo = vi.fn()
  const mockOnDismiss = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders the banner with relative time', () => {
      const savedAt = new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText(/Draft restored from/)).toBeTruthy()
      expect(screen.getByText('5 minutes ago')).toBeTruthy()
    })

    it('renders Undo button', () => {
      render(
        <DraftRestorationBanner
          savedAt={new Date()}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    })

    it('renders Dismiss button', () => {
      render(
        <DraftRestorationBanner
          savedAt={new Date()}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    })
  })

  describe('Interactions', () => {
    it('calls onUndo when Undo button is clicked', () => {
      render(
        <DraftRestorationBanner
          savedAt={new Date()}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(mockOnUndo).toHaveBeenCalledTimes(1)
    })

    it('calls onDismiss when Dismiss button is clicked', () => {
      render(
        <DraftRestorationBanner
          savedAt={new Date()}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

      expect(mockOnDismiss).toHaveBeenCalledTimes(1)
    })
  })

  describe('formatRelativeTime', () => {
    it('shows "just now" for times less than 60 seconds ago', () => {
      const savedAt = new Date(Date.now() - 30 * 1000) // 30 seconds ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('just now')).toBeTruthy()
    })

    it('shows "1 minute ago" for exactly 1 minute', () => {
      const savedAt = new Date(Date.now() - 60 * 1000) // 1 minute ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('1 minute ago')).toBeTruthy()
    })

    it('shows "X minutes ago" for 2-59 minutes', () => {
      const savedAt = new Date(Date.now() - 45 * 60 * 1000) // 45 minutes ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('45 minutes ago')).toBeTruthy()
    })

    it('shows "1 hour ago" for exactly 1 hour', () => {
      const savedAt = new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('1 hour ago')).toBeTruthy()
    })

    it('shows "X hours ago" for 2-23 hours', () => {
      const savedAt = new Date(Date.now() - 5 * 60 * 60 * 1000) // 5 hours ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('5 hours ago')).toBeTruthy()
    })

    it('shows "yesterday" for 24-47 hours', () => {
      const savedAt = new Date(Date.now() - 30 * 60 * 60 * 1000) // 30 hours ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('yesterday')).toBeTruthy()
    })

    it('shows "X days ago" for 2+ days', () => {
      const savedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago

      render(
        <DraftRestorationBanner
          savedAt={savedAt}
          onUndo={mockOnUndo}
          onDismiss={mockOnDismiss}
        />
      )

      expect(screen.getByText('3 days ago')).toBeTruthy()
    })
  })
})
