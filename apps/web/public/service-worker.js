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

// Stamped by scripts/build-map-tiles.ts from manifest.build — do not hand-edit.
// app/lib/service-worker-assets.test.ts fails if this and
// public/maps/fdtj/manifest.json disagree, which is what makes the invariant in
// cacheFirst below ("CACHE_NAME moves whenever the tiles do") enforced rather
// than merely asserted. It used to be neither: manifest.build rotated on every
// re-tile while CACHE_NAME sat still, so `ignoreSearch` happily answered every
// `?v=<new build>` request out of the previous build's bytes, forever.
const TILE_BUILD = '20f1255a'
// Two halves on purpose. `v5` is the *scheme* version — bump it by hand when
// what is stored changes shape (a new pre-cache set, a new key convention).
// TILE_BUILD is the *content* version and moves on its own. Either one moving
// rotates the cache, and `activate`'s unmanaged-cache sweep collects the loser.
//
// A rotation costs every user an 8.6 MiB re-fetch of the raster set. That is
// correct — those bytes genuinely changed — but it isn't free, so don't rotate
// the scheme half casually. The 64 SVG fallbacks (~24 MB) are cached on demand
// and are *not* part of that cost.
const CACHE_NAME = `pwa-cache-v5-${TILE_BUILD}`
const TILE_PATH_PREFIX = '/maps/fdtj/'
const TILE_MANIFEST_PATH = `${TILE_PATH_PREFIX}manifest.json`

// Every network read of a tile goes through this. The worker stamps with its
// *own* TILE_BUILD rather than reusing whatever query the page sent: the page's
// stamp comes from a manifest.json that may be up to five minutes stale, while
// this one comes from the same build that named the cache. Keying network reads
// on the value the cache is named after is what keeps the two from disagreeing.
const versionedTileUrl = (pathname) => `${pathname}?v=${TILE_BUILD}`

// The runtime caches, split out from CACHE_NAME so they can be swept without
// touching the tiles. They used to share one bucket, which meant the only way
// to evict a poisoned index.html was a CACHE_NAME bump — i.e. an 8.6 MiB
// re-download for every user. Splitting them makes eviction cheap, and lets
// each one carry the entry budget that suits it.
//
// The budgets are about survival, not disk: browsers evict CacheStorage per
// origin, all at once, under pressure. Letting these grow without bound is what
// would eventually take the tiles down with them.
const SHELL_CACHE = 'commute-shell-v1'
const ASSET_CACHE = 'commute-assets-v1'
const API_CACHE = 'commute-api-v1'
const MAX_SHELL_ENTRIES = 20
const MAX_ASSET_ENTRIES = 160
const MAX_API_ENTRIES = 120

// Pre-cached map assets. Derived deterministically from the grid in
// build-map-tiles.ts — keep MAP_ROWS/MAP_COLS/RASTER_TIERS in sync with
// GRID_ROWS/GRID_COLS/RASTER_TIERS there, and bump CACHE_NAME when they change.
// A stale copy of this list is worse than useless: it pre-caches tiles that no
// longer exist and leaves the real ones out of IMMUTABLE_MAP_ASSETS, so they
// miss the cache-first path entirely.
//
// Only genuinely-immutable, stable-URL assets belong here. Both JSON files
// under /maps/fdtj/ are deliberately absent:
//   - points.json is edited constantly. It now lives at app/data/points.json
//     and is imported with `?url`, so Vite content-hashes it into /assets/.
//     There is no stable URL left to pre-cache, and none is needed — a new
//     hash is a new URL, which no cache can have a stale copy of.
//   - manifest.json is the map's version pointer, so it has to stay
//     revalidated. It falls through to stale-while-revalidate in `fetch`.
const MAP_ROWS = 8
const MAP_COLS = 8
// 0.5 is the half-res tier; its files are named `@0.5x.webp`, matching the
// `@${tier}x` template used by both the build script and the tile source.
const RASTER_TIERS = [0.5, 1, 2]
// Rasters + preview: what the renderer actually draws. Every tier it can ask
// for is rasterized, so these cover the whole happy path.
const buildRasterAssetList = () => {
  const urls = [`${TILE_PATH_PREFIX}preview.webp`]
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      for (const t of RASTER_TIERS) {
        urls.push(`${TILE_PATH_PREFIX}tile-${r}-${c}@${t}x.webp`)
      }
    }
  }
  return urls
}

// Per-tile SVGs. map-renderer-tile-source.ts reads these only when a raster
// fetch *fails*, which on the happy path never happens — so they are cached
// on demand rather than pre-cached. Downloading all 64 up front cost ~24.7 MB
// against ~9 MB for every asset the map actually reads.
const buildSvgAssetList = () => {
  const urls = []
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      urls.push(`${TILE_PATH_PREFIX}tile-${r}-${c}.svg`)
    }
  }
  return urls
}

// Fetched atomically on install so the map works offline after one visit.
const MAP_PRECACHE_URLS = buildRasterAssetList()

// Cache-first membership, which is broader than the pre-cache set: an SVG that
// was never pre-cached is still immutable once fetched, so it should be served
// from cache rather than revalidated. The invariant: if an asset isn't safe to
// freeze for the lifetime of CACHE_NAME, it isn't safe to serve from cache
// without revalidating either. An allowlist rather than a manifest.json
// denylist so it fails safe — any *future* file dropped under /maps/fdtj/ gets
// revalidated instead of silently frozen.
const IMMUTABLE_MAP_ASSETS = new Set([...MAP_PRECACHE_URLS, ...buildSvgAssetList()])

// --- test split marker ---
// Everything above is pure declarations: no side effects, no access to
// service-worker globals. app/lib/service-worker-assets.test.ts splits the
// source on this line and evaluates the section above it in isolation, so keep
// CACHE_NAME / MAP_PRECACHE_URLS / IMMUTABLE_MAP_ASSETS on this side of it.
// Nothing below may be evaluated without a real service-worker global scope.

// Derived, because the worker can't read VITE_API_BASE_URL. In production the
// API is api.<host>, so this matches; if it ever moves, requests simply fall
// through to the default-bypass branch and go straight to the network, which is
// the safe failure.
const API_HOSTNAME = `api.${self.location.hostname}`
// Only the woff2 files, not the stylesheet. The <link> in root.tsx carries no
// crossorigin, so the stylesheet request is no-cors and its response is opaque:
// `response.ok` is false, which means the old code's `response.ok && put(...)`
// guard never cached it anyway. Font *file* fetches are always CORS, so those
// are cacheable and worth keeping.
const FONT_FILE_HOSTNAME = 'fonts.gstatic.com'

// How long a cached API payload may be served before the network becomes
// authoritative. Deliberately short: the perceived-instant paint comes from
// SWR's IndexedDB provider in app/layouts/default.tsx, not from here, so this
// only bounds staleness and background traffic. An unbounded version of this
// cache is what produced utils/timetable-shim.ts.
const API_TTL_MS = 60 * 60 * 1000
const CACHED_AT_HEADER = 'x-sw-cached-at'

// Long enough to prefer a fresh shell on a normal mobile connection, short
// enough that an unreachable origin doesn't hold the splash hostage.
const NAVIGATION_TIMEOUT_MS = 3000
// How much longer a late navigation response gets to arrive before the cached
// shell is served instead. Only spent when the cache actually has a shell to
// fall back to, so an offline load still fails fast at NAVIGATION_TIMEOUT_MS.
// The cached shell is the riskier answer of the two — see the grace window in
// raceNetworkAgainstCache — so it is worth waiting a little to avoid it.
const NAVIGATION_GRACE_MS = 2000
const MANIFEST_TIMEOUT_MS = 2000

// Posted to every open window when a chunk request comes back as the SPA
// fallback. app/lib/boot-watchdog.ts listens for it and recovers immediately
// instead of waiting out its timeout.
const STALE_SHELL_MESSAGE = 'commute:stale-shell'

// Trim runs off a counter rather than on every write: a cold load performs
// ~30 puts, and a cache.keys() scan per put would be pure overhead. Module
// scope, so it resets whenever the browser kills the worker — self-limiting.
const TRIM_INTERVAL = 16
let putsSinceTrim = 0

const isDevPath = pathname =>
  pathname.includes('__vite') || pathname.startsWith('/@id/__x00__virtual:react-router')

const HTML_CONTENT_TYPE = /^\s*text\/html/i
const NON_HTML_DESTINATIONS = new Set(['script', 'style', 'worker', 'sharedworker', 'manifest'])
const NON_HTML_EXTENSION = /\.(?:js|mjs|css|json|map|webp|svg|png|woff2?)$/i

const expectsNonHtml = (request, url) =>
  NON_HTML_DESTINATIONS.has(request.destination) || NON_HTML_EXTENSION.test(url.pathname)

/**
 * Detects Cloudflare Pages' SPA fallback standing in for a missing file.
 *
 * `not_found_handling = "single-page-application"` turns a 404 for a dead
 * /assets/<oldhash>.js into a 200 text/html. That response is poison twice
 * over: cached, it keeps the app broken for every later load; returned, the
 * module fails its MIME check, the shell's bare import() rejects unhandled,
 * and hydration never starts — which is exactly how the splash gets stuck.
 */
const isSpaFallbackPoison = (request, url, response) =>
  expectsNonHtml(request, url)
  && HTML_CONTENT_TYPE.test(response.headers.get('content-type') || '')

// A response worth keeping: really from the origin, and really what was asked
// for. Checked before every put.
const isCacheable = (request, url, response) =>
  response.ok && !isSpaFallbackPoison(request, url, response)

/**
 * Cache a response and occasionally trim, swallowing failures.
 *
 * Never let a cache write break the response the page is waiting on — a full
 * quota or an unsupported request method is not the page's problem.
 */
const cachePut = async (cacheName, request, response, maxEntries) => {
  try {
    const cache = await caches.open(cacheName)
    await cache.put(request, response)
    putsSinceTrim++
    if (putsSinceTrim >= TRIM_INTERVAL) {
      putsSinceTrim = 0
      await trimCache(cacheName, maxEntries)
    }
  } catch (err) {
    console.warn('[sw] cache write failed:', err)
  }
}

/**
 * The controlling document is stale — it asked for a chunk that no longer
 * exists. Drop the cached shell so the next navigation cannot re-serve it, and
 * tell the page so it can recover now rather than after its timeout.
 */
const notifyStaleShell = async () => {
  try {
    await caches.delete(SHELL_CACHE)
    const windows = await self.clients.matchAll({ type: 'window' })
    for (const client of windows) client.postMessage({ type: STALE_SHELL_MESSAGE })
  } catch (err) {
    console.warn('[sw] stale-shell notification failed:', err)
  }
}

/**
 * Fetch a set of tile URLs and commit them, atomically.
 *
 * This used to be `cache.addAll`, which is four characters and does the same
 * job — except addAll accepts no RequestInit, so every entry is fetched under
 * the default cache mode and reads the browser's HTTP disk cache. public/_headers
 * serves these same URLs `immutable, max-age=31536000`, and that was the whole
 * bug: DevTools "Clear site data" wipes CacheStorage and unregisters the worker
 * but leaves the HTTP cache alone, so the worker reinstalled, addAll refilled
 * CacheStorage out of the year-old disk entries, and cacheFirst's ignoreSearch
 * served those bytes to every `?v=` request. Only "Empty cache and hard reload"
 * — the one action that clears the HTTP cache — broke the loop.
 *
 * Two independent defences, because either alone has a gap:
 *   - `?v=<TILE_BUILD>` makes it a URL the HTTP cache has never seen. Needs no
 *     browser support at all, which covers the iOS Safari versions (< 16.4)
 *     that ignore the `cache` init entirely.
 *   - `cache: 'reload'` bypasses the HTTP cache and any intermediary, which
 *     holds even if an edge rule ever starts stripping query strings.
 * Don't drop either one.
 *
 * Atomicity is preserved by hand, since addAll's all-or-nothing rollback went
 * with it: every response is fetched and checked before the first put, so one
 * failure leaves the cache exactly as it was. That matters because install's
 * catch swallows the error and lets the worker activate — a half-filled cache
 * would look complete to the `missing` diff below and never heal.
 */
const precacheTiles = async (cache, urls) => {
  const fetched = await Promise.all(urls.map(async (url) => {
    const response = await fetch(versionedTileUrl(url), { cache: 'reload' })
    if (!response.ok) throw new TypeError(`pre-cache failed for ${url} (${response.status})`)
    return [url, response]
  }))
  // Stored under the bare path: one entry per asset, matching both the
  // ignoreSearch lookup in cacheFirst and the IMMUTABLE_MAP_ASSETS allowlist
  // that `activate` sweeps against. Sequential so the bodies drain one at a
  // time rather than all being resident at once.
  for (const [url, response] of fetched) await cache.put(url, response)
}

/**
 *  @Lifecycle Install
 *  Pre-cache the full set of map tile assets so the map works offline after the
 *  first visit. precacheTiles is atomic — a single failure rolls back the batch,
 *  so a partial-cache state is impossible.
 */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      // Only fetch what's actually missing. precacheTiles *always* hits the
      // network — deliberately, that is the point of it — so an unfiltered call
      // would re-download the whole 8.6 MiB tile set on every reinstall. The
      // boot watchdog recovers a stranded page by unregistering the worker,
      // which forces exactly that reinstall, so this filter is what makes the
      // recovery affordable rather than worse than the failure it fixes.
      //
      // After a TILE_BUILD rotation `caches.open(CACHE_NAME)` yields a brand-new
      // empty cache, so `missing` is the full set and the whole 8.6 MiB is
      // re-fetched. That is the intended cost of a re-tile, not a miss here.
      const cached = await cache.keys()
      const present = new Set(cached.map(req => new URL(req.url).pathname))
      const missing = MAP_PRECACHE_URLS.filter(url => !present.has(url))
      if (missing.length > 0) await precacheTiles(cache, missing)
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
 * Trim a cache back to `maxEntries`, oldest first.
 *
 * CacheStorage keys() is insertion-ordered and put() removes-then-appends, so
 * a re-fetched entry moves to the back: FIFO that approximates LRU closely
 * enough. Over-eager eviction costs one network fetch of a current-deploy
 * asset, which succeeds; it is not a correctness risk.
 */
const trimCache = async (cacheName, maxEntries) => {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= maxEntries) return
  const excess = keys.slice(0, keys.length - maxEntries)
  await Promise.all(excess.map(request => cache.delete(request)))
}

/**
     *  @Lifecycle Activate
     *  New one activated when old isnt being used.
     *
     *  waitUntil(): activating ====> activated
     */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches this worker doesn't manage at all — older CACHE_NAME
    // generations, and anything left by a previous scheme.
    const managed = [CACHE_NAME, SHELL_CACHE, ASSET_CACHE, API_CACHE]
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => !managed.includes(k)).map(k => caches.delete(k)))

    // Migration out of the single-cache era. CACHE_NAME still holds the ~9 MB
    // tile set, but it also holds whatever the old stale-while-revalidate
    // branch swept in: HTML, JS chunks, API JSON. The stale index.html among
    // them is what strands hydration — it points at /assets/<oldhash> files
    // that no longer exist on the origin.
    //
    // Deleting the cache would take the tiles with it, so evict by key instead.
    // The allowlist is IMMUTABLE_MAP_ASSETS rather than a /maps/fdtj/ prefix,
    // so the old cached manifest.json goes too; it belongs in SHELL_CACHE now,
    // where it gets revalidated.
    const tiles = await caches.open(CACHE_NAME)
    const tileKeys = await tiles.keys()
    await Promise.all(tileKeys
      .filter(request => !IMMUTABLE_MAP_ASSETS.has(new URL(request.url).pathname))
      .map(request => tiles.delete(request)))

    await trimCache(SHELL_CACHE, MAX_SHELL_ENTRIES)
    await trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES)
    await trimCache(API_CACHE, MAX_API_ENTRIES)

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
  // `ignoreSearch` so the `?v=<build>` cache-buster the renderer appends to tile
  // URLs doesn't fragment the cache. The query exists to defeat Cloudflare's
  // year-long `immutable` edge cache on stable tile filenames; CacheStorage is
  // already scoped by CACHE_NAME, which now genuinely moves whenever the tiles
  // do — build-map-tiles.ts stamps TILE_BUILD in, and
  // app/lib/service-worker-assets.test.ts fails if the two ever disagree. So
  // keying on the path alone is both sufficient and what lets the pre-cached
  // (unversioned) entries answer versioned requests.
  const cached = await cache.match(request, { ignoreSearch: true })
  if (cached) return cached
  try {
    // Re-stamped through versionedTileUrl rather than reusing request.url, on
    // both axes:
    //   - the query is the worker's TILE_BUILD, not whatever the caller sent.
    //     This path also serves the SVG fallbacks, which any future caller
    //     might request unstamped — normalising here means the worker can never
    //     issue an unversioned tile request, so it can never re-poison the bare
    //     HTTP entry that precacheTiles just stopped reading.
    //   - `cache: 'reload'` bypasses the HTTP disk cache, which still holds
    //     these under a one-year `immutable` entry. Without it a CACHE_NAME
    //     rotation would refill CacheStorage from that stale HTTP copy and
    //     change nothing — the rotation would appear to work while serving the
    //     old tiles.
    // This only runs on a CacheStorage miss (fresh install or post-rotation),
    // exactly when network authority is wanted, so it costs nothing otherwise.
    const response = await fetch(versionedTileUrl(new URL(request.url).pathname), { cache: 'reload' })
    // Store under the bare path so there is exactly one entry per asset,
    // matching both the pre-cached URLs and the ignoreSearch lookup above.
    if (response.ok) {
      cache.put(new URL(request.url).pathname, response.clone()).catch(() => {})
    }
    return response
  } catch (err) {
    // Offline + uncached — return a synthetic 504 so the renderer's onerror
    // path runs instead of stalling on a hung fetch.
    return new Response('', { status: 504, statusText: 'tile unavailable offline' })
  }
}

/**
 * Cache-first for content-addressed build output: /assets/* and font files.
 *
 * A new build emits a new hash, which is a new URL, so a cache hit here is
 * correct by construction and revalidation buys nothing. The old code ran these
 * through stale-while-revalidate with `?cache-bust=<now>` and `cache: 'no-store'`,
 * which defeated the `immutable` header in public/_headers outright and
 * re-downloaded the entire bundle in the background on every single page load.
 */
const assetCacheFirst = async (event, cacheName, maxEntries) => {
  const request = event.request
  const url = new URL(request.url)
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  // A hit is normally authoritative — a content-hashed URL cannot change
  // meaning — but it is only trustworthy if it holds what was asked for. An
  // entry can predate the guard in isCacheable: while a deploy is mid-flight
  // the edge answers a not-yet-live chunk with the SPA fallback under an
  // `immutable` header, and any worker that cached that keeps serving HTML for
  // a module forever. Purging the edge or fixing the origin cannot dislodge it,
  // and it fails quietly — the page gets a cached 200 rather than a 504, so the
  // boot watchdog sees no evidence and only ever reaches its bare timeout.
  // Dropping the entry here turns an unrecoverable state into one more fetch.
  if (cached && isSpaFallbackPoison(request, url, cached)) {
    await cache.delete(request)
  } else if (cached) {
    return cached
  }

  try {
    const response = await fetch(request)

    // A 404, or the SPA fallback wearing its clothes, means the document that
    // asked for this is from a deploy that no longer exists.
    if (response.status === 404 || isSpaFallbackPoison(request, url, response)) {
      event.waitUntil(notifyStaleShell())
      // Deliberately not the HTML body: handing that back is what fails the
      // module MIME check and leaves the import() rejecting into nothing. A
      // clean 504 fails the same request without poisoning anything, and gives
      // the boot watchdog a signal it can act on.
      return new Response('', { status: 504, statusText: 'stale asset' })
    }

    if (isCacheable(request, url, response)) {
      event.waitUntil(cachePut(cacheName, request, response.clone(), maxEntries))
    }
    return response
  } catch (err) {
    return new Response('', { status: 504, statusText: 'asset unavailable offline' })
  }
}

/**
 * Stale-while-revalidate for the in-app illustrations under /img/*.
 *
 * They are static files but not content-hashed, so cache-first-forever could
 * serve an edited image stale indefinitely, and network-only (the previous
 * behavior) left the offline empty states without their artwork. Serve from
 * cache for instant paint, refresh the stored copy in the background.
 */
const imageStaleWhileRevalidate = async (event, cacheName, maxEntries) => {
  const request = event.request
  const url = new URL(request.url)
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const refresh = fetch(request).then((response) => {
    if (isCacheable(request, url, response)) {
      event.waitUntil(cachePut(cacheName, request, response.clone(), maxEntries))
    }
    return response
  })

  if (cached) {
    event.waitUntil(refresh.catch(() => {}))
    return cached
  }
  try {
    return await refresh
  } catch (err) {
    return new Response('', { status: 504, statusText: 'image unavailable offline' })
  }
}

/**
 * Race the network against a timer, falling back to cache — never to undefined.
 *
 * The old handler's `Promise.race([fetched.catch(_ => cached), cached])` had the
 * opposite bias: a CacheStorage hit resolves in about a millisecond and beat the
 * network essentially always, so a returning user was served the *previous*
 * deploy's index.html. Its trailing `.catch(_ => {})` also resolved to
 * undefined, and `respondWith(undefined)` is a hard network error.
 */
const raceNetworkAgainstCache = async (request, network, cacheName, timeoutMs, fallbackUrl) => {
  const cache = await caches.open(cacheName)

  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs)
  })

  try {
    // The network is authoritative when it answers at all — including a 404 or
    // a 500. Only silence falls through to the cache.
    const winner = await Promise.race([network.then(response => response), timeout])
    if (winner) return winner

    // The timeout fired, but a *shell* is not like any other cached response:
    // after a deploy the cached one points at /assets/<oldhash> chunks the
    // origin no longer has. Serving it unconditionally is what produced the
    // production reload loop — the asset handler 504s those chunks, React
    // Router reloads, and the next navigation races the timer again,
    // alternating between the new and previous build indefinitely (~65
    // navigations in 8s when observed). And the timer is easy to lose
    // innocently: `install` is pre-caching ~9 MB of map tiles over the same
    // connection, so a perfectly healthy network routinely misses 3s.
    //
    // A late network answer is therefore worth strictly more than the cached
    // shell, because it is the only one guaranteed to match the chunks on the
    // origin. Give it a bounded second chance rather than discarding it: the
    // offline case still resolves at TOTAL, and the merely-slow case now
    // returns a shell that actually works.
    const cached = await cache.match(request)
    if (cached) {
      const graced = await Promise.race([
        network.then(response => response, () => null),
        new Promise(resolve => setTimeout(() => resolve(null), NAVIGATION_GRACE_MS))
      ])
      return graced || cached
    }
    // Nothing cached for this URL: the timeout bought us nothing, so keep
    // waiting on the network rather than inventing a failure.
    return await network
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    if (fallbackUrl) {
      const shell = await cache.match(fallbackUrl)
      if (shell) return shell
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>'
      + '<p>Kamu sedang offline dan halaman ini belum tersimpan.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Network-first. Not async on purpose: event.waitUntil() throws once the
 * respondWith promise has settled, and this returns the cached copy while the
 * network is still in flight, so the background write has to be registered
 * synchronously — before the first await.
 */
const networkFirst = (event, cacheName, maxEntries, timeoutMs, fallbackUrl) => {
  const request = event.request
  const url = new URL(request.url)
  // Plain fetch(request), never fetch(request, init): per the Fetch spec,
  // building a Request from one whose mode is "navigate" silently downgrades
  // the mode to "same-origin" and changes redirect handling. HTTP-cache
  // freshness for the shell is handled by the no-cache rules in public/_headers
  // instead.
  const network = fetch(request)

  event.waitUntil(network
    .then(async (response) => {
      if (isCacheable(request, url, response)) {
        await cachePut(cacheName, request, response.clone(), maxEntries)
      }
    })
    .catch(() => { /* offline; the cache fallback below covers it */ }))

  return raceNetworkAgainstCache(request, network, cacheName, timeoutMs, fallbackUrl)
}

/**
 * Stale-while-revalidate for API JSON, capped by API_TTL_MS.
 *
 * Entries are stamped on write so age is knowable. Within the TTL the cached
 * copy answers immediately and a refresh runs in the background; past it the
 * network becomes authoritative. A stale copy is still served when the network
 * fails at any age — the app already renders "Kamu sedang offline, data mungkin
 * tidak up-to-date", which is a better answer than a blank screen.
 */
const stampCachedAt = async (response) => {
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT_HEADER, String(Date.now()))
  // Buffer the body rather than piping the stream: these payloads are small,
  // and it keeps the entry constructible from plain Response objects.
  const body = await response.clone().arrayBuffer()
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

const isWithinTtl = response =>
  Date.now() - Number(response.headers.get(CACHED_AT_HEADER) || 0) <= API_TTL_MS

const apiStaleWhileRevalidate = (event) => {
  const request = event.request
  const url = new URL(request.url)
  const network = fetch(request)

  event.waitUntil(network
    .then(async (response) => {
      if (!isCacheable(request, url, response)) return
      await cachePut(API_CACHE, request, await stampCachedAt(response), MAX_API_ENTRIES)
    })
    .catch(() => { /* offline; the stale copy below covers it */ }))

  return (async () => {
    const cache = await caches.open(API_CACHE)
    const cached = await cache.match(request)
    if (cached && isWithinTtl(cached)) return cached
    try {
      return await network
    } catch (err) {
      // Past the TTL and the network is gone. Old data beats no data here.
      if (cached) return cached
      return new Response('', { status: 504, statusText: 'api unavailable offline' })
    }
  })()
}

/**
 *  @Functional Fetch
 *  All network requests are being intercepted here.
 *
 *  Ordered from most specific to least. Anything that falls off the end goes
 *  straight to the network untouched — the safe default, and the reason a
 *  misconfigured API hostname degrades to "not cached" rather than "broken".
 */
self.addEventListener('fetch', (event) => {
  const request = event.request

  // Never intercept non-GET. The old getFixedUrl() path re-issued every
  // intercepted request as a bare GET string, dropping method, headers, body
  // and credentials. Nothing in the app sends a non-GET today, so this was
  // latent rather than live — but it should be impossible, not merely unreached.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Dev-server plumbing. The worker only registers in PROD, but one installed
  // from a production visit can still control http://localhost.
  if (isDevPath(url.pathname)) return

  // Navigations: network-first. This is the fix. A cached index.html must never
  // win a race against the network, because its /assets/<hash> references stop
  // existing the moment a new deploy lands.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event, SHELL_CACHE, MAX_SHELL_ENTRIES, NAVIGATION_TIMEOUT_MS, '/'))
    return
  }

  const sameOrigin = url.hostname === self.location.hostname

  // Immutable tiles, ahead of every other same-origin rule so the renderer's
  // ?v=<build> stamp never reaches a cache that keys on the query string.
  if (sameOrigin && IMMUTABLE_MAP_ASSETS.has(url.pathname)) {
    event.respondWith(cacheFirst(event.request))
    return
  }

  // Content-hashed build output. Covers the JS/CSS chunks, the map renderer
  // worker bundle, and points.json — everything Vite emits with a hash.
  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(assetCacheFirst(event, ASSET_CACHE, MAX_ASSET_ENTRIES))
    return
  }

  // The map's version pointer: mutable, so network-first — but cached, so the
  // map still opens offline.
  if (sameOrigin && url.pathname === TILE_MANIFEST_PATH) {
    event.respondWith(networkFirst(event, SHELL_CACHE, MAX_SHELL_ENTRIES, MANIFEST_TIMEOUT_MS))
    return
  }

  if (url.hostname === API_HOSTNAME) {
    event.respondWith(apiStaleWhileRevalidate(event))
    return
  }

  if (url.hostname === FONT_FILE_HOSTNAME) {
    event.respondWith(assetCacheFirst(event, ASSET_CACHE, MAX_ASSET_ENTRIES))
    return
  }

  // In-app illustrations (empty states, OG images): cached for offline and
  // instant repeat paint, refreshed in the background since these URLs are
  // not content-hashed.
  if (sameOrigin && url.pathname.startsWith('/img/')) {
    event.respondWith(imageStaleWhileRevalidate(event, ASSET_CACHE, MAX_ASSET_ENTRIES))
    return
  }

  // Everything else — the font stylesheet, /manifest.json, and anything
  // unforeseen — goes to the network untouched.
})
