import * as fs from 'node:fs'
import type { Operator } from '@commute/constants'
import { TOPOLOGY, type LineTopology, type Stop } from '../data/topology'
import { haversineMeters } from '../../utils/geo'
import { stopLists } from '../../utils/edgeChain'
import { simplify, type LngLat } from '../../utils/polyline'

/*
 * Physical track geometry for every rail adjacency in TOPOLOGY, traced out of
 * OpenStreetMap.
 *
 * Output is one GeoJSON FeatureCollection per operator in data/geometry/, one
 * LineString per pair of CONSECUTIVE stops in a stop list — pass-through and
 * one-way stops included, because a bridged hop still runs over their track.
 * A segment belongs to the station pair, not the line: track several lines run
 * on (MRI-SUDB on A and C, the LRT Jabodebek trunk on BK and CB) is stored
 * once and lists every line in `lines`. A line is a chain of segments, and a
 * hop's geometry is the segments it covers concatenated.
 *
 * How a segment is traced: the OSM running lines for the operator's mode are
 * built into an undirected graph, each station is projected onto its nearest
 * track segment, and the shortest path along the rails between the two
 * projections is the geometry. Yards, sidings and spurs cost five times their
 * length so a path can't shortcut through a depot, and the Whoosh high-speed
 * line is left out because it is tagged as ordinary main-line rail.
 *
 * That path follows one OSM running line, so on double track it sits on one
 * side of the track bed. Each point is then moved to the middle of the bed
 * (TrackGraph.bedShift, smoothed by centreTrace()) so the drawn line sits where a
 * map reader expects it.
 *
 * `lengthM` is measured on the full-resolution trace, before centring. Simplify only for
 * shipping, never before measuring — simplification cuts curves and shortens
 * the distance.
 *
 * The traced geometry is derived from OpenStreetMap data, © OpenStreetMap
 * contributors, available under the Open Database License (ODbL 1.0,
 * https://www.openstreetmap.org/copyright). Every output file carries that
 * attribution, and so must anything that ships it.
 *
 * The raw OSM extract is cached beside this script (gitignored); pass
 * --refresh to re-download it. Run:
 *   pnpm --filter api generate:track-geometry [--refresh]
 */

const OUTPUT_DIR = `${__dirname}/../data/geometry`
const OSM_CACHE = `${__dirname}/osm_rail.json`
const COORDS_CSV = `${__dirname}/stations_lat_lng.csv`
const STATIONS_URL = 'https://api.commute.shiorilabs.id/stations'
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]
// Jabodetabek, from Rangkasbitung to Cikarang and Bogor to Tanjung Priok.
const BBOX = '-6.75,106.15,-5.95,107.25'
const OVERPASS_QUERY = `[out:json][timeout:180];way["railway"~"^(rail|light_rail|subway)$"](${BBOX});out body qt;>;out skel qt;`

// Foreign members on each FeatureCollection, so the ODbL notice travels with
// the data rather than living only in this script.
const OSM_ATTRIBUTION = [
  `"attribution":${JSON.stringify('© OpenStreetMap contributors')}`,
  `"license":${JSON.stringify('ODbL-1.0 (https://www.openstreetmap.org/copyright)')}`
].join(',')

const MODE: Record<string, string> = {
  KCI: 'rail',
  MRTJ: 'subway',
  LRTJ: 'light_rail',
  LRTJBDB: 'light_rail',
  APCGK: 'light_rail'
}
// Station and yard tracks. OSM often breaks the running line through a
// station and carries it on tracks tagged like these, so they stay in the graph
// to close those gaps — at a cost high enough that a path never prefers them
// over a running line. Stations are never snapped onto them.
const SERVICE_TRACK = new Set(['yard', 'siding', 'spur', 'depot'])
const SERVICE_TRACK_COST = 5
// Way ends this close together are the same track drawn as two pieces that
// were never joined at a shared node.
const JOIN_GAP_M = 15
// How much further than its nearest running line a parallel line may be and
// still count as passing the same station (see TrackGraph.snap).
const PARALLEL_TRACK_M = 25
// Metres per degree of latitude.
const DEG_M = 111_320
// Running lines of the same line this close side by side are one track bed
// (double track, quadruple track, the loops through a station) and are centred
// on together. Wide enough to span an island platform with room to spare: a station whose
// tracks spread past it puts a kink in the line, snapping back onto one track.
const TRACK_BED_GAP_M = 30
// Furthest a parallel running line is looked for, either side of the path.
const MAX_BED_HALF_WIDTH_M = 40
// Running lines whose bearings differ by less than this count as parallel.
const PARALLEL_COS = Math.cos((20 * Math.PI) / 180)
// A parallel line counts only where it runs abeam of the point, not off past
// the end of one of its segments.
const ABEAM_TOLERANCE_M = 3
// The trace is resampled this often before centring, so a change in bed width
// ramps across many points instead of jumping between two OSM nodes.
const SAMPLE_M = 5
// Median radius, along the trace, that irons out spikes where the nearest
// running line under a point is briefly a crossover or a turnout leg.
const SPIKE_RADIUS_M = 15
// Moving-average radius, along the trace, that ramps the line across a change
// in bed width, and the distance over which a segment's ends ease onto their
// stations' centred points.
const RAMP_RADIUS_M = 60
// A sideways move of the centred line bigger than this between two samples is
// a change in bed width, to be ramped: a track joining or leaving the bed moves
// the centre half a track spacing (2m or more) at once. Smaller moves are the
// line curving, or tracks spreading apart gradually (Kalayang's ~0.5m a
// sample), and are kept.
const BED_STEP_M = 1
// Douglas-Peucker tolerance that thins the resampled, centred line again.
const OUTPUT_SIMPLIFY_M = 0.5
// Spatial index cell for the running-line segments, in degrees (~55m).
const GRID_DEG = 0.0005

// A station further than this from its line's track is a bad coordinate or a
// missing OSM way, not a real offset.
const MAX_SNAP_M = 150
// Track length over straight-line distance. Above this the shortest path has
// almost certainly wandered onto another line.
const MAX_DETOUR_RATIO = 1.5
// Track length against published chainage (cumM).
const MAX_CHAINAGE_DRIFT = 0.1

interface Coord { lat: number, lng: number }

// One piece of track between two OSM nodes. `name` is the way's line name
// ("Jalur Kereta Api Jakarta Kota–Bogor"), when OSM gives one; `layer` is its
// OSM layer, '0' when untagged.
interface TrackSegment { a: number, b: number, name?: string, layer: string }

interface OsmElement {
  type: 'node' | 'way'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  tags?: Record<string, string>
}

async function loadOsm(refresh: boolean): Promise<OsmElement[]> {
  if (!refresh && fs.existsSync(OSM_CACHE)) {
    return (JSON.parse(fs.readFileSync(OSM_CACHE, 'utf-8')) as { elements: OsmElement[] }).elements
  }
  // The public Overpass instances shed load with an HTML error page, so try
  // each mirror a few times before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of OVERPASS_URLS) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'commute-track-geometry' },
        body: new URLSearchParams({ data: OVERPASS_QUERY })
      })
      const text = await res.text()
      if (!res.ok || !text.startsWith('{')) continue
      fs.writeFileSync(OSM_CACHE, text)
      return (JSON.parse(text) as { elements: OsmElement[] }).elements
    }
  }
  throw new Error('Overpass refused every attempt; try again later')
}

// Live coordinates, falling back to the seed CSV for stations the API does not
// list — the LRTJ pass-through stops are searchable = 0 and so absent there,
// but their track is still on the line.
async function loadCoords(): Promise<Map<string, Coord>> {
  const res = await fetch(STATIONS_URL)
  if (!res.ok) throw new Error(`stations fetch failed: ${res.status}`)
  const json = await res.json() as { data: { id: string, latitude: number | null, longitude: number | null }[] }
  const map = new Map<string, Coord>()
  for (const row of fs.readFileSync(COORDS_CSV, 'utf-8').split('\n')) {
    const [id, lat, lng] = row.trim().split(',')
    if (!id || id === 'id' || id.startsWith('#') || !lat || !lng) continue
    map.set(id, { lat: Number(lat), lng: Number(lng) })
  }
  for (const s of json.data) {
    if (s.latitude != null && s.longitude != null) map.set(s.id, { lat: s.latitude, lng: s.longitude })
  }
  return map
}

/*
 * The running lines of one mode as an undirected graph. Node ids are OSM node
 * ids; projected station points are added later with negative ids.
 */
class TrackGraph {
  readonly pos = new Map<number, Coord>()
  readonly adj = new Map<number, Map<number, number>>()
  // Running-line segments only: the candidates a station may snap onto.
  readonly segments: TrackSegment[] = []
  // The tracks a track bed is measured across: the running lines, plus the
  // numbered station tracks OSM tags as sidings (Manggarai's 1 and 4, which
  // the Cikarang line calls at).
  readonly bedSegments: TrackSegment[] = []
  // Spliced-in projection nodes take negative ids so they never collide with OSM's.
  private nextId = -1
  // Bed segments by grid cell, built on first use by bedShift().
  private grid: Map<string, TrackSegment[]> | null = null

  constructor(elements: OsmElement[], railway: string) {
    const nodes = new Map<number, Coord>()
    for (const e of elements) {
      if (e.type === 'node') nodes.set(e.id, { lat: e.lat!, lng: e.lon! })
    }
    const wayEnds: number[] = []
    for (const e of elements) {
      const t = e.tags ?? {}
      if (e.type !== 'way' || t.railway !== railway) continue
      if (t.highspeed === 'yes' || /kereta cepat/i.test(t.operator ?? '')) continue
      const serviceTrack = SERVICE_TRACK.has(t.service ?? '')
      const stationTrack = serviceTrack && t['railway:track_ref'] != null
      const ids = e.nodes!.filter(id => nodes.has(id))
      for (let i = 1; i < ids.length; i++) {
        const a = ids[i - 1]!
        const b = ids[i]!
        this.pos.set(a, nodes.get(a)!)
        this.pos.set(b, nodes.get(b)!)
        this.link(a, b, serviceTrack ? SERVICE_TRACK_COST : 1)
        const seg = { a, b, name: t.name, layer: t.layer ?? '0' }
        if (!serviceTrack) this.segments.push(seg)
        if (!serviceTrack || stationTrack) this.bedSegments.push(seg)
      }
      if (ids.length > 1) wayEnds.push(ids[0]!, ids[ids.length - 1]!)
    }
    this.joinGaps(wayEnds)
  }

  // Bridges way ends that sit within JOIN_GAP_M of another way's end but
  // share no node with it. Quadratic over way ends, which number in the low
  // thousands.
  private joinGaps(ends: number[]): void {
    const unique = [...new Set(ends)]
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i]!
        const b = unique[j]!
        if (this.adj.get(a)?.has(b)) continue
        if (this.distance(a, b) <= JOIN_GAP_M) this.link(a, b, 1)
      }
    }
  }

  private distance(a: number, b: number): number {
    const pa = this.pos.get(a)!
    const pb = this.pos.get(b)!
    return haversineMeters(pa.lat, pa.lng, pb.lat, pb.lng)
  }

  // `cost` scales the routing weight only; lengths are measured from the
  // coordinates afterwards.
  private link(a: number, b: number, cost: number): void {
    const w = this.distance(a, b) * cost
    if (!this.adj.has(a)) this.adj.set(a, new Map())
    if (!this.adj.has(b)) this.adj.set(b, new Map())
    if (w < (this.adj.get(a)!.get(b) ?? Infinity)) {
      this.adj.get(a)!.set(b, w)
      this.adj.get(b)!.set(a, w)
    }
  }

  /*
   * Projects a point onto the track and splices it into the graph, returning
   * the new node and how far the point was from the track.
   *
   * The point lands on its nearest running line, and is also tied to every
   * other running line within PARALLEL_TRACK_M of that. A station on double
   * track sits between two lines, and snapping to only one of them forces a
   * path arriving on the other to run past the station to the next crossover
   * and come back — 330m each way at Ciracas. The ties are a few metres long,
   * so the worst a path picks up is a jog across the track bed.
   *
   * Projection is done in a local equirectangular plane, which is exact
   * enough at station scale.
   */
  snap(p: Coord): { id: number, offsetM: number } {
    const kx = Math.cos((p.lat * Math.PI) / 180)
    const candidates: { d: number, a: number, b: number, t: number }[] = []
    for (const { a, b } of this.segments) {
      const A = this.pos.get(a)!
      const B = this.pos.get(b)!
      const ax = A.lng * kx, ay = A.lat
      const bx = B.lng * kx, by = B.lat
      const px = p.lng * kx, py = p.lat
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py) * DEG_M
      candidates.push({ d, a, b, t })
    }
    candidates.sort((x, y) => x.d - y.d)
    const nearest = candidates[0]!
    const ids = candidates
      .filter(c => c.d <= nearest.d + PARALLEL_TRACK_M)
      .map((c) => {
        const A = this.pos.get(c.a)!
        const B = this.pos.get(c.b)!
        const id = this.nextId--
        this.pos.set(id, { lat: A.lat + c.t * (B.lat - A.lat), lng: A.lng + c.t * (B.lng - A.lng) })
        this.link(id, c.a, 1)
        this.link(id, c.b, 1)
        return id
      })
    for (const id of ids.slice(1)) this.link(ids[0]!, id, 1)
    return { id: ids[0]!, offsetM: nearest.d }
  }

  /*
   * How far, in degrees, p moves to reach the middle of the track bed under it.
   *
   * The running lines parallel to the nearest one and abeam of p are measured
   * as signed offsets across the track. Only tracks on the same OSM layer and
   * of the same named line count, so Manggarai's ground-level platforms don't
   * share a bed with the elevated Bogor line above them, and a corridor running alongside another (the Tanah Abang split, the
   * approach to Jakarta Kota) stays on its own pair instead of drifting into
   * the gap between them. A track OSM leaves unnamed counts with any line.
   * Starting from p's own track, the bed takes in every line within
   * TRACK_BED_GAP_M of the bed so far, and p moves to the middle of the
   * outermost two. Single track has nothing alongside and stays where it is.
   *
   * Also returns the across-track unit vector (east, north), zero when there
   * is no track near p. This is the raw shift at one point; centreTrace()
   * smooths it along a trace.
   */
  bedShift(p: Coord): BedShift {
    const kx = Math.cos((p.lat * Math.PI) / 180)
    const px = p.lng * kx * DEG_M
    const py = p.lat * DEG_M
    const feet = this.nearbySegments(p).map(({ a, b, name, layer }) => {
      const A = this.pos.get(a)!
      const B = this.pos.get(b)!
      const ax = A.lng * kx * DEG_M, ay = A.lat * DEG_M
      const dx = B.lng * kx * DEG_M - ax, dy = B.lat * DEG_M - ay
      const len = Math.hypot(dx, dy)
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)))
      const fx = ax + t * dx - px, fy = ay + t * dy - py
      return { ux: dx / len, uy: dy / len, fx, fy, d: Math.hypot(fx, fy), name, layer }
    }).filter(f => Number.isFinite(f.ux))
    if (feet.length === 0) return { dLat: 0, dLng: 0, nx: 0, ny: 0 }
    const own = feet.reduce((x, y) => (y.d < x.d ? y : x))
    // Across-track unit vector, perpendicular to the point's own track.
    const nx = -own.uy, ny = own.ux

    const offsets = [0]
    for (const f of feet) {
      if (f.layer !== own.layer) continue
      if (own.name && f.name && f.name !== own.name) continue
      if (Math.abs(f.ux * own.ux + f.uy * own.uy) < PARALLEL_COS) continue
      if (Math.abs(f.fx * own.ux + f.fy * own.uy) > ABEAM_TOLERANCE_M) continue
      const across = f.fx * nx + f.fy * ny
      if (Math.abs(across) <= MAX_BED_HALF_WIDTH_M) offsets.push(across)
    }
    let lo = 0, hi = 0
    for (const o of offsets.filter(o => o > 0).sort((x, y) => x - y)) {
      if (o - hi > TRACK_BED_GAP_M) break
      hi = o
    }
    for (const o of offsets.filter(o => o < 0).sort((x, y) => y - x)) {
      if (lo - o > TRACK_BED_GAP_M) break
      lo = o
    }
    const shift = (lo + hi) / 2
    return { dLat: (shift * ny) / DEG_M, dLng: (shift * nx) / (DEG_M * kx), nx, ny }
  }

  // Bed segments with any part within MAX_BED_HALF_WIDTH_M of p.
  private nearbySegments(p: Coord): TrackSegment[] {
    if (!this.grid) {
      this.grid = new Map()
      for (const seg of this.bedSegments) {
        const A = this.pos.get(seg.a)!
        const B = this.pos.get(seg.b)!
        for (let i = Math.floor(Math.min(A.lat, B.lat) / GRID_DEG); i <= Math.floor(Math.max(A.lat, B.lat) / GRID_DEG); i++) {
          for (let j = Math.floor(Math.min(A.lng, B.lng) / GRID_DEG); j <= Math.floor(Math.max(A.lng, B.lng) / GRID_DEG); j++) {
            const key = `${i},${j}`
            const cell = this.grid.get(key) ?? []
            cell.push(seg)
            this.grid.set(key, cell)
          }
        }
      }
    }
    const r = MAX_BED_HALF_WIDTH_M / DEG_M
    const found = new Set<TrackSegment>()
    for (let i = Math.floor((p.lat - r) / GRID_DEG); i <= Math.floor((p.lat + r) / GRID_DEG); i++) {
      for (let j = Math.floor((p.lng - r) / GRID_DEG); j <= Math.floor((p.lng + r) / GRID_DEG); j++) {
        for (const seg of this.grid.get(`${i},${j}`) ?? []) found.add(seg)
      }
    }
    return [...found]
  }

  shortestPath(from: number, to: number): number[] | null {
    const dist = new Map<number, number>([[from, 0]])
    const prev = new Map<number, number>()
    const heap = new MinHeap()
    heap.push(0, from)
    while (heap.size > 0) {
      const [d, u] = heap.pop()
      if (u === to) break
      if (d > dist.get(u)!) continue
      for (const [v, w] of this.adj.get(u) ?? []) {
        const nd = d + w
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd)
          prev.set(v, u)
          heap.push(nd, v)
        }
      }
    }
    if (!dist.has(to)) return null
    const path = [to]
    while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]!)!)
    return path.reverse()
  }
}

class MinHeap {
  private items: [number, number][] = []
  get size(): number { return this.items.length }

  push(key: number, value: number): void {
    const items = this.items
    items.push([key, value])
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent]![0] <= items[i]![0]) break
      ;[items[parent], items[i]] = [items[i]!, items[parent]!]
      i = parent
    }
  }

  pop(): [number, number] {
    const items = this.items
    const top = items[0]!
    const last = items.pop()!
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && items[l]![0] < items[m]![0]) m = l
        if (r < items.length && items[r]![0] < items[m]![0]) m = r
        if (m === i) break
        ;[items[m], items[i]] = [items[i]!, items[m]!]
        i = m
      }
    }
    return top
  }
}

interface BedShift { dLat: number, dLng: number, nx: number, ny: number }

// A trace resampled every SAMPLE_M, with each point's distance along it and
// raw bed shift.
interface Sampled { points: Coord[], along: number[], shifts: BedShift[] }

function sampleTrace(graph: TrackGraph, line: Coord[]): Sampled {
  const points: Coord[] = [line[0]!]
  const along = [0]
  for (let i = 1; i < line.length; i++) {
    const A = line[i - 1]!
    const B = line[i]!
    const d = haversineMeters(A.lat, A.lng, B.lat, B.lng)
    const steps = Math.max(1, Math.ceil(d / SAMPLE_M))
    for (let k = 1; k <= steps; k++) {
      points.push({ lat: A.lat + (k / steps) * (B.lat - A.lat), lng: A.lng + (k / steps) * (B.lng - A.lng) })
      along.push(along[along.length - 1]! + d / steps)
    }
  }
  return { points, along, shifts: points.map(p => graph.bedShift(p)) }
}

// The values within `radius` of each index along the trace, reduced
// coordinate by coordinate with `f`.
function alongWindow(along: number[], values: Coord[], radius: number, f: (xs: number[]) => number): Coord[] {
  let lo = 0
  let hi = 0
  return values.map((_, i) => {
    while (along[i]! - along[lo]! > radius) lo++
    while (hi + 1 < values.length && along[hi + 1]! - along[i]! <= radius) hi++
    const window = values.slice(lo, hi + 1)
    return { lat: f(window.map(c => c.lat)), lng: f(window.map(c => c.lng)) }
  })
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/*
 * A sampled trace moved onto its track bed's centreline, before its ends are
 * eased onto their stations (pinEnds).
 *
 * Each point first moves by its raw shift. Those centred points are already
 * continuous where the trace hops tracks at a crossover, since both tracks
 * share one centre, so the smoothing works on them and not on the shifts.
 * A short median over the coordinates drops one-point spikes without pulling
 * curves inwards. Then every sideways step bigger than BED_STEP_M, where the
 * bed gains or loses a track, is collected, and replaced by its moving
 * average: the step becomes a ramp, and curves, which never step, are left
 * alone.
 */
function centreTrace({ points, along, shifts }: Sampled): Coord[] {
  const raw = points.map((p, i) => ({ lat: p.lat + shifts[i]!.dLat, lng: p.lng + shifts[i]!.dLng }))
  const despiked = alongWindow(along, raw, SPIKE_RADIUS_M, median)
  const steps: Coord[] = [{ lat: 0, lng: 0 }]
  for (let i = 1; i < despiked.length; i++) {
    const prev = steps[i - 1]!
    const { nx, ny } = shifts[i]!
    const kx = Math.cos((despiked[i]!.lat * Math.PI) / 180)
    const east = (despiked[i]!.lng - despiked[i - 1]!.lng) * kx * DEG_M
    const north = (despiked[i]!.lat - despiked[i - 1]!.lat) * DEG_M
    const across = east * nx + north * ny
    steps.push(Math.abs(across) > BED_STEP_M
      ? { lat: prev.lat + (across * ny) / DEG_M, lng: prev.lng + (across * nx) / (DEG_M * kx) }
      : prev)
  }
  const ramps = alongWindow(along, steps, RAMP_RADIUS_M, mean)
  return despiked.map((c, i) => ({
    lat: c.lat - steps[i]!.lat + ramps[i]!.lat,
    lng: c.lng - steps[i]!.lng + ramps[i]!.lng
  }))
}

// A centred trace with its ends eased, over RAMP_RADIUS_M, onto the given
// station points, which every segment ending at a station shares, so
// consecutive segments join end to end.
function pinEnds(line: Coord[], along: number[], start: Coord, end: Coord): Coord[] {
  const total = along[along.length - 1]!
  const first = line[0]!
  const last = line[line.length - 1]!
  return line.map((c, i) => {
    const fromStart = Math.max(0, 1 - along[i]! / RAMP_RADIUS_M)
    const fromEnd = Math.max(0, 1 - (total - along[i]!) / RAMP_RADIUS_M)
    return {
      lat: c.lat + (start.lat - first.lat) * fromStart + (end.lat - last.lat) * fromEnd,
      lng: c.lng + (start.lng - first.lng) * fromStart + (end.lng - last.lng) * fromEnd
    }
  })
}

interface Segment {
  operator: Operator
  from: Stop
  to: Stop
  lines: Set<string>
}

// Consecutive stops of every stop list, keyed by unordered station pair so
// shared track is traced once. The first line to list a pair sets its order.
function collectSegments(lines: LineTopology[]): Map<string, Segment> {
  const segments = new Map<string, Segment>()
  for (const line of lines) {
    const lists = line.pathReverse ? [line.path, line.pathReverse] : stopLists(line)
    for (const stops of lists) {
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1]!
        const b = stops[i]!
        if (a.unbuilt || b.unbuilt) continue
        const key = `${line.operator}:${[a.station, b.station].sort().join('|')}`
        const seg = segments.get(key) ?? { operator: line.operator, from: a, to: b, lines: new Set() }
        seg.lines.add(line.lineCode)
        segments.set(key, seg)
      }
    }
  }
  return segments
}

function pathLength(coords: Coord[]): number {
  let m = 0
  for (let i = 1; i < coords.length; i++) {
    m += haversineMeters(coords[i - 1]!.lat, coords[i - 1]!.lng, coords[i]!.lat, coords[i]!.lng)
  }
  return m
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh')
  const [osm, coords] = await Promise.all([loadOsm(refresh), loadCoords()])

  const rail = TOPOLOGY.filter(line => MODE[line.operator] != null)
  const segments = collectSegments(rail)
  const graphs = new Map<string, TrackGraph>()
  const snapIds = new Map<string, number>()
  const problems: string[] = []
  const report: string[] = []
  const byOperator = new Map<string, unknown[]>()
  // Traced segments, centred once every station's shift is known.
  const traced: { seg: Segment, fromId: string, toId: string, lengthM: number, sampled: Sampled, ends: [string, string] }[] = []

  for (const seg of segments.values()) {
    const mode = MODE[seg.operator]!
    if (!graphs.has(mode)) graphs.set(mode, new TrackGraph(osm, mode))
    const graph = graphs.get(mode)!
    const fromId = `${seg.operator}-${seg.from.station}`
    const toId = `${seg.operator}-${seg.to.station}`

    // Each station is projected once per mode, so every segment touching it
    // starts from the same point and consecutive segments join end to end.
    const ends: number[] = []
    for (const id of [fromId, toId]) {
      const key = `${mode}:${id}`
      if (!snapIds.has(key)) {
        const c = coords.get(id)
        if (!c) {
          problems.push(`${id}: no coordinates`)
          continue
        }
        const { id: nodeId, offsetM } = graph.snap(c)
        if (offsetM > MAX_SNAP_M) problems.push(`${id}: ${Math.round(offsetM)}m from the nearest ${mode} track`)
        snapIds.set(key, nodeId)
      }
      ends.push(snapIds.get(key)!)
    }
    if (ends.length < 2) continue

    const path = graph.shortestPath(ends[0]!, ends[1]!)
    if (!path) {
      problems.push(`${fromId} -> ${toId}: no track connects them`)
      continue
    }
    const line = path.map(n => graph.pos.get(n)!)
    const lengthM = Math.round(pathLength(line))
    const a = coords.get(fromId)!
    const b = coords.get(toId)!
    const straight = haversineMeters(a.lat, a.lng, b.lat, b.lng)
    const chainage = seg.from.cumM != null && seg.to.cumM != null ? Math.abs(seg.from.cumM - seg.to.cumM) : null

    const flags: string[] = []
    if (lengthM > straight * MAX_DETOUR_RATIO) flags.push(`detour x${(lengthM / straight).toFixed(2)}`)
    if (chainage != null && Math.abs(lengthM - chainage) > chainage * MAX_CHAINAGE_DRIFT) {
      flags.push(`chainage ${chainage}m`)
    }
    if (flags.length > 0) problems.push(`${fromId} -> ${toId}: ${lengthM}m, ${flags.join(', ')}`)
    report.push([
      [...seg.lines].join(',').padEnd(6),
      `${fromId} -> ${toId}`.padEnd(28),
      String(Math.round(straight)).padStart(6),
      String(chainage ?? '').padStart(6),
      String(lengthM).padStart(6)
    ].join(' '))

    traced.push({
      seg,
      fromId,
      toId,
      lengthM,
      sampled: sampleTrace(graph, line),
      ends: [`${mode}:${fromId}`, `${mode}:${toId}`]
    })
  }

  // Each station's point is the median of where the segments ending there
  // centre it, so one segment's odd end can't pin the others.
  const centred = traced.map(t => centreTrace(t.sampled))
  const stationEnds = new Map<string, Coord[]>()
  traced.forEach(({ ends }, i) => {
    const line = centred[i]!
    stationEnds.set(ends[0], [...stationEnds.get(ends[0]) ?? [], line[0]!])
    stationEnds.set(ends[1], [...stationEnds.get(ends[1]) ?? [], line[line.length - 1]!])
  })
  const stationPoint = (key: string): Coord => {
    const points = stationEnds.get(key)!
    return { lat: median(points.map(c => c.lat)), lng: median(points.map(c => c.lng)) }
  }

  for (const [i, { seg, fromId, toId, lengthM, sampled, ends }] of traced.entries()) {
    const pinned = pinEnds(centred[i]!, sampled.along, stationPoint(ends[0]), stationPoint(ends[1]))
    const coordinates = simplify(pinned.map((p): LngLat => [p.lng, p.lat]), OUTPUT_SIMPLIFY_M)
    const features = byOperator.get(seg.operator) ?? []
    features.push({
      type: 'Feature',
      properties: { from: fromId, to: toId, lines: [...seg.lines], lengthM },
      geometry: { type: 'LineString', coordinates: coordinates.map(([lng, lat]) => [round6(lng), round6(lat)]) }
    })
    byOperator.set(seg.operator, features)
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const [operator, features] of byOperator) {
    const file = `${OUTPUT_DIR}/${operator.toLowerCase()}.geojson`
    // One feature per line keeps diffs readable when a single segment is redrawn.
    const body = features.map(f => JSON.stringify(f)).join(',\n')
    fs.writeFileSync(file, `{"type":"FeatureCollection",${OSM_ATTRIBUTION},"features":[\n${body}\n]}\n`)
    console.log(`Wrote ${features.length} segments to ${file}`)
  }

  console.log(`\nlines  segment                      straight  chain  track`)
  for (const row of report) console.log(row)
  if (problems.length > 0) {
    console.warn(`\n${problems.length} segment(s) need a look:`)
    for (const p of problems) console.warn(`  ${p}`)
  }
}

main().catch((err) => {
  console.error('An error occurred during track geometry generation:', err)
  process.exit(1)
})
