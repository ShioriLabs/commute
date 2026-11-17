/*
 * Roads for one z15 tile from data/osm/roads.sqlite (scripts/export-osm-roads.py),
 * in the shape decodeRoads gives for a basemap tile: [{ props, lines }] in
 * tile units. Each road is projected from its own lon/lat and clipped to the
 * tile plus `edge`, so neighbouring tiles cut the same road from the same
 * unquantised line and agree where they overlap (Protomaps' per-tile geometry
 * jogged ~0.3 m at every tile edge).
 *
 * Lanes come with the roads, exactly: each road keeps the lanes of the ways it
 * was joined from, so lanesFor(line) gives a line's lane runs without matching.
 */
import { DatabaseSync } from 'node:sqlite'
import { project } from './tiles.mjs'

/* Road kinds whose OSM lane counts set their width (residential stays on its class). */
const LANE_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'])

/*
 * A polyline clipped to [lo, hi]², by segment (Liang-Barsky), each output
 * point carrying the source segment it came from.
 */
export function clipLine(points, lo, hi) {
  const parts = []
  let current = null
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const dx = bx - ax
    const dy = by - ay
    let t0 = 0
    let t1 = 1
    let inside = true
    for (const [p, q] of [[-dx, ax - lo], [dx, hi - ax], [-dy, ay - lo], [dy, hi - ay]]) {
      if (p === 0) {
        if (q < 0) inside = false
        continue
      }
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
    }
    if (!inside || t0 > t1) {
      if (current) parts.push(current)
      current = null
      continue
    }
    if (!current) current = { points: [[ax + t0 * dx, ay + t0 * dy]], segs: [] }
    current.points.push([ax + t1 * dx, ay + t1 * dy])
    current.segs.push(i)
    if (t1 < 1) {
      parts.push(current)
      current = null
    }
  }
  if (current) parts.push(current)
  return parts.filter(p => p.points.length >= 2)
}

export function openOsmRoads(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  const query = db.prepare('SELECT r.props AS props, r.coords AS coords, r.spans AS spans FROM tiles t JOIN roads r ON r.id = t.road WHERE t.x = ? AND t.y = ?')
  return {
    close: () => db.close(),
    /*
     * The tile's roads ({ props, lines }, decodeRoads' shape), and lanesFor:
     * the raw lane runs of one of those lines ({ from, to, lanes, width } in
     * tile units along it), or null.
     */
    tile(x, y, extent, edge, zoom = 15) {
      const features = []
      const runsOf = new Map()
      for (const row of query.all(x, y)) {
        const props = JSON.parse(row.props)
        const blob = row.coords
        const coords = new Float64Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))
        const points = []
        for (let k = 0; k < coords.length; k += 2) {
          const [fx, fy] = project(coords[k], coords[k + 1], zoom)
          points.push([(fx - x) * extent, (fy - y) * extent])
        }
        const spans = LANE_KINDS.has(props.kind_detail) ? JSON.parse(row.spans) : []
        const laneOf = (seg) => {
          for (const [a, b, lanes, width] of spans) if (seg >= a && seg < b) return { lanes, width }
          return { lanes: null, width: null }
        }
        const lines = []
        for (const part of clipLine(points, -edge, extent + edge)) {
          lines.push(part.points)
          if (!spans.some(s => s[2])) continue
          const runs = []
          let along = 0
          part.segs.forEach((seg, k) => {
            const [ax, ay] = part.points[k]
            const [bx, by] = part.points[k + 1]
            const len = Math.hypot(bx - ax, by - ay)
            runs.push({ from: along, to: along + len, ...laneOf(seg) })
            along += len
          })
          runsOf.set(part.points, runs)
        }
        if (lines.length) features.push({ props, lines })
      }
      return { features, lanesFor: line => runsOf.get(line) ?? null }
    }
  }
}
