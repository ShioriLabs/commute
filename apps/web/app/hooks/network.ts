import { useSyncExternalStore } from 'react'

export type NetworkStatus = 'ONLINE' | 'OFFLINE'

// One window-level subscription shared by every consumer — the home feed
// renders a card per saved station, and each used to register its own
// online/offline listener pair.
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('online', notify)
    window.addEventListener('offline', notify)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('online', notify)
      window.removeEventListener('offline', notify)
    }
  }
}

function getSnapshot(): NetworkStatus {
  return navigator.onLine ? 'ONLINE' : 'OFFLINE'
}

export function useNetworkStatus() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
