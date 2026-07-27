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

// Bump this if and only if tile or preview *bytes* change — i.e. whenever
// build-map-tiles.ts regenerates the grid. After the cache-first split below,
// those are the only assets frozen for the lifetime of this cache, and a bump
// costs every user a ~27 MB re-download of the full tile set.
const CACHE_NAME = 'pwa-cache-v3'
const TILE_PATH_PREFIX = '/maps/fdtj/'

// Pre-cached map assets. Derived deterministically from the 4x4 grid in
// build-map-tiles.ts — keep this list in sync if grid dimensions change.
//
// Only genuinely-immutable, stable-URL assets belong here. Both JSON files
// under /maps/fdtj/ are deliberately absent:
//   - points.json is edited constantly. It now lives at app/data/points.json
//     and is imported with `?url`, so Vite content-hashes it into /assets/.
//     There is no stable URL left to pre-cache, and none is needed — a new
//     hash is a new URL, which no cache can have a stale copy of.
//   - manifest.json is the map's version pointer, so it has to stay
//     revalidated. It falls through to stale-while-revalidate in `fetch`.
const MAP_ROWS = 4
const MAP_COLS = 4
const RASTER_TIERS = [1, 2]
const buildMapAssetList = () => {
  const urls = [`${TILE_PATH_PREFIX}preview.webp`]
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

// Cache-first serves exactly the pre-cached set. The invariant: if an asset
// isn't safe to freeze for the lifetime of CACHE_NAME, it isn't safe to serve
// from cache without revalidating either. Membership is an allowlist rather
// than a manifest.json denylist so it fails safe — any *future* file dropped
// under /maps/fdtj/ gets revalidated instead of silently frozen.
const MAP_PRECACHE_URLS = buildMapAssetList()
const IMMUTABLE_MAP_ASSETS = new Set(MAP_PRECACHE_URLS)

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
      await cache.addAll(MAP_PRECACHE_URLS)
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
    // One-time migration off the old cache-first JSON entries: points.json has
    // moved to a hashed /assets/ URL, and manifest.json must be revalidated
    // from now on. Evicting two entries costs nothing, whereas bumping
    // CACHE_NAME to achieve the same thing would force every user to
    // re-download ~27 MB of tiles. Safe to delete once CACHE_NAME next moves,
    // since that drops the whole cache anyway.
    const cache = await caches.open(CACHE_NAME)
    await Promise.all([
      cache.delete(`${TILE_PATH_PREFIX}points.json`),
      cache.delete(`${TILE_PATH_PREFIX}manifest.json`)
    ])
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
    // `cache: 'reload'` bypasses the HTTP disk cache, which still holds these
    // under a one-year `immutable` entry. Without it a CACHE_NAME bump would
    // refill CacheStorage from that stale HTTP copy and change nothing — the
    // bump would appear to work while serving the old tiles. This path only
    // runs on a CacheStorage miss (fresh install or post-bump), which is
    // exactly when network authority is wanted, so it costs nothing otherwise.
    const response = await fetch(request.url, { cache: 'reload' })
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

  // Immutable map assets (tiles + preview): cache-first. Their bytes never
  // change for the lifetime of CACHE_NAME, so revalidation is wasted bytes.
  // Everything else under /maps/fdtj/ — i.e. manifest.json — intentionally
  // falls through to the stale-while-revalidate branch below, which fetches
  // with `cache: 'no-store'` and so bypasses the HTTP cache as well.
  if (
    requestUrl.hostname === self.location.hostname
    && IMMUTABLE_MAP_ASSETS.has(requestUrl.pathname)
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
