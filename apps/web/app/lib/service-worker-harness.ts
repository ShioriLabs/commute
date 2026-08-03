// Test harness that runs the real public/service-worker.js in Node.
//
// The worker can't be imported: it's a plain script that reads service-worker
// globals at load time and registers listeners as its only side effect. So it
// gets evaluated through `new Function` with every global it touches injected as
// a parameter — the same trick service-worker-assets.test.ts uses on the
// declaration block, extended to the whole file.
//
// Two things are deliberately asymmetric, and both matter:
//
//   - Requests are duck-typed plain objects, not real `Request` instances.
//     `new Request(url, { mode: 'navigate' })` throws by spec, so a navigation
//     request is impossible to construct. The worker only reads `.url`,
//     `.method`, `.mode` and `.destination`, so a plain object is both
//     sufficient and the only option.
//   - Responses are real `Response` objects, so `.ok`, `.status`, `.headers.get`
//     and `.clone()` behave exactly as they do in a browser.
//
// Cached responses are stored frozen (status + headers + bytes) and thawed into
// a fresh Response on every read. Real CacheStorage hands out a new Response
// each time; keeping one instance around would let a second read fail with
// "body already consumed" and produce failures that look like cache misses.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(HERE, '..', '..', 'public')

export const HOSTNAME = 'commute.test'
export const ORIGIN = `https://${HOSTNAME}`
export const API_ORIGIN = `https://api.${HOSTNAME}`

/** The subset of Request the worker actually reads. */
export interface RequestLike {
  url: string
  method: string
  mode?: string
  destination?: string
}

interface StoredResponse {
  status: number
  statusText: string
  headers: [string, string][]
  body: ArrayBuffer
}

// Statuses the Response constructor refuses to pair with a body.
const NULL_BODY_STATUS = new Set([204, 205, 304])

async function freeze(response: Response): Promise<StoredResponse> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers] as [string, string][],
    body: await response.arrayBuffer()
  }
}

function thaw(stored: StoredResponse): Response {
  const body = NULL_BODY_STATUS.has(stored.status) ? null : stored.body
  return new Response(body, {
    status: stored.status,
    statusText: stored.statusText,
    headers: stored.headers
  })
}

function stripSearch(href: string): string {
  const url = new URL(href)
  url.search = ''
  return url.href
}

interface CacheQueryOptions {
  ignoreSearch?: boolean
}

class FakeCache {
  // Insertion-ordered, which is what the worker's FIFO trimming relies on.
  readonly entries = new Map<string, StoredResponse>()

  // The worker sometimes puts under a bare pathname string (real CacheStorage
  // resolves those against the worker's scope), so normalise everything to an
  // absolute href before it becomes a key.
  private key(request: RequestLike | string): string {
    const url = typeof request === 'string' ? request : request.url
    return new URL(url, ORIGIN).href
  }

  async match(request: RequestLike | string, options?: CacheQueryOptions): Promise<Response | undefined> {
    const href = this.key(request)
    const direct = this.entries.get(href)
    if (direct) return thaw(direct)
    if (!options?.ignoreSearch) return undefined
    const bare = stripSearch(href)
    for (const [key, stored] of this.entries) {
      if (stripSearch(key) === bare) return thaw(stored)
    }
    return undefined
  }

  async put(request: RequestLike | string, response: Response): Promise<void> {
    if (typeof request !== 'string' && request.method && request.method !== 'GET') {
      throw new TypeError('Request method is unsupported')
    }
    const href = this.key(request)
    // Re-insert rather than overwrite in place: the spec removes the matching
    // entry and appends the new pair, so a rewritten key moves to the back of
    // the FIFO. The worker's trim relies on that ordering.
    this.entries.delete(href)
    this.entries.set(href, await freeze(response))
  }

  async delete(request: RequestLike | string): Promise<boolean> {
    return this.entries.delete(this.key(request))
  }

  async keys(): Promise<RequestLike[]> {
    return [...this.entries.keys()].map(url => ({ url, method: 'GET' }))
  }

  // Deliberately no addAll. The worker pre-caches through its own precacheTiles
  // instead, because addAll takes no RequestInit and so cannot be kept off the
  // HTTP disk cache — which is the bug that made tiles immortal. Faking an API
  // the worker must never use again is how someone reintroduces it.
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    const existing = this.stores.get(name)
    if (existing) return existing
    const created = new FakeCache()
    this.stores.set(name, created)
    return created
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }

  async match(request: RequestLike | string, options?: CacheQueryOptions): Promise<Response | undefined> {
    for (const store of this.stores.values()) {
      const hit = await store.match(request, options)
      if (hit) return hit
    }
    return undefined
  }
}

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>
type Matcher = (url: string) => boolean

function toMatcher(pattern: string | RegExp | Matcher): Matcher {
  if (typeof pattern === 'function') return pattern
  if (pattern instanceof RegExp) return url => pattern.test(url)
  if (pattern.includes('://')) return url => url === pattern
  // A bare path matches on pathname, so a `?cache-bust=` suffix can't make a
  // route silently stop matching — that would hide the very bug we're pinning.
  return url => new URL(url).pathname === pattern
}

export interface FetchCall {
  url: string
  init?: RequestInit
}

export interface Clock {
  pending(): number[]
  fireAll(): void
}

export interface FetchDispatch {
  /** False when the worker declined to intercept (plain `return`). */
  respondWithCalled: boolean
  /** What was handed to respondWith, or undefined when it wasn't called. */
  response: Promise<Response | undefined>
  /** Settles once every waitUntil the handler registered has finished. */
  drain: () => Promise<void>
}

export interface FakeClient {
  messages: unknown[]
}

/**
 * The worker's own cache-identity constants, read out of the evaluated source.
 *
 * Tests assert against these rather than string literals because CACHE_NAME is
 * now derived from TILE_BUILD, which scripts/build-map-tiles.ts rewrites on
 * every re-tile. A hardcoded 'pwa-cache-v5-20f1255a' in a test would go stale
 * the first time the tiles are regenerated.
 */
export interface WorkerNames {
  CACHE_NAME: string
  TILE_BUILD: string
  SHELL_CACHE: string
  ASSET_CACHE: string
  API_CACHE: string
}

export interface Harness {
  caches: FakeCacheStorage
  names: WorkerNames
  clock: Clock
  /** Every fetch the worker made, in order. */
  calls: FetchCall[]
  clients: FakeClient[]
  warnings: unknown[][]
  /** Register a network responder. Later routes win, so tests can override. */
  route: (pattern: string | RegExp | Matcher, responder: Responder) => void
  /** Put a response into a named cache without going through the worker. */
  seed: (cacheName: string, url: string, response: Response) => Promise<void>
  /** Absolute hrefs currently held by a cache, in insertion order. */
  cached: (cacheName: string) => Promise<string[]>
  dispatchFetch: (request: RequestLike) => FetchDispatch
  dispatchInstall: () => Promise<void>
  dispatchActivate: () => Promise<void>
  skipWaitingCalls: number
  claimCalls: number
}

export function createRequest(url: string, init: Partial<RequestLike> = {}): RequestLike {
  return {
    url: new URL(url, ORIGIN).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'no-cors',
    destination: init.destination ?? ''
  }
}

export function navigationRequest(url = '/'): RequestLike {
  return createRequest(url, { mode: 'navigate', destination: 'document' })
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export function script(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/javascript' } })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function createHarness(): Harness {
  const routes: { match: Matcher, responder: Responder }[] = []
  const calls: FetchCall[] = []
  const clients: FakeClient[] = []
  const warnings: unknown[][] = []
  const listeners = new Map<string, (event: unknown) => void>()

  const timers = new Map<number, { fn: () => void, ms: number }>()
  let nextTimerId = 1

  const fetchImpl = async (input: RequestLike | string, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).href : input.url
    calls.push({ url, init })
    for (let i = routes.length - 1; i >= 0; i--) {
      if (routes[i].match(url)) return routes[i].responder(url, init)
    }
    // Nothing registered: behave like a host with no such file rather than like
    // a network failure, so an unrouted URL fails loudly and specifically.
    return new Response('not routed', { status: 404 })
  }

  const caches = new FakeCacheStorage()

  let skipWaitingCalls = 0
  let claimCalls = 0

  const self = {
    location: { hostname: HOSTNAME, protocol: 'https:', origin: ORIGIN, href: `${ORIGIN}/` },
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler)
    },
    async skipWaiting() {
      skipWaitingCalls++
    },
    clients: {
      async claim() {
        claimCalls++
      },
      async matchAll() {
        return clients
      }
    }
  }

  const consoleStub = {
    log: () => {},
    info: () => {},
    error: (...args: unknown[]) => { warnings.push(args) },
    warn: (...args: unknown[]) => { warnings.push(args) }
  }

  const setTimer = (fn: () => void, ms: number) => {
    const id = nextTimerId++
    timers.set(id, { fn, ms })
    return id
  }
  const clearTimer = (id: number) => {
    timers.delete(id)
  }

  const source = readFileSync(path.join(PUBLIC_DIR, 'service-worker.js'), 'utf8')
  // The trailing `return` hands back the cache-identity constants. Everything in
  // the worker is a function-scoped `const`, and its last statement is an
  // addEventListener call, so appending a return is safe and needs no parsing.
  const factory = new Function(
    'self', 'caches', 'fetch', 'console', 'setTimeout', 'clearTimeout',
    `${source}\n;return { CACHE_NAME, TILE_BUILD, SHELL_CACHE, ASSET_CACHE, API_CACHE }`
  ) as (...args: unknown[]) => WorkerNames
  const names = factory(self, caches, fetchImpl, consoleStub, setTimer, clearTimer)

  const dispatchLifecycle = async (type: 'install' | 'activate') => {
    const handler = listeners.get(type)
    if (!handler) throw new Error(`service worker registered no ${type} listener`)
    const waits: Promise<unknown>[] = []
    const waitUntil = (p: Promise<unknown>) => {
      waits.push(Promise.resolve(p))
    }
    handler({ waitUntil })
    await Promise.all(waits)
  }

  return {
    caches,
    names,
    calls,
    clients,
    warnings,
    clock: {
      pending: () => [...timers.values()].map(t => t.ms),
      fireAll: () => {
        const due = [...timers.entries()]
        timers.clear()
        for (const [, timer] of due) timer.fn()
      }
    },
    route(pattern, responder) {
      routes.push({ match: toMatcher(pattern), responder })
    },
    async seed(cacheName, url, response) {
      const store = await caches.open(cacheName)
      await store.put(new URL(url, ORIGIN).href, response)
    },
    async cached(cacheName) {
      const store = await caches.open(cacheName)
      return [...store.entries.keys()]
    },
    dispatchFetch(request) {
      const handler = listeners.get('fetch')
      if (!handler) throw new Error('service worker registered no fetch listener')
      const waits: Promise<unknown>[] = []
      let responded: Promise<Response | undefined> | undefined
      handler({
        request,
        respondWith(value: Promise<Response> | Response) {
          responded = Promise.resolve(value)
        },
        waitUntil(p: Promise<unknown>) {
          waits.push(Promise.resolve(p))
        }
      })
      return {
        // respondWith must be called synchronously during the handler, so by
        // the time control returns here it either happened or never will.
        respondWithCalled: responded !== undefined,
        response: responded ?? Promise.resolve(undefined),
        async drain() {
          // waitUntil can be called after an await, so keep settling until the
          // queue stops growing rather than snapshotting it once.
          for (let i = 0; i < 20; i++) {
            const before = waits.length
            await Promise.allSettled([...waits])
            await Promise.resolve()
            if (waits.length === before) return
          }
        }
      }
    },
    dispatchInstall: () => dispatchLifecycle('install'),
    dispatchActivate: () => dispatchLifecycle('activate'),
    get skipWaitingCalls() {
      return skipWaitingCalls
    },
    get claimCalls() {
      return claimCalls
    }
  }
}
