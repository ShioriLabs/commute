import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import linesManifest from '../data/map-lines.json'
import pointsManifest from '../data/points.json'
import { channelDistance, CORRIDOR_COLOUR_TOLERANCE } from './map-corridor-colour'
import { isBrtCorridor, prepareCorridors, projectOntoPolyline, type Corridor } from './map-corridors'

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

  it('covers the rail network and the BRT trunk', () => {
    /*
     * 41 lines today: 10 rail plus 31 BRT. BRT used to be excluded for want of a
     * per-line discriminator — a colour names a koridor FAMILY, not a line — and
     * is included now that the line's own stations supply that identity.
     *
     * The floor is well under 41 because the dormant TJ feeders legitimately come
     * and go as topology lands; what it has to catch is a collapse back to
     * rail-only, which would be 10.
     */
    expect(lines.length).toBeGreaterThanOrEqual(32)
    const operators = new Set(lines.map(l => l.operator))
    expect(operators.has('KCI')).toBe(true)
    expect(operators.has('MRTJ')).toBe(true)
    expect(operators.has('TJ')).toBe(true)
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

  // The artwork ink a line was traced against: its brand colour, unless the build
  // recorded that the sheet draws it in something else.
  const drawnColour = (line: { color: string, inkColor?: string }): string =>
    line.inkColor ?? line.color

  it('keeps every line on its own stroke', () => {
    /*
     * The accuracy guard, and the only one that means anything here.
     *
     * A pair COUNT is not evidence: it read 136/136 while Soekarno-Hatta was
     * traced down Cikarang's cyan for a third of its length. What catches that is
     * asking, per traced edge, whether the artwork underneath is the colour this
     * line is drawn in — never the colour of the corridor it matched, which is
     * circular and reports every trace as perfect.
     *
     * This used to assert instead that every line's brand colour resolved to a
     * DISTINCT artwork colour, which was a proxy for the same idea and is now
     * false by construction: 41 lines share 27 artwork colours, because the sheet
     * draws a whole koridor family in one hex. Identity comes from the stations
     * now, not from a 1:1 colour mapping, so the guard measures the ink directly.
     *
     * Weighted by LENGTH, not edge count, so one long wrong stretch cannot hide
     * behind many short right ones. Measured 1.24%; the ceiling has room for the
     * artwork to shift without going slack. The residue is genuine: a corridor
     * crossing another, and station discs drawn over the centreline. Measured
     * 0.92% against a 2% ceiling.
     *
     * Judged against the ink each line is DRAWN in, which for three lines is not
     * its brand hex — TJ:7, TJ:7F and TJ:14 are branded colours the sheet never
     * uses for them. Auditing those against the brand would score them ~100%
     * off-colour while they are in fact traced perfectly, and a ceiling loose
     * enough to absorb that would stop catching real breakage. The brand-to-ink
     * gap is asserted on its own below, where it can be seen rather than
     * averaged away.
     */
    const corridors = prepareCorridors(
      (corridorsManifest as unknown as { corridors: Corridor[] }).corridors
    )
    let onColour = 0
    let offColour = 0
    for (const line of lines) {
      const isBrt = line.operator === 'TJ'
      for (const segment of line.segments) {
        for (const [ax, ay, bx, by] of segment.edges) {
          const mx = (ax + bx) / 2
          const my = (ay + by) / 2
          let nearest = Infinity
          let ink: string | null = null
          for (const corridor of corridors) {
            // Same-mode strokes only: a rail edge crossing a busway must not be
            // judged against the BRT stroke it passes over.
            if (isBrtCorridor(corridor) !== isBrt) continue
            const { dist } = projectOntoPolyline(mx, my, corridor)
            if (dist < nearest) {
              nearest = dist
              ink = corridor.c
            }
          }
          // Beyond half a stroke the edge is over blank paper — a station disc
          // or a label — and the audit abstains rather than guessing.
          if (!ink || nearest > 12.5) continue
          const length = Math.hypot(bx - ax, by - ay)
          if (channelDistance(ink, drawnColour(line)) > CORRIDOR_COLOUR_TOLERANCE) offColour += length
          else onColour += length
        }
      }
    }
    expect(offColour / (onColour + offColour)).toBeLessThan(0.02)
  })

  it('draws each line as a continuous run, not a string of disconnected pieces', () => {
    /*
     * The gap guard, and the one the ink audit above structurally cannot provide.
     *
     * When a pair matches a corridor that is not this line's, the drawn line
     * jumps to that stroke and back, leaving a visible break at each end. The
     * colour audit misses it whenever the intruding stroke is a near-enough hue:
     * koridor 9's teal sits 56 channels from koridor 6's green, INSIDE the 72
     * tolerance, so TJ:6V read as 0% off-colour while visibly split in two.
     *
     * Consecutive edges are emitted head-to-tail within a pair, so a gap between
     * them means the two pairs landed on different strokes. The tolerance is the
     * widest station disc: the artwork genuinely breaks a corridor where a marker
     * is drawn over it, and those breaks are real ink, not tracing errors.
     *
     * Only lines that traced EVERY pair are checked. A refused pair is meant to
     * leave a hole — that is the whole no-chord rule — so a line carrying one is
     * expected to be discontinuous and says so in matchedPairs. Checking those
     * too would pin the refusals rather than the jumps this exists to catch.
     */
    const MAX_GAP_WORLD = 92
    const offenders: string[] = []
    for (const line of lines) {
      if (line.matchedPairs < line.totalPairs) continue
      for (const segment of line.segments) {
        let worst = 0
        for (let i = 1; i < segment.edges.length; i++) {
          const [, , px, py] = segment.edges[i - 1]
          const [qx, qy] = segment.edges[i]
          worst = Math.max(worst, Math.hypot(qx - px, qy - py))
        }
        if (worst > MAX_GAP_WORLD) offenders.push(`${line.key} ${Math.round(worst)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('only lets a line leave its brand colour where the sheet demands it', () => {
    /*
     * The companion to the audit above, and the reason it can be strict.
     *
     * A line is traced against the ink its own stations elect, which is normally
     * its brand colour in the artwork's spelling — a shift of at most a few tens
     * of channels. Three lines are genuinely drawn in a colour their brand never
     * names, and those are listed here by hand: if a fourth appears, or one of
     * these three quietly stops needing the exception, that is a real change in
     * either the artwork or the brand table and should be looked at rather than
     * absorbed.
     */
    const EXPECTED_REDRAWN: Record<string, string> = {
      // Branded a pale tint of the orange it is drawn in.
      'TJ:14': '#FA7116',
      // Branded brown, drawn crimson — and the brown-ish stubs they cross would
      // pass a brand-gated match, so this is the pair the election exists for.
      'TJ:7': '#F71752',
      'TJ:7F': '#F71752'
    }
    const redrawn = lines.filter(line =>
      channelDistance(drawnColour(line), line.color) > CORRIDOR_COLOUR_TOLERANCE
    )
    expect(Object.fromEntries(redrawn.map(l => [l.key, drawnColour(l)]))).toEqual(EXPECTED_REDRAWN)
  })

  it('traces nearly every pair, and says so when it does not', () => {
    // Measured 636/655. A collapse here means corridors and points were
    // regenerated apart, or the artwork moved under the matcher.
    const matched = lines.reduce((n, l) => n + l.matchedPairs, 0)
    const total = lines.reduce((n, l) => n + l.totalPairs, 0)
    expect(matched / total).toBeGreaterThan(0.93)
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
