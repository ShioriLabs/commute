import * as fs from 'node:fs'
import { parseCSV } from './gtfs'

/*
 * The 2026-11 TransJakarta feed ships NO `shape_dist_traveled` (stop_times and
 * shapes both blank), which the importers read for edge metres and topology
 * `cumM`. This fills the stop_times column by snapping each trip's stops onto
 * its own shape and measuring metres along it, so the generators run unchanged.
 *
 *   pnpm --filter api fill:tj-shape-dist
 *
 * Run it right after unpacking a feed that lacks the column, BEFORE
 * generate:tj / generate:tj-topology. The raw file is kept as
 * stop_times.raw.txt and the run is idempotent (always re-reads the raw file).
 *
 * Snapping is a Viterbi pass: each stop may land on any shape segment close to
 * it, along-shape position must never go backwards, and the cheapest total
 * perpendicular offset wins. That keeps out-and-back and loop routes (where a
 * stop is near the shape twice) on the correct pass.
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const R = 6371008.8
const MAX_SNAP_M = 120 // beyond this a stop is off its shape: reported, distance still best-effort
const WINDOW_M = 100 // candidates within nearest + WINDOW_M

const load = (f: string) => parseCSV(fs.readFileSync(`${FEED_DIR}/${f}`, 'utf8'))

const stops = new Map(load('stops.txt').map(s => [s.stop_id, s]))
const parentOf = (id: string) => stops.get(id)?.parent_station || id
const tripShape = new Map(load('trips.txt').map(t => [t.trip_id, t.shape_id]))

interface Shape { x: number[], y: number[], cum: number[] }
const shapes = new Map<string, Shape>()
{
  const lat0 = -6.2 * Math.PI / 180
  const pts = new Map<string, { seq: number, lat: number, lon: number }[]>()
  for (const r of load('shapes.txt')) {
    const l = pts.get(r.shape_id) ?? []
    l.push({ seq: Number(r.shape_pt_sequence), lat: Number(r.shape_pt_lat), lon: Number(r.shape_pt_lon) })
    pts.set(r.shape_id, l)
  }
  for (const [id, l] of pts) {
    l.sort((a, b) => a.seq - b.seq)
    const x = l.map(p => R * Math.cos(lat0) * p.lon * Math.PI / 180)
    const y = l.map(p => R * p.lat * Math.PI / 180)
    const cum = [0]
    for (let i = 1; i < l.length; i++) cum.push(cum[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!))
    shapes.set(id, { x, y, cum })
  }
}
const LAT0 = -6.2 * Math.PI / 180
const px = (lon: number) => R * Math.cos(LAT0) * lon * Math.PI / 180
const py = (lat: number) => R * lat * Math.PI / 180

interface Cand { along: number, off: number }
function candidates(sh: Shape, sx: number, sy: number): Cand[] {
  const all: Cand[] = []
  for (let i = 0; i + 1 < sh.x.length; i++) {
    const ax = sh.x[i]!
    const ay = sh.y[i]!
    const dx = sh.x[i + 1]! - ax
    const dy = sh.y[i + 1]! - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / len2))
    const off = Math.hypot(sx - (ax + t * dx), sy - (ay + t * dy))
    all.push({ along: sh.cum[i]! + t * Math.sqrt(len2), off })
  }
  const best = Math.min(...all.map(c => c.off))
  const keep = all.filter(c => c.off <= best + WINDOW_M)
  // collapse neighbouring segments of one pass to the closest of the run
  keep.sort((a, b) => a.along - b.along)
  const out: Cand[] = []
  for (const c of keep) {
    const last = out[out.length - 1]
    if (last && c.along - last.along < 40) {
      if (c.off < last.off) out[out.length - 1] = c
    } else out.push(c)
  }
  return out
}

function snapTrip(
  sh: Shape,
  pts: { x: number, y: number }[],
  prior?: (i: number) => number | undefined
): { along: number, off: number }[] {
  const cands = pts.map(p => candidates(sh, p.x, p.y))
  const cost: number[][] = []
  const back: number[][] = []
  cands.forEach((cs, i) => {
    cost[i] = []
    back[i] = []
    cs.forEach((c, j) => {
      if (i === 0) {
        cost[i]![j] = c.off
        back[i]![j] = -1
        return
      }
      let bestCost = Infinity
      let bestK = -1
      cands[i - 1]!.forEach((p, k) => {
        if (c.along + 25 < p.along) return // never backwards (25 m GPS slack)
        const hop = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
        const detour = Math.max(0, (c.along - p.along) - hop * 3) * 0.02
        // The same stop pair on other trips usually agrees; a hop far longer than
        // that is a wrong-pass snap (shape runs near the stop twice), not a detour.
        const pr = prior?.(i)
        const gap = c.along - p.along
        const consensus = pr === undefined ? 0 : Math.max(0, gap - (pr * 1.3 + 60)) * 0.5
        const v = cost[i - 1]![k]! + c.off + detour + consensus
        if (v < bestCost) {
          bestCost = v
          bestK = k
        }
      })
      cost[i]![j] = bestCost
      back[i]![j] = bestK
    })
  })
  // fall back to nearest-forward if monotonic path was impossible
  const last = cost.length - 1
  let j = cost[last]!.indexOf(Math.min(...cost[last]!))
  if (!Number.isFinite(cost[last]![j]!)) return pts.map((_, i) => ({ along: NaN, off: cands[i]![0]?.off ?? NaN }))
  const res = new Array<{ along: number, off: number }>(pts.length)
  for (let i = last; i >= 0; i--) {
    res[i] = cands[i]![j]!
    j = back[i]![j]!
  }
  return res
}

const rawPath = `${FEED_DIR}/stop_times.raw.txt`
if (!fs.existsSync(rawPath)) fs.copyFileSync(`${FEED_DIR}/stop_times.txt`, rawPath)
const text = fs.readFileSync(rawPath, 'utf8')
const header = text.split(/\r?\n/, 1)[0]!.split(',')
const rows = parseCSV(text)

const byTrip = new Map<string, Record<string, string>[]>()
for (const r of rows) {
  const l = byTrip.get(r.trip_id) ?? []
  l.push(r)
  byTrip.set(r.trip_id, l)
}

const tripIds = [...byTrip.keys()]
const snapAll = (priors?: Map<string, number>) => {
  const res = new Map<string, { along: number, off: number }[]>()
  const mins = new Map<string, number>()
  for (const tripId of tripIds) {
    const list = byTrip.get(tripId)!
    list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
    const sh = shapes.get(tripShape.get(tripId) ?? '')
    if (!sh || sh.x.length < 2) continue
    const pts = list.map((r) => {
      const st = stops.get(r.stop_id)!
      return { x: px(Number(st.stop_lon)), y: py(Number(st.stop_lat)) }
    })
    const key = (i: number) => `${parentOf(list[i - 1]!.stop_id)}>${parentOf(list[i]!.stop_id)}`
    const snap = snapTrip(sh, pts, priors ? i => priors.get(key(i)) : undefined)
    res.set(tripId, snap)
    for (let i = 1; i < snap.length; i++) {
      const hop = snap[i]!.along - snap[i - 1]!.along
      if (Number.isFinite(hop) && hop > 20) mins.set(key(i), Math.min(mins.get(key(i)) ?? Infinity, hop))
    }
  }
  return { res, mins }
}
const pass1 = snapAll()
const pass2 = snapAll(pass1.mins)

let filled = 0
let failed = 0
let farStops = 0
let noShape = 0
const failedTrips: string[] = []
for (const [tripId, list] of byTrip) {
  const snap = pass2.res.get(tripId)
  if (!snap) {
    noShape++
    continue
  }
  snap.forEach((s, i) => {
    if (!Number.isFinite(s.along)) {
      failed++
      if (i === 0) failedTrips.push(tripId)
      return
    }
    if (s.off > MAX_SNAP_M) farStops++
    list[i]!.shape_dist_traveled = (i === 0 ? 0 : s.along - snap[0]!.along).toFixed(1)
    filled++
  })
}

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const out = [header.join(',')]
for (const r of rows) out.push(header.map(h => q(r[h] ?? '')).join(','))
fs.writeFileSync(`${FEED_DIR}/stop_times.txt`, out.join('\n') + '\n')
console.log(`stop_times: ${rows.length} rows, ${filled} filled, ${failed} unsnappable, ${farStops} stops >${MAX_SNAP_M} m off shape, ${noShape} trips without shape`)
if (failedTrips.length) console.log(`unsnappable trips (${failedTrips.length}): ${failedTrips.join(' ')}`)
