// Service worker registration and update handling.
//
// This used to be a bare register() call in root.tsx that did nothing with the
// registration — no update check, no controllerchange handling. That meant a
// long-lived PWA session could never discover a fixed worker, which matters
// because the worker is a static file: when it ships broken, the only way out
// is for a running tab to notice a new one.
//
// Dependencies are injected rather than read off globals so this can be driven
// under the node-only vitest config, matching map-context-recovery.ts.

// Shared with app/lib/boot-watchdog.ts. sessionStorage rather than
// localStorage: per-tab and dies with the tab, so a broken deploy can't
// permanently disable reload recovery for the fixed deploy that follows.
export const RECOVERY_STORAGE_KEY = 'commute:boot-recovery'

// A page that reloads more than this per tab session is looping, not
// recovering. The watchdog spends one of these; this leaves one for a genuine
// worker update in the same session.
export const MAX_RELOADS_PER_SESSION = 2

// mobile Safari fires visibilitychange on every app switch. Without a floor,
// each one would cost a network round trip to re-check the worker script.
export const UPDATE_THROTTLE_MS = 60_000

export interface RegistrationLike {
  update: () => Promise<unknown>
}

export interface ServiceWorkerDeps {
  /** False in dev, or when the browser has no service worker support. */
  enabled: boolean
  register: () => Promise<RegistrationLike>
  /** Whether a worker was already controlling this page at load time. */
  hasController: () => boolean
  onControllerChange: (handler: () => void) => void
  onVisibilityChange: (handler: () => void) => void
  isPageVisible: () => boolean
  reload: () => void
  now: () => number
  readCount: () => number
  writeCount: (value: number) => void
  onError: (error: unknown) => void
}

export function registerServiceWorker(deps: ServiceWorkerDeps): void {
  if (!deps.enabled) return

  // Captured before registering. If the page loaded with no controller, the
  // first controllerchange is this worker's own initial clients.claim() — not
  // an update. Reloading there would reload every user's very first visit.
  const hadController = deps.hasController()

  let reloading = false
  // Negative infinity, not 0: the first check must never be throttled, whatever
  // origin the clock happens to have.
  let lastUpdateCheck = Number.NEGATIVE_INFINITY
  let registration: RegistrationLike | null = null

  const claimReload = (): boolean => {
    try {
      const count = deps.readCount()
      if (count >= MAX_RELOADS_PER_SESSION) return false
      deps.writeCount(count + 1)
      return true
    } catch {
      // Storage disabled (private mode, blocked cookies). No working guard
      // means no automatic reload — the only safe default, since an unbounded
      // reload loop is exactly what can't be debugged on those devices.
      return false
    }
  }

  deps.onControllerChange(() => {
    if (!hadController || reloading) return
    if (!claimReload()) return
    reloading = true
    // The worker calls skipWaiting() + clients.claim(), so a new one takes over
    // a page that is already running against the old one's caching rules. That
    // is deliberate — it's what makes a worker fix land on the next page load
    // rather than eventually — and reloading here is what keeps the page and
    // its controller coherent. The app is a read-only timetable with no forms
    // and no unsaved state, so the interruption is cheap.
    deps.reload()
  })

  deps.onVisibilityChange(() => {
    if (!deps.isPageVisible() || registration === null) return
    const now = deps.now()
    if (now - lastUpdateCheck < UPDATE_THROTTLE_MS) return
    lastUpdateCheck = now
    Promise.resolve(registration.update()).catch(deps.onError)
  })

  deps.register()
    .then((value) => {
      registration = value
    })
    .catch(deps.onError)
}

/** Wires `registerServiceWorker` to real browser globals. */
export function createBrowserDeps(enabled: boolean): ServiceWorkerDeps {
  return {
    enabled: enabled && 'serviceWorker' in navigator,
    // updateViaCache: 'none' keeps the update check off the HTTP cache
    // entirely, so it never depends on edge or intermediary behaviour.
    register: () => navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }),
    hasController: () => Boolean(navigator.serviceWorker.controller),
    onControllerChange: handler =>
      navigator.serviceWorker.addEventListener('controllerchange', handler),
    onVisibilityChange: handler => document.addEventListener('visibilitychange', handler),
    isPageVisible: () => document.visibilityState === 'visible',
    reload: () => { window.location.reload() },
    now: () => Date.now(),
    readCount: () => Number(window.sessionStorage.getItem(RECOVERY_STORAGE_KEY) || 0),
    writeCount: (value) => { window.sessionStorage.setItem(RECOVERY_STORAGE_KEY, String(value)) },
    onError: (error) => { console.error('Service Worker registration failed:', error) }
  }
}
