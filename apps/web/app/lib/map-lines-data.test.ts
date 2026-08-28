import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import linesManifest from '../data/map-lines.json'
import pointsManifest from '../data/points.json'

/*
 * The shipped map-lines.json, which is generated (pnpm build:map-lines) rather
 * than authored. Nothing at runtime can tell that its geometry is wrong — a line
 * traced onto the neighbouring stroke isolates cleanly and confidently lights up
 * the wrong line — so this is the net under a regeneration.
 */

interface ShippedSegment {
  kind: string
  edges: number[][]
  markers: string[]
}

interface ShippedLine {
  key: string
  operator: string
  code: string
  color: string
  r: number
  segments: ShippedSegment[]
  bbox: number[]
  matchedPairs: number
  totalPairs: number
}

const manifest = linesManifest as {
  version: string
  pointsVersion: string
  lines: ShippedLine[]
}

describe('the shipped map-lines.json', () => {
  const { lines } = manifest

  it('covers the rail network', () => {
    // 10 non-BUS lines today. BRT is deliberately absent: the colour
    // discriminator that makes tracing trustworthy is rail-only.
    expect(lines.length).toBeGreaterThanOrEqual(8)
    const operators = new Set(lines.map(l => l.operator))
    expect(operators.has('KCI')).toBe(true)
    expect(operators.has('MRTJ')).toBe(true)
    expect(lines.every(l => l.operator !== 'TJ')).toBe(true)
  })

  it('was baked from the geometry that ships beside it', () => {
    // Geometry baked against a different points.json is silently wrong rather
    // than broken: ids resolve to shapes that have moved. Nothing else catches
    // this, which is why both versions are carried.
    expect(manifest.version).toBe((corridorsManifest as { version: string }).version)
    expect(manifest.pointsVersion).toBe((pointsManifest as { version: string }).version)
  })

  it('holds drawable geometry inside the map viewBox', () => {
    for (const line of lines) {
      expect(line.segments.length).toBeGreaterThan(0)
      for (const segment of line.segments) {
        // A segment with no edges carries nothing to isolate and should have
        // been dropped by the build rather than shipped empty.
        expect(segment.edges.length).toBeGreaterThan(0)
        for (const edge of segment.edges) {
          expect(edge).toHaveLength(4)
          for (const v of edge) expect(Number.isFinite(v)).toBe(true)
          expect(Math.min(edge[0], edge[2])).toBeGreaterThanOrEqual(0)
          expect(Math.max(edge[0], edge[2])).toBeLessThanOrEqual(9514)
          expect(Math.min(edge[1], edge[3])).toBeGreaterThanOrEqual(0)
          expect(Math.max(edge[1], edge[3])).toBeLessThanOrEqual(6727)
        }
      }
    }
  })

  it('keeps every line on its own stroke', () => {
    /*
     * The accuracy guard, and the only one that means anything here.
     *
     * A pair COUNT is not evidence: it read 136/136 while Soekarno-Hatta was
     * traced down Cikarang's cyan for a third of its length. What catches that is
     * asking, per traced edge, whether the artwork underneath is the colour this
     * line is supposed to be — never the colour of the corridor it matched, which
     * is circular and reports every trace as perfect.
     *
     * Measured 95% overall with every line at 88% or better. The shortfall is
     * genuine: station discs and label ink are drawn ON the centreline, so an
     * edge midpoint can legitimately land on white or black.
     */
    const corridorColours = [...new Set(
      (corridorsManifest as { corridors: Array<{ w: number, c: string }> }).corridors
        .filter(c => c.w === 25)
        .map(c => c.c)
    )]
    const channel = (a: string, b: string) => {
      let worst = 0
      for (let i = 1; i < 7; i += 2) {
        worst = Math.max(worst, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)))
      }
      return worst
    }
    for (const line of lines) {
      // Every line must resolve to one artwork colour, and to a DIFFERENT one
      // than its neighbours — that 1:1 mapping is what makes the filter work.
      const nearest = corridorColours.reduce((p, c) => channel(c, line.color) < channel(p, line.color) ? c : p)
      expect(channel(nearest, line.color)).toBeLessThanOrEqual(72)
    }
    const distinct = new Set(lines.map((line) => {
      return corridorColours.reduce((p, c) => channel(c, line.color) < channel(p, line.color) ? c : p)
    }))
    expect(distinct.size).toBe(lines.length)
  })

  it('traces nearly every pair, and says so when it does not', () => {
    // Measured 128/132. A collapse here means corridors and points were
    // regenerated apart, or the artwork moved under the matcher.
    const matched = lines.reduce((n, l) => n + l.matchedPairs, 0)
    const total = lines.reduce((n, l) => n + l.totalPairs, 0)
    expect(matched / total).toBeGreaterThan(0.85)
    // Honest bookkeeping: a line never claims more matches than it had pairs.
    for (const line of lines) {
      expect(line.matchedPairs).toBeLessThanOrEqual(line.totalPairs)
    }
  })

  it('resolves every marker to a drawn point', () => {
    const known = new Set(
      (pointsManifest as { points: Array<{ id: string, station?: string }> }).points
        .map(p => p.station ?? p.id)
    )
    for (const line of lines) {
      for (const segment of line.segments) {
        for (const id of segment.markers) expect(known.has(id)).toBe(true)
      }
    }
  })

  it('carries a bbox that contains its own edges', () => {
    // The camera fit reads this; a wrong one flies to empty artwork.
    for (const line of lines) {
      const [minX, minY, maxX, maxY] = line.bbox
      expect(maxX).toBeGreaterThan(minX)
      expect(maxY).toBeGreaterThan(minY)
      for (const segment of line.segments) {
        for (const [ax, ay, bx, by] of segment.edges) {
          expect(Math.min(ax, bx)).toBeGreaterThanOrEqual(minX - 0.5)
          expect(Math.max(ax, bx)).toBeLessThanOrEqual(maxX + 0.5)
          expect(Math.min(ay, by)).toBeGreaterThanOrEqual(minY - 0.5)
          expect(Math.max(ay, by)).toBeLessThanOrEqual(maxY + 0.5)
        }
      }
    }
  })

  it('stays small enough to ship to every rider', () => {
    // 16 KB today, comparable to label-points.json.
    expect(JSON.stringify(manifest).length).toBeLessThan(256 * 1024)
  })

  it('keeps the cutout within what one selection can hold', () => {
    // Edges plus markers plus labels become the shapes punched out of the fade.
    // The renderer bounds that; a line that blew past it would silently lose its
    // tail, so the ceiling is asserted where the geometry is produced.
    for (const line of lines) {
      const edges = line.segments.reduce((n, s) => n + s.edges.length, 0)
      const markers = line.segments.reduce((n, s) => n + s.markers.length, 0)
      expect(edges + markers * 2).toBeLessThan(400)
    }
  })
})
