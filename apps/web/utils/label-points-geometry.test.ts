import { describe, expect, it } from 'vitest'
import labelPoints from '../app/data/label-points.json'
import points from '../app/data/points.json'
import manifest from '../public/maps/fdtj/manifest.json'

/*
 * Geometry guards for the label tap-targets built by
 * scripts/build_label_points.py. They exist because this data was tuned for a
 * long time against metrics that all looked healthy while nine labels were
 * silently glued to a neighbour — a whole class of defect nothing was watching
 * for. Each assertion below is one of those blind spots, now pinned.
 *
 * Re-derive with:
 *   MAP_PDF="<edition>.pdf" python3 apps/web/scripts/build_label_points.py
 * and check the result with scripts/audit_label_points.py, which renders the
 * whole map as a contact sheet alongside these same checks.
 */

interface LabelPoint {
  id: string
  station: string
  text: string
  ax: number
  ay: number
  bx: number
  by: number
  r: number
  cr: number
  rot: boolean
  dist: number
  noRing: boolean
}

const labels = labelPoints.points as LabelPoint[]

// A corridor sequence badge ("4-12", "10-6"). Legitimate when it LEADS a label
// — one halte can be served by several corridors — but a badge appearing
// mid-text means two separate labels were merged into one box.
const BADGE = /^\d+[-–]\d+$/

function hitArea(o: LabelPoint): number {
  return (Math.hypot(o.bx - o.ax, o.by - o.ay) + 2 * o.r) * 2 * o.r
}

/*
 * Closest approach of two capsule centrelines, minus both radii.
 *
 * This has to be segment-to-segment. Sampling one shape's centreline against
 * the other ignores the radii and reported zero overlaps among rotated labels
 * while a render plainly showed them bleeding together.
 */
function gapBetween(a: LabelPoint, b: LabelPoint): number {
  const pointToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax
    const vy = by - ay
    const lenSq = vx * vx + vy * vy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq))
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
  }
  const closest = Math.min(
    pointToSegment(a.ax, a.ay, b.ax, b.ay, b.bx, b.by),
    pointToSegment(a.bx, a.by, b.ax, b.ay, b.bx, b.by),
    pointToSegment(b.ax, b.ay, a.ax, a.ay, a.bx, a.by),
    pointToSegment(b.bx, b.by, a.ax, a.ay, a.bx, a.by)
  )
  return closest - (a.r + b.r)
}

describe('label tap-targets', () => {
  it('tracks the map edition the artwork was extracted from', () => {
    // Same contract as map-skeleton.json: derived map data that silently
    // outlives its edition is how map-corridors.json drifted two editions
    // behind while every render looked plausible.
    expect(labelPoints.version).toBe(manifest.version)
  })

  it('resolves every label to a point that exists', () => {
    const ids = new Set(points.points.map(p => p.id))
    for (const label of labels) {
      expect(ids.has(label.id.replace('LBL-', ''))).toBe(true)
    }
  })

  it('never glues two labels into one box', () => {
    // The detector that would have caught all nine. Badge COUNT is not the
    // signal — 36 of 45 multi-badge labels are legitimate multi-corridor names
    // like "10-4 12-19 Walikota Jakarta Utara", where every badge leads.
    const glued = labels.filter((label) => {
      const tokens = label.text.split(' ')
      let i = 0
      while (i < tokens.length && BADGE.test(tokens[i])) i++
      return tokens.slice(i).some(t => BADGE.test(t))
    })
    expect(glued.map(l => `${l.station} ${l.text}`)).toEqual([])
  })

  it('keeps every box within the area a real station name occupies', () => {
    // The longest genuine label is "Dukuh Atas Bank Syariah Indonesia" at
    // ~35,500. Anything beyond this ceiling is a merge, not a name.
    const oversized = labels.filter(o => hitArea(o) > 40000)
    expect(oversized.map(l => `${l.station} ${Math.round(hitArea(l))}`)).toEqual([])
  })

  it('keeps every box big enough to tap', () => {
    // The boxes are deliberately tighter than the drawn text — they cover the
    // x-height core, which is what a thumb hits, and that tightness is part of
    // what keeps stacked neighbours apart. This is the floor that decision
    // rides on: a dot tap target is ~450 u^2, so every label is far larger.
    const tiny = labels.filter(o => hitArea(o) < 1200)
    expect(tiny.map(l => `${l.station} ${Math.round(hitArea(l))}`)).toEqual([])
  })

  it('holds overlaps between different labels at the measured floor', () => {
    // Two labels for the SAME station, or one drawn name shared across
    // operators at an interchange, are not overlaps — that is one label
    // legitimately claimed twice.
    let overlaps = 0
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]
        const b = labels[j]
        if (a.station === b.station || a.text.trim() === b.text.trim()) continue
        if (gapBetween(a, b) < 0) overlaps++
      }
    }
    // Down from 44 before the extractor rules were tuned. What remains is
    // labels the artwork genuinely draws touching, all within ~10 units.
    expect(overlaps).toBeLessThanOrEqual(4)
  })

  it('suppresses the selection halo on every label', () => {
    // A ring is an offset outline settling onto the shape's edge: right for a
    // marker, wrong for a word, where it reads as a box drawn around the text.
    expect(labels.every(o => o.noRing)).toBe(true)
  })
})
