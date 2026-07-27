import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Fix } from 'utils/geo'
import { isFixFresh } from 'utils/geo'

const FIX_KEY = 'last-known-position'
const NEARBY_KEY = 'location-nearby-enabled'
const HERE_KEY = 'location-here-enabled'

export type LocationStatus = 'unsupported' | 'prompt' | 'granted' | 'denied' | 'error'

export interface LocationPreferences {
  /** The "Stasiun Terdekat" rail in the search sheet. */
  nearby: boolean
  /** Floating the station you're in to the top of the home list. */
  here: boolean
}

interface LocationContextType {
  /** False until the stored state has been read; gate UI on it to avoid a
   * banner or rail flashing in before we know the permission state. */
  isReady: boolean
  status: LocationStatus
  /** The stored fix at any age. For display only — the settings page shows it
   * with its age. Never position a feature off this; use `freshFix`. */
  fix: Fix | null
  /** The fix, or null once it is too old to describe where the user is now.
   * Features read this so none of them can forget the staleness rule. */
  freshFix: Fix | null
  request: () => Promise<boolean>
  clearFix: () => void
  prefs: LocationPreferences
  setNearbyEnabled: (enabled: boolean) => void
  setHereEnabled: (enabled: boolean) => void
}

const LocationContext = createContext<LocationContextType>({
  isReady: false,
  status: 'prompt',
  fix: null,
  freshFix: null,
  request: async () => false,
  clearFix: () => {},
  prefs: { nearby: true, here: true },
  setNearbyEnabled: () => {},
  setHereEnabled: () => {}
})

function readFix(): Fix | null {
  const raw = localStorage.getItem(FIX_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Fix
    const isUsable = typeof parsed?.lat === 'number'
      && typeof parsed?.lng === 'number'
      && typeof parsed?.accuracy === 'number'
      && typeof parsed?.at === 'number'
    if (!isUsable) {
      localStorage.removeItem(FIX_KEY)
      return null
    }
    return parsed
  } catch {
    localStorage.removeItem(FIX_KEY)
    return null
  }
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [status, setStatus] = useState<LocationStatus>('prompt')
  const [fix, setFix] = useState<Fix | null>(null)
  const [prefs, setPrefs] = useState<LocationPreferences>({ nearby: true, here: true })

  // Mirrors `status` for callbacks that must not re-subscribe every time it
  // changes (the visibility listener below).
  const statusRef = useRef<LocationStatus>('prompt')

  const applyStatus = useCallback((next: LocationStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  /*
   * Reads the sensor and stores the result. Only ever called from an explicit
   * tap, or when permission is ALREADY granted — so the app never raises a
   * permission dialog the user didn't ask for.
   */
  const request = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      applyStatus('unsupported')
      return false
    }

    return new Promise<boolean>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next: Fix = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            at: Date.now()
          }
          localStorage.setItem(FIX_KEY, JSON.stringify(next))
          setFix(next)
          applyStatus('granted')
          resolve(true)
        },
        (error) => {
          applyStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'error')
          resolve(false)
        },
        // High accuracy is not optional: the "kamu di sini" check discards any
        // fix vaguer than HERE_MAX_ACCURACY_M, which a coarse fix never beats.
        //
        // maximumAge is 0 deliberately. The FIX_TTL_MS gate already keeps this
        // to a handful of calls, so every one of them is a considered request
        // for the user's position NOW — and a cached reply can be minutes and
        // several stations behind on a moving train.
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
      )
    })
  }, [applyStatus])

  /*
   * Re-reads the sensor when the stored fix is too old to be believed. Reads
   * localStorage rather than state so it is safe to call from a listener
   * without re-subscribing, and does nothing unless permission is already
   * granted — it can never surface a dialog.
   */
  const refreshIfStale = useCallback(() => {
    if (statusRef.current !== 'granted') return
    if (isFixFresh(readFix())) return

    void request()
  }, [request])

  // Everything here is browser-only: the app prerenders in SPA mode, so
  // localStorage and navigator must not be touched during render.
  useEffect(() => {
    setPrefs({
      nearby: localStorage.getItem(NEARBY_KEY) !== 'false',
      here: localStorage.getItem(HERE_KEY) !== 'false'
    })

    const stored = readFix()
    setFix(stored)

    if (!('geolocation' in navigator)) {
      applyStatus('unsupported')
      setIsReady(true)
      return
    }

    // Permissions API is unavailable on older Safari. Without it we can't tell
    // 'prompt' from 'denied' up front, so we assume 'prompt' and find out when
    // the user asks — the same outcome, one tap later.
    if (!navigator.permissions?.query) {
      setIsReady(true)
      return
    }

    let cancelled = false

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        if (cancelled) return
        applyStatus(result.state)
        setIsReady(true)
        // Fires when the user flips the permission in browser settings while
        // the app is open, so the rail and banner correct themselves.
        result.onchange = () => {
          if (cancelled) return
          applyStatus(result.state)
        }

        // Refreshing here rather than in each consumer keeps it to one sensor
        // read even when the search sheet is open over the home screen.
        refreshIfStale()
      })
      .catch(() => {
        if (!cancelled) setIsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [applyStatus, refreshIfStale])

  /*
   * The provider sits in the root layout, so client-side navigation never
   * remounts it — without this an installed PWA resumed from the background
   * would keep serving a fix from whenever it was last cold-started, which
   * could be days and several cities ago.
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfStale()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshIfStale])

  const clearFix = useCallback(() => {
    localStorage.removeItem(FIX_KEY)
    setFix(null)
  }, [])

  const setNearbyEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(NEARBY_KEY, String(enabled))
    setPrefs(current => ({ ...current, nearby: enabled }))
  }, [])

  const setHereEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(HERE_KEY, String(enabled))
    setPrefs(current => ({ ...current, here: enabled }))
  }, [])

  // Evaluated per render rather than stored, so it can't go stale in state.
  // Identity is stable — it is either `fix` itself or null.
  const freshFix = isFixFresh(fix) ? fix : null

  return (
    <LocationContext.Provider value={{ isReady, status, fix, freshFix, request, clearFix, prefs, setNearbyEnabled, setHereEnabled }}>
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  const context = useContext(LocationContext)

  if (context === undefined) {
    throw new Error('useLocation must be used within a LocationProvider')
  }

  return context
}
