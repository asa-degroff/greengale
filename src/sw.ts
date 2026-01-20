/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import {
  NetworkFirst,
  CacheFirst,
  StaleWhileRevalidate,
  NetworkOnly,
} from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

// Clean up old caches from previous versions
cleanupOutdatedCaches()

// Precache app shell (injected by vite-plugin-pwa at build time)
precacheAndRoute(self.__WB_MANIFEST)

// Navigation requests - serve app shell for SPA routing
const navigationHandler = new NetworkFirst({
  cacheName: 'navigation-cache',
  networkTimeoutSeconds: 3,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
  ],
})

registerRoute(new NavigationRoute(navigationHandler, {
  // Don't cache OAuth callback - must always go to network
  denylist: [/\/auth\/callback/],
}))

// OAuth and auth endpoints - NEVER cache
registerRoute(
  ({ url }) =>
    url.pathname.includes('oauth') ||
    url.pathname.includes('.well-known') ||
    url.pathname.includes('client-metadata.json') ||
    url.pathname.includes('/auth/'),
  new NetworkOnly()
)

// Fonts - cache first, long TTL
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        maxEntries: 30,
      }),
    ],
  })
)

// Our static images (icons, logos) - cache first
registerRoute(
  ({ url, request }) =>
    request.destination === 'image' &&
    (url.pathname.startsWith('/icons/') ||
      url.pathname.includes('logo') ||
      url.pathname.includes('favicon')),
  new CacheFirst({
    cacheName: 'static-images-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        maxEntries: 50,
      }),
    ],
  })
)

// External blob images (from PDS) - cache first with shorter TTL
// These are immutable by CID so safe to cache
registerRoute(
  ({ url, request }) =>
    request.destination === 'image' &&
    (url.hostname.includes('bsky.') ||
      url.hostname.includes('atproto.') ||
      url.hostname.includes('cdn.bsky.')),
  new CacheFirst({
    cacheName: 'blob-images-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
        maxEntries: 200,
      }),
    ],
  })
)

// API: Recent posts and author posts - network first with cache fallback
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/app.greengale.feed.getRecentPosts') ||
    url.pathname.includes('/xrpc/app.greengale.feed.getAuthorPosts'),
  new NetworkFirst({
    cacheName: 'api-feed-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 5, // 5 minutes
        maxEntries: 50,
      }),
    ],
  })
)

// API: Profiles - stale while revalidate
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/app.greengale.actor.getProfile'),
  new StaleWhileRevalidate({
    cacheName: 'api-profile-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 5, // 5 minutes
        maxEntries: 100,
      }),
    ],
  })
)

// API: Single post metadata - stale while revalidate
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/app.greengale.feed.getPost'),
  new StaleWhileRevalidate({
    cacheName: 'api-post-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 10, // 10 minutes
        maxEntries: 100,
      }),
    ],
  })
)

// PDS content (full post content) - network only
// These can change and are cross-origin, don't cache
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/com.atproto.') ||
    url.hostname.includes('.host.bsky.network'),
  new NetworkOnly()
)

// Admin endpoints - never cache
registerRoute(
  ({ url }) => url.pathname.includes('/xrpc/app.greengale.admin.'),
  new NetworkOnly()
)

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
