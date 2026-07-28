import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent
} from 'react'
import { useLocation } from 'react-router'
import clsx from 'clsx'
import { measureBox, morphStyle } from 'utils/morph'
import {
  FDTJ_MAP_H,
  FDTJ_MAP_W,
  FDTJ_PREVIEW_H,
  FDTJ_PREVIEW_W,
  previewCamera,
  type PreviewCamera
} from 'utils/map-morph-camera'
import { useReducedMotion } from '~/hooks/reduced-motion'

// Card → fullscreen morph for the map nav card. Unlike the sheets (which morph
// a dialog and never leave the page), tapping the map card runs a real route
// navigation — so this overlay lives in the layout that hosts both `/` and
// `/map` and plays *over* the navigation: it expands from the card showing the
// map's own preview image, holds while the route chunk/manifest/renderer load
// underneath, and fades once the canvas has painted the same preview at the
// same camera. The wait happens inside the gesture instead of on a spinner.

const MORPH_MS = 250
const MORPH_FALLBACK_MS = MORPH_MS + 150
const FACE_DELAY_MS = 50
const FACE_MS = 100
const FADE_MS = 200
const FADE_FALLBACK_MS = FADE_MS + 150
// If the map never reports a painted frame (dead network, renderer failure),
// the overlay must still get out of the way — the route's own fallback/error
// UI is underneath it.
const READY_TIMEOUT_MS = 4000

type Phase = 'idle' | 'morphing' | 'holding' | 'fading'

export interface MapMorphController {
  // Begin the morph from this element's rect. No-op while a morph is already
  // running or under prefers-reduced-motion (plain navigation is the reduced
  // experience; the map route's preview backdrop covers the wait).
  start(card: HTMLElement): void
  // Map route: first frame containing the map has been presented.
  notifyMapReady(): void
  // Map route: error state mounted — reveal it now.
  notifyMapFailed(): void
}

const noopController: MapMorphController = {
  start: () => {},
  notifyMapReady: () => {},
  notifyMapFailed: () => {}
}

const MapMorphContext = createContext<MapMorphController>(noopController)

export function useMapMorph(): MapMorphController {
  return useContext(MapMorphContext)
}

// The preview image positioned exactly where the map's first frame draws it:
// map.tsx's initial camera (utils/map-morph-camera.ts) applied to the natural-
// size image via a composited per-axis scale, matching how the renderer
// stretches the preview over the full viewBox. Shared between the morph
// overlay and the map route's loading fallback so both land on the same frame.
export function MapPreviewBackdrop() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<PreviewCamera | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const measure = () => setCamera(previewCamera(el.clientWidth, el.clientHeight))
    measure()
    // Transforms don't change layout size, so measuring while the overlay is
    // squashed onto the card still reads the fullscreen box.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" aria-hidden>
      {camera && (
        <img
          src="/maps/fdtj/preview.webp"
          alt=""
          draggable={false}
          width={FDTJ_PREVIEW_W}
          height={FDTJ_PREVIEW_H}
          // max-w-none is load-bearing: preflight's `max-width: 100%` would
          // shrink the natural-size layout box the scale is computed against.
          className="absolute top-0 left-0 origin-top-left max-w-none select-none blur-xs"
          style={{
            transform: `translate(${camera.tx}px, ${camera.ty}px) `
              + `scale(${camera.scale * FDTJ_MAP_W / FDTJ_PREVIEW_W}, ${camera.scale * FDTJ_MAP_H / FDTJ_PREVIEW_H})`
          }}
        />
      )}
    </div>
  )
}

export function MapMorphProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('idle')
  // The overlay first paints in its start state (transformed onto the card)
  // and only then gets the class that carries it to fullscreen — state-driven
  // so later re-renders (phase changes) can't accidentally strip it.
  const [open, setOpen] = useState(false)

  // Everything the transitionend/timeout handlers need synchronously lives in
  // refs; `phase` state exists only to drive rendering.
  const phaseRef = useRef<Phase>('idle')
  const readyRef = useRef(false)
  // Whether the navigation this morph plays over has committed (/map became
  // the location). Needed by the location guard: going *back* mid-morph lands
  // on the exact location the morph started from, so comparing keys alone
  // can't tell "still waiting for the push" from "user backed out".
  const navigatedRef = useRef(false)
  const cardBoxRef = useRef<ReturnType<typeof measureBox> | null>(null)
  const cardRadiusRef = useRef(0)
  const startLocationKeyRef = useRef<string | null>(null)
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const morphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const location = useLocation()
  const locationKeyRef = useRef(location.key)
  locationKeyRef.current = location.key

  const reducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const clearTimer = (ref: { current: ReturnType<typeof setTimeout> | null }) => {
    if (ref.current !== null) clearTimeout(ref.current)
    ref.current = null
  }

  const reset = useCallback(() => {
    clearTimer(readyTimerRef)
    clearTimer(morphTimerRef)
    clearTimer(fadeTimerRef)
    readyRef.current = false
    setOpen(false)
    changePhase('idle')
  }, [changePhase])

  const beginFade = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'fading') return
    clearTimer(readyTimerRef)
    clearTimer(morphTimerRef)
    changePhase('fading')
    fadeTimerRef.current = setTimeout(reset, FADE_FALLBACK_MS)
  }, [changePhase, reset])

  const finishMorph = useCallback(() => {
    if (phaseRef.current !== 'morphing') return
    clearTimer(morphTimerRef)
    if (readyRef.current) beginFade()
    else changePhase('holding')
  }, [beginFade, changePhase])

  const start = useCallback((card: HTMLElement) => {
    if (phaseRef.current !== 'idle') return
    if (reducedMotionRef.current) return

    cardBoxRef.current = measureBox(card)
    // Read rather than hardcoded, same as the sheet morph: tracks the card's
    // actual rounding.
    cardRadiusRef.current = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0
    startLocationKeyRef.current = locationKeyRef.current
    readyRef.current = false
    navigatedRef.current = false
    changePhase('morphing')
    readyTimerRef.current = setTimeout(beginFade, READY_TIMEOUT_MS)
    // Covers a transform transitionend that never fires (degenerate morph,
    // hidden tab) — same belt as the boot splash.
    morphTimerRef.current = setTimeout(finishMorph, MORPH_FALLBACK_MS)
  }, [beginFade, changePhase, finishMorph])

  const notifyMapReady = useCallback(() => {
    if (phaseRef.current === 'morphing') readyRef.current = true
    else if (phaseRef.current === 'holding') beginFade()
  }, [beginFade])

  const notifyMapFailed = useCallback(() => {
    if (phaseRef.current !== 'idle') beginFade()
  }, [beginFade])

  const controller = useMemo<MapMorphController>(
    () => ({ start, notifyMapReady, notifyMapFailed }),
    [start, notifyMapReady, notifyMapFailed]
  )

  // Back/popstate mid-morph, or any navigation that doesn't land on /map:
  // the overlay must not sit over a page it doesn't belong to. The start
  // location itself is only exempt *before* the /map push commits — once it
  // has, arriving anywhere that isn't /map (including back at the start
  // location) dismisses the overlay.
  useEffect(() => {
    if (phaseRef.current === 'idle') return
    if (location.pathname === '/map') {
      navigatedRef.current = true
      return
    }
    if (navigatedRef.current || location.key !== startLocationKeyRef.current) beginFade()
  }, [location, beginFade])

  useEffect(() => reset, [reset])

  // Ref callback rather than an effect: it runs during commit, so the start
  // transform is in place before the overlay's first paint (the same portal-
  // timing reasoning as SheetButton's setPanelRef). The release happens a
  // double rAF later, NOT synchronously: a newly inserted element has no
  // before-change style, so a set-reflow-unset in the insertion tick never
  // starts a transition — the start state must survive into a painted frame
  // before it is released (standard FLIP timing). The card face covers those
  // one or two squashed frames.
  const setOverlayRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || phaseRef.current !== 'morphing') return

    const cardBox = cardBoxRef.current
    const morph = cardBox ? morphStyle(cardBox, measureBox(node), cardRadiusRef.current) : null
    if (!morph) {
      // No usable geometry (zero-area box): appear fullscreen and let the
      // fade-out do the work — a plain reveal, worse than the morph but intact.
      finishMorph()
      setOpen(true)
      return
    }

    node.style.transform = morph.transform
    node.style.borderRadius = morph.radius
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (phaseRef.current !== 'morphing' || !node.isConnected) return
        node.style.removeProperty('transform')
        node.style.removeProperty('border-radius')
        setOpen(true)
      })
    })
  }, [finishMorph])

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    // Only the overlay's own box: the face mask's opacity bubbles up from a
    // child and would otherwise end the morph early.
    if (event.target !== event.currentTarget) return
    if (event.propertyName === 'transform') finishMorph()
    else if (event.propertyName === 'opacity' && phaseRef.current === 'fading') reset()
  }

  return (
    <MapMorphContext.Provider value={controller}>
      {children}
      {phase !== 'idle' && (
        <div
          ref={setOverlayRef}
          onTransitionEnd={handleTransitionEnd}
          aria-hidden
          data-map-morph
          className={clsx(
            'map-morph-overlay fixed inset-0 z-40 overflow-hidden origin-top-left transform-gpu bg-[#FFF8F8] pointer-events-none',
            open && 'map-morph-open',
            phase === 'fading' && 'map-morph-fading'
          )}
          style={{
            '--map-morph-ms': `${MORPH_MS}ms`,
            '--map-morph-fade-ms': `${FADE_MS}ms`,
            '--map-morph-face-ms': `${FACE_MS}ms`,
            '--map-morph-face-delay-ms': `${FACE_DELAY_MS}ms`
          } as CSSProperties}
        >
          <MapPreviewBackdrop />
          <div className="map-morph-face" />
        </div>
      )}
    </MapMorphContext.Provider>
  )
}
