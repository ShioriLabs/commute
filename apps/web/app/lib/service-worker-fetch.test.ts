import { beforeEach, describe, expect, it } from 'vitest'
import {
  API_ORIGIN,
  createHarness,
  createRequest,
  html,
  json,
  navigationRequest,
  ORIGIN,
  script,
  type FetchDispatch,
  type Harness
} from './service-worker-harness'

// The worker's own timers are injected fakes, so this only flushes microtasks —
// it lets an in-flight handler reach its next await before a test fires the
// fake clock or asserts on a background write.
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // An unobserved rejection here would fail the run before the worker's own
  // catch has had a chance to handle it.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

// Every intercepted request must come back as a real Response. respondWith(undefined)
// is a hard network error, and the old handler produced one whenever both cache
// and network failed.
async function expectResponse(dispatch: FetchDispatch): Promise<Response> {
  expect(dispatch.respondWithCalled).toBe(true)
  const response = await dispatch.response
  expect(typeof response?.status).toBe('number')
  return response as Response
}

function stampedApiResponse(body: unknown, ageMs: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'x-sw-cached-at': String(Date.now() - ageMs)
    }
  })
}

let harness: Harness

beforeEach(() => {
  harness = createHarness()
})

describe('navigations', () => {
  // The reported bug, pinned. A cached index.html points at /assets/<oldhash>
  // files that stop existing the moment a new deploy lands, so preferring it
  // over the network is what strands hydration on the splash.
  it('never prefers a stale cached shell over the network', async () => {
    await harness.seed('commute-shell-v1', '/', html('<html>OLD SHELL</html>'))
    harness.route('/', () => html('<html>FRESH SHELL</html>'))

    const dispatch = harness.dispatchFetch(navigationRequest('/'))
    const response = await expectResponse(dispatch)

    expect(await response.text()).toContain('FRESH SHELL')
  })

  it('stores the fresh shell for offline use', async () => {
    harness.route('/', () => html('<html>FRESH SHELL</html>'))

    const dispatch = harness.dispatchFetch(navigationRequest('/'))
    await expectResponse(dispatch)
    await dispatch.drain()

    expect(await harness.cached('commute-shell-v1')).toEqual([`${ORIGIN}/`])
  })

  it('falls back to the cached shell when the network fails', async () => {
    await harness.seed('commute-shell-v1', '/', html('<html>OLD SHELL</html>'))
    harness.route('/', () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await expectResponse(harness.dispatchFetch(navigationRequest('/')))

    expect(await response.text()).toContain('OLD SHELL')
  })

  it('falls back to the cached root shell for an uncached sub-route', async () => {
    await harness.seed('commute-shell-v1', '/', html('<html>ROOT SHELL</html>'))
    harness.route('/settings/about', () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await expectResponse(
      harness.dispatchFetch(navigationRequest('/settings/about'))
    )

    expect(await response.text()).toContain('ROOT SHELL')
  })

  it('returns an offline document rather than undefined when nothing is cached', async () => {
    harness.route('/', () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await expectResponse(harness.dispatchFetch(navigationRequest('/')))

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('offline')
  })

  it('serves the cached shell once the network times out', async () => {
    const network = deferred<Response>()
    await harness.seed('commute-shell-v1', '/', html('<html>OLD SHELL</html>'))
    harness.route('/', () => network.promise)

    const dispatch = harness.dispatchFetch(navigationRequest('/'))
    await flush()
    expect(harness.clock.pending()).toEqual([3000])
    harness.clock.fireAll()

    // The navigation timeout no longer settles the race on its own: a cached
    // shell is only served after the network has also had its grace window,
    // because serving a stale shell is what loops the app after a deploy.
    await flush()
    expect(harness.clock.pending()).toEqual([2000])
    harness.clock.fireAll()

    const response = await expectResponse(dispatch)
    expect(await response.text()).toContain('OLD SHELL')
  })

  // The reload loop, pinned. The timeout fallback cannot tell "the network is
  // slow" from "the network is fine but the tile pre-cache is saturating it",
  // and in the second case the cached shell it serves is guaranteed toxic after
  // a deploy: its chunks are gone, the SW 504s them, React Router reloads, and
  // the next navigation races again. Observed in production as ~65 main-frame
  // navigations in 8s, alternating between the new and the previous build.
  //
  // So a timeout must not resolve the race on its own. Once the network does
  // answer, its shell is authoritative and must win.
  it('prefers the network shell even when the timeout fired first', async () => {
    const network = deferred<Response>()
    await harness.seed('commute-shell-v1', '/', html('<html>OLD SHELL</html>'))
    harness.route('/', () => network.promise)

    const dispatch = harness.dispatchFetch(navigationRequest('/'))
    await flush()
    // The navigation timeout fires and the cached shell is right there...
    expect(harness.clock.pending()).toEqual([3000])
    harness.clock.fireAll()
    await flush()
    // ...but the network answers inside the grace window, so it still wins.
    network.resolve(html('<html>FRESH SHELL</html>'))

    const response = await expectResponse(dispatch)
    expect(await response.text()).toContain('FRESH SHELL')
  })

  it('keeps waiting on the network when the timeout fires with nothing cached', async () => {
    const network = deferred<Response>()
    harness.route('/', () => network.promise)

    const dispatch = harness.dispatchFetch(navigationRequest('/'))
    await flush()
    harness.clock.fireAll()
    await flush()
    network.resolve(html('<html>LATE SHELL</html>'))

    const response = await expectResponse(dispatch)
    expect(await response.text()).toContain('LATE SHELL')
  })

  it('treats a server error as authoritative rather than falling back', async () => {
    await harness.seed('commute-shell-v1', '/', html('<html>OLD SHELL</html>'))
    harness.route('/', () => html('boom', 500))

    const response = await expectResponse(harness.dispatchFetch(navigationRequest('/')))

    expect(response.status).toBe(500)
  })
})

describe('hashed build assets', () => {
  // The other half of the reported bug: Cloudflare Pages' SPA fallback answers a
  // missing chunk with 200 text/html, which fails the module MIME check and
  // leaves the shell's bare import() rejecting into nothing.
  it('rejects an HTML response for a script request and never caches it', async () => {
    await harness.seed('commute-shell-v1', '/', html('<html>STALE SHELL</html>'))
    harness.route('/assets/root-OLDHASH.js', () => html('<html>spa fallback</html>'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-OLDHASH.js', { destination: 'script' })
    )
    const response = await expectResponse(dispatch)
    await dispatch.drain()

    expect(response.status).toBe(504)
    expect(await harness.cached('commute-assets-v1')).toEqual([])
    // The stale shell that asked for this chunk is evicted, so the next
    // navigation cannot re-serve it.
    expect(harness.caches.stores.has('commute-shell-v1')).toBe(false)
    expect(harness.clients).toEqual([])
  })

  it('notifies open windows that the shell is stale', async () => {
    const messages: unknown[] = []
    harness.clients.push({ messages, postMessage: (m: unknown) => messages.push(m) } as never)
    harness.route('/assets/root-OLDHASH.js', () => html('<html>spa fallback</html>'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-OLDHASH.js', { destination: 'script' })
    )
    await expectResponse(dispatch)
    await dispatch.drain()

    expect(messages).toEqual([{ type: 'commute:stale-shell' }])
  })

  it('treats an outright 404 the same way', async () => {
    harness.route('/assets/root-OLDHASH.js', () => new Response('', { status: 404 }))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-OLDHASH.js', { destination: 'script' })
    )
    const response = await expectResponse(dispatch)
    await dispatch.drain()

    expect(response.status).toBe(504)
    expect(await harness.cached('commute-assets-v1')).toEqual([])
  })

  it('serves a cached chunk without touching the network', async () => {
    await harness.seed('commute-assets-v1', '/assets/root-ABC12345.js', script('cached chunk'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-ABC12345.js', { destination: 'script' })
    )
    const response = await expectResponse(dispatch)

    expect(await response.text()).toBe('cached chunk')
    expect(harness.calls).toHaveLength(0)
  })

  // A cache hit is normally authoritative — a content-hashed URL can't change
  // meaning. But CacheStorage can already hold HTML under a module URL: while a
  // deploy was mid-flight the edge served the SPA fallback with `immutable`, and
  // this worker cached whatever it got. Once that entry exists the cache-first
  // path returns it forever, so fixing the origin (or purging the edge) changes
  // nothing and the app can only be recovered by clearing site data by hand.
  //
  // It also fails silently: the page gets a cached 200, not a 504, so the boot
  // watchdog sees no evidence and falls through to its bare timeout — the
  // "Lama banget ya?" panel rather than an actual recovery.
  it('does not serve poisoned HTML from the asset cache', async () => {
    await harness.seed('commute-assets-v1', '/assets/root-ABC12345.js', html('<html>SPA FALLBACK</html>'))
    harness.route('/assets/root-ABC12345.js', () => script('real chunk'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-ABC12345.js', { destination: 'script' })
    )
    const response = await expectResponse(dispatch)

    expect(await response.text()).toBe('real chunk')
  })

  it('evicts a poisoned asset entry rather than leaving it to be re-served', async () => {
    await harness.seed('commute-assets-v1', '/assets/root-ABC12345.js', html('<html>SPA FALLBACK</html>'))
    harness.route('/assets/root-ABC12345.js', () => script('real chunk'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-ABC12345.js', { destination: 'script' })
    )
    await expectResponse(dispatch)
    await dispatch.drain()

    const store = await harness.caches.open('commute-assets-v1')
    const stored = await store.match(`${ORIGIN}/assets/root-ABC12345.js`)
    expect(await stored?.text()).toBe('real chunk')
  })

  it('fetches a chunk without a cache-buster and caches it', async () => {
    harness.route('/assets/root-ABC12345.js', () => script('fresh chunk'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/root-ABC12345.js', { destination: 'script' })
    )
    await expectResponse(dispatch)
    await dispatch.drain()

    // The old handler appended ?cache-bust=<now> and fetched with
    // cache: 'no-store', which defeated the `immutable` header in _headers and
    // re-downloaded the whole bundle on every load.
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0].url).not.toContain('cache-bust')
    expect(harness.calls[0].init).toBeUndefined()
    expect(await harness.cached('commute-assets-v1'))
      .toEqual([`${ORIGIN}/assets/root-ABC12345.js`])
  })

  it('caches hashed JSON, not just scripts', async () => {
    harness.route('/assets/points-rO0fVCwS.json', () => json({ points: [] }))

    const dispatch = harness.dispatchFetch(createRequest('/assets/points-rO0fVCwS.json'))
    await expectResponse(dispatch)
    await dispatch.drain()

    expect(await harness.cached('commute-assets-v1'))
      .toEqual([`${ORIGIN}/assets/points-rO0fVCwS.json`])
  })

  it('caches the map renderer worker bundle', async () => {
    harness.route('/assets/map-renderer-worker-XY12345Z.js', () => script('worker'))

    const dispatch = harness.dispatchFetch(
      createRequest('/assets/map-renderer-worker-XY12345Z.js', { destination: 'worker' })
    )
    await expectResponse(dispatch)
    await dispatch.drain()

    expect(await harness.cached('commute-assets-v1'))
      .toEqual([`${ORIGIN}/assets/map-renderer-worker-XY12345Z.js`])
  })

  it('returns a clean 504 for a chunk when offline and uncached', async () => {
    harness.route('/assets/root-ABC12345.js', () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await expectResponse(
      harness.dispatchFetch(createRequest('/assets/root-ABC12345.js', { destination: 'script' }))
    )

    expect(response.status).toBe(504)
  })
})

describe('map tiles', () => {
  it('ignores the ?v= build stamp when matching', async () => {
    await harness.seed('pwa-cache-v4', '/maps/fdtj/tile-0-0@2x.webp', new Response('cached tile'))

    const dispatch = harness.dispatchFetch(
      createRequest('/maps/fdtj/tile-0-0@2x.webp?v=20f1255a', { destination: 'image' })
    )
    const response = await expectResponse(dispatch)

    expect(await response.text()).toBe('cached tile')
    expect(harness.calls).toHaveLength(0)
  })

  it('routes the tile manifest to the shell cache, not the tile cache', async () => {
    harness.route('/maps/fdtj/manifest.json', () => json({ build: 'abc123' }))

    const dispatch = harness.dispatchFetch(createRequest('/maps/fdtj/manifest.json'))
    await expectResponse(dispatch)
    await dispatch.drain()

    expect(await harness.cached('commute-shell-v1'))
      .toEqual([`${ORIGIN}/maps/fdtj/manifest.json`])
    expect(await harness.cached('pwa-cache-v4')).toEqual([])
  })
})

describe('api', () => {
  const stationUrl = `${API_ORIGIN}/stations/KCI/BOO`

  it('serves a cached payload that is still within its TTL', async () => {
    await harness.seed('commute-api-v1', stationUrl, stampedApiResponse({ name: 'cached' }, 60_000))
    harness.route(stationUrl, () => json({ name: 'network' }))

    const response = await expectResponse(harness.dispatchFetch(createRequest(stationUrl)))

    expect(await response.json()).toEqual({ name: 'cached' })
  })

  it('revalidates in the background and stamps what it stores', async () => {
    await harness.seed('commute-api-v1', stationUrl, stampedApiResponse({ name: 'cached' }, 60_000))
    harness.route(stationUrl, () => json({ name: 'network' }))

    const dispatch = harness.dispatchFetch(createRequest(stationUrl))
    await expectResponse(dispatch)
    await dispatch.drain()

    const store = await harness.caches.open('commute-api-v1')
    const stored = await store.match(stationUrl)
    expect(await stored?.json()).toEqual({ name: 'network' })
    expect(stored?.headers.get('x-sw-cached-at')).toMatch(/^\d+$/)
  })

  it('goes to the network once the cached payload is past its TTL', async () => {
    const twoHours = 2 * 60 * 60 * 1000
    await harness.seed('commute-api-v1', stationUrl, stampedApiResponse({ name: 'stale' }, twoHours))
    harness.route(stationUrl, () => json({ name: 'network' }))

    const response = await expectResponse(harness.dispatchFetch(createRequest(stationUrl)))

    expect(await response.json()).toEqual({ name: 'network' })
  })

  it('serves an expired payload rather than nothing when the network is gone', async () => {
    const twoHours = 2 * 60 * 60 * 1000
    await harness.seed('commute-api-v1', stationUrl, stampedApiResponse({ name: 'stale' }, twoHours))
    harness.route(stationUrl, () => {
      throw new TypeError('Failed to fetch')
    })

    const response = await expectResponse(harness.dispatchFetch(createRequest(stationUrl)))

    expect(await response.json()).toEqual({ name: 'stale' })
  })

  it('treats an unstamped legacy entry as expired', async () => {
    await harness.seed('commute-api-v1', stationUrl, json({ name: 'legacy' }))
    harness.route(stationUrl, () => json({ name: 'network' }))

    const response = await expectResponse(harness.dispatchFetch(createRequest(stationUrl)))

    expect(await response.json()).toEqual({ name: 'network' })
  })
})

describe('requests the worker must not touch', () => {
  it('ignores non-GET requests', () => {
    const dispatch = harness.dispatchFetch(
      createRequest(`${API_ORIGIN}/stations`, { method: 'POST' })
    )
    expect(dispatch.respondWithCalled).toBe(false)
  })

  it('ignores vite and react-router dev paths', () => {
    expect(harness.dispatchFetch(createRequest('/__vite_ping')).respondWithCalled).toBe(false)
    expect(
      harness.dispatchFetch(createRequest('/@id/__x00__virtual:react-router/server-build'))
        .respondWithCalled
    ).toBe(false)
  })

  it('ignores the opaque Google Fonts stylesheet', () => {
    const dispatch = harness.dispatchFetch(
      createRequest('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans')
    )
    expect(dispatch.respondWithCalled).toBe(false)
  })

  it('ignores unrelated cross-origin requests', () => {
    expect(
      harness.dispatchFetch(createRequest('https://example.com/tracker.js')).respondWithCalled
    ).toBe(false)
  })

  it('ignores same-origin files outside the managed paths', () => {
    expect(harness.dispatchFetch(createRequest('/manifest.json')).respondWithCalled).toBe(false)
    expect(harness.dispatchFetch(createRequest('/img/og-image.png')).respondWithCalled).toBe(false)
  })

  it('still caches Google Fonts woff2 files', async () => {
    const fontUrl = 'https://fonts.gstatic.com/s/plusjakartasans/v8/abc.woff2'
    harness.route(fontUrl, () => new Response('font', { headers: { 'content-type': 'font/woff2' } }))

    const dispatch = harness.dispatchFetch(createRequest(fontUrl, { destination: 'font' }))
    await expectResponse(dispatch)
    await dispatch.drain()

    expect(await harness.cached('commute-assets-v1')).toEqual([fontUrl])
  })
})

describe('lifecycle', () => {
  it('pre-caches the tile set on a fresh install', async () => {
    harness.route(/\/maps\/fdtj\//, () => new Response('tile'))

    await harness.dispatchInstall()

    expect(await harness.cached('pwa-cache-v4')).toHaveLength(193)
    expect(harness.skipWaitingCalls).toBe(1)
  })

  // The boot watchdog recovers by unregistering the worker, which forces a
  // reinstall. cache.addAll always hits the network, so without this filter that
  // recovery would cost a ~9 MB re-download and be worse than the failure.
  it('re-downloads nothing when the tiles are already cached', async () => {
    harness.route(/\/maps\/fdtj\//, () => new Response('tile'))
    await harness.dispatchInstall()
    const afterFirstInstall = harness.calls.length

    await harness.dispatchInstall()

    expect(harness.calls).toHaveLength(afterFirstInstall)
    expect(await harness.cached('pwa-cache-v4')).toHaveLength(193)
  })

  it('prunes the tile cache without evicting the tiles', async () => {
    await harness.seed('pwa-cache-v4', '/maps/fdtj/preview.webp', new Response('preview'))
    await harness.seed('pwa-cache-v4', '/maps/fdtj/tile-0-0@2x.webp', new Response('tile'))
    await harness.seed('pwa-cache-v4', '/maps/fdtj/tile-3-3.svg', new Response('svg'))
    // The intruders the old single-cache scheme swept in.
    await harness.seed('pwa-cache-v4', '/', html('<html>STALE SHELL</html>'))
    await harness.seed('pwa-cache-v4', '/assets/root-OLDHASH.js', script('old chunk'))
    await harness.seed('pwa-cache-v4', '/maps/fdtj/manifest.json', json({ build: 'old' }))

    await harness.dispatchActivate()

    expect(await harness.cached('pwa-cache-v4')).toEqual([
      `${ORIGIN}/maps/fdtj/preview.webp`,
      `${ORIGIN}/maps/fdtj/tile-0-0@2x.webp`,
      `${ORIGIN}/maps/fdtj/tile-3-3.svg`
    ])
    expect(harness.claimCalls).toBe(1)
  })

  it('deletes caches it does not manage but keeps the ones it does', async () => {
    await harness.seed('pwa-cache-v3', '/maps/fdtj/preview.webp', new Response('old gen'))
    await harness.seed('commute-shell-v1', '/', html('<html>shell</html>'))
    await harness.seed('commute-assets-v1', '/assets/root-ABC12345.js', script('chunk'))

    await harness.dispatchActivate()

    expect(harness.caches.stores.has('pwa-cache-v3')).toBe(false)
    expect(await harness.cached('commute-shell-v1')).toHaveLength(1)
    expect(await harness.cached('commute-assets-v1')).toHaveLength(1)
  })

  it('trims the asset cache back to its cap, oldest first', async () => {
    for (let i = 0; i < 180; i++) {
      await harness.seed('commute-assets-v1', `/assets/chunk-${i}.js`, script(`chunk ${i}`))
    }

    await harness.dispatchActivate()

    const remaining = await harness.cached('commute-assets-v1')
    expect(remaining).toHaveLength(160)
    expect(remaining[0]).toBe(`${ORIGIN}/assets/chunk-20.js`)
    expect(remaining.at(-1)).toBe(`${ORIGIN}/assets/chunk-179.js`)
  })
})
