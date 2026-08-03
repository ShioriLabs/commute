// Detects a hydration that never happens, and recovers from it once.
//
// The prerendered shell in build/client/index.html ends with a static
// `import "/assets/manifest-<hash>.js"` followed by a bare
// `import("/assets/entry.client-<hash>.js")` with no .catch(). If any of those
// modules fails to load — most often because a cached shell from a previous
// deploy is pointing at hashes the origin no longer serves — the import rejects
// into nothing, React never hydrates, and root.tsx's HydrateFallback breathes
// forever with no timeout and no way out.
//
// This has to run as an inline classic script in the shell, not as part of the
// bundle. The decisive reason is the *static* import on the first line of that
// generated module: a static import failure aborts the whole module before a
// single statement in it executes, so no handler registered inside it can ever
// see the failure. Only an outside observer can. That also rules out a custom
// entry.client.tsx (it is the module that fails) and an external
// <script src> (one more resource that can 404 or arrive late).
//
// The source is a string rather than real module code because it is injected
// via dangerouslySetInnerHTML. Everything is read off the single `w` parameter
// so app/lib/boot-watchdog.test.ts can run it against a fake window.

// The watchdog's reload budget is deliberately NOT the one in
// register-service-worker.ts. They used to share RECOVERY_STORAGE_KEY, and the
// collision had teeth: a deploy landing on a live tab fires controllerchange,
// the updater reloads once and writes 1, and the reloaded page can still come
// up on the previous shell (the HTTP cache had it). The service worker then
// answers its chunk requests with a synthetic 504 and posts
// commute:stale-shell — and the watchdog, reading a budget someone else had
// already spent, showed the retry panel instead of recovering. Two independent
// causes of a reload need two independent budgets; sharing one meant the more
// common event could disarm the rarer, more serious one.
export const BOOT_RECOVERY_STORAGE_KEY = 'commute:boot-watchdog-recovery'

// Caches the watchdog may clear. The tile cache (`pwa-cache-v5-<build>`, named
// after the hash build-map-tiles.ts stamps into the worker) is deliberately
// absent: it holds the 8.6 MiB raster set, and a recovery that re-downloaded
// that would be worse than the failure it is recovering from. An allowlist
// rather than a denylist, so a rotated tile cache name can never fall into it.
export const RECOVERABLE_CACHES = ['commute-shell-v1', 'commute-assets-v1']

// How long hydration gets before the watchdog assumes it is not coming. Only
// ever reveals the retry UI — a timeout alone is not evidence of failure, and a
// slow connection must not trigger a reload.
export const BOOT_TIMEOUT_MS = 10_000

// Cap on the cache-clearing and unregistering, so a hung CacheStorage cannot
// strand the user in place of the splash this is meant to escape.
export const RECOVERY_DEADLINE_MS = 1500

export const STALE_SHELL_MESSAGE = 'commute:stale-shell'

export const BOOT_FALLBACK_ID = 'boot-fallback'
export const BOOT_FALLBACK_MESSAGE_ID = 'boot-fallback-message'
export const BOOT_FALLBACK_RETRY_ID = 'boot-fallback-retry'

// Indonesian, matching the app's register ("Memuat...", the offline banners).
export const BOOT_FALLBACK_COPY = {
  slow: 'Lama banget ya? Coba muat ulang.',
  offline: 'Kamu lagi offline dan datanya belum tersimpan. Sambungin internet dulu, ya.',
  failed: 'Gagal memuat aplikasi. Coba muat ulang.'
}

export const BOOT_WATCHDOG_SOURCE = `
;(function (w) {
  var hydrated = false
  var recovered = false
  var timer = null

  var RECOVERABLE = ${JSON.stringify(RECOVERABLE_CACHES)}
  var COPY = ${JSON.stringify(BOOT_FALLBACK_COPY)}
  var STORAGE_KEY = ${JSON.stringify(BOOT_RECOVERY_STORAGE_KEY)}

  function readCount() {
    return Number(w.sessionStorage.getItem(STORAGE_KEY) || 0)
  }

  // Returns false when no reload is allowed. Storage throwing (private mode,
  // blocked cookies) counts as "no working guard", and no working guard means
  // no automatic reload — an unbounded reload loop is the worse failure, and
  // the one that cannot be debugged on the devices where storage is blocked.
  function claimAttempt() {
    try {
      if (readCount() >= 1) return false
      w.sessionStorage.setItem(STORAGE_KEY, '1')
      return true
    } catch (err) {
      return false
    }
  }

  function clearGuard() {
    try {
      w.sessionStorage.removeItem(STORAGE_KEY)
    } catch (err) { /* nothing to clear */ }
  }

  function revealRetryUi(reason) {
    var panel = w.document.getElementById(${JSON.stringify(BOOT_FALLBACK_ID)})
    var message = w.document.getElementById(${JSON.stringify(BOOT_FALLBACK_MESSAGE_ID)})
    if (message) message.textContent = COPY[reason] || COPY.failed
    if (panel) panel.hidden = false
    var splash = w.document.querySelector('[data-boot-splash]')
    if (splash) splash.setAttribute('aria-busy', 'false')
    // Wired here rather than at startup: this script runs in <head>, so the
    // button hasn't been parsed yet at that point.
    var retry = w.document.getElementById(${JSON.stringify(BOOT_FALLBACK_RETRY_ID)})
    if (retry) {
      retry.addEventListener('click', function () {
        w.__commuteBoot.retry()
      })
    }
  }

  // This script runs in <head>, and the failures it watches for are fast: a
  // modulepreload in the same <head> can 504 before <body> has been parsed at
  // all. Revealing the panel then would silently find nothing and leave the
  // splash up forever, because fail() has already latched. So if the panel
  // isn't there yet, wait for it.
  function showRetryUi(reason) {
    if (w.document.getElementById(${JSON.stringify(BOOT_FALLBACK_ID)})) {
      return revealRetryUi(reason)
    }
    w.document.addEventListener('DOMContentLoaded', function () {
      revealRetryUi(reason)
    })
  }

  function withDeadline(promises) {
    return new w.Promise(function (resolve) {
      var done = false
      function finish() {
        if (done) return
        done = true
        resolve()
      }
      w.setTimeout(finish, ${RECOVERY_DEADLINE_MS})
      w.Promise.all(promises).then(finish, finish)
    })
  }

  function purge() {
    var jobs = []
    try {
      if (w.caches) {
        for (var i = 0; i < RECOVERABLE.length; i++) jobs.push(w.caches.delete(RECOVERABLE[i]))
      }
    } catch (err) { /* CacheStorage unavailable; the reload alone may be enough */ }
    try {
      if (w.navigator.serviceWorker) {
        jobs.push(w.navigator.serviceWorker.getRegistrations().then(function (regs) {
          return w.Promise.all(regs.map(function (reg) { return reg.unregister() }))
        }))
      }
    } catch (err) { /* nothing registered */ }
    return withDeadline(jobs)
  }

  // hasEvidence is the whole loop-safety story: only a signal that positively
  // proves a load failure earns an automatic reload. A bare timeout — which a
  // slow connection produces routinely — just reveals the retry button.
  function fail(hasEvidence) {
    if (hydrated || recovered) return
    recovered = true
    if (timer !== null) w.clearTimeout(timer)

    if (!hasEvidence) return showRetryUi('slow')
    if (!w.navigator.onLine) return showRetryUi('offline')
    if (!claimAttempt()) return showRetryUi('failed')

    purge().then(function () { w.location.reload() })
  }

  function isAssetElement(target) {
    if (!target || !target.tagName) return false
    var tag = target.tagName
    if (tag !== 'SCRIPT' && tag !== 'LINK') return false
    var href = target.src || target.href || ''
    return href.indexOf('/assets/') !== -1
  }

  w.addEventListener('error', function (event) {
    if (isAssetElement(event.target)) fail(true)
  }, true)

  w.addEventListener('unhandledrejection', function () {
    fail(true)
  })

  try {
    if (w.navigator.serviceWorker) {
      w.navigator.serviceWorker.addEventListener('message', function (event) {
        if (event && event.data && event.data.type === ${JSON.stringify(STALE_SHELL_MESSAGE)}) {
          fail(true)
        }
      })
    }
  } catch (err) { /* no service worker to hear from */ }

  timer = w.setTimeout(function () { fail(false) }, ${BOOT_TIMEOUT_MS})

  w.__commuteBoot = {
    ok: function () {
      hydrated = true
      if (timer !== null) w.clearTimeout(timer)
      // A successful boot resets the budget, so the next session starts fresh.
      clearGuard()
    },
    retry: function () {
      // User-initiated, so it is always allowed regardless of the guard.
      clearGuard()
      purge().then(function () { w.location.reload() })
    }
  }
})(window)
`
