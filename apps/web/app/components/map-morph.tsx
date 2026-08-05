import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  FDTJ_PREVIEW_W
} from 'utils/map-morph-camera'
import { MAP_PREVIEW_URL } from '~/lib/map-assets'
import { useMapCamera } from '~/hooks/map-camera'
import { useReducedMotion } from '~/hooks/reduced-motion'
import { MapSkeleton, prefetchMapSkeleton, type SkeletonDoc } from './map-skeleton'

// Card → fullscreen morph for the map nav card. Unlike the sheets (which morph
// a dialog and never leave the page), tapping the map card runs a real route
// navigation — so this overlay lives in the layout that hosts both `/` and
// `/map` and plays *over* the navigation: it expands from the card showing the
// paper sheet, draws the network while the route chunk/manifest/renderer load
// underneath, and fades once the canvas has painted its first frame at the same
// camera the drawing used. The wait happens inside the gesture instead of on a
// spinner.
//
// The map route also enters here directly (startDirect), without a card to morph
// from. That is not just for consistency: `/map`'s own loading fallback only
// covers the manifest fetch, which is a 439-byte prewarmed request, and the real
// wait — renderer construction, points, preview upload, first draw — happens
// after it, on a route that renders a bare canvas. Routing both entries through
// this overlay is what gives that window anything at all.

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

// Skeleton draw. DRAW is the whole cascade: the last corridor starts at SPAN and
// takes STROKE to finish, so SPAN + STROKE is the budget.
const SKELETON_STROKE_MS = 620
const SKELETON_SPAN_MS = 280
const SKELETON_DRAW_MS = SKELETON_SPAN_MS + SKELETON_STROKE_MS
// How long the draw is allowed to run before a ready signal may cut it short.
// This is the one number that decides whether the animation feels like a drawing
// or a flash: on a warm service-worker cache the map reports ready ~50ms in, and
// compressing the whole network into the settle window from there reads as a pop.
// The cost is that a warm open is up to MIN_DRAW + SETTLE slower than it was.
const SKELETON_MIN_DRAW_MS = 260
const SKELETON_SETTLE_MS = 150
// Longer than FADE_MS on purpose — see .map-skeleton in app.css.
const SKELETON_FADE_MS = 260
// One station marker popping in. Short relative to the stroke: a marker is punctuation on
// a line that is already being drawn, not an entrance of its own.
const SKELETON_STATION_MS = 220
// Starting a 900ms draw long after the gesture is worse than not drawing at all,
// so past this the overlay just holds as it always did. Card entries only: a
// direct entry has no gesture to stay close to, and its alternative to a late
// draw is staring at blank paper until the canvas is ready — so direct draws
// whenever the geometry lands, however late.
const SKELETON_LOAD_BUDGET_MS = 500

type Phase = 'idle' | 'morphing' | 'drawing' | 'settling' | 'holding' | 'fading'

export interface MapMorphController {
  // Begin the morph from this element's rect. No-op while a morph is already
  // running or under prefers-reduced-motion (plain navigation is the reduced
  // experience; the map route's preview backdrop covers the wait).
  start(card: HTMLElement): void
  // Enter fullscreen with no card to morph from, for direct/deep-link arrivals
  // at /map. No-op if a card morph is already running, so the card path wins.
  startDirect(): void
  // Warm the skeleton chunk and evaluate the map route module ahead of a
  // likely navigation.
  prefetch(): void
  // Map route: first frame containing the map has been presented.
  notifyMapReady(): void
  // Map route: error state mounted — reveal it now.
  notifyMapFailed(): void
}

const noopController: MapMorphController = {
  start: () => {},
  startDirect: () => {},
  prefetch: () => {},
  notifyMapReady: () => {},
  notifyMapFailed: () => {}
}

const MapMorphContext = createContext<MapMorphController>(noopController)

// Evaluates the map route module (and with it the renderer modules it statically
// imports) ahead of the navigation. The card's `prefetch="intent"` only fetches and
// compiles the chunk — evaluation still runs at navigation time, and it landed as a
// long main-thread task in the middle of the skeleton draw (measured via LoAF script
// attribution; in dev, where each module is transformed on demand, it is the single
// biggest freeze). A dynamic import here resolves to the same module React Router
// code-split, so nothing is bundled twice; the cycle with map.tsx importing this file
// is harmless because the import is dynamic.
let mapRouteWarmed = false
function prefetchMapRoute() {
  if (mapRouteWarmed) return
  mapRouteWarmed = true
  void import('~/routes/map').catch(() => {
    mapRouteWarmed = false
  })
}

export function useMapMorph(): MapMorphController {
  return useContext(MapMorphContext)
}

// The preview image positioned exactly where the map's first frame draws it:
// map.tsx's initial camera (utils/map-morph-camera.ts) applied to the natural-
// size image via a composited per-axis scale, matching how the renderer
// stretches the preview over the full viewBox. Only the map route's loading
// fallback uses this now — it is what covers the wait for reduced-motion and
// direct arrivals, where the morph overlay never runs. The overlay itself used
// to layer it under the skeleton, but the skeleton's opaque sheet occluded it
// for the whole draw and the real canvas is already painted before the fade,
// so it never earned its raster there.
export function MapPreviewBackdrop() {
  const [wrapRef, camera] = useMapCamera()

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" aria-hidden>
      {camera && (
        <img
          // Stamped, though with the service worker installed this changes
          // nothing — cacheFirst intercepts on pathname and ignores the query.
          // That is exactly why the bare URL hid for so long: it only poisons
          // the paths where the worker is absent (dev, the first visit before
          // install finishes, iOS after the worker is evicted).
          src={MAP_PREVIEW_URL}
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
  // A direct entry has no card, so it has no squashed frames to mask.
  const [direct, setDirect] = useState(false)
  // Mirrors `direct` for the synchronous read in loadSkeleton, same as skeletonRef.
  const directRef = useRef(false)
  const [skeleton, setSkeleton] = useState<SkeletonDoc | null>(null)
  const [drew, setDrew] = useState(false)

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
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mirrors the `skeleton` state for the synchronous reads in finishMorph.
  const skeletonRef = useRef<SkeletonDoc | null>(null)
  const startedAtRef = useRef(0)
  const drawStartedAtRef = useRef(0)

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
    clearTimer(settleTimerRef)
    readyRef.current = false
    setOpen(false)
    setDirect(false)
    directRef.current = false
    setDrew(false)
    changePhase('idle')
  }, [changePhase])

  const beginFade = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'fading') return
    clearTimer(readyTimerRef)
    clearTimer(morphTimerRef)
    clearTimer(settleTimerRef)
    changePhase('fading')
    fadeTimerRef.current = setTimeout(reset, FADE_FALLBACK_MS)
  }, [changePhase, reset])

  const beginDraw = useCallback(() => {
    drawStartedAtRef.current = performance.now()
    setDrew(true)
    changePhase('drawing')
  }, [changePhase])

  // Ready arrived mid-draw. Rather than cutting the linework off, hand the rest to
  // MapSkeleton's fast-forward so the cascade finishes at speed and the crossfade
  // starts from a complete map.
  const beginSettle = useCallback(() => {
    if (phaseRef.current !== 'drawing') return
    clearTimer(settleTimerRef)

    const elapsed = performance.now() - drawStartedAtRef.current
    // Already finished on its own, which is the usual case on a slow load — there is
    // nothing left to compress, so don't spend the settle window on dead time.
    if (elapsed >= SKELETON_DRAW_MS) {
      beginFade()
      return
    }
    if (elapsed < SKELETON_MIN_DRAW_MS) {
      settleTimerRef.current = setTimeout(beginSettle, SKELETON_MIN_DRAW_MS - elapsed)
      return
    }

    changePhase('settling')
    settleTimerRef.current = setTimeout(beginFade, SKELETON_SETTLE_MS)
  }, [beginFade, changePhase])

  const finishMorph = useCallback(() => {
    if (phaseRef.current !== 'morphing') return
    clearTimer(morphTimerRef)
    // A map that was already ready before the morph even landed must not then sit
    // through the draw.
    if (readyRef.current) beginFade()
    else if (skeletonRef.current) beginDraw()
    else changePhase('holding')
  }, [beginDraw, beginFade, changePhase])

  // Resolves null on failure, and is a no-op after the first call.
  const loadSkeleton = useCallback(() => {
    void prefetchMapSkeleton().then((doc) => {
      if (!doc) return
      skeletonRef.current = doc
      setSkeleton(doc)
      // Landed just after the morph gave up on it. Still worth drawing while it is
      // inside the budget — the alternative is a hold that has barely begun. Direct
      // entries ignore the budget entirely (see SKELETON_LOAD_BUDGET_MS).
      const late = performance.now() - startedAtRef.current
      const withinBudget = directRef.current || late <= SKELETON_LOAD_BUDGET_MS
      if (phaseRef.current === 'holding' && withinBudget) beginDraw()
    })
  }, [beginDraw])

  const prefetch = useCallback(() => {
    loadSkeleton()
    prefetchMapRoute()
  }, [loadSkeleton])

  const begin = useCallback(() => {
    startedAtRef.current = performance.now()
    startLocationKeyRef.current = locationKeyRef.current
    readyRef.current = false
    navigatedRef.current = false
    loadSkeleton()
    readyTimerRef.current = setTimeout(beginFade, READY_TIMEOUT_MS)
  }, [beginFade, loadSkeleton])

  const start = useCallback((card: HTMLElement) => {
    if (phaseRef.current !== 'idle') return
    if (reducedMotionRef.current) return

    cardBoxRef.current = measureBox(card)
    // Read rather than hardcoded, same as the sheet morph: tracks the card's
    // actual rounding.
    cardRadiusRef.current = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0
    begin()
    changePhase('morphing')
    // Covers a transform transitionend that never fires (degenerate morph,
    // hidden tab) — same belt as the boot splash.
    morphTimerRef.current = setTimeout(finishMorph, MORPH_FALLBACK_MS)
  }, [begin, changePhase, finishMorph])

  const startDirect = useCallback(() => {
    if (phaseRef.current !== 'idle') return
    if (reducedMotionRef.current) return

    directRef.current = true
    begin()
    setDirect(true)
    // Fullscreen from the first frame: there is no card geometry to FLIP from, so
    // setOverlayRef sits this one out (it only acts while 'morphing').
    setOpen(true)
    if (skeletonRef.current) beginDraw()
    else changePhase('holding')
  }, [begin, beginDraw, changePhase])

  const notifyMapReady = useCallback(() => {
    if (phaseRef.current === 'morphing') readyRef.current = true
    else if (phaseRef.current === 'drawing') beginSettle()
    else if (phaseRef.current === 'holding') beginFade()
  }, [beginFade, beginSettle])

  const notifyMapFailed = useCallback(() => {
    if (phaseRef.current !== 'idle') beginFade()
  }, [beginFade])

  const controller = useMemo<MapMorphController>(
    () => ({ start, startDirect, prefetch, notifyMapReady, notifyMapFailed }),
    [start, startDirect, prefetch, notifyMapReady, notifyMapFailed]
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
    // Only the overlay's own box. Both the face mask and the skeleton layer fade
    // on opacity from inside here, and the skeleton's fade is deliberately the
    // longer of the two — without this guard its transitionend would reset the
    // whole overlay early and cut the real fade off.
    if (event.target !== event.currentTarget) return
    if (event.propertyName === 'transform') finishMorph()
    else if (event.propertyName === 'opacity' && phaseRef.current === 'fading') reset()
  }

  // Gated on having actually started a draw, not merely on the geometry being loaded:
  // reaching the fade straight from 'morphing' or 'holding' must not flash a screenful
  // of undrawn linework on its way out.
  const skeletonMounted = skeleton !== null && drew && phase !== 'morphing' && phase !== 'holding'

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
            // z-40 sits below the boot splash (z-[45]) on purpose: a direct
            // /map entry mounts this overlay while the splash is still up, and
            // the splash fades out over the drawing rather than being cut off.
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
          {skeletonMounted && skeleton && (
            <MapSkeleton
              doc={skeleton}
              phase={phase}
              strokeMs={SKELETON_STROKE_MS}
              spanMs={SKELETON_SPAN_MS}
              settleMs={SKELETON_SETTLE_MS}
              fadeMs={SKELETON_FADE_MS}
              stationMs={SKELETON_STATION_MS}
            />
          )}
          {!direct && <div className="map-morph-face" />}
        </div>
      )}
    </MapMorphContext.Provider>
  )
}
