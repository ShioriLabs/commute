import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import clsx from 'clsx'
import { FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y, FDTJ_MAP_H, FDTJ_MAP_W } from 'utils/map-morph-camera'
import {
  orderSkeleton,
  orderStations,
  type SkeletonStation,
  type SkeletonStroke
} from 'utils/map-skeleton-order'
import { useMapCamera } from '~/hooks/map-camera'

// The map drawing itself while it loads: the corridor centrelines extracted by
// scripts/build-map-skeleton.ts, stroked on with stroke-dashoffset and radiating out from
// Manggarai — which previewCamera() puts at the centre of the viewport whatever its size.
//
// Layered *over* MapPreviewBackdrop rather than replacing it. The backdrop is what
// establishes the "overlay frame == canvas first frame" alignment that lets the morph fade
// out invisibly; this draws on its own opaque sheet above it and clears first, so the
// linework reads as ink on paper and the handoff underneath is untouched.

// The source weight, unscaled. Rail is stroked at 25 world units on the schematic itself,
// so drawing the skeleton at the same width means each line lands exactly on the band it
// becomes — the crossfade then adds only the white casing, the station ticks and the
// labels. Drawing it lighter (this was 0.5) left the linework visibly thinner than the map
// it resolved into, so the handoff read as a swap rather than as detail filling in.
const STROKE_SCALE = 1

// Ring thickness of a station marker, world units.
//
// The tiles draw a marker as a 44x44 coloured disc under a 40x40 white one, so the real
// ring is 2 — but 2 is one CSS pixel at the loading camera's 0.5 scale, and against a
// 25-unit line it disappears: the markers read as plain white blobs. This is the one place
// the skeleton deliberately departs from the artwork, because for the 900ms of the draw
// there is no artwork on screen to be faithful to, and the difference is absorbed by the
// crossfade. The outer radius still matches exactly; only the inside thickens.
const STATION_RING = 6

// Markers outside the viewport are dropped rather than hidden. Only ~8 of the 105 are ever
// on screen at the loading camera, and leaving the rest in the document costs real frame
// time — not paint, since they never rasterise, but per-frame animation bookkeeping. At
// 6x CPU throttle keeping them all cost ~3ms a frame and 20 dropped frames; culling put it
// back to within noise of no markers at all. The margin covers a marker whose centre sits
// just outside while its ring still shows.
const STATION_MARGIN = 80

export interface SkeletonDoc {
  version: string
  viewBox: number[]
  strokes: SkeletonStroke[]
  stations: SkeletonStation[]
}

export type SkeletonPhase = 'drawing' | 'settling' | 'fading'

let pending: Promise<SkeletonDoc | null> | null = null

/**
 * Loads (once) the skeleton geometry, resolving null on any failure so callers can simply
 * fall back to the plain hold. Dynamic import rather than fetch: Vite code-splits it to a
 * content-hashed /assets/ URL, which the service worker's existing cache-first rule for
 * build output already covers, and which can never go stale the way a fixed public/ URL
 * would. On failure the memo is cleared so a later entry retries.
 */
export function prefetchMapSkeleton(): Promise<SkeletonDoc | null> {
  pending ??= import('../data/map-skeleton.json')
    .then(module => module.default as SkeletonDoc)
    .catch(() => {
      pending = null
      return null
    })
  return pending
}

/**
 * Compresses whatever is left of the draw into `settleMs`.
 *
 * updatePlaybackRate changes speed while preserving each animation's current progress, so
 * there is no seek and nothing jumps. Because endTime includes animation-delay, a corridor
 * that has not started yet burns its remaining delay *and* strokes inside the same window —
 * the tail of the cascade whips to completion instead of being cut off.
 */
export function fastForwardDraw(root: SVGSVGElement | null, settleMs: number): void {
  if (!root || typeof root.getAnimations !== 'function' || settleMs <= 0) return

  for (const animation of root.getAnimations({ subtree: true })) {
    const current = animation.currentTime
    const timing = animation.effect?.getComputedTiming()
    // currentTime and endTime are CSSNumberish; a document timeline always gives numbers.
    if (typeof current !== 'number' || typeof timing?.endTime !== 'number') continue

    const remaining = timing.endTime - current
    // Never slow anything down: a corridor already finishing sooner than the settle window
    // must not be stretched back out to fill it.
    if (remaining <= settleMs) continue

    const rate = remaining / settleMs
    if (typeof animation.updatePlaybackRate === 'function') animation.updatePlaybackRate(rate)
    else animation.playbackRate = rate
  }
}

interface Props {
  doc: SkeletonDoc
  phase: SkeletonPhase
  /** How long one corridor takes to draw. */
  strokeMs: number
  /** Spread between the first corridor starting and the last. */
  spanMs: number
  /** Window the fast-forward compresses the remainder into. */
  settleMs: number
  fadeMs: number
  /** How long one station marker takes to pop in. */
  stationMs: number
}

export function MapSkeleton({ doc, phase, strokeMs, spanMs, settleMs, fadeMs, stationMs }: Props) {
  const [wrapRef, camera] = useMapCamera()
  const svgRef = useRef<SVGSVGElement>(null)

  const strokes = useMemo(
    () => orderSkeleton(doc.strokes, FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y, spanMs),
    [doc, spanMs]
  )

  const stations = useMemo(
    () => orderStations(doc.stations ?? [], strokes, strokeMs),
    [doc, strokes, strokeMs]
  )

  const visibleStations = useMemo(() => {
    if (!camera) return []
    const width = wrapRef.current?.clientWidth ?? 0
    const height = wrapRef.current?.clientHeight ?? 0
    return stations.filter((station) => {
      const x = camera.tx + station.x * camera.scale
      const y = camera.ty + station.y * camera.scale
      return x >= -STATION_MARGIN && x <= width + STATION_MARGIN
        && y >= -STATION_MARGIN && y <= height + STATION_MARGIN
    })
  }, [stations, camera, wrapRef])

  useEffect(() => {
    if (phase === 'settling') fastForwardDraw(svgRef.current, settleMs)
  }, [phase, settleMs])

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={clsx(
        'map-skeleton absolute inset-0 overflow-hidden bg-[#FFF8F8]',
        phase === 'fading' && 'map-skeleton-fading'
      )}
      style={{
        '--map-skeleton-stroke-ms': `${strokeMs}ms`,
        '--map-skeleton-fade-ms': `${fadeMs}ms`,
        '--map-skeleton-station-ms': `${stationMs}ms`
      } as CSSProperties}
    >
      {camera && (
        <svg
          ref={svgRef}
          width={FDTJ_MAP_W}
          height={FDTJ_MAP_H}
          viewBox={`0 0 ${FDTJ_MAP_W} ${FDTJ_MAP_H}`}
          // No transform-gpu/will-change here, unlike the other morphing surfaces: this box
          // is the whole map, so promoting it would hand the compositor a ~4757x3363 layer
          // (tens of MB) at exactly the moment the renderer is uploading tile textures.
          // Left unpromoted, only the visible region ever rasterises.
          //
          // max-w-none for the same reason it is load-bearing on the preview image.
          className="absolute top-0 left-0 origin-top-left max-w-none"
          style={{ transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.scale})` }}
        >
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {strokes.map((stroke, index) => (
              <path
                key={`${stroke.c}|${stroke.w}|${index}`}
                className="map-skeleton-path"
                d={stroke.d}
                stroke={stroke.c}
                strokeWidth={stroke.w * STROKE_SCALE}
                // Normalises every corridor to the same 0->1 dash range regardless of its
                // real length, so one keyframe draws them all at a comparable rate.
                pathLength={1}
                style={{ animationDelay: `${stroke.delayMs}ms` }}
              />
            ))}
          </g>
          {/* Drawn after the lines so a marker sits on top of the track it belongs to,
              and timed to that track's own progress so it never lands on rail the
              drawing has not laid yet. */}
          {/* White interior, not the paper colour: that is what the tiles draw, so the
              marker keeps matching once the crossfade starts. */}
          <g fill="#FFFFFF">
            {visibleStations.map(station => (
              <circle
                key={`${station.x}|${station.y}`}
                className="map-skeleton-station"
                cx={station.x}
                cy={station.y}
                r={station.r - STATION_RING / 2}
                stroke={station.c}
                strokeWidth={STATION_RING}
                style={{ animationDelay: `${station.delayMs}ms` }}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  )
}
