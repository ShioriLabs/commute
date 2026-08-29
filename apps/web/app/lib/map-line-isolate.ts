/*
 * Turning a line's baked geometry into the shapes punched out of the fade.
 *
 * The tracing happened at build time (scripts/build-map-lines.ts), so this is a
 * lookup and an assembly, not a match. Kept out of the renderers because both
 * consume the same list through mapTreatment, and out of map.tsx because it is
 * pure enough to test on its own.
 */

import type { CutShape, Point } from './map-renderer'
import { isLabelPoint, pointCornerRadius, pointStationId } from './map-renderer'

export interface LineSegmentGeometry {
  kind: string
  edges: number[][]
  markers: string[]
}

export interface LineGeometry {
  key: string
  operator: string
  code: string
  name: string
  color: string
  r: number
  segments: LineSegmentGeometry[]
  bbox: number[]
  matchedPairs: number
  totalPairs: number
}

export interface LinesManifest {
  version: string
  pointsVersion: string
  lines: LineGeometry[]
}

/*
 * Every shape held at full strength when this line is isolated: the traced
 * stroke, each station's marker, and each station's name.
 *
 * The names are in for the same reason they are in a station selection — a line
 * held sharp while the words naming its stops go pale is half an answer, and on
 * a small marker the name carries most of the identity.
 *
 * Edges become capsules with cr === r, which degenerates the rounded rect to a
 * capsule and matches how the route overlay draws its own segments.
 */
export function lineCutShapes(
  line: LineGeometry,
  points: readonly Point[],
  labelPoints: readonly Point[]
): CutShape[] {
  const markerByStation = new Map<string, Point>()
  for (const p of points) {
    if (isLabelPoint(p)) continue
    const stationId = pointStationId(p)
    // First alias wins, but an exact id always beats an alias — the same rule
    // the tracer and the route overlay use, so all three agree on which shape a
    // twice-drawn station means.
    if (p.id === stationId || !markerByStation.has(stationId)) markerByStation.set(stationId, p)
  }
  const labelByStation = new Map<string, Point>()
  for (const p of labelPoints) {
    const stationId = pointStationId(p)
    if (!labelByStation.has(stationId)) labelByStation.set(stationId, p)
  }

  const shapes: CutShape[] = []
  const seen = new Set<string>()
  for (const segment of line.segments) {
    for (const edge of segment.edges) {
      const [ax, ay, bx, by] = edge
      shapes.push({ ax, ay, bx, by, r: line.r, cr: line.r })
    }
    for (const stationId of segment.markers) {
      // Branches share their junction station with the trunk, so dedupe rather
      // than punching the same hole twice.
      if (seen.has(stationId)) continue
      seen.add(stationId)
      const marker = markerByStation.get(stationId)
      if (marker) {
        shapes.push({
          ax: marker.ax, ay: marker.ay, bx: marker.bx, by: marker.by,
          r: marker.r, cr: pointCornerRadius(marker)
        })
      }
      const label = labelByStation.get(stationId)
      if (label) {
        shapes.push({
          ax: label.ax, ay: label.ay, bx: label.bx, by: label.by,
          r: label.r, cr: pointCornerRadius(label)
        })
      }
    }
  }
  return shapes
}

export function findLine(manifest: LinesManifest | undefined, key: string): LineGeometry | undefined {
  return manifest?.lines.find(l => l.key === key)
}

/*
 * The lines whose geometry passes near a world point, nearest first.
 *
 * Used to resolve a tap on a corridor stroke. Returns line KEYS rather than one
 * answer because an interlined trunk genuinely carries several, and the artwork
 * draws a corridor's two directions as separate strokes — both of which belong
 * to the same line, so keying by line collapses them and only a real ambiguity
 * survives to be disambiguated.
 */
export function linesNear(
  manifest: LinesManifest | undefined,
  x: number,
  y: number,
  slopWorld: number
): string[] {
  if (!manifest) return []
  const hits: Array<{ key: string, dist: number }> = []
  for (const line of manifest.lines) {
    let best = Infinity
    for (const segment of line.segments) {
      for (const [ax, ay, bx, by] of segment.edges) {
        const d = pointToSegmentDistance(x, y, ax, ay, bx, by)
        if (d < best) best = d
      }
    }
    if (best <= line.r + slopWorld) hits.push({ key: line.key, dist: best })
  }
  hits.sort((a, b) => a.dist - b.dist)
  return hits.map(h => h.key)
}

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Where a starting fade should pick up from.
 *
 * A fade that begins at zero while the map is ALREADY dimmed reads as a dip:
 * the outgoing treatment falls faster than the incoming one rises, the two are
 * reconciled with a max(), and the map briefly brightens in the middle of one
 * gesture. Seeding from whatever is currently drawn removes that.
 *
 * beginIsolate already did this for a previous isolate, so line-to-line was
 * smooth. It did not account for a station spotlight, which is why isolating a
 * line from an open station sheet dipped: the spotlight drops over 220ms while
 * the isolate climbs over 350ms, so max() sagged to about 0.41 of a 0.6 fade
 * around the 110ms mark before recovering.
 *
 * Takes the fades already drawn and returns the highest, because that is the
 * one the rider can currently see.
 */
export function seedFadeFrom(...drawn: readonly (number | null | undefined)[]): number {
  let seed = 0
  for (const fade of drawn) {
    if (fade != null && fade > seed) seed = fade
  }
  return seed
}
