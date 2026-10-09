import * as fs from 'node:fs'
import type { Operator } from '@commute/constants'
import { TOPOLOGY, type LineTopology, type Stop } from '../data/topology'
import { haversineMeters } from '../../utils/geo'
import { stopLists } from '../../utils/edgeChain'

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
 * projections is the geometry. Yards, sidings and spurs are left out of the
 * graph so a path can't shortcut through a depot, and the Whoosh high-speed
 * line is left out because it is tagged as ordinary main-line rail.
 *
 * `lengthM` is measured on the full-resolution trace. Simplify only for
 * shipping, never before measuring — simplification cuts curves and shortens
 * the distance.
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

// A station further than this from its line's track is a bad coordinate or a
// missing OSM way, not a real offset.
const MAX_SNAP_M = 150
// Track length over straight-line distance. Above this the shortest path has
// almost certainly wandered onto another line.
const MAX_DETOUR_RATIO = 1.5
// Track length against published chainage (cumM).
const MAX_CHAINAGE_DRIFT = 0.1

interface Coord { lat: number, lng: number }

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
  readonly segments: [number, number][] = []
  // Spliced-in projection nodes take negative ids so they never collide with OSM's.
  private nextId = -1

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
      const ids = e.nodes!.filter(id => nodes.has(id))
      for (let i = 1; i < ids.length; i++) {
        const a = ids[i - 1]!
        const b = ids[i]!
        this.pos.set(a, nodes.get(a)!)
        this.pos.set(b, nodes.get(b)!)
        this.link(a, b, serviceTrack ? SERVICE_TRACK_COST : 1)
        if (!serviceTrack) this.segments.push([a, b])
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
    for (const [a, b] of this.segments) {
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

    const features = byOperator.get(seg.operator) ?? []
    features.push({
      type: 'Feature',
      properties: { from: fromId, to: toId, lines: [...seg.lines], lengthM },
      geometry: { type: 'LineString', coordinates: line.map(p => [round6(p.lng), round6(p.lat)]) }
    })
    byOperator.set(seg.operator, features)
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const [operator, features] of byOperator) {
    const file = `${OUTPUT_DIR}/${operator.toLowerCase()}.geojson`
    // One feature per line keeps diffs readable when a single segment is redrawn.
    const body = features.map(f => JSON.stringify(f)).join(',\n')
    fs.writeFileSync(file, `{"type":"FeatureCollection","features":[\n${body}\n]}\n`)
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
