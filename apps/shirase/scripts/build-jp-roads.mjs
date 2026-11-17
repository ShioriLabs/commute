/*
 * The jp theme's roads as real geometry: road surfaces that merge at
 * junctions and forks, and Japanese road markings that stop where roads meet.
 *
 *   pnpm --filter @commute/shirase build:jp-roads
 *
 * Reads the newest basemap extract in data/ and writes
 * data/<spec.tileset>.pmtiles: z15 tiles with two layers, which MapLibre
 * overzooms from z17 up (src/jp-roads.ts styles them):
 *   surface  polygons  l: level (g ground, b bridge), p: paving (spec colour)
 *   paint    lines     l: level, c: paint colour (spec colour), w: stripe width, m
 *
 * Why geometry and not a line pattern: a pattern is drawn along each road on
 * its own, so where two roads meet their stripes cross, and at a fork the two
 * ribbons overlap for tens of metres. Here, per z15 tile:
 *   1. every painted road is buffered to its cross-section's width; the union
 *      is the road surface, so junctions and forks get their true shape;
 *   2. at every junction (found as before: real meetings, not one road
 *      continuing into the next), the overlap of the meeting roads is the
 *      junction zone: the box at a crossing, the mouth at a T, the whole
 *      shared stretch at a fork;
 *   3. the markings (spec `lines`, offset from each road's centreline, dashes
 *      cut in true metres) are drawn everywhere except inside junction
 *      zones, so they stop at the junction as they do on a Japanese road.
 * Bus-lane paving is the busways minus every other road, so it stops at
 * intersections too.
 *
 * Tiles carry road geometry 64 units (~19 m) past each edge, more than any
 * half-road, so each tile is complete on its own. Output is clipped to the
 * tile plus a small margin.
 *
 * Derived from OpenStreetMap via the Protomaps extract: © OpenStreetMap
 * contributors, ODbL (LICENSE.md §3).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ClipperLib from 'clipper-lib'
import { PMTiles } from 'pmtiles'
import { availableParallelism } from 'node:os'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { openOsmRoads } from './lib/osm-roads.mjs'
import { DATA_DIR, decodeRoads, encodeTile, FileSource, newestBasemap, PmtilesWriter, project, tileMetres } from './lib/tiles.mjs'

/*
 * Road geometry: raw OSM ways (scripts/export-osm-roads.py) when this file
 * exists, else the basemap's own z15 tiles. Raw OSM is the same line in every
 * tile, so tiles agree at their edges; Protomaps' per-tile geometry jogged
 * ~0.3 m there. Its roads also carry their own lanes, exactly.
 */
const OSM_ROADS = path.join(DATA_DIR, 'osm', 'roads.sqlite')

const { Clipper, ClipperOffset, ClipType, EndType, JoinType, PolyFillType, PolyTree, PolyType } = ClipperLib

const SPEC_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'jp-roads.json')
export const loadSpec = () => JSON.parse(readFileSync(SPEC_PATH, 'utf-8'))

const ZOOM = 15
const EXTENT = 4096
// Clipper works in integers: source units × SCALE (~0.02 m).
const SCALE = 16
// Kept around each tile: past the edge so fills and lines meet their
// neighbours' without a seam, inside the source buffer so nothing is missing.
const MARGIN = 32
// The source's clip edge, where roads end only because the tile does.
const CLIP_EDGE = 64
const OUT_EXTENT = 8192
// ~0.6 m: how close counts as touching when finding junctions.
const EPSILON = 2
const GRID = 64
// How far from a junction its zone can reach: long enough for a shallow
// fork's branches to separate (60 m cut a 3%-diverging fork short and its
// stripes came back inside the shared stretch; 120 m cost nothing more).
const ZONE_REACH_M = 120

// ── which spec row a road is (mirrors the style's choice of roads) ──────────

/** The spec row a road's tile properties put it in; null when it is not painted. */
export function rowFor(spec, props) {
  if (props.is_tunnel) return null
  for (const row of spec.rows) {
    if (Boolean(row.link) !== Boolean(props.is_link)) continue
    if (!row.kindDetail.includes(props.kind_detail)) continue
    if (row.named && !props.name) continue
    if (row.hiddenAccess?.includes(props.access)) continue
    if (row.oneway === 'yes' && props.oneway !== 'yes') continue
    if (row.oneway === 'no' && props.oneway === 'yes') continue
    return row
  }
  return null
}

// ── lanes from raw OSM ─────────────────────────────────────────────────────

/*
 * The tiles carry no lane data (Protomaps drops `lanes`, `width`), so lane
 * counts come from raw OSM: data/osm/lanes.json, ways with their `lanes`,
 * `lanes:forward`/`backward`, `width` and geometry (lon/lat), exported from
 * a Geofabrik extract. Optional: without it every road keeps its class's
 * cross-section.
 */
const LANE_M = 3.25
const SHOULDER_M = 0.5

/** A row re-cut for a road with known lanes: true width, a lane line between every two lanes. */
export function laneRow(row, { lanes, width }) {
  const n = Math.round(lanes ?? 0)
  if (n < 1 || n > 8 || row.background === 'busLane' || !row.lines.length) return row
  // OSM `width` is the carriageway's; trusted only if it is lane-like.
  const carriage = width && width >= n * 2.5 && width <= n * 4.5 ? width : n * LANE_M
  const lane = carriage / n
  const edge = row.lines.find(l => l.edge)
  // The row's own shoulder (motorways keep their wider one), 0.5 m without an edge line.
  const shoulder = edge ? row.widthM / 2 - edge.offsetM : SHOULDER_M
  const widthM = carriage + 2 * shoulder
  const centre = row.lines.filter(l => !l.edge && l.offsetM < 0.5)
  const divider = row.lines.find(l => !l.edge && l.offsetM >= 0.5) ?? { widthM: 0.15, colour: 'white', dash: [5, 5] }
  const lines = edge ? [{ ...edge, offsetM: widthM / 2 - shoulder }] : []
  // Every line is drawn at ±offset, so one offset per mirrored pair.
  const offsets = new Set()
  if (row.oneway === 'yes') {
    for (let k = 1; k < n; k++) offsets.add(Math.round(Math.abs(-carriage / 2 + k * lane) * 1000) / 1000)
  } else {
    lines.push(...centre)
    for (let k = 1; k < Math.round(n / 2); k++) offsets.add(Math.round(k * lane * 1000) / 1000)
  }
  for (const offsetM of offsets) lines.push({ ...divider, offsetM, edge: undefined })
  return { ...row, widthM, lines, lanes: n }
}

/* data/osm/lanes.json bucketed by z15 tile, or null when absent. */
export function loadLanes(file = path.join(DATA_DIR, 'osm', 'lanes.json')) {
  if (!existsSync(file)) return null
  const byTile = new Map()
  for (const way of JSON.parse(readFileSync(file, 'utf8'))) {
    const pts = way.coords.map(([lon, lat]) => project(lon, lat, ZOOM))
    const xs = pts.map(p => Math.floor(p[0]))
    const ys = pts.map(p => Math.floor(p[1]))
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
        const key = `${x},${y}`
        if (!byTile.has(key)) byTile.set(key, [])
        byTile.get(key).push({ ...way, pts })
      }
    }
  }
  return byTile
}

/*
 * For one tile: where along a tile road which OSM lanes apply. Every
 * SAMPLE_M along the road takes the lanes of the nearest OSM way within 3 m
 * that runs the same way (within 20°). Positions, not a vote per road: a
 * lane change then falls where OSM's ways meet, the same place in every tile
 * (a vote per tile road put the change on a tile edge, Rasuna Said at Karet
 * Kuningan). Returns runs [{ from, to, lanes, width }] in tile units along
 * the line (lanes null where nothing matched), or null.
 */
const SAMPLE_M = 2
// Runs shorter than this (a junction box, a short way) take their neighbour's
// lanes: Rasuna Said's many short ways made the width change every few dozen metres.
const MIN_RUN_M = 40

export function lanesForTile(byTile, x, y, unitsPerMetre) {
  const ways = byTile?.get(`${x},${y}`)
  if (!ways) return null
  const reach = 3 * unitsPerMetre
  const step = SAMPLE_M * unitsPerMetre
  /*
   * Every way segment in a grid of reach-sized cells, so a sample reads only
   * the nine cells round it: with every main road's lanes loaded, scanning
   * all of a dense tile's ways for each 2 m sample took seconds per tile.
   */
  const cell = v => Math.floor(v / reach)
  const grid = new Map()
  for (const w of ways) {
    const line = w.pts.map(([fx, fy]) => [(fx - x) * EXTENT, (fy - y) * EXTENT])
    for (let j = 0; j + 1 < line.length; j++) {
      const seg = { w, a: line[j], b: line[j + 1] }
      for (let gx = cell(Math.min(seg.a[0], seg.b[0])); gx <= cell(Math.max(seg.a[0], seg.b[0])); gx++) {
        for (let gy = cell(Math.min(seg.a[1], seg.b[1])); gy <= cell(Math.max(seg.a[1], seg.b[1])); gy++) {
          const key = `${gx},${gy}`
          if (!grid.has(key)) grid.set(key, [])
          grid.get(key).push(seg)
        }
      }
    }
  }
  // Only a way of the road's own kind: a primary_link slip lane beside a
  // primary road must not set the primary's lanes (Rasuna Said).
  const match = (p, ux, uy, kind) => {
    let best = null
    let bestD = reach
    for (let dx = -1; dx <= 1; dx++) {
      for (const dy of [-1, 0, 1]) {
        for (const { w, a: [cx, cy], b: [ex, ey] } of grid.get(`${cell(p[0]) + dx},${cell(p[1]) + dy}`) ?? []) {
          if (kind && w.highway !== kind) continue
          const l2 = (ex - cx) ** 2 + (ey - cy) ** 2
          if (l2 === 0) continue
          const t = Math.max(0, Math.min(1, ((p[0] - cx) * (ex - cx) + (p[1] - cy) * (ey - cy)) / l2))
          const dist = Math.hypot(p[0] - (cx + t * (ex - cx)), p[1] - (cy + t * (ey - cy)))
          const parallel = Math.abs(((ex - cx) * ux + (ey - cy) * uy) / Math.sqrt(l2))
          if (dist <= bestD && parallel >= Math.cos(Math.PI / 9)) {
            bestD = dist
            best = w
          }
        }
      }
    }
    return best
  }
  return (line, kind) => {
    const samples = []
    let along = 0
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i]
      const [bx, by] = line[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      if (len === 0) continue
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len]
      for (let d = 0; d < len; d += step) samples.push({ at: along + d, way: match([ax + ux * d, ay + uy * d], ux, uy, kind) })
      along += len
    }
    if (!samples.some(s => s.way)) return null
    const raw = samples.map(s => ({ from: s.at, to: s.at + step, lanes: s.way?.lanes ?? null, width: s.way?.width ?? null }))
    raw[raw.length - 1].to = along
    return settleRuns(raw, unitsPerMetre)
  }
}

/*
 * Lane runs along a line, settled: neighbours with the same lanes merged,
 * then runs shorter than MIN_RUN_M folded into a neighbour, so a junction box
 * or a short way does not make the width change every few dozen metres.
 */
export function settleRuns(input, unitsPerMetre) {
  const key = r => (r.lanes ? `${r.lanes}|${r.width ?? ''}` : '')
  const merge = list => list.reduce((out, r) => {
    const last = out.at(-1)
    if (last && key(last) === key(r)) last.to = r.to
    else out.push({ ...r })
    return out
  }, [])
  let runs = merge(input)
  const short = MIN_RUN_M * unitsPerMetre
  for (let changed = true; changed && runs.length > 1;) {
    changed = false
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].to - runs[i].from >= short) continue
      const into = i === 0 ? 1 : i - 1
      if (into === i + 1) runs[into].from = runs[i].from
      else runs[into].to = runs[i].to
      runs.splice(i, 1)
      changed = true
      break
    }
    runs = merge(runs)
  }
  return runs.some(r => r.lanes) ? runs : null
}

/* The part of a line between distances a and b along it. */
export function sliceLine(line, a, b) {
  const out = []
  let along = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i]
    const [bx, by] = line[i + 1]
    const len = Math.hypot(bx - ax, by - ay)
    const at = t => [ax + ((bx - ax) * t) / (len || 1), ay + ((by - ay) * t) / (len || 1)]
    if (along + len >= a && along <= b) {
      if (!out.length) out.push(at(Math.max(0, a - along)))
      out.push(at(Math.min(len, b - along)))
    }
    along += len
  }
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1])
}

// Where OSM's lane count changes, the carriageway widens over this distance.
export const TAPER_M = 30

// A gap up to this wide between a busway and the road beside it is paved (one span).
export const BUS_JOIN_M = 3

// Where a busway ends into general traffic, its paving narrows to a point over this.
export const BUS_FADE_M = 25

/*
 * A tile road cut by its lane runs: pieces of steady width, and a tapered
 * piece (width easing from one to the next over TAPER_M, centred on the
 * change) between each two. Internal piece ends are square (`butt`), so
 * joins carry no round-cap bulge; the road's own ends stay round.
 */
export function lanePieces(row, line, runs, unitsPerMetre) {
  if (!runs) return [{ row, line }]
  const rowOf = r => (r.lanes ? laneRow(row, r) : row)
  if (runs.length === 1) return [{ row: rowOf(runs[0]), line }]
  const total = runs.at(-1).to
  const pieces = []
  let from = 0
  for (let i = 0; i < runs.length; i++) {
    const here = rowOf(runs[i])
    const next = runs[i + 1]
    // The taper is centred on the change but never longer than either run allows.
    const half = next ? Math.min(TAPER_M * unitsPerMetre / 2, (runs[i].to - runs[i].from) / 2, (next.to - next.from) / 2) : 0
    const to = next ? runs[i].to - half : total
    if (to > from) pieces.push({ row: here, span: [from, to] })
    if (next) {
      const there = rowOf(next)
      const narrow = here.widthM <= there.widthM ? here : there
      pieces.push({ row: narrow, span: [to, runs[i].to + half], taper: [here.widthM, there.widthM] })
      from = runs[i].to + half
    }
  }
  /*
   * Neighbouring pieces overlap by OVERLAP_M: square ends that only touch
   * left a hairline between them once each piece was smoothed on its own,
   * and the kerb line traced across the road there.
   */
  const overlap = OVERLAP_M * unitsPerMetre
  return pieces
    .filter(p => p.span[1] > p.span[0])
    .map((p, i, all) => {
      const a = i > 0 ? Math.max(0, p.span[0] - overlap) : p.span[0]
      const b = i < all.length - 1 ? Math.min(total, p.span[1] + overlap) : p.span[1]
      return { row: p.row, ...(p.taper ? { taper: p.taper } : {}), line: sliceLine(line, a, b), buttStart: i > 0, buttEnd: i < all.length - 1 }
    })
    .filter(p => p.line.length >= 2)
}

const OVERLAP_M = 0.5

/*
 * Where two different roads continue end to end (a ground road onto a
 * bridge, or two roads of different lanes) at different widths, the width
 * stepped at the join (Kuningan Flyover). The ground-level one (or, both on
 * the ground, the wider) tapers its last TAPER_M to the other's width.
 * Points where three or more roads meet are junctions, not continuations.
 * Mutates `roads`: a tapered piece becomes a shorter piece and a taper.
 */
export function taperContinuations(roads, junctions, unitsPerMetre) {
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= EPSILON
  const ends = []
  roads.forEach((r, i) => {
    if (!r.buttStart) ends.push({ i, at: r.line[0], start: true })
    if (!r.buttEnd) ends.push({ i, at: r.line.at(-1), start: false })
  })
  // Which ends of which pieces taper, and to what width; a piece can taper at both.
  const wanted = new Map()
  for (const a of ends) {
    if (junctions.some(j => near([j.x, j.y], a.at))) continue
    const meeting = ends.filter(b => near(b.at, a.at))
    if (meeting.length !== 2) continue
    const b = meeting.find(e => e !== a)
    const [ra, rb] = [roads[a.i], roads[b.i]]
    if (ra.group === rb.group || ra.taper || Math.abs(ra.row.widthM - rb.row.widthM) < 0.3) continue
    // Who tapers: the ground side of a bridge join, else the wider road.
    const mine = ra.level !== rb.level ? ra.level === 'g' : ra.row.widthM > rb.row.widthM
    if (!mine) continue
    wanted.set(a.i, { ...wanted.get(a.i), [a.start ? 'start' : 'end']: rb.row.widthM })
  }
  const taper = TAPER_M * unitsPerMetre
  const overlap = OVERLAP_M * unitsPerMetre
  const replaced = new Map()
  for (const [i, want] of wanted) {
    const r = roads[i]
    let length = 0
    for (let k = 1; k < r.line.length; k++) length += Math.hypot(r.line[k][0] - r.line[k - 1][0], r.line[k][1] - r.line[k - 1][1])
    // Each taper at most TAPER_M, and together at most 90% of a short piece.
    const share = want.start !== undefined && want.end !== undefined ? 0.45 : 0.9
    const span = Math.min(taper, length * share)
    if (span < 2 * unitsPerMetre) continue
    const narrowOf = w => (w <= r.row.widthM ? { ...r.row, widthM: w } : r.row)
    const pieces = []
    const from = want.start !== undefined ? span : 0
    const to = want.end !== undefined ? length - span : length
    if (want.start !== undefined) {
      pieces.push({ ...r, row: narrowOf(want.start), line: sliceLine(r.line, 0, span + overlap), taper: [want.start, r.row.widthM], buttEnd: true, squareEnd: false })
    }
    pieces.push({ ...r, line: sliceLine(r.line, Math.max(0, from - (from ? overlap : 0)), Math.min(length, to + (to < length ? overlap : 0))), buttStart: r.buttStart || from > 0, buttEnd: r.buttEnd || to < length, squareStart: from > 0 ? false : r.squareStart, squareEnd: to < length ? false : r.squareEnd })
    if (want.end !== undefined) {
      pieces.push({ ...r, row: narrowOf(want.end), line: sliceLine(r.line, length - span - overlap, length), taper: [r.row.widthM, want.end], buttStart: true, squareStart: false })
    }
    replaced.set(i, pieces.filter(p => p.line.length >= 2))
  }
  for (const i of [...replaced.keys()].sort((p, q) => q - p)) roads.splice(i, 1, ...replaced.get(i))
}

/* The spec's median stretches that reach z15 tile (x, y), their boxes in its tile units. */
export function medianStretchesFor(spec, x, y) {
  return stretchesFor(spec.medians?.stretches, x, y)
}

/* The spec's merged divided roads (spec.merge.stretches) that reach tile (x, y), boxed in its units. */
export function mergeStretchesFor(spec, x, y) {
  return stretchesFor(spec.merge?.stretches, x, y)
}

function stretchesFor(stretches = [], x, y) {
  const out = []
  for (const { name, box: [w, s, e, n], medianM, green } of stretches) {
    const [x0, y0] = project(w, n, ZOOM)
    const [x1, y1] = project(e, s, ZOOM)
    const rect = [(x0 - x) * EXTENT, (y0 - y) * EXTENT, (x1 - x) * EXTENT, (y1 - y) * EXTENT]
    const pad = CLIP_EDGE
    if (rect[2] < -pad || rect[0] > EXTENT + pad || rect[3] < -pad || rect[1] > EXTENT + pad) continue
    out.push({ name, rect, medianM, green })
  }
  return out
}

/* A line widened from w0 at its start to w1 at its end (full widths, tile units), as a Clipper polygon. */
export function taperPolygon(line, w0, w1) {
  const pts = densify(line, Math.max(1, Math.hypot(line.at(-1)[0] - line[0][0], line.at(-1)[1] - line[0][1]) / 16))
  const lengths = [0]
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = lengths.at(-1) || 1
  const left = []
  const right = []
  pts.forEach(([px, py], i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)]
    const [bx, by] = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(bx - ax, by - ay) || 1
    const [nx, ny] = [-(by - ay) / len, (bx - ax) / len]
    const h = (w0 + (w1 - w0) * (lengths[i] / total)) / 2
    left.push([px + nx * h, py + ny * h])
    right.push([px - nx * h, py - ny * h])
  })
  // Wound like ClipperOffset's output whichever way the road was drawn: a
  // reversed ring cancelled its neighbours in the union and left holes.
  const path = toPath([...left, ...right.reverse()])
  return Clipper.Orientation(path) ? path : path.reverse()
}

// ── junctions ──────────────────────────────────────────────────────────────

const dist2PointSeg = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

function segmentCrossing([ax, ay], [bx, by], [cx, cy], [dx, dy]) {
  const rx = bx - ax
  const ry = by - ay
  const sx = dx - cx
  const sy = dy - cy
  const denom = rx * sy - ry * sx
  if (denom === 0) return null
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
  return [ax + t * rx, ay + t * ry]
}

/*
 * Where painted roads really meet. roads: [{ level, line }] in tile units.
 * A candidate (an endpoint, a shared vertex, or a same-level segment
 * crossing) is a junction when the roads within EPSILON of it add up to
 * three or more way-ends (passing through counts two, ending one) from at
 * least two roads. Returns [{ x, y, level, roads: [road index...] }].
 *
 * Junctions out in the tile's buffer count too (their zones reach into the
 * tile), except at the clip edge itself, where roads end only because the
 * tile does.
 */
export function findJunctions(roads) {
  const grid = new Map()
  const cellsOf = (a, b) => {
    const out = []
    const x0 = Math.floor((Math.min(a[0], b[0]) - EPSILON) / GRID)
    const x1 = Math.floor((Math.max(a[0], b[0]) + EPSILON) / GRID)
    const y0 = Math.floor((Math.min(a[1], b[1]) - EPSILON) / GRID)
    const y1 = Math.floor((Math.max(a[1], b[1]) + EPSILON) / GRID)
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) out.push(`${gx},${gy}`)
    return out
  }
  roads.forEach((road, ri) => {
    for (let s = 0; s < road.line.length - 1; s++) {
      for (const cell of cellsOf(road.line[s], road.line[s + 1])) {
        if (!grid.has(cell)) grid.set(cell, [])
        grid.get(cell).push([ri, s])
      }
    }
  })
  const near = (p) => {
    const found = new Map()
    for (const cell of cellsOf(p, p)) for (const [ri, s] of grid.get(cell) ?? []) found.set(`${ri}:${s}`, [ri, s])
    return [...found.values()]
  }

  const lo = -CLIP_EDGE + EPSILON
  const hi = EXTENT + CLIP_EDGE - EPSILON
  const usable = ([x, y]) => x > lo && y > lo && x < hi && y < hi

  const candidates = []
  for (const road of roads) for (const p of road.line) if (usable(p)) candidates.push(p)
  roads.forEach((road, ri) => {
    for (let s = 0; s < road.line.length - 1; s++) {
      for (const cell of cellsOf(road.line[s], road.line[s + 1])) {
        for (const [rj, t] of grid.get(cell) ?? []) {
          if (rj <= ri || roads[rj].level !== road.level) continue
          const hit = segmentCrossing(road.line[s], road.line[s + 1], roads[rj].line[t], roads[rj].line[t + 1])
          if (hit && usable(hit)) candidates.push(hit)
        }
      }
    }
  })

  const eps2 = EPSILON * EPSILON
  const seen = new Set()
  const out = []
  for (const p of candidates) {
    const key = `${Math.round(p[0] / EPSILON)},${Math.round(p[1] / EPSILON)}`
    if (seen.has(key)) continue
    const byLevel = { g: new Map(), b: new Map() }
    for (const [ri, s] of near(p)) {
      const road = roads[ri]
      if (dist2PointSeg(p, road.line[s], road.line[s + 1]) > eps2) continue
      const atEnd = q => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= eps2
      const contribution = atEnd(road.line[0]) || atEnd(road.line[road.line.length - 1]) ? 1 : 2
      byLevel[road.level].set(ri, Math.max(byLevel[road.level].get(ri) ?? 0, contribution))
    }
    for (const level of ['g', 'b']) {
      const incident = byLevel[level]
      const degree = [...incident.values()].reduce((a, b) => a + b, 0)
      if (incident.size < 2 || degree < 3) continue
      seen.add(key)
      // `through`: the roads that run on past the junction (not ending there).
      out.push({ x: p[0], y: p[1], level, roads: [...incident.keys()], through: [...incident].filter(([, c]) => c === 2).map(([ri]) => ri) })
    }
  }
  return out
}

// ── lines ──────────────────────────────────────────────────────────────────

/*
 * A polyline offset sideways by d (positive to the left of travel in tile
 * coordinates). Miter joins, bevelled past a sharp turn so a hairpin does
 * not throw a spike.
 */
export function offsetPolyline(line, d) {
  if (d === 0) return line.map(p => [...p])
  const normals = []
  for (let i = 0; i < line.length - 1; i++) {
    const dx = line[i + 1][0] - line[i][0]
    const dy = line[i + 1][1] - line[i][1]
    const len = Math.hypot(dx, dy) || 1
    normals.push([-dy / len, dx / len])
  }
  const out = []
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i]
    if (i === 0 || i === line.length - 1) {
      const n = normals[Math.min(i, normals.length - 1)]
      out.push([x + n[0] * d, y + n[1] * d])
      continue
    }
    const a = normals[i - 1]
    const b = normals[i]
    const k = 1 + a[0] * b[0] + a[1] * b[1]
    if (k < 0.25) {
      out.push([x + a[0] * d, y + a[1] * d], [x + b[0] * d, y + b[1] * d])
    } else {
      out.push([x + ((a[0] + b[0]) / k) * d, y + ((a[1] + b[1]) / k) * d])
    }
  }
  return out
}

/*
 * The painted pieces of a dashed line: `paint` long, `gap` apart, measured
 * from the line's start, so the phase is the road's own and dash lengths are
 * true at every zoom.
 */
export function dashes(line, paint, gap) {
  /*
   * Each dash is cut by absolute distance, [k·cycle, k·cycle + paint], with
   * one forward walk along the line. (A first version stepped by phase with
   * `%`, and a float phase landing a hair under the cycle made near-zero
   * steps: it ran out of memory on the first real tile.)
   */
  const cum = [0]
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  }
  const total = cum.at(-1)
  const at = (i, d) => {
    const len = cum[i + 1] - cum[i]
    const s = len === 0 ? 0 : (d - cum[i]) / len
    return [line[i][0] + (line[i + 1][0] - line[i][0]) * s, line[i][1] + (line[i + 1][1] - line[i][1]) * s]
  }
  const out = []
  let seg = 0
  for (let start = 0; start < total; start += paint + gap) {
    const end = Math.min(start + paint, total)
    while (seg < line.length - 2 && cum[seg + 1] <= start) seg++
    const piece = [at(seg, start)]
    let i = seg
    while (i < line.length - 2 && cum[i + 1] < end) {
      piece.push(line[i + 1])
      i++
    }
    piece.push(at(i, end))
    if (end - start > 1e-6) out.push(piece)
  }
  return out
}

/*
 * A road's centreline as a curve: centripetal Catmull-Rom through the OSM
 * vertices (it passes through every one, so junctions stay where they are),
 * resampled about every `step`. OSM draws a bend as straight segments, and
 * the extract thins those further, so at street zoom every vertex showed as
 * a corner.
 *
 * Only bends are curved: a vertex turning more than `maxTurnDeg` (a road
 * rounding a street corner, a U-turn slot) stays a corner, and a segment
 * whose two ends both run straight on is kept as it is rather than
 * densified, so straight roads cost nothing.
 */
export function smoothLine(line, step, maxTurnDeg) {
  if (line.length < 3) return line.map(p => [...p])
  const turn = (i) => {
    if (i <= 0 || i >= line.length - 1) return 0
    const ax = line[i][0] - line[i - 1][0]
    const ay = line[i][1] - line[i - 1][1]
    const bx = line[i + 1][0] - line[i][0]
    const by = line[i + 1][1] - line[i][1]
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    if (la === 0 || lb === 0) return 0
    return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180) / Math.PI
  }
  const sharp = i => turn(i) > maxTurnDeg
  const gentle = i => turn(i) < 1
  const out = [[...line[0]]]
  for (let i = 0; i < line.length - 1; i++) {
    const p1 = line[i]
    const p2 = line[i + 1]
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if (len === 0) continue
    // Straight on at both ends, or a sharp corner at either: a straight segment.
    if ((gentle(i) && gentle(i + 1)) || sharp(i) || sharp(i + 1)) {
      out.push([...p2])
      continue
    }
    // Neighbours for the spline; a missing or sharp-cornered one is mirrored.
    const p0 = i > 0 && !sharp(i) ? line[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]]
    const p3 = i + 2 < line.length && !sharp(i + 1) ? line[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]]
    const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    // About one chord per 6° of turning (a smooth-looking curve), never
    // closer than `step`: sampling every metre made curvy residential tiles
    // ten times slower to build for no visible gain.
    const n = Math.max(1, Math.min(Math.ceil(len / step), Math.ceil(Math.max(turn(i), turn(i + 1)) / 6)))
    for (let k = 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n
      const lerp = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)]
      const a1 = lerp(p0, p1, 0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, 0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      out.push(k === n ? [...p2] : lerp(b1, b2, t1, t2))
    }
  }
  return out
}

// ── Clipper helpers ─────────────────────────────────────────────────────────

/*
 * A Clipper path in integer units, with repeated consecutive points dropped.
 * Rounding to integers makes repeats (a dash cut landing on a vertex), and
 * Clipper 6 loops forever on an open path that has one: measured, one such
 * path in a rural tile (26142/16964) hung the whole build for an hour.
 */
export function toPath(line) {
  const out = []
  for (const [x, y] of line) {
    const X = Math.round(x * SCALE)
    const Y = Math.round(y * SCALE)
    const last = out[out.length - 1]
    if (!last || last.X !== X || last.Y !== Y) out.push({ X, Y })
  }
  return out
}
const fromPath = path => path.map(({ X, Y }) => [X / SCALE, Y / SCALE])

function buffer(line, halfWidth, end) {
  const co = new ClipperOffset(2, 0.05 * SCALE)
  co.AddPath(toPath(line), JoinType.jtRound, end)
  const out = []
  co.Execute(out, halfWidth * SCALE)
  return out
}

function run(type, subject, clip, { open = false, tree = false } = {}) {
  const c = new Clipper()
  if (open) for (const p of subject) c.AddPath(p, PolyType.ptSubject, false)
  else c.AddPaths(subject, PolyType.ptSubject, true)
  if (clip.length) c.AddPaths(clip, PolyType.ptClip, true)
  if (open || tree) {
    const t = new PolyTree()
    c.Execute(type, t, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
    return open ? Clipper.OpenPathsFromPolyTree(t) : t
  }
  const out = []
  c.Execute(type, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
  return out
}

const union = paths => run(ClipType.ctUnion, paths, [])

/*
 * Morphological closing: grow by r then shrink by r, rounding inside
 * corners. `keep` leaves the result that much larger (shrinks back by r − keep).
 */
function closePolygons(paths, r, keep = 0) {
  // With r = 0 it is a plain offset by `keep`, which may be negative.
  const grow = new ClipperOffset(2, 0.05 * SCALE)
  grow.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon)
  const grown = []
  grow.Execute(grown, (r + keep) * SCALE)
  if (r === 0) return grown
  const shrink = new ClipperOffset(2, 0.05 * SCALE)
  shrink.AddPaths(grown, JoinType.jtRound, EndType.etClosedPolygon)
  const out = []
  shrink.Execute(out, -r * SCALE)
  return out
}

/*
 * The parts of a line inside the square of half-side `reach` around (x, y),
 * segments cut exactly at the square's edge (Liang-Barsky). Cutting by
 * segment, not by vertex: a long straight road has no vertex near the
 * junction at all, and dropping it lost the junction's zone.
 */
export function cropNear(line, x, y, reach) {
  const [x0, x1, y0, y1] = [x - reach, x + reach, y - reach, y + reach]
  const parts = []
  let current = null
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i]
    const [bx, by] = line[i + 1]
    const dx = bx - ax
    const dy = by - ay
    let t0 = 0
    let t1 = 1
    let inside = true
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
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
    const from = [ax + t0 * dx, ay + t0 * dy]
    const to = [ax + t1 * dx, ay + t1 * dy]
    if (!current) current = [from]
    current.push(to)
    // Leaving the square mid-segment ends this part.
    if (t1 < 1) {
      parts.push(current)
      current = null
    }
  }
  if (current) parts.push(current)
  return parts.filter(p => p.length >= 2)
}

/** The diagonal of a Clipper ring's bounding box, in Clipper units. */
function extent(ring) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { X, Y } of ring) {
    x0 = Math.min(x0, X)
    y0 = Math.min(y0, Y)
    x1 = Math.max(x1, X)
    y1 = Math.max(y1, Y)
  }
  return Math.hypot(x1 - x0, y1 - y0)
}

/** A circle as a Clipper path, centred at (x, y) tile units. */
function disc(x, y, radius) {
  const out = []
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * 2 * Math.PI
    out.push({ X: Math.round((x + Math.cos(a) * radius) * SCALE), Y: Math.round((y + Math.sin(a) * radius) * SCALE) })
  }
  return out
}

/** Polygons ([outer, ...holes], tile units) from a Clipper PolyTree. */
function polygonsOf(tree) {
  const out = []
  const walk = (node) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) continue
      const polygon = [fromPath(child.Contour())]
      for (const hole of child.Childs()) {
        polygon.push(fromPath(hole.Contour()))
        walk(hole)
      }
      out.push(polygon)
    }
  }
  walk(tree)
  return out
}

// ── one tile ───────────────────────────────────────────────────────────────

/*
 * Surfaces and paint for one tile's roads. features: decodeRoads output;
 * unitsPerMetre: tile units per ground metre. Returns { surfaces, paint } in
 * tile units: surfaces [{ level, paving, polygons }], paint
 * [{ level, kind, colour, width, lines }], kind being 'kerb' (the asphalt's
 * outline, which light and dark draw), 'edge' (edge lines) or 'mark'.
 */
export function buildTile(spec, features, unitsPerMetre, { lanesFor, medianStretches = [], mergeStretches = [] } = {}) {
  // Names along merged divided roads, one per road instead of one per carriageway.
  const labels = []
  const roads = []
  // The roads as the tile has them, before lane changes cut them into pieces.
  const originals = []
  // Mapped sidewalks and pedestrian streets at ground level, paved as pavement.
  const ground = kind => features.filter(f => f.props.kind_detail === kind && !f.props.is_bridge && !f.props.is_tunnel).flatMap(f => f.lines)
  const sidewalks = ground('sidewalk')
  const pedestrianStreets = ground('pedestrian')
  // A JPO's deck and stairs (export-osm-roads.py's footbridge and steps).
  const footbridges = features.filter(f => ['footbridge', 'steps'].includes(f.props.kind_detail) && !f.props.is_tunnel).flatMap(f => f.lines)
  /*
   * Tunnels: their own faded surface under the ground roads (light and dark;
   * jp leaves them out), so an underpass reads as one road running on under
   * what it passes beneath instead of two roads ending at its portals.
   */
  const tunnels = []
  for (const feature of features) {
    if (!feature.props.is_tunnel) continue
    const row = rowFor(spec, { ...feature.props, is_tunnel: false })
    if (row) for (const line of feature.lines) tunnels.push({ row, line })
  }
  const portals = tunnels.flatMap(t => [t.line[0], t.line.at(-1)])
  const atPortal = p => portals.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) <= unitsPerMetre)
  for (const feature of features) {
    const row = rowFor(spec, feature.props)
    if (!row) continue
    const level = feature.props.is_bridge ? 'b' : 'g'
    for (const line of feature.lines) {
      const group = originals.length
      originals.push({ line, level })
      for (const piece of lanePieces(row, line, lanesFor?.(line, feature.props.kind_detail), unitsPerMetre)) {
        // Square, not round, where a road dives into a tunnel.
        const squareStart = !piece.buttStart && atPortal(line[0])
        const squareEnd = !piece.buttEnd && atPortal(line.at(-1))
        roads.push({ ...piece, level, kind: feature.props.kind_detail, name: feature.props.name, group, squareStart, squareEnd })
      }
    }
  }
  if (roads.length === 0 && tunnels.length === 0 && footbridges.length === 0) return { surfaces: [], paint: [], labels: [] }

  // Junctions from the original lines (their vertices are what roads share);
  // everything drawn from the smoothed ones.
  /*
   * Junctions are found on the roads as drawn, then given to the pieces near
   * them: found on the pieces, each overlapping joint read as a T junction,
   * cutting lane lines and bus paving at every lane change.
   */
  const found = findJunctions(originals)
  taperContinuations(roads, found, unitsPerMetre)
  const piecesOf = new Map()
  roads.forEach((r, i) => piecesOf.set(r.group, [...(piecesOf.get(r.group) ?? []), i]))
  const nearJunction = (i, j) => roads[i].line.some((p, k) => k + 1 < roads[i].line.length
    && dist2PointSeg([j.x, j.y], p, roads[i].line[k + 1]) <= (4 * EPSILON) ** 2)
  /*
   * A street ending on a road that runs on through (a T's stem) ends square:
   * the road it meets covers the rest and the kerb returns round the corners.
   * Its round end reached past a narrow road's far kerb once OSM lanes made
   * that road narrower than its class (Latuharhari).
   */
  /*
   * Where every road ends at a junction (names change there: Jalan Kendal
   * becomes Latuharhari, with Purworejo as the stem), the two running most
   * nearly straight on (within 30°) count as the road through.
   */
  const away = (line, j) => {
    const fromStart = Math.hypot(line[0][0] - j.x, line[0][1] - j.y) <= Math.hypot(line.at(-1)[0] - j.x, line.at(-1)[1] - j.y)
    const pts = fromStart ? line : [...line].reverse()
    const reach = 5 * unitsPerMetre
    const p = pts.find(q => Math.hypot(q[0] - j.x, q[1] - j.y) >= reach) ?? pts.at(-1)
    const len = Math.hypot(p[0] - j.x, p[1] - j.y) || 1
    return [(p[0] - j.x) / len, (p[1] - j.y) / len]
  }
  for (const j of found) {
    if (j.through.length || j.roads.length < 3) continue
    let best = null
    for (let a = 0; a < j.roads.length; a++) {
      for (let b = a + 1; b < j.roads.length; b++) {
        const [ua, ub] = [away(originals[j.roads[a]].line, j), away(originals[j.roads[b]].line, j)]
        const dot = ua[0] * ub[0] + ua[1] * ub[1]
        if (dot <= -Math.cos(Math.PI / 6) && (!best || dot < best.dot)) best = { dot, pair: [j.roads[a], j.roads[b]] }
      }
    }
    if (best) j.through = best.pair
  }
  for (const j of found) {
    if (!j.through.length) continue
    for (const g of j.roads) {
      if (j.through.includes(g)) continue
      const near = q => Math.hypot(q[0] - j.x, q[1] - j.y) <= EPSILON
      for (const i of piecesOf.get(g) ?? []) {
        const r = roads[i]
        if (!r.buttStart && near(r.line[0])) r.squareStart = true
        if (!r.buttEnd && near(r.line.at(-1))) r.squareEnd = true
      }
    }
  }
  const junctions = found.map((j) => {
    const pieces = j.roads.flatMap((g) => {
      const all = piecesOf.get(g) ?? []
      const near = all.filter(i => nearJunction(i, j))
      return near.length ? near : all
    })
    return { ...j, roads: pieces }
  })
  const { maxTurnDeg, stepM } = spec.smoothing
  for (const r of roads) r.line = smoothLine(r.line, stepM * unitsPerMetre, maxTurnDeg)

  const half = r => (r.row.widthM / 2) * unitsPerMetre
  // Round ends for the surface, so road ends fill the junction they meet;
  // butt ends for junction zones, so a side street's zone stops at the main
  // road's centreline instead of eating its far edge line.
  // Bridges end square, at their abutments: they are drawn above the ground
  // level, so a round end spilled over the ground road beyond (dark bumps
  // across Galunggung's bus lanes where its bridge meets the road).
  /*
   * A lane change's tapered piece is its own polygon; the pieces either side
   * end square where they meet it, and round only at the road's true ends.
   */
  const roundStart = r => !r.buttStart && !r.squareStart
  const roundEnd = r => !r.buttEnd && !r.squareEnd
  const ends = (r) => {
    if (r.level === 'b') return []
    const caps = []
    if (roundStart(r)) caps.push(disc(r.line[0][0], r.line[0][1], half(r)))
    if (roundEnd(r)) caps.push(disc(r.line.at(-1)[0], r.line.at(-1)[1], half(r)))
    return caps
  }
  const bodyOf = r => (r.taper
    ? [taperPolygon(r.line, r.taper[0] * unitsPerMetre, r.taper[1] * unitsPerMetre)]
    : buffer(r.line, half(r), EndType.etOpenButt))
  const surface = roads.map(r => (r.taper || r.buttStart || r.buttEnd || r.squareStart || r.squareEnd
    ? [...bodyOf(r), ...ends(r)]
    : buffer(r.line, half(r), r.level === 'b' ? EndType.etOpenButt : EndType.etOpenRound)))
  const body = roads.map(bodyOf)

  /*
   * Bus paving fades out where a busway ends into general traffic (a dead
   * end: no other busway there): its last BUS_FADE_M narrows to a point,
   * like the taper painted where a dedicated lane ends, instead of a red
   * block stopping square in the road (Galunggung). Ends that carry on into
   * another busway, and internal lane joins, are left as they are.
   */
  const isBusRoad = r => r.row.background === 'busLane'
  const freeEnd = (r, p) => !roads.some(q => q !== r && isBusRoad(q) && q.line.some((a, k) => k + 1 < q.line.length
    && dist2PointSeg(p, a, q.line[k + 1]) <= unitsPerMetre ** 2))
  const busSurface = roads.map((r) => {
    if (!isBusRoad(r) || r.taper) return null
    const fadeStart = !r.buttStart && freeEnd(r, r.line[0])
    const fadeEnd = !r.buttEnd && freeEnd(r, r.line.at(-1))
    if (!fadeStart && !fadeEnd) return null
    let length = 0
    for (let k = 1; k < r.line.length; k++) length += Math.hypot(r.line[k][0] - r.line[k - 1][0], r.line[k][1] - r.line[k - 1][1])
    const fade = Math.min(BUS_FADE_M * unitsPerMetre, length * (fadeStart && fadeEnd ? 0.45 : 0.9))
    if (fade < 2 * unitsPerMetre) return null
    const w = r.row.widthM * unitsPerMetre
    const tip = 0.3 * unitsPerMetre
    const overlap = OVERLAP_M * unitsPerMetre
    const from = fadeStart ? fade : 0
    const to = fadeEnd ? length - fade : length
    const parts = buffer(sliceLine(r.line, Math.max(0, from - overlap), Math.min(length, to + overlap)), w / 2, EndType.etOpenButt)
    if (fadeStart) parts.push(taperPolygon(sliceLine(r.line, 0, fade + overlap), tip, w))
    if (fadeEnd) parts.push(taperPolygon(sliceLine(r.line, length - fade - overlap, length), w, tip))
    // A kept end stays round, as the rest of the surface would have been.
    if (!fadeStart && !r.buttStart) parts.push(disc(r.line[0][0], r.line[0][1], w / 2))
    if (!fadeEnd && !r.buttEnd) parts.push(disc(r.line.at(-1)[0], r.line.at(-1)[1], w / 2))
    return parts
  })

  const rect = [[
    { X: -MARGIN * SCALE, Y: -MARGIN * SCALE },
    { X: (EXTENT + MARGIN) * SCALE, Y: -MARGIN * SCALE },
    { X: (EXTENT + MARGIN) * SCALE, Y: (EXTENT + MARGIN) * SCALE },
    { X: -MARGIN * SCALE, Y: (EXTENT + MARGIN) * SCALE }
  ]]

  /*
   * Junction zones: the overlap of the meeting roads, the piece at the
   * junction. For a busway meeting a car road, only the overlap near the
   * junction point counts (a disc a little wider than the two roads): a
   * busway down a road's median overlaps that road for its whole length
   * when the class widths are guesses, and the whole strip must not become
   * a "junction" that erases the bus lane (Galunggung, Koridor 4/6).
   */
  const isBus = i => roads[i].row.background === 'busLane'
  const zones = { g: [], b: [] }
  /*
   * Each junction works on the meeting roads cropped to ZONE_REACH_M around
   * it: long enough for a fork's branches to separate, and it keeps a long
   * road's full outline from being intersected again at every junction it
   * touches (the dominant cost once roads were smoothed).
   */
  const reach = ZONE_REACH_M * unitsPerMetre
  for (const j of junctions) {
    const local = new Map(j.roads.map(i => [i, cropNear(roads[i].line, j.x, j.y, reach).flatMap(part => buffer(part, half(roads[i]), EndType.etOpenButt))]))
    const overlaps = []
    for (let a = 0; a < j.roads.length; a++) {
      for (let b = a + 1; b < j.roads.length; b++) {
        const [ra, rb] = [j.roads[a], j.roads[b]]
        let overlap = run(ClipType.ctIntersection, local.get(ra), local.get(rb))
        if (isBus(ra) !== isBus(rb)) {
          const reach = Math.hypot(half(roads[ra]), half(roads[rb])) + unitsPerMetre
          overlap = run(ClipType.ctIntersection, overlap, [disc(j.x, j.y, reach)])
        }
        overlaps.push(...overlap)
      }
    }
    const at = { X: Math.round(j.x * SCALE), Y: Math.round(j.y * SCALE) }
    // A crossing point can sit a hair outside its own overlap after
    // rounding; then keep the piece nearest instead of dropping the zone.
    const pieces = union(overlaps)
    const hit = pieces.filter(p => Clipper.PointInPolygon(at, p) !== 0)
    zones[j.level].push(...(hit.length ? hit : pieces))
  }

  const surfaces = []
  const paint = []
  if (tunnels.length) {
    for (const t of tunnels) t.line = smoothLine(t.line, stepM * unitsPerMetre, maxTurnDeg)
    const bored = union(tunnels.flatMap(t => buffer(t.line, (t.row.widthM / 2) * unitsPerMetre, EndType.etOpenButt)))
    surfaces.push({ level: 't', paving: 'tunnel', polygons: polygonsOf(run(ClipType.ctIntersection, bored, rect, { tree: true })) })
  }
  /*
   * A bridge's square ends at its abutments are part of its outline, and the
   * kerb hairline drew them as a line across the road (Epicentrum Tengah).
   * Thin strips across each true bridge end take them out of its kerbs; a
   * flyover keeps its kerbs where it passes over another road.
   */
  const bridgeEnds = roads.filter(r => r.level === 'b').flatMap((r) => {
    const across = (p, q) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const [nx, ny] = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len]
      const h = half(r) + 0.5 * unitsPerMetre
      return buffer([[p[0] - nx * h, p[1] - ny * h], [p[0] + nx * h, p[1] + ny * h]], 0.3 * unitsPerMetre, EndType.etOpenButt)
    }
    return [
      ...(roundStart(r) && r.line.length >= 2 ? across(r.line[0], r.line[1]) : []),
      ...(roundEnd(r) && r.line.length >= 2 ? across(r.line.at(-1), r.line.at(-2)) : [])
    ]
  })
  for (const level of ['g', 'b']) {
    const here = roads.map((r, i) => [r, i]).filter(([r]) => r.level === level)
    if (here.length === 0) continue
    const levelZones = union(zones[level])

    /*
     * Kerb returns: the merged surface widened by kerbRadiusM and shrunk
     * back rounds every inside corner to that radius. It would also fill a
     * median narrower than twice the radius, so only corner-sized pieces of
     * what it adds are kept.
     */
    const merged = union(here.flatMap(([, i]) => surface[i]))
    const kerb = spec.kerbRadiusM * unitsPerMetre
    const closed = closePolygons(merged, kerb)
    /*
     * Which added pieces are kerbs: by shape, not by place. A kerb return is
     * a small corner fill, a few metres across; what closing adds between
     * a one-way pair is a long strip. Keeping only pieces under four kerb
     * radii across keeps fillets whole. (Cropping them with a disc round
     * each junction left a hard notch where the disc ended, which the edge
     * line then traced in and back out of as a spike.)
     */
    // Also at least a square metre: widening and shrinking a curved outline
    // leaves hairline slivers along every road (rounding), which the edge
    // line then traced. A 90° kerb return at 5 m adds about 5.4 m².
    const minArea = (unitsPerMetre * SCALE) ** 2
    const added = run(ClipType.ctDifference, closed, merged)
    /*
     * A kerb return can arrive joined to one of those slivers, which runs on
     * along a road that is not quite straight (Jalan Sawo: a 5 m corner
     * welded to a 112 m hairline), and the whole piece then fails the size
     * test. So the shape is judged on cores: each piece opened (shrunk and
     * regrown) by a quarter metre, which snaps every neck thinner than half
     * a metre. The kept cores then take back the piece around them, tapered
     * tips included, but not the sliver beyond.
     */
    const neck = 0.25 * unitsPerMetre
    const cores = added.length
      ? closePolygons(closePolygons(added, 0, -neck), 0, neck)
          .filter(ring => extent(ring) <= 4 * kerb * SCALE && Math.abs(Clipper.Area(ring)) >= minArea)
      : []
    const pieces = cores.length ? run(ClipType.ctIntersection, added, closePolygons(cores, 0, kerb / 2)) : []
    // Grown a hair so each one welds to the road it fills, not beside it.
    const fillets = pieces.length ? closePolygons(pieces, 0, 0.02 * unitsPerMetre) : []
    /*
     * A busway and the carriageway beside it are one road surface: our
     * widths are estimates, so the busway landed a metre or so off the
     * carriageway's edge and the gap read as a green median sliver (Rasuna
     * Said). Gaps up to BUS_JOIN_M between a busway and a road alongside are
     * paved; only wider ones are left for the median.
     */
    const busways = here.filter(([, i]) => isBus(i))
    let joins = []
    if (busways.length) {
      const busSurface = union(busways.flatMap(([, i]) => surface[i]))
      const join = (BUS_JOIN_M / 2) * unitsPerMetre
      const added = run(ClipType.ctDifference, closePolygons(merged, join), merged)
      // Only what lies beside a busway, in long strips (not a junction corner).
      const beside = run(ClipType.ctIntersection, added, closePolygons(busSurface, 0, join + unitsPerMetre))
      const minLength = 10 * unitsPerMetre * SCALE
      joins = beside.filter(ring => extent(ring) >= minLength)
    }
    /*
     * Merged divided roads (light and dark; a demo on Mega Kuningan's
     * spine): a divided road is one road split by a median, and OSM maps it
     * as two one-way carriageways with nothing linking them. Paired by name
     * (the same name, running the opposite way, side by side within
     * maxGapM), the strip between them is paved, so the road is one surface
     * kerb to kerb, and the median is drawn medianM wide down its centre
     * line, whatever the gap: OSM's carriageway lines wander 7.5-12 m apart
     * along Ide Anak Agung Gde Agung, so what they left between them ran
     * from half a metre to five, where the real median is a steady ~3 m.
     * The centre line also carries the road's one name.
     */
    const mergedStrips = []
    const medianLines = []
    if (level === 'g' && spec.merge && mergeStretches.length) {
      const { maxGapM, sampleM } = spec.merge
      for (const { name, rect: [x0, y0, x1, y1], medianM, green } of mergeStretches) {
        const lines = features
          // Not a busway sharing the road's name (Sultan Iskandar Muda's): it is no carriageway.
          .filter(f => f.props.name === name && f.props.oneway === 'yes' && f.props.kind_detail !== 'busway' && !f.props.is_link && !f.props.is_bridge && !f.props.is_tunnel)
          .flatMap(f => f.lines.map(line => densify(line, sampleM * unitsPerMetre)))
        if (lines.length < 2) continue
        const { strips, centres } = pairCarriageways(lines, maxGapM * unitsPerMetre)
        if (!strips.length) continue
        const box = [toPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])]
        mergedStrips.push(...run(ClipType.ctIntersection, union(strips), box))
        const centre = run(ClipType.ctIntersection, centres.map(toPath), box, { open: true })
        medianLines.push({ name, centre, medianM: medianM ?? spec.merge.medianM, green: Boolean(green) })
        const kept = centre.length ? run(ClipType.ctIntersection, centre, rect, { open: true }) : []
        if (kept.length) labels.push({ name, lines: kept.map(fromPath) })
      }
    }
    const paved = union([...merged, ...fillets, ...joins, ...mergedStrips])
    const asphalt = run(ClipType.ctIntersection, paved, rect, { tree: true })
    surfaces.push({ level, paving: 'asphalt', polygons: polygonsOf(asphalt) })
    /*
     * Kerbs: the asphalt's own outline, taken before the tile clip so the
     * tile's edge never becomes a line. Light and dark draw it as a hairline
     * round the road (Apple Maps' look); jp leaves it out.
     */
    const outline = paved.filter(r => r.length >= 3).map(r => [...r, r[0]])
    const kerbs = run(ClipType.ctIntersection, level === 'b' ? minus(outline, bridgeEnds) : outline, rect, { open: true })
    if (kerbs.length) paint.push({ level, kind: 'kerb', colour: 'kerb', width: 0, lines: kerbs.map(fromPath) })
    /*
     * Medians (light and dark): OSM barely maps the planted strips between
     * carriageways (one 76 m strip on all of Rasuna Said), so they are
     * inferred: the carriageways of a named road and the busways along it,
     * closed over gaps up to maxWidthM, minus every road surface. What is
     * left between them, kept only in long pieces, is the median. Only on
     * the stretches known to be green (spec.medians.stretches, given here as
     * { name, rect } in tile units by the caller).
     */
    if (level === 'g' && spec.medians && medianStretches.length) {
      const { maxWidthM, minLengthM } = spec.medians
      const reach = (maxWidthM / 2) * unitsPerMetre
      const long = minLengthM * unitsPerMetre * SCALE
      const found = []
      for (const { name, rect: [x0, y0, x1, y1] } of medianStretches) {
        const named = here.filter(([r]) => r.name?.includes(name))
        if (!named.length) continue
        const corridor = union(here.filter(([r, i]) => named.some(([q]) => q === r) || isBus(i)).flatMap(([, i]) => surface[i]))
        const near = closePolygons(union(named.flatMap(([, i]) => surface[i])), 0, maxWidthM * unitsPerMetre)
        const box = [toPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])]
        const gaps = run(ClipType.ctIntersection, run(ClipType.ctIntersection, run(ClipType.ctDifference, closePolygons(corridor, reach), paved), near), box)
        found.push(...gaps.filter(ring => extent(ring) >= long && Math.abs(Clipper.Area(ring)) >= long * unitsPerMetre * SCALE))
      }
      if (found.length) surfaces.push({ level, paving: 'median', polygons: polygonsOf(run(ClipType.ctIntersection, union(found), rect, { tree: true })) })
    }
    if (medianLines.length) {
      /*
       * The median down each merged road's centre line, cut where any other
       * road crosses it. Unless the stretch says otherwise it is a plain
       * divider (paving 'divider'), as Apple draws one: about 1.5 m, a shade
       * off the road. A stretch known to be planted is green ('median'), at
       * its own width (Ide Anak Agung Gde Agung's ~3 m).
       */
      const long = spec.merge.minLengthM * unitsPerMetre * SCALE
      const found = { median: [], divider: [] }
      // The holes in the asphalt that islands came from: what rounding leaves of them is road.
      const islandHoles = []
      for (const { name, centre, medianM, green } of medianLines) {
        const half = (medianM / 2) * unitsPerMetre
        const strip = union(centre.flatMap(line => buffer(fromPath(line), half, EndType.etOpenButt)))
        // Only roads whose own line enters the median break it (cross streets,
        // U-turn gaps): a driveway ending at the carriageway reached in with
        // its end cap and kerb returns and punched holes in it.
        // A busway running alongside (Sudirman's Koridor 1, down the middle)
        // never breaks it; the median only stays off the busway's paving.
        const crossing = union(here
          .filter(([r, i]) => r.name !== name && !isBus(i) && run(ClipType.ctIntersection, [toPath(r.line)], strip, { open: true }).length > 0)
          .flatMap(([, i]) => surface[i]))
        const busways = union(here.filter(([, i]) => isBus(i)).flatMap(([, i]) => busSurface[i] ?? surface[i]))
        const kept = busways.length ? run(ClipType.ctDifference, strip, busways) : strip
        const cut = crossing.length ? run(ClipType.ctDifference, kept, closePolygons(crossing, 0, kerb)) : kept
        const pieces = cut.filter(ring => extent(ring) >= long)
        /*
         * The traffic islands where it forks (a triangle where a divided road
         * meets a T junction) are the same median, and the strip joins its
         * island as one shape. The centre line runs on past the island (along
         * its edge or through it), which left a stub out on the road beyond;
         * so the strip stops short of the island (cut by it grown by a median
         * width), and a closing as wide as the median fills the gap between
         * them, nothing more.
         */
        const islands = islandsNear(paved, pieces, spec.merge.islandMaxM2 * unitsPerMetre ** 2, spec.merge.islandReachM * unitsPerMetre)
        if (islands.length) {
          const width = medianM * unitsPerMetre
          const strips = run(ClipType.ctDifference, pieces, closePolygons(islands, 0, width)).filter(ring => extent(ring) >= long)
          // Kerbed islands: straight sides, rounded tips (their outline was
          // the leftover of the kerb returns round them, every wobble and step).
          const kerbed = islands.flatMap(island => kerbedIsland(island, spec.merge.islandStraightenM * unitsPerMetre, spec.merge.islandCornerM * unitsPerMetre))
          islandHoles.push(...islands)
          const joined = closePolygons(union([...strips, ...kerbed]), width * 1.5)
          // And the join and the strip's ends rounded too, gently enough to keep the strip.
          found[green ? 'median' : 'divider'].push(...openPolygons(joined, Math.min(spec.merge.islandCornerM, medianM * 0.45) * unitsPerMetre))
        } else found[green ? 'median' : 'divider'].push(...pieces)
      }
      for (const [paving, rings] of Object.entries(found)) {
        if (rings.length) surfaces.push({ level, paving, polygons: polygonsOf(run(ClipType.ctIntersection, union(rings), rect, { tree: true })) })
      }
      // An island's rounded-off corners are road: paved, under the median layer.
      if (islandHoles.length) surfaces.push({ level, paving: 'asphalt', polygons: polygonsOf(run(ClipType.ctIntersection, union(islandHoles), rect, { tree: true })) })
      // A median has no kerb line, so an island taken into one loses its own
      // (it ran across where the strip joins it, and round the rounded-off corners).
      const covered = closePolygons(union([...found.median, ...found.divider, ...islandHoles]), 0, 0.2 * unitsPerMetre)
      const kerbLines = paint.find(p => p.level === level && p.kind === 'kerb')
      if (kerbLines && covered.length) kerbLines.lines = minus(kerbLines.lines.map(toPath), covered).map(fromPath)
    }
    if (level === 'g' && spec.pavement) {
      const pave = [
        ...pavement(sidewalks, paved, unitsPerMetre, spec.pavement),
        // Pedestrian streets (Kota Tua, plazas mapped as ways): a street-wide
        // strip, no kerb join; asphalt still wins where one meets a road.
        ...pedestrianStreets.flatMap(line => buffer(line, (spec.pavement.streetWidthM / 2) * unitsPerMetre, EndType.etOpenRound))
      ]
      if (pave.length) surfaces.push({ level, paving: 'sidewalk', polygons: polygonsOf(run(ClipType.ctIntersection, run(ClipType.ctDifference, union(pave), paved), rect, { tree: true })) })
    }
    /*
     * Highway paving: motorways and their ramps, with the kerb returns where
     * they meet, tinted over the asphalt so light and dark keep toll roads
     * yellow up close as they are at every lower zoom. jp has no colour for
     * it and draws plain asphalt.
     */
    const highway = here.filter(([r]) => spec.highwayKinds.includes(r.kind))
    if (highway.length) {
      const roadsOnly = union(highway.flatMap(([, i]) => surface[i]))
      const near = fillets.length ? run(ClipType.ctIntersection, fillets, closePolygons(roadsOnly, 0, kerb)) : []
      const tinted = run(ClipType.ctIntersection, union([...roadsOnly, ...near]), rect, { tree: true })
      surfaces.push({ level, paving: 'highway', polygons: polygonsOf(tinted) })
    }
    /*
     * Bus lanes win where they run alongside a car road: the paving is the
     * busways minus junction zones only (so it still stops at a crossing),
     * not minus every other road, which erased median bus lanes along roads
     * whose guessed width swallows the median.
     */
    const bus = here.filter(([, i]) => isBus(i))
    const busBodies = union(bus.flatMap(([, i]) => body[i]))
    if (bus.length) {
      const busAll = union(bus.flatMap(([, i]) => busSurface[i] ?? surface[i]))
      // Cutting the zones out leaves crumbs where a zone nearly covers a
      // lane's end (a stray dot at Galunggung): under a square metre or two,
      // they are dropped.
      const minArea = 2 * (unitsPerMetre * SCALE) ** 2
      const busOnly = run(ClipType.ctDifference, busAll, levelZones).filter(ring => Math.abs(Clipper.Area(ring)) >= minArea)
      surfaces.push({ level, paving: 'busLane', polygons: polygonsOf(run(ClipType.ctIntersection, busOnly, rect, { tree: true })) })
      /*
       * And whole, through every junction: TransJakarta corridors run on
       * through intersections. jp draws the cut lanes (bus lanes stop at
       * junctions in Japan), light and dark these.
       */
      surfaces.push({ level, paving: 'busway', polygons: polygonsOf(run(ClipType.ctIntersection, busAll, rect, { tree: true })) })
    }

    // Markings, grouped by how they are drawn.
    const groups = new Map()
    for (const [r, ri] of here) {
      for (const spec of r.row.lines) {
        // Edge lines come from the surface outline below, unless the row keeps them per road.
        if (spec.edge && !r.row.edgesAlongRoad) continue
        const kind = spec.edge ? 'edge' : 'mark'
        const key = `${kind}|${spec.colour}|${spec.widthM}`
        if (!groups.has(key)) groups.set(key, { level, kind, colour: spec.colour, width: spec.widthM, raw: [], busRaw: [] })
        for (const side of spec.offsetM === 0 ? [0] : [-spec.offsetM, spec.offsetM]) {
          const offset = offsetPolyline(r.line, side * unitsPerMetre)
          const pieces = spec.dash ? dashes(offset, spec.dash[0] * unitsPerMetre, spec.dash[1] * unitsPerMetre) : [offset]
          groups.get(key)[isBus(ri) ? 'busRaw' : 'raw'].push(...pieces.map(toPath).filter(p => p.length >= 2))
        }
      }
    }
    // A car road's markings also stop at a bus lane it overlaps, so its
    // lane lines never run over the red.
    const carCut = busBodies.length ? union([...levelZones, ...busBodies]) : levelZones
    for (const g of groups.values()) {
      const outside = [...minus(g.raw, carCut), ...minus(g.busRaw, levelZones)]
      const kept = outside.length ? run(ClipType.ctIntersection, outside, rect, { open: true }) : []
      if (kept.length) paint.push({ level: g.level, kind: g.kind, colour: g.colour, width: g.width, lines: kept.map(fromPath) })
    }

    /*
     * Edge lines (車道外側線): the outline of the merged road surface, kerb
     * returns included, inset by the shoulder. Offset per road they stopped
     * short of every rounded corner; as an outline they follow the kerb
     * round it, never cross a junction mouth (there is no outline there),
     * and ring traffic islands. Taken before the tile clip, so the tile's
     * own edge never becomes a line. Busways keep their own yellow lines and
     * motorways their per-road ones, so the outline skips both and is cut
     * where it runs through them.
     */
    // Only roads that have edge lines: a driveway or car-park aisle gets
    // none (as in Japan), and a marked road's edge line runs on past its mouth.
    const outlined = here.filter(([r, i]) => !isBus(i) && !r.row.edgesAlongRoad && r.row.lines.some(l => l.edge))
    const edgeSpec = outlined.length ? outlined[0][0].row.lines.find(l => l.edge) : null
    if (edgeSpec) {
      // Every outlined row shares this shoulder (0.5 m; tested against the spec).
      const shoulder = outlined[0][0].row.widthM / 2 - edgeSpec.offsetM
      const outline = insetOutline(union([...outlined.flatMap(([, i]) => surface[i]), ...fillets]), shoulder * unitsPerMetre)
      const exclusions = union([...busBodies, ...here.filter(([r]) => r.row.edgesAlongRoad).flatMap(([, i]) => body[i])])
      const cut = minus(outline, exclusions)
      const kept = cut.length ? run(ClipType.ctIntersection, cut, rect, { open: true }) : []
      if (kept.length) paint.push({ level, kind: 'edge', colour: edgeSpec.colour, width: edgeSpec.widthM, lines: kept.map(fromPath) })
    }
  }
  if (spec.footbridges) {
    /*
     * Footbridges (light and dark): a JPO's deck and its stairs, each a
     * strip widthM wide cut square at its ends, unioned into one shape, so
     * the translucent deck has no seams where its pieces overlap and stops
     * where its stairs do. Its outline is the rim, taken before the tile
     * clip as the kerbs are. Level f: jp never draws it.
     */
    const half = (spec.footbridges.widthM / 2) * unitsPerMetre
    const decks = footbridges.flatMap(line => buffer(line, half, EndType.etOpenButt))
    if (decks.length) {
      const deck = union(decks)
      surfaces.push({ level: 'f', paving: 'footbridge', polygons: polygonsOf(run(ClipType.ctIntersection, deck, rect, { tree: true })) })
      const rim = run(ClipType.ctIntersection, deck.filter(r => r.length >= 3).map(r => [...r, r[0]]), rect, { open: true })
      if (rim.length) paint.push({ level: 'f', kind: 'kerb', colour: 'kerb', width: 0, lines: rim.map(fromPath) })
    }
  }
  return { surfaces, paint, labels }
}

/*
 * Traffic islands near a median: the holes in the paved surface (ground
 * enclosed by road all round) no bigger than maxArea (tile units²) that come
 * within reach of it, as polygons. A city block is a hole too, but a big one.
 */
export function islandsNear(paved, median, maxArea, reach) {
  if (!median.length) return []
  const near = closePolygons(median, 0, reach)
  // Holes wind the other way from the outlines (Clipper's union output).
  const outer = Math.sign(paved.reduce((best, r) => (Math.abs(Clipper.Area(r)) > Math.abs(best) ? Clipper.Area(r) : best), 0))
  const holes = paved
    .filter(r => Math.sign(Clipper.Area(r)) === -outer && Math.abs(Clipper.Area(r)) <= maxArea * SCALE * SCALE)
    .map(r => [...r].reverse())
  return holes.filter(h => run(ClipType.ctIntersection, [h], near).length > 0)
}

/*
 * A traffic island as it is built: its outline straightened (vertices within
 * `straighten` of the line between their neighbours dropped, Douglas-Peucker)
 * and its corners rounded to `corner` (an opening, which rounds the convex
 * tips). An island too small to keep its shape through the rounding stays as
 * it was. Tile units.
 */
export function kerbedIsland(island, straighten, corner) {
  const straight = simplifyRing(island, straighten * SCALE)
  const rounded = openPolygons([straight], corner)
  return rounded.length ? rounded : [island]
}

/* Morphological opening: shrink by r then grow back, rounding convex corners to r. */
function openPolygons(paths, r) {
  if (r <= 0 || !paths.length) return paths
  return closePolygons(closePolygons(paths, 0, -r), 0, r)
}

/* A closed ring simplified by Douglas-Peucker to `tolerance` (Clipper units). */
function simplifyRing(ring, tolerance) {
  if (ring.length < 4) return ring
  // Split at the two vertices farthest apart, so each half is an open chain.
  let a = 0
  let b = 0
  let far = -1
  for (let i = 0; i < ring.length; i++) {
    const d = (ring[i].X - ring[0].X) ** 2 + (ring[i].Y - ring[0].Y) ** 2
    if (d > far) {
      far = d
      b = i
    }
  }
  const chain = (from, to) => {
    const out = []
    for (let i = from; ; i = (i + 1) % ring.length) {
      out.push(ring[i])
      if (i === to) return out
    }
  }
  const dp = (pts) => {
    if (pts.length < 3) return pts
    const [p, q] = [pts[0], pts.at(-1)]
    const len = Math.hypot(q.X - p.X, q.Y - p.Y) || 1
    let worst = 0
    let at = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((q.X - p.X) * (p.Y - pts[i].Y) - (p.X - pts[i].X) * (q.Y - p.Y)) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst <= tolerance) return [p, q]
    return [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))]
  }
  const first = dp(chain(a, b))
  const second = dp(chain(b, a))
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

/*
 * A divided road's two carriageways paired: every point of each line (dense,
 * tile units) matched to the nearest point on another line running the
 * opposite way within maxGap. Consecutive matched points make a quad across
 * the road, and the quads together are the strip between the carriageways;
 * their midpoints are its centre line, taken from one side of each pair only.
 */
export function pairCarriageways(lines, maxGap) {
  const strips = []
  const centres = []
  const heading = (line, k) => {
    const a = line[Math.max(0, k - 1)]
    const b = line[Math.min(line.length - 1, k + 1)]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
  }
  lines.forEach((line, i) => {
    const matches = line.map((p, k) => {
      const [hx, hy] = heading(line, k)
      let best = null
      lines.forEach((other, j) => {
        if (j === i) return
        for (let s = 0; s + 1 < other.length; s++) {
          const [ax, ay] = other[s]
          const [bx, by] = other[s + 1]
          const dx = bx - ax
          const dy = by - ay
          const len2 = dx * dx + dy * dy
          if (len2 === 0) continue
          // Opposite directions only (within ~35°): a crossing road never pairs.
          if ((hx * dx + hy * dy) / Math.sqrt(len2) > -0.82) continue
          const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2))
          const q = [ax + t * dx, ay + t * dy]
          const d = Math.hypot(p[0] - q[0], p[1] - q[1])
          if (d <= maxGap && (!best || d < best.d)) best = { d, q, j }
        }
      })
      return best
    })
    let centre = []
    for (let k = 0; k < line.length; k++) {
      const m = matches[k]
      const next = matches[k + 1]
      if (m && next && next.j === m.j) {
        // One winding for every quad: under the non-zero union, quads from
        // the two sides of a pair wound opposite ways would cancel to holes.
        const quad = toPath([line[k], line[k + 1], next.q, m.q])
        strips.push(Clipper.Orientation(quad) ? quad : quad.reverse())
      }
      // The centre line from the lower-numbered side of each pair.
      if (m && m.j > i) centre.push([(line[k][0] + m.q[0]) / 2, (line[k][1] + m.q[1]) / 2])
      else {
        if (centre.length >= 2) centres.push(centre)
        centre = []
      }
    }
    if (centre.length >= 2) centres.push(centre)
  })
  return { strips, centres }
}

/*
 * Open paths minus polygons. With nothing to subtract, the paths as they are:
 * Clipper's difference against an empty clip returns no open paths at all,
 * which dropped every lane and centre line on a stretch with no junction in
 * its tile (toll roads between interchanges).
 */
function minus(paths, cut) {
  if (!paths.length) return []
  return cut.length ? run(ClipType.ctDifference, paths, cut, { open: true }) : paths
}

/* A line with a vertex at least every `step` units. */
function densify(line, step) {
  const out = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const [bx, by] = line[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  return out
}

/*
 * Pavement (light and dark's sidewalks, Apple Maps' block edges): every
 * mapped sidewalk as a strip widthM wide, joined to the kerb. Carriageway
 * widths are guesses by road class, so a mapped sidewalk often runs a few
 * metres off our kerb, or inside it: each metre of it is joined to the
 * nearest kerb within reachM by a quad, so the pavement starts exactly at the
 * kerb either way, and the asphalt is taken out of the result. A sidewalk
 * with no kerb within reach (a footway along a canal) is just its strip.
 */
export function pavement(sidewalks, paved, unitsPerMetre, { widthM, reachM }) {
  if (!sidewalks.length || !paved.length) return []
  const reach = reachM * unitsPerMetre
  const segs = []
  for (const ring of paved) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      segs.push([a.X / SCALE, a.Y / SCALE, b.X / SCALE, b.Y / SCALE])
    }
  }
  // Kerb segments in a grid of reach-sized cells, so each lookup reads nine.
  const grid = new Map()
  const cell = v => Math.floor(v / reach)
  segs.forEach(([ax, ay, bx, by], i) => {
    for (let cx = cell(Math.min(ax, bx)); cx <= cell(Math.max(ax, bx)); cx++) {
      for (let cy = cell(Math.min(ay, by)); cy <= cell(Math.max(ay, by)); cy++) {
        const key = `${cx},${cy}`
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(i)
      }
    }
  })
  const nearest = ([px, py]) => {
    let best = null
    let bestD = reach
    const seen = new Set()
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of grid.get(`${cell(px) + dx},${cell(py) + dy}`) ?? []) {
          if (seen.has(i)) continue
          seen.add(i)
          const [ax, ay, bx, by] = segs[i]
          const ex = bx - ax
          const ey = by - ay
          const len2 = ex * ex + ey * ey
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2))
          const q = [ax + t * ex, ay + t * ey]
          const d = Math.hypot(px - q[0], py - q[1])
          if (d <= bestD) {
            bestD = d
            best = q
          }
        }
      }
    }
    return best
  }
  const pieces = []
  for (const line of sidewalks) {
    if (line.length < 2) continue
    const pts = densify(line, unitsPerMetre)
    const kerb = pts.map(nearest)
    for (let i = 0; i + 1 < pts.length; i++) {
      if (!kerb[i] || !kerb[i + 1]) continue
      const quad = toPath([pts[i], pts[i + 1], kerb[i + 1], kerb[i]])
      if (quad.length >= 3) pieces.push(quad)
    }
    pieces.push(...buffer(line, (widthM / 2) * unitsPerMetre, EndType.etOpenRound))
  }
  return pieces.length ? run(ClipType.ctDifference, union(pieces), paved) : []
}

/* The rings of a surface shrunk by `inset`, as open paths (closed by repeating the first point). */
function insetOutline(paths, inset) {
  const co = new ClipperOffset(2, 0.05 * SCALE)
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon)
  const shrunk = []
  co.Execute(shrunk, -inset * SCALE)
  return shrunk.filter(r => r.length >= 3).map(r => [...r, r[0]])
}

// ── whole extract ──────────────────────────────────────────────────────────

/** A tile's built geometry as an encoded output tile, or null when empty. */
export function encodeBuilt({ surfaces, paint, labels = [] }) {
  const k = OUT_EXTENT / EXTENT
  const pt = ([x, y]) => [Math.round(x * k), Math.round(y * k)]
  const dedupe = (ring) => {
    const out = []
    for (const p of ring) {
      const q = pt(p)
      const last = out.at(-1)
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q)
    }
    return out
  }
  const surfaceFeatures = surfaces
    .map(s => ({ type: 3, props: { l: s.level, p: s.paving }, parts: s.polygons.map(poly => poly.map(dedupe).filter(r => r.length >= 3)).filter(poly => poly.length > 0) }))
    .filter(f => f.parts.length > 0)
  const paintFeatures = paint
    .map(p => ({ type: 2, props: { l: p.level, k: p.kind, c: p.colour, w: p.width }, parts: p.lines.map(dedupe).filter(l => l.length >= 2) }))
    .filter(f => f.parts.length > 0)
  const labelFeatures = labels
    .map(l => ({ type: 2, props: { name: l.name }, parts: l.lines.map(dedupe).filter(line => line.length >= 2) }))
    .filter(f => f.parts.length > 0)
  if (!surfaceFeatures.length && !paintFeatures.length && !labelFeatures.length) return null
  const layers = [{ name: 'surface', features: surfaceFeatures }, { name: 'paint', features: paintFeatures }]
  if (labelFeatures.length) layers.push({ name: 'label', features: labelFeatures })
  return encodeTile(layers, OUT_EXTENT)
}

/*
 * The whole extract, on worker threads: rows are independent, the dense
 * middle of Jakarta is slow (a tile there can take seconds once roads are
 * smoothed), and one thread took most of an hour. The main thread hands out
 * rows one at a time (so slow rows don't hold up a fixed share) and streams
 * finished tiles to disk.
 */
async function main() {
  const spec = loadSpec()
  const file = newestBasemap()
  const source = new FileSource(file)
  const header = await new PMTiles(source).getHeader()
  source.close()
  const [x0, y0] = project(header.minLon, header.maxLat, ZOOM).map(Math.floor)
  const [x1, y1] = project(header.maxLon, header.minLat, ZOOM).map(Math.floor)
  const threads = Math.max(1, Math.min(10, availableParallelism() - 2))
  console.log(`Building ${spec.tileset} from ${path.basename(file)} on ${threads} threads…`)

  const target = path.join(DATA_DIR, `${spec.tileset}.pmtiles`)
  const writer = new PmtilesWriter(target, {
    name: spec.tileset,
    minzoom: ZOOM,
    maxzoom: ZOOM,
    bounds: `${header.minLon},${header.minLat},${header.maxLon},${header.maxLat}`,
    center: `106.8272,-6.1754,${ZOOM}`,
    attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>',
    json: JSON.stringify({
      vector_layers: [
        { id: 'surface', fields: { l: 'String', p: 'String' }, minzoom: ZOOM, maxzoom: ZOOM },
        { id: 'paint', fields: { l: 'String', k: 'String', c: 'String', w: 'Number' }, minzoom: ZOOM, maxzoom: ZOOM },
        // Merged divided roads' one name, on their centre line (light and dark).
        { id: 'label', fields: { name: 'String' }, minzoom: ZOOM, maxzoom: ZOOM }
      ]
    })
  })

  const rows = []
  for (let y = y0; y <= y1; y++) rows.push(y)
  const total = rows.length
  let done = 0
  let read = 0
  const started = Date.now()
  await Promise.all(Array.from({ length: threads }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jpRoadsWorker: true, file, x0, x1 } })
    const next = () => {
      const y = rows.shift()
      if (y === undefined) worker.postMessage(null)
      else worker.postMessage(y)
    }
    worker.on('message', (msg) => {
      if (msg.ready) return next()
      read += msg.read
      for (const t of msg.tiles) writer.add({ z: ZOOM, x: t.x, y: msg.y, data: Buffer.from(t.data) })
      // Named, so a pathological tile can be replayed on its own.
      for (const slow of msg.slow) console.log(`  slow tile ${slow.x}/${msg.y}: ${slow.ms} ms`)
      done++
      if (done % 5 === 0 || done === total) console.log(`  ${done}/${total} rows, ${writer.count} tiles, ${Math.round((Date.now() - started) / 1000)} s`)
      next()
    })
    worker.on('error', reject)
    worker.on('exit', code => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))))
  })))

  writer.finish()
  console.log(`${read} tiles read, ${writer.count} written (${(writer.bytes / 1e6).toFixed(1)} MB before gzip), ${Math.round((Date.now() - started) / 1000)} s → ${target}`)
}

/* A worker: build whole rows on request until told to stop. */
async function work() {
  const spec = loadSpec()
  const osm = existsSync(OSM_ROADS) ? openOsmRoads(OSM_ROADS) : null
  const lanes = osm ? null : loadLanes()
  const { file, x0, x1 } = workerData
  const source = new FileSource(file)
  const archive = new PMTiles(source)
  parentPort.on('message', async (y) => {
    if (y === null) {
      osm?.close()
      source.close()
      process.exit(0)
    }
    const unitsPerMetre = EXTENT / tileMetres(ZOOM, y)
    const tiles = []
    const slow = []
    let read = 0
    for (let x = x0; x <= x1; x++) {
      const tile = await archive.getZxy(ZOOM, x, y)
      if (!tile) continue
      read++
      const t0 = Date.now()
      let data
      if (osm) {
        const roads = osm.tile(x, y, EXTENT, CLIP_EDGE)
        const lanesFor = (line) => {
          const runs = roads.lanesFor(line)
          return runs ? settleRuns(runs, unitsPerMetre) : null
        }
        data = encodeBuilt(buildTile(spec, roads.features, unitsPerMetre, { lanesFor, medianStretches: medianStretchesFor(spec, x, y), mergeStretches: mergeStretchesFor(spec, x, y) }))
      } else {
        data = encodeBuilt(buildTile(spec, decodeRoads(new Uint8Array(tile.data)), unitsPerMetre, { lanesFor: lanesForTile(lanes, x, y, unitsPerMetre), medianStretches: medianStretchesFor(spec, x, y), mergeStretches: mergeStretchesFor(spec, x, y) }))
      }
      if (data) tiles.push({ x, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
      if (Date.now() - t0 > 2000) slow.push({ x, ms: Date.now() - t0 })
    }
    parentPort.postMessage({ y, tiles, slow, read }, tiles.map(t => t.data))
  })
  parentPort.postMessage({ ready: true })
}

// Only a worker this build started: a test runner's own worker threads also
// have isMainThread false, and importing this module there must not start one.
if (!isMainThread && workerData?.jpRoadsWorker) await work()
else if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
