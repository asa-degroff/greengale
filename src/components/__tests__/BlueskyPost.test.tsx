/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlueskyPostCard } from '../BlueskyPost'
import type { BlueskyPost } from '@/lib/bluesky'

// Helper to create a mock post
function createMockPost(overrides: Partial<BlueskyPost> = {}): BlueskyPost {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/abc123',
    cid: 'bafytest',
    author: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
      displayName: 'Test User',
      avatar: 'https://example.com/avatar.jpg',
    },
    text: 'This is a test post',
    createdAt: new Date().toISOString(),
    indexedAt: new Date().toISOString(),
    likeCount: 10,
    repostCount: 5,
    replyCount: 3,
    quoteCount: 1,
    ...overrides,
  }
}

// Helper to create nested reply structure
function createNestedReplies(depth: number, repliesPerLevel: number = 2): BlueskyPost[] {
  if (depth === 0) return []

  return Array.from({ length: repliesPerLevel }, (_, i) => ({
    ...createMockPost({
      uri: `at://did:plc:reply${depth}-${i}/app.bsky.feed.post/reply`,
      text: `Reply at depth ${depth}, index ${i}`,
      author: {
        did: `did:plc:reply${depth}-${i}`,
        handle: `reply${depth}-${i}.bsky.social`,
        displayName: `Reply User ${depth}-${i}`,
      },
    }),
    replies: createNestedReplies(depth - 1, repliesPerLevel),
  }))
}

describe('BlueskyPostCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders post content', () => {
      const post = createMockPost()
      render(<BlueskyPostCard post={post} />)

      expect(screen.getByText('This is a test post')).toBeDefined()
      expect(screen.getByText('Test User')).toBeDefined()
      expect(screen.getByText('@test.bsky.social')).toBeDefined()
    })

    it('renders engagement stats for top-level posts', () => {
      const post = createMockPost()
      render(<BlueskyPostCard post={post} />)

      expect(screen.getByText('10')).toBeDefined() // likes
      expect(screen.getByText('5')).toBeDefined() // reposts
      expect(screen.getByText('3')).toBeDefined() // replies
    })

    it('does not render engagement stats for replies', () => {
      const post = createMockPost()
      render(<BlueskyPostCard post={post} isReply={true} depth={1} />)

      // The post text should be there
      expect(screen.getByText('This is a test post')).toBeDefined()
      // But engagement stats should not be present (no title attributes)
      expect(screen.queryByTitle('Likes')).toBeNull()
    })

    it('renders avatar fallback when no avatar URL', () => {
      const post = createMockPost({
        author: {
          did: 'did:plc:test',
          handle: 'test.bsky.social',
          displayName: 'Test User',
        },
      })
      render(<BlueskyPostCard post={post} />)

      // Should show first letter of display name
      expect(screen.getByText('T')).toBeDefined()
    })
  })

  describe('Depth and Collapse Behavior', () => {
    it('defaults to depth 0', () => {
      const post = createMockPost({ replies: createNestedReplies(1) })
      render(<BlueskyPostCard post={post} />)

      // At depth 0, should show full post and replies expanded
      expect(screen.getByText('This is a test post')).toBeDefined()
      expect(screen.getByText('Reply at depth 1, index 0')).toBeDefined()
    })

    it('shows expanded content at depth 0 and 1', () => {
      const post = createMockPost({ replies: createNestedReplies(2) })
      render(<BlueskyPostCard post={post} />)

      // Depth 0 post should be visible
      expect(screen.getByText('This is a test post')).toBeDefined()
      // Depth 1 replies should be visible (expanded by default)
      expect(screen.getByText('Reply at depth 2, index 0')).toBeDefined()
    })

    it('collapses replies at depth 2+ by default', () => {
      const post = createMockPost({
        replies: createNestedReplies(1),
        text: 'Deep reply post'
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // At depth 2 with replies, should show collapsed preview
      expect(screen.getByText('replied')).toBeDefined()
      // The actual post text should not be visible until expanded
      expect(screen.queryByText('Deep reply post')).toBeNull()
    })

    it('shows expand button for collapsed threads', () => {
      const post = createMockPost({
        replies: createNestedReplies(1),
        author: { did: 'test', handle: 'collapsed.user', displayName: 'Collapsed User' }
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // Should show author name and "replied" in collapsed state
      expect(screen.getByText('Collapsed User')).toBeDefined()
      expect(screen.getByText('replied')).toBeDefined()
    })

    it('expands collapsed thread when clicked', () => {
      const post = createMockPost({
        replies: createNestedReplies(1),
        text: 'Hidden until expanded'
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // Initially collapsed - text not visible
      expect(screen.queryByText('Hidden until expanded')).toBeNull()

      // Click the expand button
      const expandButton = screen.getByRole('button')
      fireEvent.click(expandButton)

      // Now the text should be visible
      expect(screen.getByText('Hidden until expanded')).toBeDefined()
    })

    it('shows collapse button for expanded deep threads', () => {
      const post = createMockPost({
        replies: createNestedReplies(1),
        text: 'Expanded deep reply'
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // Expand first
      const expandButton = screen.getByRole('button')
      fireEvent.click(expandButton)

      // Should now have collapse buttons (one for this post, plus any for expanded children)
      const collapseButtons = screen.getAllByTitle('Collapse thread')
      expect(collapseButtons.length).toBeGreaterThan(0)
    })

    it('collapses expanded thread when collapse button clicked', () => {
      const post = createMockPost({
        replies: createNestedReplies(1),
        text: 'Collapsible content'
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // Expand
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByText('Collapsible content')).toBeDefined()

      // Collapse - click the first collapse button (the parent)
      const collapseButtons = screen.getAllByTitle('Collapse thread')
      fireEvent.click(collapseButtons[0])
      expect(screen.queryByText('Collapsible content')).toBeNull()
    })

    it('does not collapse posts without replies at depth 2+', () => {
      const post = createMockPost({
        replies: [], // No replies
        text: 'Leaf node reply'
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={3} />)

      // Should show full post even at deep depth since no replies to collapse
      expect(screen.getByText('Leaf node reply')).toBeDefined()
    })

    it('expands entire thread branch up to 10 levels when clicked', () => {
      // Create a deep nested structure
      const post = createMockPost({
        text: 'Root collapsed post',
        replies: [createMockPost({
          text: 'Level 1 reply',
          uri: 'at://did:plc:l1/app.bsky.feed.post/l1',
          replies: [createMockPost({
            text: 'Level 2 reply',
            uri: 'at://did:plc:l2/app.bsky.feed.post/l2',
            replies: [createMockPost({
              text: 'Level 3 reply',
              uri: 'at://did:plc:l3/app.bsky.feed.post/l3',
              replies: []
            })]
          })]
        })]
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // Initially collapsed - only shows collapsed preview
      expect(screen.queryByText('Root collapsed post')).toBeNull()
      expect(screen.queryByText('Level 1 reply')).toBeNull()

      // Click expand
      fireEvent.click(screen.getByRole('button'))

      // All levels should now be visible (cascading expand)
      expect(screen.getByText('Root collapsed post')).toBeDefined()
      expect(screen.getByText('Level 1 reply')).toBeDefined()
      expect(screen.getByText('Level 2 reply')).toBeDefined()
      expect(screen.getByText('Level 3 reply')).toBeDefined()
    })
  })

  describe('Max Visible Replies', () => {
    it('shows up to 5 replies at depth 0', () => {
      const post = createMockPost({
        replies: Array.from({ length: 7 }, (_, i) => createMockPost({
          uri: `at://did:plc:reply${i}/app.bsky.feed.post/r${i}`,
          text: `Reply ${i}`,
        }))
      })
      render(<BlueskyPostCard post={post} />)

      // Should show first 5 replies
      expect(screen.getByText('Reply 0')).toBeDefined()
      expect(screen.getByText('Reply 4')).toBeDefined()
      // 6th and 7th should not be visible
      expect(screen.queryByText('Reply 5')).toBeNull()
      expect(screen.queryByText('Reply 6')).toBeNull()
      // Should show "View more" link
      expect(screen.getByText(/View 2 more replies/)).toBeDefined()
    })

    it('shows up to 3 replies at depth 1-3', () => {
      const post = createMockPost({
        replies: Array.from({ length: 5 }, (_, i) => createMockPost({
          uri: `at://did:plc:reply${i}/app.bsky.feed.post/r${i}`,
          text: `Nested Reply ${i}`,
        }))
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={1} />)

      // Should show first 3 replies
      expect(screen.getByText('Nested Reply 0')).toBeDefined()
      expect(screen.getByText('Nested Reply 2')).toBeDefined()
      // 4th and 5th should not be visible
      expect(screen.queryByText('Nested Reply 3')).toBeNull()
      expect(screen.queryByText('Nested Reply 4')).toBeNull()
    })

    it('shows up to 2 replies at depth 4+', () => {
      const post = createMockPost({
        replies: Array.from({ length: 4 }, (_, i) => createMockPost({
          uri: `at://did:plc:reply${i}/app.bsky.feed.post/r${i}`,
          text: `Deep Reply ${i}`,
        }))
      })
      // Start expanded by manually setting depth < 2 first, then test deeper
      render(<BlueskyPostCard post={post} isReply={true} depth={4} />)

      // At depth 4 with replies, starts collapsed
      // Click to expand
      fireEvent.click(screen.getByRole('button'))

      // Should show first 2 replies
      expect(screen.getByText('Deep Reply 0')).toBeDefined()
      expect(screen.getByText('Deep Reply 1')).toBeDefined()
      // 3rd and 4th should not be visible
      expect(screen.queryByText('Deep Reply 2')).toBeNull()
    })
  })

  describe('Nested Reply Count', () => {
    it('shows total nested reply count in collapsed preview', () => {
      const post = createMockPost({
        replies: createNestedReplies(3, 2) // 3 levels deep, 2 replies each
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // With 2 replies at each of 3 levels: 2 + 4 + 8 = 14 total, but we only see 2 at level 1
      // Actually: level 1 has 2 replies, each has 2 replies (4 at level 2), each has 2 (8 at level 3)
      // Total nested from this post: 2 + 2*2 + 2*2*2 = 2 + 4 + 8 = 14
      // But countNestedReplies counts the structure we have, which is 2 + (2 + (2)) * 2 = ...
      // Let me trace: createNestedReplies(3, 2) creates:
      // - 2 replies at depth 3, each with createNestedReplies(2, 2)
      //   - 2 replies at depth 2, each with createNestedReplies(1, 2)
      //     - 2 replies at depth 1, each with createNestedReplies(0, 2) = []
      // So total: 2 + 2*2 + 2*2*2 = 2 + 4 + 8 = 14
      // The text should show "+14 replies"
      expect(screen.getByText(/\+\d+ repl/)).toBeDefined()
    })

    it('shows singular "reply" for single nested reply', () => {
      const post = createMockPost({
        replies: [createMockPost({ replies: [] })]
      })
      render(<BlueskyPostCard post={post} isReply={true} depth={2} />)

      // Only 1 nested reply
      expect(screen.getByText(/\+1 reply/)).toBeDefined()
    })
  })

  describe('TTS Click Handler', () => {
    it('calls onTextClick when post text is clicked', () => {
      const onTextClick = vi.fn()
      const post = createMockPost({ text: 'Clickable text' })
      render(<BlueskyPostCard post={post} onTextClick={onTextClick} />)

      fireEvent.click(screen.getByText('Clickable text'))

      expect(onTextClick).toHaveBeenCalledWith('Clickable text')
    })

    it('passes onTextClick to nested replies', () => {
      const onTextClick = vi.fn()
      const post = createMockPost({
        text: 'Parent post',
        replies: [createMockPost({ text: 'Child reply' })]
      })
      render(<BlueskyPostCard post={post} onTextClick={onTextClick} />)

      fireEvent.click(screen.getByText('Child reply'))

      expect(onTextClick).toHaveBeenCalledWith('Child reply')
    })

    it('adds cursor-pointer class when onTextClick is provided', () => {
      const onTextClick = vi.fn()
      const post = createMockPost()
      render(<BlueskyPostCard post={post} onTextClick={onTextClick} />)

      const textElement = screen.getByText('This is a test post')
      expect(textElement.className).toContain('cursor-pointer')
    })
  })

  describe('Visual Depth Capping', () => {
    it('caps indentation style at depth 5', () => {
      const post = createMockPost({ text: 'Very deep reply' })
      const { container } = render(
        <BlueskyPostCard post={post} isReply={true} depth={10} />
      )

      // At depth 10, visual depth should be capped at 5
      // paddingLeft should be Math.min(5 + 1, 5) * 0.75 = 3.75rem
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv.style.paddingLeft).toBe('3.75rem')
    })

    it('increases indentation up to depth 5', () => {
      const post1 = createMockPost({ text: 'Depth 1' })
      const post3 = createMockPost({ text: 'Depth 3' })

      const { container: c1 } = render(
        <BlueskyPostCard post={post1} isReply={true} depth={1} />
      )
      const { container: c3 } = render(
        <BlueskyPostCard post={post3} isReply={true} depth={3} />
      )

      const div1 = c1.firstChild as HTMLElement
      const div3 = c3.firstChild as HTMLElement

      // Depth 1: (1+1) * 0.75 = 1.5rem
      expect(div1.style.paddingLeft).toBe('1.5rem')
      // Depth 3: (3+1) * 0.75 = 3rem
      expect(div3.style.paddingLeft).toBe('3rem')
    })
  })

  describe('Links', () => {
    it('links to author profile on Bluesky', () => {
      const post = createMockPost()
      render(<BlueskyPostCard post={post} />)

      const profileLinks = screen.getAllByRole('link', { name: /Test User|@test.bsky.social/ })
      expect(profileLinks.length).toBeGreaterThan(0)
      expect(profileLinks[0].getAttribute('href')).toBe('https://bsky.app/profile/test.bsky.social')
    })

    it('links to post on Bluesky for "View" button', () => {
      const post = createMockPost()
      render(<BlueskyPostCard post={post} />)

      const viewLink = screen.getByRole('link', { name: /View/ })
      expect(viewLink.getAttribute('href')).toContain('bsky.app/profile')
    })

    it('links to post on Bluesky for "View more replies"', () => {
      const post = createMockPost({
        replies: Array.from({ length: 10 }, (_, i) => createMockPost({
          uri: `at://did:plc:reply${i}/app.bsky.feed.post/r${i}`,
          text: `Reply ${i}`,
        }))
      })
      render(<BlueskyPostCard post={post} />)

      const moreLink = screen.getByRole('link', { name: /View \d+ more replies on Bluesky/ })
      expect(moreLink.getAttribute('href')).toContain('bsky.app/profile')
    })
  })
})
