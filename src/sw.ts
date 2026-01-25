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

cleanupOutdatedCaches()

// Precache app shell (injected by vite-plugin-pwa at build time)
precacheAndRoute(self.__WB_MANIFEST)

// Navigation: NetworkFirst with 3s timeout for SPA shell
const navigationHandler = new NetworkFirst({
  cacheName: 'navigation-cache',
  networkTimeoutSeconds: 3,
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
  ],
})

registerRoute(new NavigationRoute(navigationHandler, {
  denylist: [/\/auth\/callback/],
}))

// OAuth/auth endpoints: NEVER cache
registerRoute(
  ({ url }) =>
    url.pathname.includes('oauth') ||
    url.pathname.includes('.well-known') ||
    url.pathname.includes('client-metadata.json') ||
    url.pathname.includes('/auth/'),
  new NetworkOnly()
)

// Admin endpoints: NEVER cache
registerRoute(
  ({ url }) => url.pathname.includes('/xrpc/app.greengale.admin.'),
  new NetworkOnly()
)

// Fonts: CacheFirst, 1 year TTL
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 365,
        maxEntries: 30,
      }),
    ],
  })
)

// Static images (icons, logos, favicon): CacheFirst, 1 year TTL
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
        maxAgeSeconds: 60 * 60 * 24 * 365,
        maxEntries: 50,
      }),
    ],
  })
)

// PDS blob images (CID-addressed, immutable): CacheFirst, 7 day TTL
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
        maxAgeSeconds: 60 * 60 * 24 * 7,
        maxEntries: 200,
      }),
    ],
  })
)

// API feeds (getRecentPosts, getAuthorPosts, getNetworkPosts): NetworkFirst, 5min cache
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/app.greengale.feed.getRecentPosts') ||
    url.pathname.includes('/xrpc/app.greengale.feed.getAuthorPosts') ||
    url.pathname.includes('/xrpc/app.greengale.feed.getNetworkPosts'),
  new NetworkFirst({
    cacheName: 'api-feed-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 5,
        maxEntries: 50,
      }),
    ],
  })
)

// API profiles: StaleWhileRevalidate, 5min cache
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/app.greengale.actor.getProfile'),
  new StaleWhileRevalidate({
    cacheName: 'api-profile-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 5,
        maxEntries: 100,
      }),
    ],
  })
)

// API single post metadata: StaleWhileRevalidate, 10min cache
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/app.greengale.feed.getPost'),
  new StaleWhileRevalidate({
    cacheName: 'api-post-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 10,
        maxEntries: 100,
      }),
    ],
  })
)

// PDS content (full post records): StaleWhileRevalidate, 30min cache
// Enables offline reading of previously viewed posts
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/com.atproto.repo.getRecord'),
  new StaleWhileRevalidate({
    cacheName: 'pds-content-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 30,
        maxEntries: 50,
      }),
    ],
  })
)

// PDS write operations and other AT Protocol calls: NetworkOnly
registerRoute(
  ({ url }) =>
    url.pathname.includes('/xrpc/com.atproto.') &&
    !url.pathname.includes('/xrpc/com.atproto.repo.getRecord'),
  new NetworkOnly()
)

// Bluesky API (profiles, posts): StaleWhileRevalidate, 5min cache
registerRoute(
  ({ url }) =>
    url.hostname.includes('public.api.bsky.app') ||
    url.hostname.includes('api.bsky.app'),
  new StaleWhileRevalidate({
    cacheName: 'bsky-api-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxAgeSeconds: 60 * 5,
        maxEntries: 100,
      }),
    ],
  })
)

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
