/* eslint-disable */
// Based off of https://github.com/pwa-builder/PWABuilder/blob/main/docs/sw.js

/*
      Welcome to our basic Service Worker! This Service Worker offers a basic offline experience
      while also being easily customizeable. You can add in your own code to implement the capabilities
      listed below, or change anything else you would like.

      Need an introduction to Service Workers? Check our docs here: https://docs.pwabuilder.com/#/home/sw-intro
      Want to learn more about how our Service Worker generation works? Check our docs here: https://docs.pwabuilder.com/#/studio/existing-app?id=add-a-service-worker

      Did you know that Service Workers offer many more capabilities than just offline?
        - Background Sync: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/06
        - Periodic Background Sync: https://web.dev/periodic-background-sync/
        - Push Notifications: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/07?id=push-notifications-on-the-web
        - Badges: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/07?id=application-badges
    */

const CACHE_NAME = 'pwa-cache-v2'
const TILE_PATH_PREFIX = '/maps/fdtj/'

// Pre-cached map assets. Derived deterministically from the 4x4 grid in
// build-map-tiles.ts — keep this list in sync if grid dimensions change.
const MAP_ROWS = 4
const MAP_COLS = 4
const RASTER_TIERS = [1, 2]
const buildMapAssetList = () => {
  const urls = [
    `${TILE_PATH_PREFIX}manifest.json`,
    `${TILE_PATH_PREFIX}points.json`,
    `${TILE_PATH_PREFIX}preview.webp`
  ]
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      urls.push(`${TILE_PATH_PREFIX}tile-${r}-${c}.svg`)
      for (const t of RASTER_TIERS) {
        urls.push(`${TILE_PATH_PREFIX}tile-${r}-${c}@${t}x.webp`)
      }
    }
  }
  return urls
}

const HOSTNAME_WHITELIST = [
  self.location.hostname,
  `api.${self.location.hostname}`,
  'fonts.gstatic.com',
  'fonts.googleapis.com',
  'cdn.jsdelivr.net'
]

// The Util Function to hack URLs of intercepted requests
const getFixedUrl = (req) => {
  var now = Date.now()
  var url = new URL(req.url)

  // 1. fixed http URL
  // Just keep syncing with location.protocol
  // fetch(httpURL) belongs to active mixed content.
  // And fetch(httpRequest) is not supported yet.
  url.protocol = self.location.protocol

  // 2. add query for caching-busting.
  // Github Pages served with Cache-Control: max-age=600
  // max-age on mutable content is error-prone, with SW life of bugs can even extend.
  // Until cache mode of Fetch API landed, we have to workaround cache-busting with query string.
  // Cache-Control-Bug: https://bugs.chromium.org/p/chromium/issues/detail?id=453190
  if (url.hostname === self.location.hostname) {
    url.search += (url.search ? '&' : '?') + 'cache-bust=' + now
  }
  return url.href
}

/**
 *  @Lifecycle Install
 *  Pre-cache the full set of map tile assets so the map works offline after the
 *  first visit. cache.addAll is atomic — a single failure rolls back the batch,
 *  so a partial-cache state is impossible.
 */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      await cache.addAll(buildMapAssetList())
    } catch (err) {
      // Don't block install if a tile asset isn't available yet (e.g. dev
      // server before the build script has run). The runtime cache-first
      // handler will fill in entries on first fetch.
      console.warn('[sw] map pre-cache failed (continuing):', err)
    }
    await self.skipWaiting()
  })())
})

/**
     *  @Lifecycle Activate
     *  New one activated when old isnt being used.
     *
     *  waitUntil(): activating ====> activated
     */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

/**
 * Cache-first handler for immutable tile assets. These have long-lived
 * Cache-Control headers and identical content for the lifetime of CACHE_NAME,
 * so we skip the network entirely once cached.
 */
const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone()).catch(() => {})
    return response
  } catch (err) {
    // Offline + uncached — return a synthetic 504 so the renderer's onerror
    // path runs instead of stalling on a hung fetch.
    return new Response('', { status: 504, statusText: 'tile unavailable offline' })
  }
}

/**
     *  @Functional Fetch
     *  All network requests are being intercepted here.
     *
     *  void respondWith(Promise<Response> r)
     */
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Exclude Vite-related requests from caching
  if (requestUrl.pathname.includes('__vite')) {
    return;
  }

  // Exclude React Router virtual requests from caching
  if (requestUrl.pathname.startsWith('/@id/__x00__virtual:react-router')) {
    return;
  }

  // Tile assets: cache-first. They're immutable for the lifetime of this SW
  // version, so network revalidation is wasted bytes.
  if (
    requestUrl.hostname === self.location.hostname
    && requestUrl.pathname.startsWith(TILE_PATH_PREFIX)
  ) {
    event.respondWith(cacheFirst(event.request))
    return
  }

  // Skip some of cross-origin requests, like those for Google Analytics.
  if (HOSTNAME_WHITELIST.indexOf(requestUrl.hostname) > -1) {
    // Stale-while-revalidate
    // similar to HTTP's stale-while-revalidate: https://www.mnot.net/blog/2007/12/12/stale
    // Upgrade from Jake's to Surma's: https://gist.github.com/surma/eb441223daaedf880801ad80006389f1
    const cached = caches.match(event.request)
    const fixedUrl = getFixedUrl(event.request)
    const fetched = fetch(fixedUrl, { cache: 'no-store' })
    const fetchedCopy = fetched.then(resp => resp.clone())

    // Call respondWith() with whatever we get first.
    // If the fetch fails (e.g disconnected), wait for the cache.
    // If there’s nothing in cache, wait for the fetch.
    // If neither yields a response, return offline pages.
    event.respondWith(
      Promise.race([fetched.catch(_ => cached), cached])
        .then(resp => resp || fetched)
        .catch((_) => { /* eat any errors */ })
    )

    // Update the cache with the version we fetched (only for ok status)
    event.waitUntil(
      Promise.all([fetchedCopy, caches.open(CACHE_NAME)])
        .then(([response, cache]) => response.ok && cache.put(event.request, response))
        .catch((_) => { /* eat any errors */ })
    )
  }
})
