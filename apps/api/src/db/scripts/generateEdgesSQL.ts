import * as fs from 'node:fs'
import { TOPOLOGY, type LineTopology, type Stop } from '../data/topology'
import { haversineMeters } from '../../utils/geo'

// Emits directed edge rows (both directions per adjacency) for the `edges` table.
// Distance = real track km where the topology has cumulative km on both stops,
// else haversine from the live station lat/lng. Apply with:
//   wrangler d1 execute commute --local --file=src/db/scripts/edges.sql
const OUTPUT_SQL_PATH = `${__dirname}/edges.sql`
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

const out: string[] = []
const missingCoords = new Set<string>()

function distance(line: LineTopology, a: Stop, b: Stop, coords: Map<string, Coord>): { m: number, src: string } {
  if (a.cumM != null && b.cumM != null) {
    return { m: Math.abs(a.cumM - b.cumM), src: 'track' }
  }
  const ca = coords.get(`${line.operator}-${a.station}`)
  const cb = coords.get(`${line.operator}-${b.station}`)
  if (ca && cb) return { m: Math.round(haversineMeters(ca.lat, ca.lng, cb.lat, cb.lng)), src: 'haversine' }
  return { m: 0, src: 'unknown' }
}

function emit(line: LineTopology, a: Stop, b: Stop, coords: Map<string, Coord>): void {
  const aId = `${line.operator}-${a.station}`
  const bId = `${line.operator}-${b.station}`
  if (!coords.has(aId)) missingCoords.add(aId)
  if (!coords.has(bId)) missingCoords.add(bId)
  const { m, src } = distance(line, a, b, coords)
  for (const [from, to] of [[aId, bId], [bId, aId]] as const) {
    out.push(
      `INSERT OR REPLACE INTO edges (id, lineCode, fromStationId, toStationId, distance, createdAt, updatedAt)`
      + ` VALUES ('${line.lineCode}:${from}->${to}', '${line.lineCode}', '${from}', '${to}', ${m}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP); -- ${src}`
    )
  }
}

function emitChain(line: LineTopology, stops: Stop[], coords: Map<string, Coord>): void {
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (a && b) emit(line, a, b, coords)
  }
}

async function main(): Promise<void> {
  const coords = await loadCoords()
  for (const line of TOPOLOGY) {
    const byCode = new Map<string, Stop>()
    for (const s of line.path) byCode.set(s.station, s)
    for (const b of line.branches ?? []) for (const s of b.path) byCode.set(s.station, s)

    emitChain(line, line.path, coords)

    for (const br of line.branches ?? []) {
      const junction = byCode.get(br.fromStation)
      const first = br.path[0]
      if (junction && first) emit(line, junction, first, coords)
      emitChain(line, br.path, coords)
      const last = br.path[br.path.length - 1]
      if (br.closeTo && last) {
        const close = byCode.get(br.closeTo)
        if (close) emit(line, last, close, coords)
      }
    }
  }

  fs.writeFileSync(OUTPUT_SQL_PATH, out.join('\n') + '\n')
  console.log(`Wrote ${out.length} edge rows to "${OUTPUT_SQL_PATH}".`)
  if (missingCoords.size > 0) {
    console.warn(`No coordinates for ${missingCoords.size} station(s): ${[...missingCoords].join(', ')}`)
  }
}

main().catch((err) => {
  console.error('An error occurred during edge generation:', err)
  process.exit(1)
})
