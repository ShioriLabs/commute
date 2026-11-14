import * as fs from 'node:fs'
import { encodePolyline, simplify, type LngLat } from '../../utils/polyline'
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
 * Re-run after a TJ GTFS import (the feed extracted under file_gtfs/, as
 * generateTJSQL needs it) or a station coordinate change:
 *   pnpm --filter api generate:bus-map
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const COORDS_CSV = `${__dirname}/stations_lat_lng.csv`
const OUTPUT_PATH = `${__dirname}/../../../../web/app/data/bus-map.json`

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
  /** Encoded polylines (Google, precision 5): the pieces that together draw the line once. */
  shapes: string[]
  /** Halte codes the line calls at, in the order of its longest pattern first. */
  stops: string[]
}

export interface BusMap {
  attribution: string
  lines: BusMapLine[]
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

function isCovered(cells: Set<string>, [x, y]: [number, number], rings = 1): boolean {
  const cx = Math.floor(x / COVER_CELL_M)
  const cy = Math.floor(y / COVER_CELL_M)
  for (let dx = -rings; dx <= rings; dx++) {
    for (let dy = -rings; dy <= rings; dy++) {
      if (cells.has(`${cx + dx},${cy + dy}`)) return true
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

function markCovered(cells: Set<string>, coords: readonly LngLat[]): void {
  // Half the sample step, so a drawn piece leaves no gap a sample could fall through.
  for (const [x, y] of sampleAlong(coords, SAMPLE_STEP_M / 2)) cells.add(cellKey(x, y))
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
 */
export function dedupePatterns(patterns: readonly LngLat[][]): LngLat[][] {
  const sorted = [...patterns].filter(p => p.length >= 2).sort((a, b) => lengthM(b) - lengthM(a))
  const cells = new Set<string>()
  const pieces: LngLat[][] = []
  for (const pattern of sorted) {
    // A segment is fresh when any point along it is uncovered.
    const fresh = pattern.slice(1).map((to, i) =>
      sampleAlong([pattern[i]!, to], SAMPLE_STEP_M).some(s => !isCovered(cells, s)))

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
      if (sampleAlong(run, SAMPLE_STEP_M).every(s => isCovered(cells, s, CARRIAGEWAY_RINGS))) continue
      pieces.push(run)
      markCovered(cells, run)
    }
  }
  return pieces
}

// ── inputs ──────────────────────────────────────────────────────────────────

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

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

function main(): void {
  if (!fs.existsSync(FEED_DIR)) {
    console.error(`No TJ feed at ${FEED_DIR}. Extract the GTFS zip there first, as generateTJSQL needs.`)
    process.exit(1)
  }

  const routes = loadFeed('routes.txt').filter(r => SCOPE[r.route_desc!])
  const routeById = new Map(routes.map(r => [r.route_id!, r]))

  const stopById = new Map(loadFeed('stops.txt').map(s => [s.stop_id!, s]))
  const collapse = (id: string): string => stopById.get(id)?.parent_station || id

  const tripsByRoute = new Map<string, { tripId: string, shapeId: string }[]>()
  for (const t of loadFeed('trips.txt')) {
    if (!routeById.has(t.route_id!)) continue
    const list = tripsByRoute.get(t.route_id!) ?? []
    list.push({ tripId: t.trip_id!, shapeId: t.shape_id ?? '' })
    tripsByRoute.set(t.route_id!, list)
  }
  const inScopeTrips = new Set([...tripsByRoute.values()].flat().map(t => t.tripId))

  const stopsByTrip = new Map<string, { seq: number, stop: string }[]>()
  for (const row of loadFeed('stop_times.txt')) {
    if (!inScopeTrips.has(row.trip_id!)) continue
    const list = stopsByTrip.get(row.trip_id!) ?? []
    list.push({ seq: Number(row.stop_sequence), stop: collapse(row.stop_id!) })
    stopsByTrip.set(row.trip_id!, list)
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

    lines.push({
      code: route.route_short_name!,
      name: route.route_long_name!.trim(),
      kind: SCOPE[route.route_desc!]!,
      color: `#${(route.route_color || '888888').toUpperCase()}`,
      shapes: kept.map(p => encodePolyline(simplify(p, SIMPLIFY_M))),
      stops
    })
  }

  lines.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  const sortedHaltes = Object.fromEntries(Object.entries(haltes).sort(([a], [b]) => a.localeCompare(b)))
  const rail = parseRailCoords(fs.readFileSync(COORDS_CSV, 'utf-8'))

  const map: BusMap = { attribution: ATTRIBUTION, lines, haltes: sortedHaltes, rail }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(map) + '\n')

  const brt = lines.filter(l => l.kind === 'BRT').length
  console.log(`Wrote ${OUTPUT_PATH}, ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(0)} KB`)
  console.log(`  lines:    ${lines.length} (${brt} BRT, ${lines.length - brt} Angkutan Umum Integrasi)`)
  console.log(`  patterns: ${patternCount} in the feed, drawn as ${keptCount} pieces`)
  console.log(`  haltes:   ${Object.keys(sortedHaltes).length}`)
  console.log(`  rail:     ${rail.length} stations`)
  if (noShape.length > 0) console.warn(`  ${noShape.length} line(s) with no shape in the feed: ${noShape.join(', ')}`)
}

if (require.main === module) main()
