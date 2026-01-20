/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

// Mock the appview module
vi.mock('@/lib/appview', () => ({
  searchPublications: vi.fn(),
}))

// Import after mocking
import { PublicationSearch } from '../PublicationSearch'
import { searchPublications } from '@/lib/appview'

const mockSearchPublications = searchPublications as ReturnType<typeof vi.fn>

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn()

// Sample search results
const mockResults = [
  {
    did: 'did:plc:user1',
    handle: 'alice.bsky.social',
    displayName: 'Alice',
    avatarUrl: 'https://example.com/alice.jpg',
    publication: { name: 'Alice Blog', url: 'https://alice.blog' },
    matchType: 'handle' as const,
  },
  {
    did: 'did:plc:user2',
    handle: 'bob.bsky.social',
    displayName: 'Bob Smith',
    avatarUrl: null,
    publication: { name: 'Tech Blog', url: 'https://tech.blog' },
    matchType: 'displayName' as const,
  },
  {
    did: 'did:plc:user3',
    handle: 'carol.bsky.social',
    displayName: null,
    avatarUrl: null,
    publication: null,
    matchType: 'handle' as const,
  },
]

// Helper to type in input and trigger debounce
async function typeAndWait(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } })
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
}

describe('PublicationSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockSearchPublications.mockResolvedValue({ results: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('renders input with default placeholder', () => {
      render(<PublicationSearch />)

      const input = screen.getByPlaceholderText('Search posts, authors, or publications...')
      expect(input).toBeDefined()
    })

    it('renders input with custom placeholder', () => {
      render(<PublicationSearch placeholder="Find a blog..." />)

      const input = screen.getByPlaceholderText('Find a blog...')
      expect(input).toBeDefined()
    })

    it('applies custom className', () => {
      const { container } = render(<PublicationSearch className="custom-class" />)

      expect((container.firstChild as HTMLElement).className).toContain('custom-class')
    })
  })

  describe('Minimum Query Length', () => {
    it('does not search for single character queries', async () => {
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'a')

      expect(mockSearchPublications).not.toHaveBeenCalled()
    })

    it('does not search for empty queries', async () => {
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, '  ')

      expect(mockSearchPublications).not.toHaveBeenCalled()
    })

    it('searches for queries with 2 or more characters', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'al')

      expect(mockSearchPublications).toHaveBeenCalledWith('al', 10)
    })
  })

  describe('Debouncing', () => {
    it('debounces search requests by 300ms', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: 'test' } })

      // Should not have called yet
      expect(mockSearchPublications).not.toHaveBeenCalled()

      // Advance past debounce time
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(mockSearchPublications).toHaveBeenCalledTimes(1)
    })

    it('cancels previous debounce when typing continues', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')

      // Type 'te', wait 200ms, then type 'st'
      fireEvent.change(input, { target: { value: 'te' } })
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      fireEvent.change(input, { target: { value: 'test' } })
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      // Should only search for the final value
      expect(mockSearchPublications).toHaveBeenCalledTimes(1)
      expect(mockSearchPublications).toHaveBeenCalledWith('test', 10)
    })
  })

  describe('Search Results Display', () => {
    it('displays search results in dropdown', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()
      expect(screen.getByText('@alice.bsky.social')).toBeDefined()
      expect(screen.getByText('Bob Smith')).toBeDefined()
    })

    it('displays avatar when available', async () => {
      mockSearchPublications.mockResolvedValue({ results: [mockResults[0]] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'alice')

      // Find the avatar image by its src attribute
      const avatar = document.querySelector('img[src="https://example.com/alice.jpg"]')
      expect(avatar).not.toBeNull()
    })

    it('displays placeholder when no avatar', async () => {
      mockSearchPublications.mockResolvedValue({ results: [mockResults[2]] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'carol')

      // Should show handle as display name when displayName is null
      expect(screen.getByText('carol.bsky.social')).toBeDefined()
    })

    it('displays match type badges', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getAllByText('Handle').length).toBeGreaterThan(0)
      expect(screen.getByText('Name')).toBeDefined()
    })

    it('does not show dropdown when no results', async () => {
      mockSearchPublications.mockResolvedValue({ results: [] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'nonexistent')

      expect(mockSearchPublications).toHaveBeenCalled()
      // Dropdown should not exist
      expect(screen.queryByRole('button', { name: /alice/i })).toBeNull()
    })
  })

  describe('Loading State', () => {
    it('shows loading spinner while searching', async () => {
      // Create a promise we can control
      let resolveSearch!: (value: { results: typeof mockResults }) => void
      const searchPromise = new Promise<{ results: typeof mockResults }>(resolve => {
        resolveSearch = resolve
      })
      mockSearchPublications.mockReturnValue(searchPromise)

      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: 'test' } })

      // Advance past debounce - this triggers the search call
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      // Should show spinner while promise is pending
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).not.toBeNull()

      // Resolve the search and let React process the state update
      await act(async () => {
        resolveSearch({ results: mockResults })
        // Flush microtasks
        await Promise.resolve()
      })

      // Spinner should disappear after resolution
      const spinnerAfter = document.querySelector('.animate-spin')
      expect(spinnerAfter).toBeNull()
    })
  })

  describe('Result Selection', () => {
    it('navigates to author page on click', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'alice')

      expect(screen.getByText('Alice')).toBeDefined()

      const resultButton = screen.getByText('Alice').closest('button')!
      fireEvent.click(resultButton)

      expect(mockNavigate).toHaveBeenCalledWith('/alice.bsky.social')
    })

    it('clears input after selection', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox') as HTMLInputElement
      await typeAndWait(input, 'alice')

      expect(screen.getByText('Alice')).toBeDefined()

      const resultButton = screen.getByText('Alice').closest('button')!
      fireEvent.click(resultButton)

      expect(input.value).toBe('')
    })
  })

  describe('Keyboard Navigation', () => {
    it('navigates down with ArrowDown', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      // Press ArrowDown
      fireEvent.keyDown(input, { key: 'ArrowDown' })

      // First item should be selected (has bg-secondary class)
      const firstButton = screen.getByText('Alice').closest('button')!
      expect(firstButton.className).toContain('bg-[var(--site-bg-secondary)]')
    })

    it('navigates up with ArrowUp', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      // Navigate down twice, then up once
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowUp' })

      // First item should be selected
      const firstButton = screen.getByText('Alice').closest('button')!
      expect(firstButton.className).toContain('bg-[var(--site-bg-secondary)]')
    })

    it('selects result with Enter', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      // Select first item and press Enter
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mockNavigate).toHaveBeenCalledWith('/alice.bsky.social')
    })

    it('closes dropdown with Escape', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      fireEvent.keyDown(input, { key: 'Escape' })

      // Dropdown should be closed
      expect(screen.queryByText('Alice')).toBeNull()
    })

    it('navigates to search page on Enter when dropdown closed', async () => {
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      // Type without triggering search (under min length initially, then immediate enter)
      fireEvent.change(input, { target: { value: 'someuser.bsky.social' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mockNavigate).toHaveBeenCalledWith('/search?q=someuser.bsky.social')
    })

    it('preserves @ in search query', async () => {
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: '@user.bsky.social' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mockNavigate).toHaveBeenCalledWith('/search?q=%40user.bsky.social')
    })
  })

  describe('Click Outside', () => {
    it('closes dropdown when clicking outside', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(
        <div>
          <PublicationSearch />
          <button data-testid="outside">Outside</button>
        </div>
      )

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside'))

      expect(screen.queryByText('Alice')).toBeNull()
    })

    it('keeps dropdown open when clicking inside', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      // Click on the input (inside)
      fireEvent.mouseDown(input)

      // Dropdown should still be open
      expect(screen.getByText('Alice')).toBeDefined()
    })
  })

  describe('Focus Behavior', () => {
    it('reopens dropdown on focus if results exist', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Alice')).toBeDefined()

      // Close with Escape
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(screen.queryByText('Alice')).toBeNull()

      // Focus input again
      fireEvent.focus(input)

      // Dropdown should reopen
      expect(screen.getByText('Alice')).toBeDefined()
    })
  })

  describe('Mouse Hover', () => {
    it('updates selection on mouse hover', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(screen.getByText('Bob Smith')).toBeDefined()

      // Hover over second result
      const secondButton = screen.getByText('Bob Smith').closest('button')!
      fireEvent.mouseEnter(secondButton)

      // Second item should be selected
      expect(secondButton.className).toContain('bg-[var(--site-bg-secondary)]')
    })
  })

  describe('Error Handling', () => {
    it('handles search errors gracefully', async () => {
      mockSearchPublications.mockRejectedValue(new Error('Network error'))
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      expect(mockSearchPublications).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /alice/i })).toBeNull()
    })
  })

  describe('Match Type Display', () => {
    it('shows publication name for publicationName match type', async () => {
      const pubNameResult = {
        did: 'did:plc:pub',
        handle: 'publisher.bsky.social',
        displayName: 'Publisher',
        avatarUrl: null,
        publication: { name: 'Tech Weekly', url: 'https://tech.weekly' },
        matchType: 'publicationName' as const,
      }
      mockSearchPublications.mockResolvedValue({ results: [pubNameResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'tech')

      expect(screen.getByText('Tech Weekly')).toBeDefined()
      expect(screen.getByText('Publication')).toBeDefined()
    })

    it('shows publication URL for publicationUrl match type', async () => {
      const pubUrlResult = {
        did: 'did:plc:url',
        handle: 'blogger.bsky.social',
        displayName: 'Blogger',
        avatarUrl: null,
        publication: { name: 'My Blog', url: 'https://myblog.example.com' },
        matchType: 'publicationUrl' as const,
      }
      mockSearchPublications.mockResolvedValue({ results: [pubUrlResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'example')

      expect(screen.getByText('https://myblog.example.com')).toBeDefined()
      expect(screen.getByText('URL')).toBeDefined()
    })
  })

  describe('Scroll Into View', () => {
    it('scrolls selected item into view on keyboard navigation', async () => {
      mockSearchPublications.mockResolvedValue({ results: mockResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      // Navigate down
      fireEvent.keyDown(input, { key: 'ArrowDown' })

      // scrollIntoView should have been called
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })
  })

  describe('Post Title Search', () => {
    const postResult = {
      did: 'did:plc:post',
      handle: 'author.bsky.social',
      displayName: 'Post Author',
      avatarUrl: null,
      publication: null,
      matchType: 'postTitle' as const,
      post: {
        rkey: '3abc123',
        title: 'My Awesome Blog Post',
      },
    }

    it('displays post title for postTitle match type', async () => {
      mockSearchPublications.mockResolvedValue({ results: [postResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'awesome')

      expect(screen.getByText('My Awesome Blog Post')).toBeDefined()
      expect(screen.getByText('Post')).toBeDefined()
    })

    it('shows Post badge with correct color', async () => {
      mockSearchPublications.mockResolvedValue({ results: [postResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'awesome')

      const badge = screen.getByText('Post')
      expect(badge.className).toContain('bg-cyan')
    })

    it('navigates to post page on click', async () => {
      mockSearchPublications.mockResolvedValue({ results: [postResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'awesome')

      const resultButton = screen.getByText('My Awesome Blog Post').closest('button')!
      fireEvent.click(resultButton)

      expect(mockNavigate).toHaveBeenCalledWith('/author.bsky.social/3abc123')
    })

    it('navigates to post page on Enter key', async () => {
      mockSearchPublications.mockResolvedValue({ results: [postResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'awesome')

      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mockNavigate).toHaveBeenCalledWith('/author.bsky.social/3abc123')
    })

    it('shows document icon for post results', async () => {
      mockSearchPublications.mockResolvedValue({ results: [postResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'awesome')

      // Post results should show a document icon (rounded-lg box instead of rounded-full)
      const iconContainer = document.querySelector('.rounded-lg.bg-\\[var\\(--site-border\\)\\]')
      expect(iconContainer).not.toBeNull()
    })

    it('displays author handle below post title', async () => {
      mockSearchPublications.mockResolvedValue({ results: [postResult] })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'awesome')

      expect(screen.getByText('@author.bsky.social')).toBeDefined()
    })

    it('handles mixed author and post results', async () => {
      const mixedResults = [
        mockResults[0], // alice - handle match
        postResult,     // post match
      ]
      mockSearchPublications.mockResolvedValue({ results: mixedResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'test')

      // Both should be visible
      expect(screen.getByText('Alice')).toBeDefined()
      expect(screen.getByText('My Awesome Blog Post')).toBeDefined()

      // Click on post result
      const postButton = screen.getByText('My Awesome Blog Post').closest('button')!
      fireEvent.click(postButton)

      // Should navigate to post, not author
      expect(mockNavigate).toHaveBeenCalledWith('/author.bsky.social/3abc123')
    })

    it('uses unique keys for multiple posts from same author', async () => {
      const multiplePostResults = [
        { ...postResult, post: { rkey: 'post1', title: 'First Post' } },
        { ...postResult, post: { rkey: 'post2', title: 'Second Post' } },
      ]
      mockSearchPublications.mockResolvedValue({ results: multiplePostResults })
      render(<PublicationSearch />)

      const input = screen.getByRole('combobox')
      await typeAndWait(input, 'post')

      // Both posts should be displayed
      expect(screen.getByText('First Post')).toBeDefined()
      expect(screen.getByText('Second Post')).toBeDefined()
    })
  })
})
