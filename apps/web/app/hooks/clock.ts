import { useSyncExternalStore } from 'react'

// One shared 10s clock for every relative-time display. Each LineCard used to
// own a setInterval, so a home feed with N saved stations ran ~N independent
// timers, each re-rendering its subtree on its own phase — and kept ticking
// while the tab was hidden. One store means one timer, one batched re-render
// per tick, and a full pause while the document is hidden (with an immediate
// catch-up tick on return, so stale "5 mnt" labels correct themselves).

const TICK_MS = 10000

const listeners = new Set<() => void>()
let now = Date.now()
let interval: ReturnType<typeof setInterval> | null = null

function tick() {
  now = Date.now()
  for (const listener of listeners) listener()
}

function start() {
  if (interval === null && !document.hidden) {
    interval = setInterval(tick, TICK_MS)
  }
}

function stop() {
  if (interval !== null) {
    clearInterval(interval)
    interval = null
  }
}

function handleVisibility() {
  if (document.hidden) {
    stop()
  } else {
    tick()
    if (listeners.size > 0) start()
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener('visibilitychange', handleVisibility)
    // Refresh the snapshot so a subscriber arriving after an idle stretch
    // doesn't render against a stale clock. React re-reads the snapshot right
    // after subscribing, so this change is picked up without a notify.
    now = Date.now()
    start()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }
}

function getSnapshot() {
  return now
}

/** Epoch ms, refreshed every 10s while the tab is visible. */
export function useClock() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
