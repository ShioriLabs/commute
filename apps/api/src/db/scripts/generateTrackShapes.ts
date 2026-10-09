import * as fs from 'node:fs'
import { TOPOLOGY, type LineTopology, type Stop } from '../data/topology'
import { chainHops, stopLists, type Hop } from '../../utils/edgeChain'
import { encodePolyline, simplify, type LngLat } from '../../utils/polyline'
import { haversineMeters } from '../../utils/geo'
import { parseCSV } from './gtfs'

/*
 * The real shape of every hop a ride leg can contain, prebaked into
 * data/trackShapes.generated.ts and served at /_internal/track-shapes for the
 * Android trip mode, which otherwise projects a rider onto the straight line
 * between two stops (see docs/track-shapes.md).
 *
 * Keyed `${fromStationId}>${toStationId}`: the consecutive stops of a leg's
 * `stops`, with no line code, since track between two stations is the same
 * whichever line runs it and a merged interlined leg cannot name one line per
 * hop. A missing key means "no shape"; the app keeps the straight line.
 *
 * Sources:
 *   - Rail: the OSM traces in data/geometry (generateTrackGeometry.ts), one per
 *     pair of consecutive stops. A hop that runs past stops without calling
 *     (Stop.passThrough, Stop.serves) is stitched from every segment it covers,
 *     exactly as generateEdgesSQL prices it. Both directions.
 *   - TransJakarta: the GTFS shapes, cut at each halte by shape_dist_traveled.
 *     Directed, since a bus can take a different street each way.
 *
 * Re-run after generate:track-geometry, generate:edges or a TJ GTFS import:
 *   pnpm --filter api generate:track-shapes
 * TJ needs the feed extracted under scripts/file_gtfs/, as generateTJSQL does.
 */

const GEOMETRY_DIR = `${__dirname}/../data/geometry`
const FEED_DIR = `${__dirname}/file_gtfs`
const OUTPUT_PATH = `${__dirname}/../data/trackShapes.generated.ts`

// Same scope as generateTJSQL: the services the router knows about.
const TJ_SCOPE_DESC = new Set(['BRT', 'Angkutan Umum Integrasi'])

// Finer than any GPS fix the app will compare against, coarse enough to drop
// the OSM and GTFS vertices that only restate a straight run.
const SIMPLIFY_M = 3

// A TJ cut whose end lands further than this from the feed's own halte is a bad
// shape_dist_traveled, not a halte set back from the road: dropped, so the app
// keeps its straight line rather than placing the halte somewhere it isn't.
// Harmoni came out 1.5 km off in the 2026-06-29 feed.
const MAX_END_OFFSET_M = 150

const ATTRIBUTION = 'Rail: © OpenStreetMap contributors, ODbL-1.0 (https://www.openstreetmap.org/copyright). TransJakarta: TransJakarta GTFS.'

export const shapeKey = (from: string, to: string): string => `${from}>${to}`

/** A traced segment as stored in data/geometry: its coordinates run from `from` to `to`. */
export interface Segment { from: string, to: string, coords: LngLat[] }

const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

/** The segments of data/geometry, by unordered station pair. */
export function indexSegments(segments: Segment[]): Map<string, Segment> {
  return new Map(segments.map(s => [pairKey(s.from, s.to), s]))
}

function oriented(index: Map<string, Segment>, from: string, to: string): LngLat[] | null {
  const segment = index.get(pairKey(from, to))
  if (!segment) return null
  return segment.from === from ? segment.coords : [...segment.coords].reverse()
}

/*
 * One hop's shape: the segments between each pair of the stops it covers, end
 * to end. Consecutive segments meet at the same snapped station point, so the
 * joint is kept once. Null when any segment is missing: a partial shape would
 * place the rider on track that stops short of the station.
 */
export function stitch(index: Map<string, Segment>, stationIds: string[]): LngLat[] | null {
  const out: LngLat[] = []
  for (let i = 1; i < stationIds.length; i++) {
    const part = oriented(index, stationIds[i - 1]!, stationIds[i]!)
    if (!part) return null
    out.push(...(out.length > 0 ? part.slice(1) : part))
  }
  return out
}

/*
 * The hops a rail line's legs can contain, directed: the same walk
 * generateEdgesSQL makes, so every edge the router can ride has a matching key.
 */
export function railHops(line: LineTopology): { from: string, to: string, covered: string[] }[] {
  const id = (s: Stop) => `${line.operator}-${s.station}`
  const lists = line.pathReverse ? [line.path, line.pathReverse] : stopLists(line)
  const hops: { from: string, to: string, covered: string[] }[] = []
  for (const stops of lists) {
    for (const hop of chainHops(stops) as Hop[]) {
      const covered = [hop.from, ...hop.via, hop.to]
      if (covered.some(s => s.unbuilt)) continue
      const ids = covered.map(id)
      hops.push({ from: ids[0]!, to: ids[ids.length - 1]!, covered: ids })
      // A pathReverse line lists each direction itself, so its hops are one-way.
      if (hop.bothWays && !line.pathReverse) {
        const back = [...ids].reverse()
        hops.push({ from: back[0]!, to: back[back.length - 1]!, covered: back })
      }
    }
  }
  return hops
}

export function railShapes(lines: LineTopology[], index: Map<string, Segment>): { shapes: Map<string, LngLat[]>, missing: string[] } {
  const shapes = new Map<string, LngLat[]>()
  const missing: string[] = []
  for (const line of lines) {
    for (const hop of railHops(line)) {
      const key = shapeKey(hop.from, hop.to)
      if (shapes.has(key)) continue
      const coords = stitch(index, hop.covered)
      if (coords) shapes.set(key, coords)
      else missing.push(`${line.lineCode} ${key}`)
    }
  }
  return { shapes, missing }
}

/** A GTFS shape point: position plus distance along the shape, in metres. */
export interface ShapePoint { lng: number, lat: number, dist: number }

/*
 * The stretch of `shape` between two distances along it, with both ends
 * interpolated onto the exact distance so the cut starts and ends where the
 * feed puts the stops. Null when the range is empty or off the shape.
 */
export function cutShape(shape: ShapePoint[], from: number, to: number): LngLat[] | null {
  if (!(to > from) || shape.length < 2) return null
  if (from < shape[0]!.dist || to > shape[shape.length - 1]!.dist) return null
  const at = (d: number): LngLat => {
    for (let i = 1; i < shape.length; i++) {
      const a = shape[i - 1]!
      const b = shape[i]!
      if (d <= b.dist) {
        const span = b.dist - a.dist
        const t = span > 0 ? (d - a.dist) / span : 0
        return [a.lng + t * (b.lng - a.lng), a.lat + t * (b.lat - a.lat)]
      }
    }
    const last = shape[shape.length - 1]!
    return [last.lng, last.lat]
  }
  const inner = shape.filter(p => p.dist > from && p.dist < to).map(p => [p.lng, p.lat] as LngLat)
  return [at(from), ...inner, at(to)]
}

function loadFeed(file: string): Record<string, string>[] {
  return parseCSV(fs.readFileSync(`${FEED_DIR}/${file}`, 'utf-8'))
}

/*
 * TransJakarta hops from the GTFS feed: every pair of consecutive median or
 * roadside haltes on an in-scope trip, cut out of that trip's shape. Stops are
 * collapsed to their parent halte and the pair skipped unless both are H/B
 * stops, exactly as generateTJSQL builds `edges`, so the keys line up with the
 * station ids the router uses. Where trip variants disagree on a pair, the
 * shortest cut wins, the same rule that picks the edge distance.
 */
function tjShapes(): { shapes: Map<string, { coords: LngLat[], length: number }>, rejected: string[] } {
  const routes = loadFeed('routes.txt')
  const scope = new Set(routes.filter(r => TJ_SCOPE_DESC.has(r.route_desc ?? '')).map(r => r.route_id))
  const tripShape = new Map<string, string>()
  for (const t of loadFeed('trips.txt')) {
    if (scope.has(t.route_id ?? '') && t.shape_id) tripShape.set(t.trip_id!, t.shape_id)
  }

  const stopParent = new Map<string, string>()
  const stopAt = new Map<string, LngLat>()
  for (const s of loadFeed('stops.txt')) {
    stopParent.set(s.stop_id!, s.parent_station || s.stop_id!)
    if (s.stop_lat && s.stop_lon) stopAt.set(s.stop_id!, [Number(s.stop_lon), Number(s.stop_lat)])
  }
  const offset = (stop: string, p: LngLat): number => {
    const at = stopAt.get(stop)
    return at ? haversineMeters(at[1], at[0], p[1], p[0]) : 0
  }

  const rawShapes = new Map<string, { seq: number, point: ShapePoint }[]>()
  for (const p of loadFeed('shapes.txt')) {
    if (p.shape_dist_traveled === '') continue
    const list = rawShapes.get(p.shape_id!) ?? []
    list.push({ seq: Number(p.shape_pt_sequence), point: { lng: Number(p.shape_pt_lon), lat: Number(p.shape_pt_lat), dist: Number(p.shape_dist_traveled) } })
    rawShapes.set(p.shape_id!, list)
  }
  const shapes = new Map<string, ShapePoint[]>()
  for (const [id, list] of rawShapes) shapes.set(id, list.sort((a, b) => a.seq - b.seq).map(p => p.point))

  const stopTimes = new Map<string, { seq: number, stop: string, dist: number | null }[]>()
  for (const r of loadFeed('stop_times.txt')) {
    if (!tripShape.has(r.trip_id!)) continue
    const list = stopTimes.get(r.trip_id!) ?? []
    list.push({ seq: Number(r.stop_sequence), stop: stopParent.get(r.stop_id!) ?? r.stop_id!, dist: r.shape_dist_traveled === '' ? null : Number(r.shape_dist_traveled) })
    stopTimes.set(r.trip_id!, list)
  }

  const isHalte = (stop: string) => stop.startsWith('H') || stop.startsWith('B')
  const out = new Map<string, { coords: LngLat[], length: number }>()
  const rejected = new Set<string>()
  for (const [tripId, list] of stopTimes) {
    const shape = shapes.get(tripShape.get(tripId)!)
    if (!shape) continue
    list.sort((a, b) => a.seq - b.seq)
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!
      const b = list[i]!
      if (a.stop === b.stop || !isHalte(a.stop) || !isHalte(b.stop)) continue
      if (a.dist == null || b.dist == null) continue
      const coords = cutShape(shape, a.dist, b.dist)
      if (!coords) continue
      const key = shapeKey(`TJ-${a.stop}`, `TJ-${b.stop}`)
      if (offset(a.stop, coords[0]!) > MAX_END_OFFSET_M || offset(b.stop, coords[coords.length - 1]!) > MAX_END_OFFSET_M) {
        rejected.add(key)
        continue
      }
      const length = b.dist - a.dist
      const existing = out.get(key)
      if (!existing || length < existing.length) out.set(key, { coords, length })
    }
  }
  // A pair another trip cut cleanly is fine; only report the ones left without.
  return { shapes: out, rejected: [...rejected].filter(k => !out.has(k)) }
}

function loadSegments(): Segment[] {
  const segments: Segment[] = []
  for (const file of fs.readdirSync(GEOMETRY_DIR).filter(f => f.endsWith('.geojson'))) {
    const json = JSON.parse(fs.readFileSync(`${GEOMETRY_DIR}/${file}`, 'utf-8')) as {
      features: { properties: { from: string, to: string }, geometry: { coordinates: LngLat[] } }[]
    }
    for (const f of json.features) segments.push({ from: f.properties.from, to: f.properties.to, coords: f.geometry.coordinates })
  }
  return segments
}

// FNV-1a, hex: the version only has to change when the shapes do.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// Encoded polylines use ASCII 63-126, which includes the backslash.
const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\')}'`

function main(): void {
  const rail = railShapes(TOPOLOGY.filter(l => l.operator !== 'TJ'), indexSegments(loadSegments()))
  const hasFeed = fs.existsSync(`${FEED_DIR}/shapes.txt`)
  const { shapes: tj, rejected } = hasFeed ? tjShapes() : { shapes: new Map<string, { coords: LngLat[], length: number }>(), rejected: [] }

  const encoded = new Map<string, string>()
  for (const [key, coords] of rail.shapes) encoded.set(key, encodePolyline(simplify(coords, SIMPLIFY_M)))
  for (const [key, { coords }] of tj) encoded.set(key, encodePolyline(simplify(coords, SIMPLIFY_M)))
  const entries = [...encoded.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const version = fnv1a(entries.map(([k, v]) => `${k}=${v}`).join('\n'))

  const body = entries.map(([k, v]) => `    ${quote(k)}: ${quote(v)}`).join(',\n')
  fs.writeFileSync(OUTPUT_PATH, `import type { TrackShapes } from '@commute/schemas'

// GENERATED by \`pnpm --filter api generate:track-shapes\` from data/geometry
// (rail) and the TransJakarta GTFS shapes. Do not edit; see
// db/scripts/generateTrackShapes.ts and docs/track-shapes.md.
export const TRACK_SHAPES: TrackShapes = {
  version: ${quote(version)},
  attribution: ${quote(ATTRIBUTION)},
  shapes: {
${body}
  }
}
`)

  // Coverage against the hops the router can ride, per operator family.
  const covered = { rail: [0, 0], tj: [0, 0] }
  for (const line of TOPOLOGY) {
    const bucket = line.operator === 'TJ' ? covered.tj : covered.rail
    for (const hop of railHops(line)) {
      bucket[1]!++
      if (encoded.has(shapeKey(hop.from, hop.to))) bucket[0]!++
    }
  }
  const pct = ([hit, all]: number[]) => `${hit}/${all} (${all ? ((100 * hit!) / all!).toFixed(1) : '0'}%)`
  console.log(`Wrote ${entries.length} shapes (${rail.shapes.size} rail, ${tj.size} TJ), ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0)} KB, version ${version}`)
  console.log(`Topology hops with a shape: rail ${pct(covered.rail)}, TJ ${pct(covered.tj)}`)
  if (!hasFeed) console.warn(`No TJ feed at ${FEED_DIR}; TJ hops were left without shapes.`)
  if (rejected.length > 0) console.warn(`${rejected.length} TJ pair(s) dropped, an end more than ${MAX_END_OFFSET_M} m from its halte: ${rejected.join(', ')}`)
  if (rail.missing.length > 0) {
    console.warn(`${rail.missing.length} rail hop(s) with a segment missing from data/geometry:`)
    for (const m of rail.missing) console.warn(`  ${m}`)
  }
}

if (require.main === module) main()
