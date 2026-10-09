import * as fs from 'node:fs'
import { TOPOLOGY, type LineTopology, type Stop } from '../data/topology'
import { haversineMeters } from '../../utils/geo'
import { chainHops, stopLists, type Hop } from '../../utils/edgeChain'

// Emits directed edge rows (both directions per adjacency) for the `edges` table.
// Distance, per pair of consecutive stops, from the first source that has it:
//   1. published chainage, where the topology has cumM on both stops
//   2. traced track length from data/geometry (generateTrackGeometry.ts)
//   3. haversine from the live station lat/lng
// Chainage outranks the trace even though the trace is the truer physical
// length: KCI prices on its own chainage, and the trace runs 2-3% long, which
// is enough to tip a fare over a 10km step — Bogor -> Manggarai is 44.1km of
// chainage (Rp 5,000, as published) but 45.4km of track (Rp 6,000).
// Apply with:
//   wrangler d1 execute commute --local --file=src/db/scripts/edges.sql
const OUTPUT_SQL_PATH = `${__dirname}/edges.sql`
const GEOMETRY_DIR = `${__dirname}/../data/geometry`
const STATIONS_URL = 'https://api.commute.shiorilabs.id/stations'

interface Coord { lat: number, lng: number }

async function loadCoords(): Promise<Map<string, Coord>> {
  const res = await fetch(STATIONS_URL)
  if (!res.ok) throw new Error(`stations fetch failed: ${res.status}`)
  const json = await res.json() as { data: { id: string, latitude: number | null, longitude: number | null }[] }
  const map = new Map<string, Coord>()
  for (const s of json.data) {
    if (s.latitude != null && s.longitude != null) map.set(s.id, { lat: s.latitude, lng: s.longitude })
  }
  return map
}

// Traced track length by unordered station-id pair. Geometry is stored once
// per physical segment, so either direction of an edge finds it.
function loadTrackLengths(): Map<string, number> {
  const lengths = new Map<string, number>()
  for (const file of fs.readdirSync(GEOMETRY_DIR).filter(f => f.endsWith('.geojson'))) {
    const json = JSON.parse(fs.readFileSync(`${GEOMETRY_DIR}/${file}`, 'utf-8')) as {
      features: { properties: { from: string, to: string, lengthM: number } }[]
    }
    for (const { properties: p } of json.features) lengths.set(pairKey(p.from, p.to), p.lengthM)
  }
  return lengths
}

const pairKey = (a: string, b: string): string => [a, b].sort().join('|')
const trackLengths = loadTrackLengths()

const out: string[] = []
const missingCoords = new Set<string>()
const srcCounts: Record<string, number> = {}
// Adjacencies that priced out at 0m between two different stations. A distance
// of 0 means UNMEASURED here, never "no gap", and the multi-criteria planner
// drops its transfer penalty — so a 0m link is free on every axis and the
// engine will happily chain routes nobody would ride. Collected rather than
// thrown on so one run reports every offender.
const zeroLength = new Set<string>()

function distance(line: LineTopology, a: Stop, b: Stop, coords: Map<string, Coord>): { m: number, src: string } {
  if (a.cumM != null && b.cumM != null) {
    return { m: Math.abs(a.cumM - b.cumM), src: 'track' }
  }
  const traced = trackLengths.get(pairKey(`${line.operator}-${a.station}`, `${line.operator}-${b.station}`))
  if (traced != null) return { m: traced, src: 'geometry' }
  const ca = coords.get(`${line.operator}-${a.station}`)
  const cb = coords.get(`${line.operator}-${b.station}`)
  if (ca && cb) return { m: Math.round(haversineMeters(ca.lat, ca.lng, cb.lat, cb.lng)), src: 'haversine' }
  return { m: 0, src: 'unknown' }
}

// One Hop becomes one row, or two when it runs both ways. A bridged hop (see
// Stop.serves) is priced as the track it covers — every stop it runs through —
// so KMO -> GST past Pasar Senen costs the same metres as the two calls it skips.
function emit(line: LineTopology, hop: Hop, coords: Map<string, Coord>): void {
  const { from: a, to: b, via } = hop
  const covered = [a, ...via, b]
  // Unbuilt stops are on the line for display only — emitting an edge here
  // would let the router send people over track that isn't open yet (and with
  // no coordinates the distance would silently come out as 0).
  if (covered.some(s => s.unbuilt)) return
  const aId = `${line.operator}-${a.station}`
  const bId = `${line.operator}-${b.station}`
  if (!coords.has(aId)) missingCoords.add(aId)
  if (!coords.has(bId)) missingCoords.add(bId)
  let m = 0
  for (let i = 1; i < covered.length; i++) {
    const segment = distance(line, covered[i - 1]!, covered[i]!, coords)
    srcCounts[segment.src] = (srcCounts[segment.src] ?? 0) + 1
    if (segment.m === 0) {
      zeroLength.add(`${line.lineCode}: ${line.operator}-${covered[i - 1]!.station} <-> ${line.operator}-${covered[i]!.station} (${segment.src})`)
    }
    m += segment.m
  }
  const pairs = hop.bothWays ? [[aId, bId], [bId, aId]] as const : [[aId, bId]] as const
  for (const [from, to] of pairs) {
    out.push(
      `INSERT OR REPLACE INTO edges (id, lineCode, fromStationId, toStationId, distance, createdAt, updatedAt)`
      + ` VALUES ('${line.lineCode}:${from}->${to}', '${line.lineCode}', '${from}', '${to}', ${m}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
    )
  }
}

function emitChain(line: LineTopology, stops: Stop[], coords: Map<string, Coord>, directed = false): void {
  for (const hop of chainHops(stops)) emit(line, directed ? { ...hop, bothWays: false } : hop, coords)
}

async function main(): Promise<void> {
  const coords = await loadCoords()
  for (const line of TOPOLOGY) {
    if (line.pathReverse) {
      // Asymmetric corridor: each direction carries its own true stop sequence.
      // Emit forward-only edges from `path` and reverse-only edges from
      // `pathReverse`; shared segments produce both directed rows naturally and
      // INSERT OR REPLACE dedupes on the edge id. (Such lines have no branches.)
      // Stop.serves would be a second direction model on the same line, and
      // the two chains here already say which way each stop is served.
      const flagged = [...line.path, ...line.pathReverse].find(s => s.serves)
      if (flagged) throw new Error(`${line.lineCode}: ${flagged.station} sets \`serves\` on a line with pathReverse`)
      emitChain(line, line.path, coords, true)
      emitChain(line, line.pathReverse, coords, true)
      continue
    }

    for (const stops of stopLists(line)) emitChain(line, stops, coords)
  }

  // Refuse before writing, so a bad run can't leave a poisoned edges.sql on
  // disk for someone to apply later.
  if (zeroLength.size > 0) {
    throw new Error(
      `${zeroLength.size} adjacency(ies) priced at 0m between distinct stations:\n`
      + [...zeroLength].map(s => `  ${s}`).join('\n')
      + '\n\nA 0m edge is free on every routing axis. Give these stops coordinates'
      + ' (stations_lat_lng.csv, then `pnpm generate:stationcoords`) or cumM, or'
      + ' mark them `unbuilt` until the track opens.'
    )
  }

  fs.writeFileSync(OUTPUT_SQL_PATH, out.join('\n') + '\n')
  const srcSummary = Object.entries(srcCounts).map(([k, v]) => `${v} ${k}`).join(', ')
  console.log(`Wrote ${out.length} edge rows (${srcSummary} segments) to "${OUTPUT_SQL_PATH}".`)
  if (missingCoords.size > 0) {
    console.warn(`No coordinates for ${missingCoords.size} station(s): ${[...missingCoords].join(', ')}`)
  }
}

main().catch((err) => {
  console.error('An error occurred during edge generation:', err)
  process.exit(1)
})
