// Recovery controller for a lost WebGL context.
//
// The browser takes the map's GL context away when it needs the memory back —
// almost always while the PWA is sitting in the background — and by spec it
// won't hand one over again unless the page asks. A canvas whose context is
// lost renders as Chromium's broken-canvas glyph: the sad face users were
// seeing on resume.
//
// Recovery means building a fresh context, and *when* matters more than it
// looks:
//   - Doing it inline from the `webglcontextlost` handler returns null. Blink is
//     still tearing the drawing buffer down at that point.
//   - Doing it while the page is hidden returns null too, and would be wasted
//     work even if it didn't.
//   - Doing it immediately after a GPU process crash returns null, because the
//     GPU process hasn't come back yet.
// So: wait for visible, then back off. Hence a state machine and not a loop.
//
// It gives up after a handful of attempts on purpose. Blink blacklists WebGL for
// a page that keeps losing its context ("Rats! WebGL hit a snag"), and a
// blacklisted page draws the *same* broken-canvas glyph with no way back except
// a reload. Hammering would turn a recoverable failure into a permanent one.

export type RecoveryState =
  // Context is healthy (or has never been lost).
  | 'idle'
  // Context is gone; waiting for the page to be visible before trying.
  | 'lost'
  // Visible, waiting out the backoff before the next attempt.
  | 'armed'
  // A rebuild is in flight; waiting to hear whether it worked.
  | 'attempting'
  // Out of attempts. Only reset() leaves this state.
  | 'fatal'

// One entry per attempt, so the length doubles as the attempt cap.
export const RECOVERY_BACKOFF_MS = [250, 750, 2000, 5000, 10000]
export const MAX_RECOVERY_ATTEMPTS = RECOVERY_BACKOFF_MS.length
// How long a rebuilt context has to survive before it counts as a real
// recovery and the attempt counter goes back to zero.
export const RECOVERY_STABLE_MS = 30_000

export interface RecoveryController {
  state(): RecoveryState
  attempts(): number
  // The context is gone. Safe to call repeatedly and from more than one
  // detector: on resume the queued `webglcontextlost` event and the
  // visibilitychange check both fire, in no guaranteed order, and must
  // collapse into a single recovery.
  notifyLost(): void
  // The page became visible. Releases a recovery that was waiting on it.
  notifyVisible(): void
  // A rebuild produced a working renderer.
  notifyAttemptSucceeded(): void
  // A rebuild threw, or produced no usable context.
  notifyAttemptFailed(): void
  // Start over from a clean slate — the retry button out of 'fatal'.
  reset(): void
  // Lifecycle, and it must be used as a symmetric pair from an effect. React
  // can disconnect a subtree's passive effects and reconnect them later without
  // the component ever unmounting (Suspense, <Activity>), so a controller that
  // only had a teardown hook would be silently dead for the rest of the
  // session — which is exactly the bug that made the first cut of this never
  // recover. activate() therefore has to be able to resume a recovery, not just
  // start one.
  activate(): void
  deactivate(): void
}

export interface RecoveryDeps {
  // Build a new renderer against a new canvas. Must eventually call back with
  // notifyAttemptSucceeded() or notifyAttemptFailed().
  rebuild(): void
  isPageVisible(): boolean
  onStateChange?(state: RecoveryState): void
  // Injectable so tests can drive the clock.
  setTimer?(fn: () => void, ms: number): number
  clearTimer?(id: number): void
}

export function createRecoveryController(deps: RecoveryDeps): RecoveryController {
  const setTimer = deps.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((id: number) => window.clearTimeout(id))

  let state: RecoveryState = 'idle'
  let attempts = 0
  let timer: number | null = null
  // Starts true so a loss reported between render and the activating effect
  // isn't dropped.
  let active = true

  function transition(next: RecoveryState) {
    if (state === next) return
    state = next
    deps.onStateChange?.(next)
  }

  function cancelTimer() {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  function arm() {
    cancelTimer()
    transition('armed')
    const delay = RECOVERY_BACKOFF_MS[Math.min(attempts, RECOVERY_BACKOFF_MS.length - 1)]
    timer = setTimer(() => {
      timer = null
      if (!active) return
      transition('attempting')
      deps.rebuild()
    }, delay)
  }

  // Shared by the initial loss and by every failed attempt: try now if we can,
  // otherwise park in 'lost' until the page comes back to the foreground.
  function scheduleOrPark() {
    if (deps.isPageVisible()) {
      arm()
      return
    }
    cancelTimer()
    transition('lost')
  }

  return {
    state: () => state,
    attempts: () => attempts,

    notifyLost() {
      if (!active) return
      // Anything other than 'idle' means a recovery is already under way (or we
      // have given up), so a second detector reporting the same loss is a no-op.
      if (state !== 'idle') return
      scheduleOrPark()
    },

    notifyVisible() {
      if (!active) return
      if (state !== 'lost') return
      arm()
    },

    notifyAttemptSucceeded() {
      if (!active) return
      cancelTimer()
      transition('idle')
      // The attempt counter is deliberately *not* zeroed here. A context that
      // is handed back and taken away again a second later would otherwise
      // retry forever at the shortest backoff — the exact behaviour that gets a
      // page's WebGL blacklisted. Only a context that survives a while counts.
      if (attempts > 0) {
        timer = setTimer(() => {
          timer = null
          attempts = 0
        }, RECOVERY_STABLE_MS)
      }
    },

    notifyAttemptFailed() {
      if (!active) return
      attempts += 1
      if (attempts >= MAX_RECOVERY_ATTEMPTS) {
        cancelTimer()
        transition('fatal')
        return
      }
      scheduleOrPark()
    },

    reset() {
      if (!active) return
      attempts = 0
      cancelTimer()
      transition('idle')
    },

    activate() {
      active = true
      // Pick a recovery back up rather than assume a clean start: this runs
      // again after any reconnect, and a loss reported while inactive would
      // otherwise sit here forever.
      if (state === 'lost' || state === 'armed') scheduleOrPark()
    },

    deactivate() {
      active = false
      cancelTimer()
    }
  }
}
