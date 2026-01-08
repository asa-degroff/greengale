-- E2E Test Seed Data
-- This data is used by Playwright E2E tests

-- Test author
INSERT OR REPLACE INTO authors (did, handle, display_name, description, avatar_url, pds_endpoint, posts_count, updated_at)
VALUES (
  'did:plc:e2etestauthor123',
  'test.bsky.social',
  'Test Author',
  'A test author for E2E testing',
  'https://cdn.bsky.app/img/avatar/plain/did:plc:e2etestauthor123/bafkreitest@jpeg',
  'https://bsky.social',
  3,
  datetime('now')
);

-- Test posts
INSERT OR REPLACE INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, indexed_at, content_preview, has_latex, theme_preset)
VALUES (
  'at://did:plc:e2etestauthor123/app.greengale.document/test-post-1',
  'did:plc:e2etestauthor123',
  'test-post-1',
  'First Test Post',
  'A subtitle for the first test post',
  'first-test-post',
  'greengale',
  'public',
  datetime('now', '-1 day'),
  datetime('now'),
  'This is a preview of the first test post content...',
  0,
  'default'
);

INSERT OR REPLACE INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, indexed_at, content_preview, has_latex, theme_preset)
VALUES (
  'at://did:plc:e2etestauthor123/app.greengale.document/test-post-2',
  'did:plc:e2etestauthor123',
  'test-post-2',
  'Second Test Post with Code',
  'This post has code blocks',
  'second-test-post',
  'greengale',
  'public',
  datetime('now', '-2 hours'),
  datetime('now'),
  'This post demonstrates code syntax highlighting...',
  0,
  'github-dark'
);

INSERT OR REPLACE INTO posts (uri, author_did, rkey, title, subtitle, slug, source, visibility, created_at, indexed_at, content_preview, has_latex, theme_preset)
VALUES (
  'at://did:plc:e2etestauthor123/app.greengale.document/test-post-3',
  'did:plc:e2etestauthor123',
  'test-post-3',
  'Third Test Post with LaTeX',
  'Mathematical content',
  'third-test-post',
  'greengale',
  'public',
  datetime('now', '-30 minutes'),
  datetime('now'),
  'This post contains LaTeX equations like E = mc^2...',
  1,
  'default'
);

-- Test publication
INSERT OR REPLACE INTO publications (author_did, name, description, theme_preset, url, enable_site_standard, updated_at)
VALUES (
  'did:plc:e2etestauthor123',
  'Test Blog',
  'A test blog for E2E testing',
  'default',
  'https://greengale.pages.dev/test.bsky.social',
  1,
  datetime('now')
);
