import * as fs from 'node:fs'
import { decodePolyline, encodePolyline, simplify, type LngLat } from '../../utils/polyline'
import { TOPOLOGY } from '../data/topology'
import {
  bundle,
  dropBypasses,
  dropRetraces,
  easeCorners,
  filletCorners,
  cutLoops,
  simplifyBends,
  smoothPath,
  isDrawn,
  placeStops,
  roundJunctions,
  strokeKeys,
  trimBarbs,
  type BusMapEdge,
  type CornerTally,
  type KeptApart,
  type OrderReport,
  type StopMark
} from './busMapBundle'
import { koridorOf, loadRoads, snapPoint, snapToRoads, type Roads } from './busMapRoads'
import { alignToTopology, passesBy, type TopologyLine } from './busMapTopology'
import { parseCSV } from './gtfs'

/*
 * The data behind Peta Bus, the geographic TransJakarta view on /map: every
 * BRT and Angkutan Umum Integrasi line drawn along its real streets from the
 * GTFS shapes, every halte those lines call at, and the rail stations as plain
 * dots for bearings. Written to apps/web/app/data/bus-map.json, which the web
 * app imports with `?url` so Vite content-hashes it like points.json.
 *
 * Why a geographic map at all: the FDTJ artwork draws no NBRT line, and 24 of
 * the non-BRT lines have no halte on it at all. A roadside stop has no honest
 * position on a schematic, but it has a GPS fix in the feed.
 *
 * The feed is trip-pattern based: one trip per pattern, and a line has many,
 * because short turns, depot runs and branches each get their own. Drawing all
 * of them redraws the same street several times, so patterns are deduplicated
 * by GEOMETRY (dedupePatterns): longest first, each pattern adds only the
 * stretches the line's earlier pieces don't already cover. That keeps
 * branches, terminus loops and the one-way streets a line takes in one
 * direction only, and drops short turns and the opposite direction along the
 * same road.
 *
 * Same scope as generateTJSQL (BRT + Angkutan Umum Integrasi; no Mikrotrans,
 * Royaltrans or Transjabodetabek), and halte codes are the same collapsed
 * parent stop ids, so `TJ-${code}` is the station id the API knows.
 *
 * Rail dots come from stations_lat_lng.csv, the same hand-kept coordinates
 * generateLatLngSQL seeds the stations table with.
 *
 * The feed's shapes carry TransJakarta's reroutes as if they were the line (koridor 1
 * via Petojo, 6 via Halimun). A koridor the routing topology knows is redrawn
 * along it instead, its poster route (busMapTopology.ts, alongTopology).
 *
 * The lines also ship as `edges`, one network with the lines sharing a street
 * side by side in a fixed order (busMapBundle.ts), which is what the clients
 * draw. `shapes` stays per line for drawing one line alone, and so the edges
 * can be rebuilt without the feed.
 *
 * Re-run after a TJ GTFS import (the feed extracted under file_gtfs/, as
 * generateTJSQL needs it) or a station coordinate change:
 *   pnpm --filter api generate:bus-map
 * After a change to the bundling alone, from the file as it is:
 *   pnpm --filter api generate:bus-map --rebundle
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const COORDS_CSV = `${__dirname}/stations_lat_lng.csv`
const OUTPUT_PATH = `${__dirname}/../../../../web/app/data/bus-map.json`

/**
 * Every line's shapes as the feed has them, each distinct one whole and untouched, for the Android
 * map's debug panel (Raw). Beside Peta Bus, which the web doesn't read it with; written by a full
 * run only, `--rebundle` having no feed.
 */
const FEED_OUTPUT_PATH = `${__dirname}/../../../../web/app/data/bus-map-feed.json`

/**
 * [FEED_OUTPUT_PATH]'s shape: each line's code, its feed shapes, encoded, and the platforms its trips
 * call at where a halte has them apart (more than PLATFORM_APART_M from the halte): which side of it the
 * line is laid on (alongRoads).
 */
export interface BusMapFeed {
  lines: { code: string, shapes: string[], platforms?: LngLat[] }[]
}

/** A platform this near its halte's own coordinate says nothing a halte doesn't. */
const PLATFORM_APART_M = 3

/** Each line's platforms, by code: the sides of its haltes it calls at. */
export function platformsOf(feed: BusMapFeed): Map<string, LngLat[]> {
  return new Map(feed.lines.flatMap(l => (l.platforms ? [[l.code, l.platforms] as const] : [])))
}

/** Each line's feed shapes, decoded, by code: the trips a koridor's redraw may take a leg from. */
export function tripsOf(feed: BusMapFeed): Map<string, LngLat[][]> {
  return new Map(feed.lines.map(l => [l.code, l.shapes.map(s => decodePolyline(s))]))
}

/** Each of [shapeIds]' shapes once, in the order first met, encoded whole: the feed's own geometry. */
export function feedShapes(shapeIds: readonly string[], shapes: ReadonlyMap<string, LngLat[]>): string[] {
  return [...new Set(shapeIds)].flatMap((id) => {
    const points = shapes.get(id)
    return points && points.length >= 2 ? [encodePolyline(points)] : []
  })
}

const SCOPE: Record<string, BusMapLineKind> = {
  'BRT': 'BRT',
  'Angkutan Umum Integrasi': 'AUI'
}

/*
 * Douglas-Peucker tolerance for what ships. A line on a city map is a few
 * pixels wide at street zoom, where a pixel is a metre or two; 4 m keeps a
 * corner looking like a corner while dropping the feed's dense straight runs.
 */
const SIMPLIFY_M = 4

/**
 * A line laid on the roads, drawn alone from street zoom in, smoothed (smoothPath) with this spread:
 * shirase's roads stop at z15, where a bend is a few uneven chords (2 round its hairpin by Gambir 2).
 * Rounding each chord's corner on its own left the unevenness as waves; smoothed along the line, a
 * bend comes out one even curve, a junction's turn a short one, a straight straight.
 */
const DRAWN_SMOOTH_M = 6

/**
 * And then simplified (simplifyBends) to this where it runs straight: finer kept the smoothing's
 * last flutters on the straights.
 */
const DRAWN_SIMPLIFY_M = 0.6

/**
 * But to this where a step heads more than DRAWN_BEND_DEG off its span's chord: at z19 a metre is
 * about 7 dp, and 0.6 m left 2's hairpin by Gambir 2 as 5-10 m chords turning 15-30 degrees each.
 */
const DRAWN_BEND_M = 0.05
const DRAWN_BEND_DEG = 2

/**
 * And encoded to this many decimals: precision 5 is a 1.1 m grid, which alone bends a 5 m chord
 * by up to 12 degrees. [BusMapLine.drawn] says so to clients.
 */
export const DRAWN_PRECISION = 6

/** A loop a laid line ties in itself this short, along it, is cut at the crossing (cutLoops). */
const DRAWN_LOOP_M = 40

/** An edge laid onto the roads longer than this times its own length, and this much more, went onto a road beside it. */
const LAID_STRETCH = 1.5
const LAID_SLACK_M = 20

/** Topology redraws until the koridors settle; see alongTopology. */
const ALIGN_PASSES = 4

/*
 * Pattern dedupe. A pattern is sampled every SAMPLE_STEP_M; a sample counts as
 * already drawn when it lies within about COVER_CELL_M of a kept pattern (the
 * 3x3 cell neighbourhood, so 1-2 cells depending on where in its cell it
 * falls). That absorbs the feed's GPS wobble along one carriageway.
 *
 * The other carriageway of a divided road sits further out than that, 30 to
 * 60 m on the wide arterials, so an uncovered stretch is also dropped when ALL
 * of it lies within CARRIAGEWAY_RINGS cells of what is drawn: it is the same
 * road the other way, and drawing it leaves a ghost stub beside the line. A
 * one-way pair a block apart (6M's, ~250 m) is further than that and stays.
 *
 * An uncovered stretch shorter than MIN_PIECE_M is not drawn either. An
 * absolute length rather than a fraction of the pattern: a 30 km trunk with a
 * 600 m one-way loop at one terminus is 98% covered, and the loop is still a
 * street the bus takes.
 */
const SAMPLE_STEP_M = 20
const COVER_CELL_M = 20
const CARRIAGEWAY_RINGS = 3
const MIN_PIECE_M = 80

const ATTRIBUTION = 'TransJakarta: TransJakarta GTFS. Rail stations: Commute.'

// ── output shape (mirrored by apps/web/app/lib/bus-map.ts) ──────────────────

export type BusMapLineKind = 'BRT' | 'AUI'

export interface BusMapLine {
  code: string
  name: string
  kind: BusMapLineKind
  /** `#RRGGBB`, the feed's route_color. */
  color: string
  /**
   * Encoded polylines (Google, precision 5): the pieces that together draw the
   * line once, from the feed (a koridor redrawn on its topology). The source the
   * generator works from; what clients draw is [drawn].
   */
  shapes: string[]
  /**
   * [shapes] laid onto the roads themselves, piece for piece: what a client draws the line with.
   * Encoded at precision 6 (DRAWN_PRECISION), not 5: it is drawn down to a fraction of a metre.
   */
  drawn: string[]
  /** Halte codes the line calls at, in the order of its longest pattern first. */
  stops: string[]
}

export interface BusMap {
  attribution: string
  lines: BusMapLine[]
  /** The lines as one network: each street once, its lines left to right along it. What clients draw. */
  edges: BusMapEdge[]
  /** Each halte placed on the network, for its mark across the bundle there (busMapBundle.ts, placeStops). */
  stopMarks: StopMark[]
  /** Halte code -> [name, lng, lat]. */
  haltes: Record<string, [string, number, number]>
  /** Rail stations for bearings: [station id, lng, lat]. */
  rail: [string, number, number][]
}

// ── geometry ────────────────────────────────────────────────────────────────

/*
 * Jakarta is small enough for one flat projection: at -6.2 degrees a degree
 * of longitude is 110.7 km everywhere in the feed, to within 0.1%.
 */
const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574

const toXY = ([lng, lat]: LngLat): [number, number] => [lng * KX, lat * KY]

/** Points every `step` metres along a polyline, both ends included. */
export function sampleAlong(coords: readonly LngLat[], step: number): [number, number][] {
  const out: [number, number][] = []
  if (coords.length === 0) return out
  const xy = coords.map(toXY)
  out.push(xy[0]!)
  let carry = 0
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]!
    const [bx, by] = xy[i]!
    const length = Math.hypot(bx - ax, by - ay)
    let d = step - carry
    while (d <= length) {
      const t = d / length
      out.push([ax + t * (bx - ax), ay + t * (by - ay)])
      d += step
    }
    carry = length - (d - step)
  }
  out.push(xy[xy.length - 1]!)
  return out
}

const cellKey = (x: number, y: number): string => `${Math.floor(x / COVER_CELL_M)},${Math.floor(y / COVER_CELL_M)}`

/** The points drawn so far, by cell; a point covers its neighbourhood. */
type Cover = Map<string, [number, number][]>

/**
 * Whether [s] lies within [rings] cells of what's drawn, on its side of anything [apart] says keeps
 * two streets apart there (a toll road between a split road's sides), for a line heading [heading].
 */
function isCovered(
  cells: Cover,
  s: [number, number],
  rings = 1,
  heading: [number, number] = [0, 0],
  apart?: KeptApart
): boolean {
  const cx = Math.floor(s[0] / COVER_CELL_M)
  const cy = Math.floor(s[1] / COVER_CELL_M)
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dy = -rings; dy <= rings; dy++) {
      const here = cells.get(`${cx + dx},${cy + dy}`)
      if (here && (!apart || here.some(p => !apart(s, p, heading)))) return true
    }
  }
  return false
}

export function lengthM(coords: readonly LngLat[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = toXY(coords[i - 1]!)
    const [bx, by] = toXY(coords[i]!)
    total += Math.hypot(bx - ax, by - ay)
  }
  return total
}

function markCovered(cells: Cover, coords: readonly LngLat[]): void {
  // Half the sample step, so a drawn piece leaves no gap a sample could fall through.
  for (const [x, y] of sampleAlong(coords, SAMPLE_STEP_M / 2)) {
    const key = cellKey(x, y)
    const here = cells.get(key)
    if (here) here.push([x, y])
    else cells.set(key, [[x, y]])
  }
}

/** The unit way from [a] to [b], in metres. */
function headingOf(a: LngLat, b: LngLat): [number, number] {
  const [ax, ay] = toXY(a)
  const [bx, by] = toXY(b)
  const l = Math.hypot(bx - ax, by - ay) || 1
  return [(bx - ax) / l, (by - ay) / l]
}

/*
 * The pieces of a line worth drawing. Patterns are walked longest first, and
 * each contributes only the runs of its segments that the pieces kept so far
 * do not already cover, so the shared trunk is drawn once and a branch or a
 * terminus loop adds just itself.
 *
 * A run carries the covered vertex on either side of it, so it joins the
 * geometry it leaves and rejoins without a gap. A run shorter than
 * MIN_PIECE_M is GPS wobble beyond the cover radius, not a street.
 *
 * With [apart], what lies the other side of a toll road from a pattern
 * doesn't cover it: each side of a split road is a street of its own, drawn
 * (10 and 12 both ways up Yos Sudarso, under the Tanjung Priok toll).
 */
export function dedupePatterns(patterns: readonly LngLat[][], apart?: KeptApart): LngLat[][] {
  const sorted = [...patterns].filter(p => p.length >= 2).sort((a, b) => lengthM(b) - lengthM(a))
  const cells: Cover = new Map()
  const pieces: LngLat[][] = []
  for (const pattern of sorted) {
    // A segment is fresh when any point along it is uncovered.
    const fresh = pattern.slice(1).map((to, i) => {
      const heading = headingOf(pattern[i]!, to)
      return sampleAlong([pattern[i]!, to], SAMPLE_STEP_M).some(s => !isCovered(cells, s, 1, heading, apart))
    })

    const runs: LngLat[][] = []
    let start = -1
    for (let i = 0; i <= fresh.length; i++) {
      if (i < fresh.length && fresh[i]) {
        if (start < 0) start = i
      } else if (start >= 0) {
        // Segments start..i-1 span vertices start..i.
        runs.push(pattern.slice(Math.max(0, start - 1), Math.min(pattern.length, i + 2)))
        start = -1
      }
    }
    for (const run of runs) {
      if (lengthM(run) < MIN_PIECE_M) continue
      const heading = headingOf(run[0]!, run[run.length - 1]!)
      if (sampleAlong(run, SAMPLE_STEP_M).every(s => isCovered(cells, s, CARRIAGEWAY_RINGS, heading, apart))) continue
      pieces.push(run)
      markCovered(cells, run)
    }
  }
  return pieces
}

// ── inputs ──────────────────────────────────────────────────────────────────

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

function loadFeed(file: string): Record<string, string>[] {
  return parseCSV(fs.readFileSync(`${FEED_DIR}/${file}`, 'utf-8'))
}

/** The coordinate CSV, minus its `#` comments and blank (unmeasured) rows. */
export function parseRailCoords(text: string): [string, number, number][] {
  const out: [string, number, number][] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('id,')) continue
    const [id, lat, lng] = line.split(',')
    if (!id || !lat || !lng) continue
    if (id.startsWith('TJ-')) continue
    out.push([id, round5(Number(lng)), round5(Number(lat))])
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

// ── build ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!fs.existsSync(FEED_DIR)) {
    console.error(`No TJ feed at ${FEED_DIR}. Extract the GTFS zip there first, as generateTJSQL needs.`)
    process.exit(1)
  }

  const routes = loadFeed('routes.txt').filter(r => SCOPE[r.route_desc!])
  const routeById = new Map(routes.map(r => [r.route_id!, r]))

  const stopById = new Map(loadFeed('stops.txt').map(s => [s.stop_id!, s]))
  const collapse = (id: string): string => stopById.get(id)?.parent_station || id
  /** [id]'s own coordinate when it is a platform set apart from its halte's, else null. */
  const platformOf = (id: string): LngLat | null => {
    const s = stopById.get(id)
    const parent = s?.parent_station ? stopById.get(s.parent_station) : undefined
    if (!s || !parent || !s.stop_lon || !parent.stop_lon) return null
    const at: LngLat = [round6(Number(s.stop_lon)), round6(Number(s.stop_lat))]
    return lengthM([at, [Number(parent.stop_lon), Number(parent.stop_lat)]]) > PLATFORM_APART_M ? at : null
  }

  const tripsByRoute = new Map<string, { tripId: string, shapeId: string }[]>()
  for (const t of loadFeed('trips.txt')) {
    if (!routeById.has(t.route_id!)) continue
    const list = tripsByRoute.get(t.route_id!) ?? []
    list.push({ tripId: t.trip_id!, shapeId: t.shape_id ?? '' })
    tripsByRoute.set(t.route_id!, list)
  }
  const inScopeTrips = new Set([...tripsByRoute.values()].flat().map(t => t.tripId))

  const stopsByTrip = new Map<string, { seq: number, stop: string }[]>()
  const platformsByTrip = new Map<string, string[]>()
  for (const row of loadFeed('stop_times.txt')) {
    if (!inScopeTrips.has(row.trip_id!)) continue
    const list = stopsByTrip.get(row.trip_id!) ?? []
    list.push({ seq: Number(row.stop_sequence), stop: collapse(row.stop_id!) })
    stopsByTrip.set(row.trip_id!, list)
    const ids = platformsByTrip.get(row.trip_id!) ?? []
    ids.push(row.stop_id!)
    platformsByTrip.set(row.trip_id!, ids)
  }

  const wantedShapes = new Set([...tripsByRoute.values()].flat().map(t => t.shapeId).filter(Boolean))
  const rawShapes = new Map<string, { seq: number, point: LngLat }[]>()
  for (const p of loadFeed('shapes.txt')) {
    if (!wantedShapes.has(p.shape_id!)) continue
    const list = rawShapes.get(p.shape_id!) ?? []
    list.push({ seq: Number(p.shape_pt_sequence), point: [Number(p.shape_pt_lon), Number(p.shape_pt_lat)] })
    rawShapes.set(p.shape_id!, list)
  }
  const shapes = new Map<string, LngLat[]>()
  for (const [id, list] of rawShapes) {
    shapes.set(id, list.sort((a, b) => a.seq - b.seq).map(p => p.point))
  }

  const lines: BusMapLine[] = []
  const feed: BusMapFeed = { lines: [] }
  const haltes: BusMap['haltes'] = {}
  const noShape: string[] = []
  let patternCount = 0
  let keptCount = 0

  for (const route of routes) {
    const trips = tripsByRoute.get(route.route_id!) ?? []

    const patterns = trips.map(t => shapes.get(t.shapeId)).filter((s): s is LngLat[] => !!s)
    const kept = dedupePatterns(patterns)
    patternCount += patterns.length
    keptCount += kept.length
    if (kept.length === 0) noShape.push(route.route_short_name!)

    // Stops: the longest pattern's order first, then whatever the others add.
    const sequences = trips
      .map(t => (stopsByTrip.get(t.tripId) ?? []).sort((a, b) => a.seq - b.seq).map(s => s.stop))
      .sort((a, b) => b.length - a.length)
    const stops: string[] = []
    const seen = new Set<string>()
    for (const sequence of sequences) {
      for (const stop of sequence) {
        if (seen.has(stop)) continue
        const s = stopById.get(stop)
        if (!s?.stop_lat || !s.stop_lon) continue
        seen.add(stop)
        stops.push(stop)
        haltes[stop] ??= [s.stop_name!.trim(), round5(Number(s.stop_lon)), round5(Number(s.stop_lat))]
      }
    }

    const platforms = [...new Set(trips.flatMap(t => platformsByTrip.get(t.tripId) ?? []))].sort()
      .flatMap((id) => {
        const at = platformOf(id)
        return at ? [at] : []
      })
    feed.lines.push({ code: route.route_short_name!, shapes: feedShapes(trips.map(t => t.shapeId), shapes), ...(platforms.length > 0 ? { platforms } : {}) })
    lines.push({
      code: route.route_short_name!,
      name: route.route_long_name!.trim(),
      kind: SCOPE[route.route_desc!]!,
      color: `#${(route.route_color || '888888').toUpperCase()}`,
      shapes: kept.map(p => encodePolyline(simplify(p, SIMPLIFY_M))),
      // Laid onto the roads once the koridors are on their topology (alongRoads).
      drawn: [],
      stops
    })
  }

  lines.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  const normal = alongTopology(lines, haltes, tripsOf(feed))
  const sortedHaltes = Object.fromEntries(Object.entries(normal.haltes).sort(([a], [b]) => a.localeCompare(b)))
  const rail = parseRailCoords(fs.readFileSync(COORDS_CSV, 'utf-8'))

  const onRoads = await alongRoads(normal.lines, sortedHaltes, platformsOf(feed))
  const edges = await bundleShapes(onRoads.lines, onRoads.roads, sortedHaltes)
  const stopMarks = marksFor(edges, onRoads.lines, sortedHaltes)
  const map: BusMap = { attribution: ATTRIBUTION, lines: onRoads.lines, edges, stopMarks, haltes: sortedHaltes, rail }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(map) + '\n')
  feed.lines.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  fs.writeFileSync(FEED_OUTPUT_PATH, JSON.stringify(feed) + '\n')

  const brt = lines.filter(l => l.kind === 'BRT').length
  console.log(`Wrote ${OUTPUT_PATH}, ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0)} KB`)
  console.log(`  lines:    ${lines.length} (${brt} BRT, ${lines.length - brt} Angkutan Umum Integrasi)`)
  console.log(`  patterns: ${patternCount} in the feed, drawn as ${keptCount} pieces`)
  console.log(`  edges:    ${edges.length}`)
  console.log(`  haltes:   ${Object.keys(sortedHaltes).length}`)
  console.log(`  rail:     ${rail.length} stations`)
  if (noShape.length > 0) console.warn(`  ${noShape.length} line(s) with no shape in the feed: ${noShape.join(', ')}`)
}

/**
 * The lines' network: what both `main` and `--rebundle` write. Which lines
 * share which street comes from their `shapes`, not the roads: a road-exact
 * line carries every slip road, U-turn lane and split carriageway of OSM, and
 * the network shattered into stubs where lines part for a few metres (1,939
 * edges against 1,193). The network's own edges are then laid onto the roads,
 * so the bundles sit on the streets all the same (laidOnRoads).
 *
 * Each line once along a street first, as the feed's patterns are: a koridor
 * redrawn up one carriageway and back down the other (6 on Rasuna Said) is one
 * line on the map, two only where its ways part (a loop to turn).
 */
async function bundleShapes(lines: readonly BusMapLine[], roads: Roads, haltes: BusMap['haltes']): Promise<BusMapEdge[]> {
  const drawn = lines.filter(l => isDrawn(l.code))
  const order: OrderReport = { local: 0, exact: 0, components: 0, fallbacks: 0 }
  // A road split by a toll road between its sides is two streets, each drawn (Yos Sudarso at Walikota).
  const keptApart = (a: [number, number], b: [number, number], heading: [number, number]): boolean => roads.motorwayBetween(a, b, heading)
  const edges = await bundle(drawn.map(l => ({ code: l.code, kind: l.kind, color: l.color, pieces: dropBypasses(dedupePatterns(l.shapes.map(s => decodePolyline(s)), keptApart), keptApart) })), order, keptApart)
  console.log(`  line order: crossings cost ${order.exact} solved exactly (local search: ${order.local}), ${order.components} component(s)`)
  if (order.fallbacks > 0) console.warn(`  ${order.fallbacks} component(s) unsolved in time, local order kept`)
  const brt = new Set(lines.filter(l => l.kind === 'BRT').map(l => l.code))
  const corners: CornerTally = { eased: 0, junctions: 0, squeezed: 0, folded: 0 }
  const laying = { unlaid: 0 }
  // Each line's haltes, where a barb isn't one: the line turns round there.
  const stopsOf = new Map(lines.map(l => [l.code, l.stops.flatMap((code) => {
    const halte = haltes[code]
    return halte ? [[halte[1], halte[2]] as LngLat] : []
  })]))
  const laid = laidOnRoads(edges, roads, brt, corners, strokeKeys(lines), laying, stopsOf)
  console.log(`  corners:    ${corners.eased} eased into one bend, ${corners.junctions} turned at a node, ${corners.squeezed} narrower than their radius (${corners.folded} folding a bundle)`)
  if (laying.unlaid > 0) console.log(`  roads:      ${laying.unlaid} edge(s) kept to their own way, laid onto a road beside it`)
  return laid
}

/**
 * The network's edges laid onto the roads: each edge's way along them, between
 * its two ends, and each end (a junction several edges meet at) onto the road
 * nearest it once, the same point for every edge there, so they go on meeting.
 */
function laidOnRoads(
  edges: readonly BusMapEdge[],
  roads: Roads,
  brt: ReadonlySet<string>,
  corners: CornerTally,
  strokeOf: ReadonlyMap<string, string>,
  laying: { unlaid: number },
  stopsOf: ReadonlyMap<string, readonly LngLat[]>
): BusMapEdge[] {
  // A bundle's width, for the radius it turns on, is its strokes, 13, 13E and L13E being one.
  const strokes = (edge: BusMapEdge): string[] => [...new Set(edge.lines.map(l => strokeOf.get(l) ?? l))]
  const nodes = new Map<string, LngLat>()
  const node = (p: LngLat): LngLat => {
    const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`
    let snapped = nodes.get(key)
    if (!snapped) {
      snapped = snapPoint(p, roads)
      nodes.set(key, snapped)
    }
    return snapped
  }
  // Corners rounded last, on the simplified line, so a corner is a real turn and not a wobble: each
  // edge's tight bends eased to one first, then the corners at nodes, then the rest along each edge.
  const eased = edges.map((edge) => {
    const pts = decodePolyline(edge.shape)
    if (pts.length < 2) return pts
    const inner = snapToRoads(pts, roads, { brt: edge.lines.some(l => brt.has(l)), anyWay: true })
    const ends = [node(pts[0]!), node(pts[pts.length - 1]!)] as const
    let laid = [ends[0], ...inner.slice(1, -1), ends[1]]
    // Laid much longer than it runs is laid onto a road beside it: koridor 1's 8 m link between two
    // nodes at CSW took its middle onto the carriageway 20 m west, a V off the junction. Its own way
    // then, between its laid ends.
    if (lengthM(laid) > lengthM(pts) * LAID_STRETCH + LAID_SLACK_M) {
      laid = [ends[0], ...pts.slice(1, -1), ends[1]]
      laying.unlaid++
    }
    const stops = edge.lines.flatMap(l => stopsOf.get(l) ?? [])
    return easeCorners(simplify(trimBarbs(laid, stops), SIMPLIFY_M), strokes(edge).length, corners)
  })
  const joined = roundJunctions(eased.map((path, i) => ({ path, lines: strokes(edges[i]!) })), corners)
  return edges.map((edge, i) => {
    const path = joined[i]!
    if (path.length < 2) return edge
    return { ...edge, shape: encodePolyline(filletCorners(path, strokes(edge).length, corners)) }
  })
}

/** Every halte's mark on the network, from the lines calling at it (placeStops). */
function marksFor(edges: readonly BusMapEdge[], lines: readonly BusMapLine[], haltes: BusMap['haltes']): StopMark[] {
  const calling = new Map<string, string[]>()
  for (const line of lines) {
    for (const code of line.stops) calling.set(code, [...(calling.get(code) ?? []), line.code])
  }
  return placeStops(edges, Object.entries(haltes).map(([code, [, lng, lat]]) => ({ code, lng, lat, lines: calling.get(code) ?? [] })), strokeKeys(lines))
}

/**
 * Every line's `drawn`: its `shapes` laid onto the roads themselves
 * (busMapRoads.ts), the feed's loose points onto the carriageway and its corners
 * onto the road's. Kept beside `shapes` rather than over them, so a re-run lays
 * the same shapes onto the same roads and changes nothing. The roads come back
 * too, for the network's edges.
 */
async function alongRoads(
  lines: readonly BusMapLine[],
  haltes: BusMap['haltes'],
  platforms: ReadonlyMap<string, LngLat[]> = new Map()
): Promise<{ lines: BusMapLine[], roads: Roads }> {
  const roads = await loadRoads(lines.flatMap(l => l.shapes.map(s => decodePolyline(s))))
  return {
    lines: lines.map((l) => {
      // Out-and-back excursions taken out, as street zoom draws these (dropRetraces): 9 north past Cawang.
      const stops = l.stops.flatMap(code => (haltes[code] ? [[haltes[code][1], haltes[code][2]] as LngLat] : []))
      const lay = (s: string): string => {
        const laid = dropRetraces(snapToRoads(decodePolyline(s), roads, { brt: l.kind === 'BRT', stops, platforms: platforms.get(l.code), koridor: koridorOf(l.code) }), stops)
        const smooth = smoothPath(cutLoops(laid, DRAWN_LOOP_M), DRAWN_SMOOTH_M)
        return encodePolyline(simplifyBends(smooth, DRAWN_SIMPLIFY_M, DRAWN_BEND_M, DRAWN_BEND_DEG), DRAWN_PRECISION)
      }
      return { ...l, drawn: l.shapes.map(lay) }
    }),
    roads
  }
}

/** The TransJakarta koridors of the routing topology (poster overrides over the feed's), as halte runs. */
function tjTopology(): TopologyLine[] {
  return TOPOLOGY
    .filter(t => t.operator === 'TJ')
    .map(t => ({
      code: t.lineCode,
      // Without a pathReverse the way back is the path run backwards, as the routing graph mirrors it (3).
      runs: [t.path, t.pathReverse ?? [...t.path].reverse()].map(run => run.map(s => s.station)),
      via: VIA[t.lineCode]
    }))
}

/*
 * Waypoints for koridor stretches the shapes can't tell, where the way the street
 * search would take isn't the bus's. Keyed by koridor, then `from->to` halte
 * codes. Checked on the ground; add one only when you know the street. (6 from
 * Galunggung onto Rasuna Said by Jl. Gembira needs none: it comes from its feed
 * trip that way, alongTopology's trips.)
 *
 * 2 and 3 turn at Monumen Nasional round the Arjuna Wijaya fountain at the foot of
 * Medan Merdeka Barat, its busway ring (per the user, 2026-11-22): on south past
 * the halte, round the ring's south side, and 3 back up Medan Merdeka Barat, 2 off
 * the ring's west side across onto Medan Merdeka Selatan for Balai Kota. Only 3's
 * round trips run it in the feed; 2's trips out turn straight onto Merdeka Selatan.
 */
const FOUNTAIN_SOUTH: LngLat = [106.82289, -6.18088]
const FOUNTAIN_WEST: LngLat = [106.82263, -6.18063]
const FOUNTAIN_TO_SELATAN: LngLat = [106.82291, -6.18036]
const VIA: Record<string, Record<string, LngLat[]>> = {
  '2': { 'H00131P->H00006P': [FOUNTAIN_SOUTH, FOUNTAIN_WEST, FOUNTAIN_TO_SELATAN] },
  '3': { 'H00131P->H00170P': [FOUNTAIN_SOUTH] }
}

/**
 * Each koridor with a topology redrawn along it, its reroutes gone, and its
 * haltes those of its runs (busMapTopology.ts). A halte no line calls at any
 * more (one only a reroute served) goes too.
 *
 * Redrawn until it settles: a koridor borrows stretches of the others, which
 * the same pass redraws, so a second pass can still move a stretch a little;
 * the third finds nothing left to move. So `--rebundle` run again on its own
 * output changes nothing.
 */
export function alongTopology(
  lines: readonly BusMapLine[],
  haltes: BusMap['haltes'],
  trips: ReadonlyMap<string, LngLat[][]> = new Map(),
  topology: readonly TopologyLine[] = tjTopology()
): { lines: BusMapLine[], haltes: BusMap['haltes'] } {
  // The feed's stops, before any redraw: the ones a koridor's topology drops mark its reroutes.
  const feedStops = new Map(lines.map(l => [l.code, l.stops]))
  let out: BusMapLine[] = [...lines]
  for (let pass = 0; pass < ALIGN_PASSES; pass++) {
    const aligned = alignToTopology(
      out.map(l => ({ code: l.code, pieces: l.shapes.map(s => decodePolyline(s)), stops: feedStops.get(l.code), feed: trips.get(l.code) })),
      haltes,
      topology
    )
    if (pass === 0 && aligned.straight.length > 0) {
      console.warn(`  ${aligned.straight.length} halte pair(s) no shape runs between, drawn straight: ${aligned.straight.join(', ')}`)
    }
    const next = out.map((l) => {
      const stops = aligned.stops.get(l.code)
      if (!stops) return l
      return { ...l, shapes: aligned.pieces.get(l.code)!.map(p => encodePolyline(simplify(p, SIMPLIFY_M))), stops }
    })
    const settled = next.every((l, i) => l.shapes.join() === out[i]!.shapes.join())
    out = next
    if (settled) break
  }
  // A koridor also keeps the feed's stops it still drives past: temporary haltes the posters leave
  // out (4's Simpang Pramuka B-codes) are real service. A reroute's haltes are off its way now.
  const managed = new Set(topology.map(t => t.code))
  out = out.map((l) => {
    if (!managed.has(l.code)) return l
    const pieces = l.shapes.map(s => decodePolyline(s))
    const kept = (feedStops.get(l.code) ?? []).filter((code) => {
      const halte = haltes[code]
      return !l.stops.includes(code) && halte !== undefined && passesBy(pieces, halte[1], halte[2])
    })
    return kept.length > 0 ? { ...l, stops: [...l.stops, ...kept] } : l
  })
  const called = new Set(out.flatMap(l => l.stops))
  const kept = Object.fromEntries(Object.entries(haltes).filter(([code]) => called.has(code)))
  return { lines: out, haltes: kept }
}

/**
 * `--rebundle`: the koridors redrawn along their topology and the edges rebuilt,
 * from the file's own lines; nothing re-read from the feed.
 */
async function rebundle(): Promise<void> {
  const map = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as BusMap
  const feed = fs.existsSync(FEED_OUTPUT_PATH) ? JSON.parse(fs.readFileSync(FEED_OUTPUT_PATH, 'utf-8')) as BusMapFeed : { lines: [] }
  const normal = alongTopology(map.lines, map.haltes, tripsOf(feed))
  const onRoads = await alongRoads(normal.lines, normal.haltes, platformsOf(feed))
  const edges = await bundleShapes(onRoads.lines, onRoads.roads, normal.haltes)
  const stopMarks = marksFor(edges, onRoads.lines, normal.haltes)
  const out: BusMap = { attribution: map.attribution, lines: onRoads.lines, edges, stopMarks, haltes: normal.haltes, rail: map.rail }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out) + '\n')
  console.log(`Rebundled ${OUTPUT_PATH}, ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0)} KB, ${edges.length} edges`)
  console.log(`  haltes:   ${Object.keys(normal.haltes).length} (was ${Object.keys(map.haltes).length})`)
}

if (require.main === module) {
  const run = process.argv.includes('--rebundle') ? rebundle : main
  run().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
