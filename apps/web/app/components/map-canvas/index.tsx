import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { haptic } from 'utils/haptics'
import {
  createRenderer,
  hitTest,
  pickTier,
  pointCornerRadius,
  pointStationId,
  SCRIM_MAX_ALPHA,
  type HitResult,
  type Point,
  type PointsManifest,
  type Renderer,
  type SelectionOverlay,
  type Tier,
  type Transform
} from '../../lib/map-renderer'
// Imported as a URL (not as data) so Vite content-hashes it into /assets/. The
// file deliberately lives outside public/: assets under public/ are copied
// verbatim with stable names, and a stable URL cannot be cached correctly for a
// file that changes every time a tap target is edited. See docs/fdtj-map-points.md.
import pointsUrl from '../../data/points.json?url'
import { centerOn, clampTransform, fitTransform, MAX_SCALE, minScaleFor } from './fit'
import { MAP_BASE_URL, useMapManifest } from './use-map-manifest'

const TAP_MOVEMENT_THRESHOLD_CSS_PX = 8
const TOUCH_HIT_SLOP_CSS_PX = 12

// Lerp time constants (milliseconds). Lower = snappier, higher = floatier.
// Wheel zoom and end-of-gesture eased; active drag/pinch snap 1:1.
const LERP_TAU_MS = 80
// Inertia: pixels/ms of velocity at release decays exponentially with this tau.
const INERTIA_TAU_MS = 180
// Below this velocity (CSS px/ms) we stop the inertia loop.
const INERTIA_MIN_VELOCITY = 0.04
// Use the most recent N ms of pointer-move samples to estimate release velocity.
const VELOCITY_SAMPLE_WINDOW_MS = 80

// Selection spotlight animation durations.
const SPOTLIGHT_IN_MS = 350
const SPOTLIGHT_OUT_MS = 220
// Halo color before the selection's line color resolves (slate-500).
export const SPOTLIGHT_NEUTRAL_COLOR: [number, number, number] = [0.39, 0.45, 0.55]
// Two taps within this window and radius count as a double-tap.
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_RADIUS_CSS_PX = 30

const WHEEL_ZOOM_INTENSITY = 0.0015

// Default zoom when centring on an anchor point rather than fitting a set.
const DEFAULT_ANCHOR_SCALE = 0.5

export interface InitialFocus {
  // Fit these stations into the visible area, if any of them have map points.
  stationIds?: string[]
  // Fallback when `stationIds` is empty or none of them are on the map.
  anchorPointId?: string
  // Preferred zoom. Fit only ever zooms out from this; the anchor path uses it
  // directly.
  scale?: number
}

export interface MapCanvasHandle {
  /** Fly to a station's pill. Returns false when it has no point on the map. */
  focusStation: (operator: string, code: string) => boolean
  /** Fit a set of stations into the visible area. False when none are on the map. */
  fitToStations: (stationIds: string[]) => boolean
  /** Zoom back out to the whole map. */
  flyToFit: () => void
  /** Re-tint the active spotlight once the selection's line colour resolves.
   *  Pass `expectStationId` to no-op if the selection has moved on since the
   *  colour was requested. Compare on the station, not the point id: a halte
   *  drawn twice has a suffixed point id that would never match. */
  setSpotlightColor: (rgb: [number, number, number], expectStationId?: string) => void
  /** Fade the spotlight out. */
  clearSpotlight: () => void
}

export interface MapCanvasProps {
  ref?: React.Ref<MapCanvasHandle>
  /** Height in px of anything covering the bottom (a peeked sheet), so fly-to
   *  centres selections in the gap above it rather than behind it. */
  bottomInset?: number
  initialFocus?: InitialFocus
  ariaLabel: string
  /** A tap resolved to a point. The canvas has already started its spotlight
   *  and fly-to; the host decides what the point *means*. */
  onSelect: (hit: HitResult) => void
  /** A clean tap that hit nothing. */
  onEmptyTap: () => void
  /** The second tap of a double-tap, whose first tap already fired onEmptyTap.
   *  Single taps are deliberately not delayed to wait out the double-tap
   *  window, so hosts that toggle on empty tap must undo it here. */
  onEmptyTapReverted?: () => void
  /** A pan/pinch/wheel gesture started. */
  onInteractionStart?: () => void
  onZoomChange?: (isZoomedIn: boolean) => void
  /** Optional external ref to the viewport element, for overlays that need to
   *  measure it (author mode's floating panel). */
  viewportRef?: React.RefObject<HTMLDivElement | null>

  // ── Author-mode escape hatches. Optional; only /map passes these. ──
  /** Controlled points. When omitted the canvas fetches points.json itself. */
  points?: Point[]
  /** Intercept a tap before the normal hit-test. Return true if handled. */
  onTapWorld?: (tap: { worldX: number, worldY: number, slopWorld: number, shift: boolean }) => boolean
  /** Called after every drawn frame. Only pass this when an overlay must track
   *  the live transform — it re-renders the host once per frame. */
  onFrame?: (rendered: Transform) => void
  debugHitboxes?: boolean
  disableDoubleTap?: boolean
}

export default function MapCanvas({
  ref,
  bottomInset = 0,
  initialFocus,
  ariaLabel,
  onSelect,
  onEmptyTap,
  onEmptyTapReverted,
  onInteractionStart,
  onZoomChange,
  viewportRef: externalViewportRef,
  points: controlledPoints,
  onTapWorld,
  onFrame,
  debugHitboxes = false,
  disableDoubleTap = false
}: MapCanvasProps) {
  const { manifest } = useMapManifest()
  const { data: pointsManifest } = useSWR<PointsManifest>(
    pointsUrl,
    (url: string) => fetch(url).then(r => r.json())
  )

  // Controlled points win (author mode edits them); otherwise mirror the
  // fetched manifest.
  const points = controlledPoints ?? pointsManifest?.points ?? []
  const pointsRef = useRef<Point[]>(points)
  pointsRef.current = points

  // Station id -> first point drawing it. A halte drawn twice has a suffixed
  // point id, so index on pointStationId rather than the raw id.
  const pointByStation = useMemo(() => {
    const index = new Map<string, Point>()
    for (const p of points) {
      const stationId = pointStationId(p)
      if (!index.has(stationId)) index.set(stationId, p)
    }
    return index
  }, [points])

  const internalViewportRef = useRef<HTMLDivElement>(null)
  const setViewportEl = useCallback((el: HTMLDivElement | null) => {
    internalViewportRef.current = el
    if (externalViewportRef) externalViewportRef.current = el
  }, [externalViewportRef])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const dirtyRef = useRef(true)
  const rafRef = useRef<number>(0)
  const currentTierRef = useRef<Tier>(1)

  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })

  // Two transforms: `target` is where we want to be; `rendered` is what we
  // currently draw. The rAF loop lerps rendered toward target each frame so
  // wheel zoom and end-of-gesture motion ease. During active drag/pinch we
  // snap rendered to target so the map tracks the finger 1:1.
  const targetRef = useRef<Transform>({ tx: 0, ty: 0, scale: 1 })
  const renderedRef = useRef<Transform>({ tx: 0, ty: 0, scale: 1 })
  // `transformRef` retains the existing name so non-render code (hit-test,
  // zoomAt anchor math) reads the *target* — the user's intent, not the
  // currently-rendered frame.
  const transformRef = targetRef
  const gestureActiveRef = useRef(false)

  // Track pointer state without re-rendering.
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map())
  const pinchStartRef = useRef<{ dist: number, scale: number, centerX: number, centerY: number } | null>(null)
  // Per-pointer tap-tracking: captures pointerdown position and the maximum
  // distance the pointer has moved during the gesture, so pointerup can
  // distinguish a tap from a drag.
  const tapTrackRef = useRef<Map<number, {
    startX: number
    startY: number
    maxDist: number
    pointerType: string
  }>>(new Map())
  // Per-pointer velocity sample log for flick inertia.
  const velocitySamplesRef = useRef<Map<number, Array<{ t: number, x: number, y: number }>>>(new Map())
  // Active inertia (decaying pan velocity in CSS px/ms).
  const inertiaRef = useRef<{ vx: number, vy: number } | null>(null)
  // Timestamp of last animation tick; used for frame-rate-independent lerp.
  const lastFrameTimeRef = useRef<number>(0)

  // Selection spotlight: scrim + halo around the selected pill, animated in
  // the rAF tick. `lastScrim`/`lastRing` mirror the values drawn on the most
  // recent frame so phase changes (switch, exit) can start from the current
  // visual state instead of jumping.
  const spotlightRef = useRef<{
    point: Point
    color: [number, number, number]
    phase: 'in' | 'hold' | 'out'
    phaseStart: number
    scrimFrom: number
    ringFrom: number
    lastScrim: number
    lastRing: number
  } | null>(null)
  // Eased camera flight (selection centering, double-tap zoom, recenter).
  // While active it writes both target and rendered so the plain lerp is inert.
  const flyToRef = useRef<{ from: Transform, to: Transform, start: number, duration: number } | null>(null)
  // Previous clean tap, for double-tap detection.
  const lastTapRef = useRef<{ t: number, x: number, y: number, wasEmpty: boolean } | null>(null)
  // Recenter visibility; ref mirrors the last reported value so the tick only
  // notifies the host when it actually flips.
  const isZoomedInRef = useRef(false)
  // Tap ripples (screen-space DOM overlay).
  const [ripples, setRipples] = useState<Array<{ id: number, x: number, y: number }>>([])
  const rippleIdRef = useRef(0)

  // Ref-mirror the host callbacks so the rAF/wheel effects don't re-create
  // (and interrupt an in-flight lerp) every time the host re-renders.
  const callbacksRef = useRef({ onSelect, onEmptyTap, onEmptyTapReverted, onInteractionStart, onZoomChange, onFrame, onTapWorld })
  useEffect(() => {
    callbacksRef.current = { onSelect, onEmptyTap, onEmptyTapReverted, onInteractionStart, onZoomChange, onFrame, onTapWorld }
  })

  const mapW = manifest?.viewBox[2] ?? 0
  const mapH = manifest?.viewBox[3] ?? 0
  const minScale = minScaleFor(viewportSize.w, viewportSize.h, mapW, mapH)

  const bottomInsetRef = useRef(bottomInset)
  bottomInsetRef.current = bottomInset

  useLayoutEffect(() => {
    const el = internalViewportRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setViewportSize({ w: rect.width, h: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Initial camera. Tries to fit `stationIds`, falls back to centring
  // `anchorPointId`, falls back to the middle of the map.
  //
  // If points.json hasn't loaded yet a *provisional* fit-to-viewport is applied
  // and the effect re-runs when points arrive to place properly — unless the
  // user has already moved the map, in which case their position wins and we
  // latch where they are.
  const didCenterRef = useRef(false)
  const provisionalCenterRef = useRef<Transform | null>(null)
  useEffect(() => {
    if (didCenterRef.current) return
    if (!viewportSize.w || !viewportSize.h || !mapW || !mapH) return

    const provisional = provisionalCenterRef.current
    const current = targetRef.current
    if (provisional && (
      current.tx !== provisional.tx
      || current.ty !== provisional.ty
      || current.scale !== provisional.scale
    )) {
      didCenterRef.current = true
      return
    }

    const fitScale = minScaleFor(viewportSize.w, viewportSize.h, mapW, mapH)
    const preferredScale = Math.max(fitScale, initialFocus?.scale ?? DEFAULT_ANCHOR_SCALE)

    const focusPoints = (initialFocus?.stationIds ?? [])
      .map(id => pointByStation.get(id))
      .filter((p): p is Point => p !== undefined)

    const fitted = fitTransform(
      focusPoints, viewportSize.w, viewportSize.h, mapW, mapH, bottomInsetRef.current, preferredScale
    )

    const anchor = initialFocus?.anchorPointId
      ? points.find(p => p.id === initialFocus.anchorPointId)
      : undefined
    const anchorX = anchor ? (anchor.ax + anchor.bx) / 2 : mapW / 2
    const anchorY = anchor ? (anchor.ay + anchor.by) / 2 : mapH / 2

    const initial = fitted ?? clampTransform(
      centerOn(anchorX, anchorY, preferredScale, viewportSize.w, viewportSize.h, bottomInsetRef.current),
      viewportSize.w, viewportSize.h, mapW, mapH, fitScale
    )

    targetRef.current = initial
    renderedRef.current = initial
    dirtyRef.current = true
    provisionalCenterRef.current = initial
    // Latch once real placement happened — or points have loaded and neither
    // the fit set nor the anchor exists, in which case the fallback is as good
    // as it gets.
    if (fitted || anchor || pointsManifest || controlledPoints) didCenterRef.current = true
  }, [viewportSize.w, viewportSize.h, mapW, mapH, pointsManifest, controlledPoints, initialFocus, pointByStation, points])

  // Initialize renderer once the manifest is loaded.
  useEffect(() => {
    if (!manifest || !canvasRef.current) return
    const renderer = createRenderer(
      canvasRef.current,
      manifest,
      MAP_BASE_URL,
      () => { dirtyRef.current = true }
    )
    rendererRef.current = renderer
    const dpr = window.devicePixelRatio || 1
    const rect = canvasRef.current.getBoundingClientRect()
    if (rect.width && rect.height) {
      renderer.resize(rect.width, rect.height, dpr)
    }
    dirtyRef.current = true
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [manifest])

  // Push points + debug flag to the renderer. Depends on manifest so it re-fires
  // when the renderer is (re-)created after manifest load — covers the case
  // where points load before the renderer exists.
  useEffect(() => {
    if (!rendererRef.current) return
    rendererRef.current.setPoints(points)
    rendererRef.current.setDebugHitboxes(debugHitboxes)
  }, [points, debugHitboxes, manifest])

  // Resize the renderer's backing store when the viewport changes.
  useEffect(() => {
    if (!rendererRef.current) return
    if (!viewportSize.w || !viewportSize.h) return
    rendererRef.current.resize(viewportSize.w, viewportSize.h, window.devicePixelRatio || 1)
    dirtyRef.current = true
  }, [viewportSize.w, viewportSize.h])

  // Watch for DPR changes (browser zoom).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    let mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const handler = () => {
      const dpr = window.devicePixelRatio || 1
      if (rendererRef.current && viewportSize.w && viewportSize.h) {
        rendererRef.current.resize(viewportSize.w, viewportSize.h, dpr)
        dirtyRef.current = true
      }
      mql.removeEventListener('change', handler)
      mql = window.matchMedia(`(resolution: ${dpr}dppx)`)
      mql.addEventListener('change', handler)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [viewportSize.w, viewportSize.h])

  // requestAnimationFrame loop: integrates inertia, lerps rendered toward
  // target, and draws when anything moved (or dirty was set externally).
  useEffect(() => {
    let stopped = false
    const tick = (now: number) => {
      if (stopped) return
      const renderer = rendererRef.current
      if (!renderer || !viewportSize.w || !viewportSize.h) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const last = lastFrameTimeRef.current || now
      const dt = Math.min(64, now - last) // clamp to 64ms to avoid huge jumps after a stall
      lastFrameTimeRef.current = now

      // Eased camera flight: drives both target and rendered so the plain
      // lerp below stays inert for its duration. Canceled by pointerdown and
      // wheel (like inertia), so it never fights a gesture.
      const fly = flyToRef.current
      if (fly && !gestureActiveRef.current) {
        const p = Math.min(1, (now - fly.start) / fly.duration)
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2 // easeInOutCubic
        const mixed = {
          tx: fly.from.tx + (fly.to.tx - fly.from.tx) * e,
          ty: fly.from.ty + (fly.to.ty - fly.from.ty) * e,
          scale: fly.from.scale + (fly.to.scale - fly.from.scale) * e
        }
        targetRef.current = mixed
        renderedRef.current = mixed
        if (p >= 1) flyToRef.current = null
        dirtyRef.current = true
      }

      // Inertia: decay velocity, add to target.
      const inertia = inertiaRef.current
      if (inertia && !gestureActiveRef.current) {
        const decay = Math.exp(-dt / INERTIA_TAU_MS)
        const target = targetRef.current
        // Add average velocity over this frame (trapezoidal).
        const avgVx = inertia.vx * (1 + decay) / 2
        const avgVy = inertia.vy * (1 + decay) / 2
        targetRef.current = clampTransform(
          { tx: target.tx + avgVx * dt, ty: target.ty + avgVy * dt, scale: target.scale },
          viewportSize.w, viewportSize.h, mapW, mapH, minScale
        )
        inertia.vx *= decay
        inertia.vy *= decay
        if (Math.hypot(inertia.vx, inertia.vy) < INERTIA_MIN_VELOCITY) {
          inertiaRef.current = null
        }
        dirtyRef.current = true
      }

      // Lerp rendered toward target. During an active drag/pinch, snap so the
      // map tracks the finger 1:1; otherwise ease frame-rate-independently.
      const target = targetRef.current
      const rendered = renderedRef.current
      const dtx = target.tx - rendered.tx
      const dty = target.ty - rendered.ty
      const dscale = target.scale - rendered.scale
      const moved = Math.abs(dtx) + Math.abs(dty) > 0.05 || Math.abs(dscale) > 1e-5
      if (moved) {
        if (gestureActiveRef.current) {
          renderedRef.current = target
        } else {
          const alpha = 1 - Math.exp(-dt / LERP_TAU_MS)
          renderedRef.current = {
            tx: rendered.tx + dtx * alpha,
            ty: rendered.ty + dty * alpha,
            scale: rendered.scale + dscale * alpha
          }
        }
        dirtyRef.current = true
      }

      // Selection spotlight: animate in/out phases here (forcing redraw while
      // they run); in the steady `hold` phase the overlay is drawn on any
      // dirty frame — tracking pan/zoom — without forcing continuous redraws.
      const spot = spotlightRef.current
      let overlay: SelectionOverlay | null = null
      if (spot) {
        const elapsed = now - spot.phaseStart
        const pt = spot.point
        let scrimAlpha: number
        let ringProgress: number
        if (spot.phase === 'in') {
          const p = Math.min(1, elapsed / SPOTLIGHT_IN_MS)
          const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
          scrimAlpha = spot.scrimFrom + (SCRIM_MAX_ALPHA - spot.scrimFrom) * e
          ringProgress = spot.ringFrom + (1 - spot.ringFrom) * e
          if (p >= 1) spot.phase = 'hold'
          else dirtyRef.current = true
        } else if (spot.phase === 'hold') {
          scrimAlpha = SCRIM_MAX_ALPHA
          ringProgress = 1
        } else {
          const p = Math.min(1, elapsed / SPOTLIGHT_OUT_MS)
          scrimAlpha = spot.scrimFrom * (1 - p)
          ringProgress = spot.ringFrom * (1 - p)
          if (p >= 1) spotlightRef.current = null
          dirtyRef.current = true
        }
        spot.lastScrim = scrimAlpha
        spot.lastRing = ringProgress
        overlay = {
          ax: pt.ax, ay: pt.ay, bx: pt.bx, by: pt.by, r: pt.r,
          cr: pointCornerRadius(pt),
          color: spot.color,
          scrimAlpha,
          ringProgress
        }
      }

      if (dirtyRef.current) {
        const dpr = window.devicePixelRatio || 1
        const r = renderedRef.current
        // Cap max tier on small viewports and low-core devices so mobile
        // never asks for the 1024x1024-per-tile tier 4 (4 MB raster each).
        // Tier 2 is plenty sharp at phone pixel densities.
        const isSmall = viewportSize.w < 768
        const lowCore = (navigator.hardwareConcurrency ?? 8) <= 4
        const maxTier: Tier = (isSmall || lowCore) ? 2 : 4
        const targetTier = pickTier(r.scale, dpr, currentTierRef.current, maxTier)
        currentTierRef.current = targetTier
        renderer.draw(r, viewportSize.w, viewportSize.h, dpr, targetTier, overlay)
        dirtyRef.current = false
        callbacksRef.current.onFrame?.(renderedRef.current)
      }

      // Recenter visibility: only notify the host when it changes.
      const zoomedIn = renderedRef.current.scale > minScale * 1.02
      if (zoomedIn !== isZoomedInRef.current) {
        isZoomedInRef.current = zoomedIn
        callbacksRef.current.onZoomChange?.(zoomedIn)
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [viewportSize.w, viewportSize.h, mapW, mapH, minScale])

  const updateTransform = (next: Transform) => {
    targetRef.current = clampTransform(next, viewportSize.w, viewportSize.h, mapW, mapH, minScale)
    dirtyRef.current = true
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const t = transformRef.current
    const el = internalViewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    // Clamp scale first so the anchor math matches the actual rendered scale.
    const newScale = Math.max(minScale, Math.min(MAX_SCALE, t.scale * factor))
    // Keep (px, py) anchored: world point under cursor stays put.
    const worldX = (px - t.tx) / t.scale
    const worldY = (py - t.ty) / t.scale
    const tx = px - worldX * newScale
    const ty = py - worldY * newScale
    updateTransform({ tx, ty, scale: newScale })
  }

  // Launch an eased camera flight from the currently rendered transform.
  const flyTo = useCallback((to: Transform, duration: number) => {
    inertiaRef.current = null
    flyToRef.current = {
      from: { ...renderedRef.current },
      to,
      start: performance.now(),
      duration
    }
    dirtyRef.current = true
  }, [])

  // Center a selected pill in the area left visible above the sheet.
  const flyToPoint = useCallback((p: Point) => {
    const cx = (p.ax + p.bx) / 2
    const cy = (p.ay + p.by) / 2
    const s = targetRef.current.scale
    const to = clampTransform(
      centerOn(cx, cy, s, viewportSize.w, viewportSize.h, bottomInsetRef.current),
      viewportSize.w, viewportSize.h, mapW, mapH, minScale
    )
    flyTo(to, 450)
  }, [viewportSize.w, viewportSize.h, mapW, mapH, minScale, flyTo])

  // Begin (or move) the spotlight. On a selection switch the scrim is already
  // up — seed it from the last drawn value so it doesn't dip; the ring always
  // re-animates its settle-in on the new pill.
  const beginSpotlight = useCallback((point: Point, color: [number, number, number]) => {
    const prevScrim = spotlightRef.current?.lastScrim ?? 0
    spotlightRef.current = {
      point,
      color,
      phase: 'in',
      phaseStart: performance.now(),
      scrimFrom: prevScrim,
      ringFrom: 0,
      lastScrim: prevScrim,
      lastRing: 0
    }
    dirtyRef.current = true
  }, [])

  const doubleTapZoom = (clientX: number, clientY: number) => {
    const t = targetRef.current
    const el = internalViewportRef.current
    if (!el) return
    let to: Transform
    if (t.scale >= MAX_SCALE * 0.98) {
      // At max zoom: toggle back to fit (clampTransform centers it).
      to = clampTransform({ tx: 0, ty: 0, scale: minScale }, viewportSize.w, viewportSize.h, mapW, mapH, minScale)
    } else {
      // Zoom a 2x step toward the tap point (world point under it stays put).
      const rect = el.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const nextScale = Math.min(MAX_SCALE, t.scale * 2)
      const worldX = (px - t.tx) / t.scale
      const worldY = (py - t.ty) / t.scale
      to = clampTransform(
        { tx: px - worldX * nextScale, ty: py - worldY * nextScale, scale: nextScale },
        viewportSize.w, viewportSize.h, mapW, mapH, minScale
      )
    }
    haptic()
    flyTo(to, 350)
  }

  useImperativeHandle(ref, () => ({
    focusStation: (operator: string, code: string) => {
      const point = pointByStation.get(`${operator}-${code}`)
      if (!point) return false
      beginSpotlight(point, SPOTLIGHT_NEUTRAL_COLOR)
      flyToPoint(point)
      return true
    },
    fitToStations: (stationIds: string[]) => {
      const focusPoints = stationIds
        .map(id => pointByStation.get(id))
        .filter((p): p is Point => p !== undefined)
      const to = fitTransform(
        focusPoints, viewportSize.w, viewportSize.h, mapW, mapH, bottomInsetRef.current,
        Math.max(minScale, initialFocus?.scale ?? DEFAULT_ANCHOR_SCALE)
      )
      if (!to) return false
      flyTo(to, 450)
      return true
    },
    flyToFit: () => {
      flyTo(
        clampTransform({ tx: 0, ty: 0, scale: minScale }, viewportSize.w, viewportSize.h, mapW, mapH, minScale),
        450
      )
    },
    setSpotlightColor: (rgb: [number, number, number], expectStationId?: string) => {
      const spot = spotlightRef.current
      if (!spot) return
      if (expectStationId !== undefined && pointStationId(spot.point) !== expectStationId) return
      spot.color = rgb
      dirtyRef.current = true
    },
    clearSpotlight: () => {
      const spot = spotlightRef.current
      if (!spot || spot.phase === 'out') return
      spot.phase = 'out'
      spot.phaseStart = performance.now()
      spot.scrimFrom = spot.lastScrim
      spot.ringFrom = spot.lastRing
      dirtyRef.current = true
    }
  }), [pointByStation, beginSpotlight, flyToPoint, flyTo, viewportSize.w, viewportSize.h, mapW, mapH, minScale, initialFocus?.scale])

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    tapTrackRef.current.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      maxDist: 0,
      pointerType: e.pointerType
    })
    velocitySamplesRef.current.set(e.pointerId, [{ t: e.timeStamp, x: e.clientX, y: e.clientY }])
    // A new touch cancels in-flight inertia and camera flights. Adopt the
    // *rendered* transform as the new target so the finger picks up exactly
    // where the eye sees the map — no teleport, no jarring stop.
    inertiaRef.current = null
    flyToRef.current = null
    targetRef.current = renderedRef.current
    gestureActiveRef.current = true
    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      pinchStartRef.current = {
        dist,
        scale: transformRef.current.scale,
        centerX: (a.x + b.x) / 2,
        centerY: (a.y + b.y) / 2
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointersRef.current.get(e.pointerId)
    if (!prev) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const tap = tapTrackRef.current.get(e.pointerId)
    if (tap) {
      const d = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY)
      if (d > tap.maxDist) tap.maxDist = d
      // First moment this gesture becomes a real drag/pinch.
      if (d > TAP_MOVEMENT_THRESHOLD_CSS_PX) callbacksRef.current.onInteractionStart?.()
    }

    const samples = velocitySamplesRef.current.get(e.pointerId)
    if (samples) {
      samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
      const cutoff = e.timeStamp - VELOCITY_SAMPLE_WINDOW_MS
      while (samples.length > 2 && samples[0].t < cutoff) samples.shift()
    }

    if (pointersRef.current.size === 1) {
      const t = transformRef.current
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      updateTransform({ tx: t.tx + dx, ty: t.ty + dy, scale: t.scale })
    } else if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const factor = dist / pinchStartRef.current.dist
      const targetScale = pinchStartRef.current.scale * factor
      zoomAt(
        pinchStartRef.current.centerX,
        pinchStartRef.current.centerY,
        targetScale / transformRef.current.scale
      )
    }
  }

  const clientToWorld = (clientX: number, clientY: number) => {
    const el = internalViewportRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const t = transformRef.current
    return { x: (px - t.tx) / t.scale, y: (py - t.ty) / t.scale }
  }

  // Returns true when the tap landed on empty space (used by the double-tap
  // disambiguation in endPointer).
  const tryHitTest = (clientX: number, clientY: number, pointerType: string, shift: boolean): boolean => {
    const { x: worldX, y: worldY } = clientToWorld(clientX, clientY)
    const t = transformRef.current
    const slopCss = pointerType === 'touch' ? TOUCH_HIT_SLOP_CSS_PX : 0
    const slopWorld = slopCss / t.scale

    // Host interception (author mode places/edits pills instead of selecting).
    if (callbacksRef.current.onTapWorld?.({ worldX, worldY, slopWorld, shift })) {
      return false
    }

    const currentPoints = pointsRef.current
    const hit = currentPoints.length > 0 ? hitTest(worldX, worldY, currentPoints, slopWorld) : null
    if (hit) {
      haptic()
      // Halo starts neutral; the host re-tints via setSpotlightColor once it
      // knows the selection's line colour.
      beginSpotlight(hit.point, SPOTLIGHT_NEUTRAL_COLOR)
      flyToPoint(hit.point)
      callbacksRef.current.onSelect(hit)
      return false
    }
    callbacksRef.current.onEmptyTap()
    return true
  }

  const endPointer = (e: React.PointerEvent) => {
    const tap = tapTrackRef.current.get(e.pointerId)
    tapTrackRef.current.delete(e.pointerId)
    const samples = velocitySamplesRef.current.get(e.pointerId)
    velocitySamplesRef.current.delete(e.pointerId)
    const wasDrag = !!(tap && tap.maxDist > TAP_MOVEMENT_THRESHOLD_CSS_PX)
    const wasPinching = pinchStartRef.current !== null
    pointersRef.current.delete(e.pointerId)

    // Only run hit-test when this is a clean single-pointer tap (no pinch).
    if (
      e.type === 'pointerup'
      && tap
      && tap.maxDist <= TAP_MOVEMENT_THRESHOLD_CSS_PX
      && !wasPinching
    ) {
      // Tap ripple (screen-space DOM overlay; capped to 4 concurrent).
      const rect = internalViewportRef.current?.getBoundingClientRect()
      if (rect) {
        const id = rippleIdRef.current++
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        setRipples(rs => [...rs.slice(-3), { id, x, y }])
      }

      // Double-tap detection without delaying single taps: the first tap
      // hit-tests immediately; a quick second tap near it becomes a zoom
      // (only for empty-space taps — a pill tap already has its selection
      // fly-to in motion).
      const prevTap = lastTapRef.current
      const isDoubleTap = !disableDoubleTap
        && prevTap !== null
        && e.timeStamp - prevTap.t < DOUBLE_TAP_MS
        && Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < DOUBLE_TAP_RADIUS_CSS_PX
      if (isDoubleTap) {
        lastTapRef.current = null
        if (prevTap.wasEmpty) {
          // Let the host undo whatever the first tap's onEmptyTap did, then zoom.
          callbacksRef.current.onEmptyTapReverted?.()
          doubleTapZoom(e.clientX, e.clientY)
        }
      } else {
        const wasEmpty = tryHitTest(e.clientX, e.clientY, tap.pointerType, e.shiftKey)
        lastTapRef.current = { t: e.timeStamp, x: e.clientX, y: e.clientY, wasEmpty }
      }
    }

    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null
    }

    // When the last pointer lifts after a drag (no pinch), launch inertia
    // from the recent velocity samples.
    if (pointersRef.current.size === 0) {
      gestureActiveRef.current = false
      if (wasDrag && !wasPinching && samples && samples.length >= 2 && e.type === 'pointerup') {
        const last = samples[samples.length - 1]
        const first = samples[0]
        const dt = last.t - first.t
        if (dt > 0) {
          inertiaRef.current = {
            vx: (last.x - first.x) / dt,
            vy: (last.y - first.y) / dt
          }
          dirtyRef.current = true
        }
      }
    }
  }

  // Browsers fire `wheel` as a passive listener on React's synthetic handler, so
  // calling preventDefault() in the React handler logs a warning. Attach a native
  // non-passive listener instead.
  useEffect(() => {
    const el = internalViewportRef.current
    if (!el) return
    const handler = (ev: WheelEvent) => {
      ev.preventDefault()
      // Manual zoom takes over from any in-flight camera animation.
      flyToRef.current = null
      const factor = Math.exp(-ev.deltaY * WHEEL_ZOOM_INTENSITY)
      zoomAt(ev.clientX, ev.clientY, factor)
      callbacksRef.current.onInteractionStart?.()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [manifest, minScale, viewportSize.w, viewportSize.h, mapW, mapH])

  return (
    <div
      ref={setViewportEl}
      className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
      role="img"
      aria-label={ariaLabel}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {ripples.map(r => (
        <span
          key={r.id}
          className="map-ripple"
          style={{ left: r.x, top: r.y }}
          onAnimationEnd={() => setRipples(rs => rs.filter(x => x.id !== r.id))}
          aria-hidden
        />
      ))}
    </div>
  )
}
