import { describe, expect, it } from 'vitest'
import {
  BOOT_FALLBACK_COPY,
  BOOT_RECOVERY_STORAGE_KEY,
  BOOT_TIMEOUT_MS,
  BOOT_WATCHDOG_SOURCE,
  RECOVERABLE_CACHES,
  STALE_SHELL_MESSAGE
} from './boot-watchdog'
import { RECOVERY_STORAGE_KEY } from './register-service-worker'

// What register-service-worker writes to *its* key when a new worker takes over
// a controlled page. The watchdog keys its budget separately, so this must not
// affect it — see 'still recovers after a worker-update reload'.
const SW_UPDATE_RELOADS_SPENT = 1

// The watchdog ships as an inline classic script, so it can't be imported. It
// reads everything off a single `w` parameter precisely so it can be driven
// here against a fake window — the same new Function trick the service worker
// tests use.

interface FakeElement {
  id: string
  hidden: boolean
  textContent: string
  attributes: Record<string, string>
  listeners: Record<string, (() => void)[]>
  setAttribute: (name: string, value: string) => void
  addEventListener: (type: string, handler: () => void) => void
  click: () => void
}

function createElement(id: string): FakeElement {
  const element: FakeElement = {
    id,
    hidden: true,
    textContent: '',
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      element.attributes[name] = value
    },
    addEventListener(type, handler) {
      element.listeners[type] = element.listeners[type] || []
      element.listeners[type].push(handler)
    },
    click() {
      for (const handler of element.listeners.click || []) handler()
    }
  }
  return element
}

function setup(options: {
  onLine?: boolean
  storage?: 'ok' | 'throws'
  /** Seeds the watchdog's own reload budget. */
  stored?: string
  /** Seeds the service-worker updater's separate reload budget. */
  swStored?: string
  /** Simulates a failure detected while <head> is still parsing. */
  bodyParsed?: boolean
} = {}) {
  const elements = new Map<string, FakeElement>([
    ['boot-fallback', createElement('boot-fallback')],
    ['boot-fallback-message', createElement('boot-fallback-message')],
    ['boot-fallback-retry', createElement('boot-fallback-retry')]
  ])
  const splash = createElement('splash')
  let bodyParsed = options.bodyParsed ?? true
  const documentListeners: Record<string, (() => void)[]> = {}

  const windowListeners: Record<string, ((event: unknown) => void)[]> = {}
  const swListeners: Record<string, ((event: unknown) => void)[]> = {}
  const timers = new Map<number, { fn: () => void, ms: number }>()
  const deletedCaches: string[] = []
  let nextTimerId = 1
  let reloads = 0
  let unregisters = 0
  const store = new Map<string, string>()
  // Seeds the *watchdog's* own budget key. Tests that need to simulate the
  // service-worker updater having spent its budget seed `swStored` instead —
  // the two are deliberately independent.
  if (options.stored !== undefined) store.set(BOOT_RECOVERY_STORAGE_KEY, options.stored)
  if (options.swStored !== undefined) store.set(RECOVERY_STORAGE_KEY, options.swStored)

  const throwingStorage = {
    getItem: () => { throw new Error('storage disabled') },
    setItem: () => { throw new Error('storage disabled') },
    removeItem: () => { throw new Error('storage disabled') }
  }

  const w = {
    Promise,
    document: {
      getElementById: (id: string) => (bodyParsed ? elements.get(id) ?? null : null),
      querySelector: (selector: string) =>
        (bodyParsed && selector === '[data-boot-splash]' ? splash : null),
      addEventListener(type: string, handler: () => void) {
        documentListeners[type] = documentListeners[type] || []
        documentListeners[type].push(handler)
      }
    },
    navigator: {
      onLine: options.onLine ?? true,
      serviceWorker: {
        addEventListener(type: string, handler: (event: unknown) => void) {
          swListeners[type] = swListeners[type] || []
          swListeners[type].push(handler)
        },
        getRegistrations: async () => [{
          unregister: async () => {
            unregisters++
            return true
          }
        }]
      }
    },
    caches: {
      delete: async (name: string) => {
        deletedCaches.push(name)
        return true
      }
    },
    sessionStorage: options.storage === 'throws'
      ? throwingStorage
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => { store.set(key, value) },
          removeItem: (key: string) => { store.delete(key) }
        },
    location: { reload: () => { reloads++ } },
    addEventListener(type: string, handler: (event: unknown) => void) {
      windowListeners[type] = windowListeners[type] || []
      windowListeners[type].push(handler)
    },
    setTimeout(fn: () => void, ms: number) {
      const id = nextTimerId++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
    __commuteBoot: undefined as { ok: () => void, retry: () => void } | undefined
  }

  new Function('window', BOOT_WATCHDOG_SOURCE)(w)

  const fire = (type: string, event: unknown) => {
    for (const handler of windowListeners[type] || []) handler(event)
  }

  return {
    boot: () => w.__commuteBoot!,
    panel: elements.get('boot-fallback')!,
    message: elements.get('boot-fallback-message')!,
    retryButton: elements.get('boot-fallback-retry')!,
    splash,
    deletedCaches,
    reloads: () => reloads,
    unregisters: () => unregisters,
    stored: () => store.get(BOOT_RECOVERY_STORAGE_KEY),
    swStored: () => store.get(RECOVERY_STORAGE_KEY),
    fireBootTimeout: () => {
      const due = [...timers.entries()].filter(([, t]) => t.ms === BOOT_TIMEOUT_MS)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.fn()
      }
    },
    fireScriptError: (src: string, tagName = 'SCRIPT') =>
      fire('error', { target: { tagName, src } }),
    fireRejection: () => fire('unhandledrejection', {}),
    fireStaleShellMessage: () => {
      for (const handler of swListeners.message || []) {
        handler({ data: { type: STALE_SHELL_MESSAGE } })
      }
    },
    parseBody: () => {
      bodyParsed = true
      for (const handler of documentListeners.DOMContentLoaded || []) handler()
    },
    // Recovery chains a few promises before reloading; a macrotask tick drains
    // them without depending on how many there are.
    settle: () => new Promise(resolve => globalThis.setTimeout(resolve, 0))
  }
}

describe('boot watchdog', () => {
  it('stands down once hydration reports success', async () => {
    const harness = setup({ stored: '1' })
    harness.boot().ok()
    harness.fireBootTimeout()
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.panel.hidden).toBe(true)
    // A successful boot resets the budget for the next session.
    expect(harness.stored()).toBeUndefined()
  })

  it('ignores a rejection that arrives after hydration', async () => {
    const harness = setup()
    harness.boot().ok()
    harness.fireRejection()
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.panel.hidden).toBe(true)
  })

  // The whole loop-safety story: a slow connection produces a timeout routinely,
  // and reloading on it would make a slow load worse rather than better.
  it('shows the retry UI without reloading when only the timeout fires', async () => {
    const harness = setup()
    harness.fireBootTimeout()
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.panel.hidden).toBe(false)
    expect(harness.message.textContent).toBe(BOOT_FALLBACK_COPY.slow)
    expect(harness.splash.attributes['aria-busy']).toBe('false')
  })

  it('recovers once on an unhandled module rejection', async () => {
    const harness = setup()
    harness.fireRejection()
    await harness.settle()

    expect(harness.reloads()).toBe(1)
    expect(harness.unregisters()).toBe(1)
    expect(harness.deletedCaches).toEqual(RECOVERABLE_CACHES)
  })

  // The tile set is the one thing recovery must never cost the user.
  it('never clears the map tile cache', async () => {
    const harness = setup()
    harness.fireRejection()
    await harness.settle()

    // Matched by prefix rather than by exact name: the tile cache is now
    // `pwa-cache-v5-<build>` and rotates on every re-tile, so pinning one
    // literal here would quietly go vacuous the first time the tiles changed.
    expect(harness.deletedCaches.some(name => name.startsWith('pwa-cache'))).toBe(false)
  })

  it('recovers on a failed asset script element', async () => {
    const harness = setup()
    harness.fireScriptError('/assets/entry.client-ABC123.js')
    await harness.settle()

    expect(harness.reloads()).toBe(1)
  })

  it('recovers on a failed asset stylesheet', async () => {
    const harness = setup()
    harness.fireScriptError('/assets/root-ABC123.css', 'LINK')
    await harness.settle()

    expect(harness.reloads()).toBe(1)
  })

  it('ignores a broken image outside /assets/', async () => {
    const harness = setup()
    harness.fireScriptError('/img/og-image.png', 'IMG')
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.panel.hidden).toBe(true)
  })

  it('recovers when the service worker reports a stale shell', async () => {
    const harness = setup()
    harness.fireStaleShellMessage()
    await harness.settle()

    expect(harness.reloads()).toBe(1)
  })

  it('reloads only once when several signals arrive together', async () => {
    const harness = setup()
    harness.fireRejection()
    harness.fireScriptError('/assets/entry.client-ABC123.js')
    harness.fireStaleShellMessage()
    await harness.settle()

    expect(harness.reloads()).toBe(1)
  })

  it('shows the retry UI instead of reloading when the budget is spent', async () => {
    const harness = setup({ stored: '1' })
    harness.fireRejection()
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.message.textContent).toBe(BOOT_FALLBACK_COPY.failed)
  })

  // The scenario that produced the 504-stale-asset console: a deploy lands on a
  // live tab, the new worker claims it, and register-service-worker reloads once
  // — spending from its own budget. The reloaded page is still the *old* shell
  // (the HTTP cache had it), so the SW answers its chunk requests with a stale
  // 504 and posts commute:stale-shell. The watchdog must still have a life left
  // to spend, or the tab is stranded on the retry panel for good.
  it('still recovers after a worker-update reload has already happened', async () => {
    const harness = setup({ swStored: String(SW_UPDATE_RELOADS_SPENT) })
    harness.fireStaleShellMessage()
    await harness.settle()

    expect(harness.reloads()).toBe(1)
  })

  it('does not reload when sessionStorage is unavailable', async () => {
    const harness = setup({ storage: 'throws' })
    harness.fireRejection()
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.message.textContent).toBe(BOOT_FALLBACK_COPY.failed)
  })

  it('tells an offline user to reconnect rather than reloading', async () => {
    const harness = setup({ onLine: false })
    harness.fireRejection()
    await harness.settle()

    expect(harness.reloads()).toBe(0)
    expect(harness.message.textContent).toBe(BOOT_FALLBACK_COPY.offline)
  })

  // The watchdog runs in <head>, and a modulepreload in that same <head> can
  // fail before <body> exists. Revealing the panel then would find nothing,
  // and because fail() has already latched, the splash would stay up forever —
  // the exact hang this whole thing exists to prevent.
  it('still reveals the retry UI when the failure precedes the body', async () => {
    const harness = setup({ bodyParsed: false, stored: '1' })
    harness.fireRejection()
    await harness.settle()
    expect(harness.panel.hidden).toBe(true)

    harness.parseBody()

    expect(harness.panel.hidden).toBe(false)
    expect(harness.message.textContent).toBe(BOOT_FALLBACK_COPY.failed)
    expect(harness.splash.attributes['aria-busy']).toBe('false')
  })

  it('wires the retry button even on the deferred path', async () => {
    const harness = setup({ bodyParsed: false, stored: '1' })
    harness.fireRejection()
    await harness.settle()
    harness.parseBody()

    harness.retryButton.click()
    await harness.settle()

    expect(harness.reloads()).toBe(1)
  })

  it('reloads on a retry tap even after the budget is spent', async () => {
    const harness = setup({ stored: '1' })
    harness.fireRejection()
    await harness.settle()
    expect(harness.reloads()).toBe(0)

    harness.retryButton.click()
    await harness.settle()

    expect(harness.reloads()).toBe(1)
    expect(harness.stored()).toBeUndefined()
  })
})
