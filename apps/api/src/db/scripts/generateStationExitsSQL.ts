import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'

/*
 * Seeds `stationExits` for MRT Jakarta from OpenStreetMap.
 *
 * MRT Jakarta's own site has no exit data (its station CMS carries addresses,
 * facilities and feeder routes, and the "locality map" is one placeholder Google
 * link shared by all 13 stations), so OSM `railway=subway_entrance` nodes are the
 * source, as docs/points-of-interest.md planned.
 *
 * ODbL: the data is (c) OpenStreetMap contributors. Every row is written with
 * source = 'OSM' so it stays identifiable and separable (attribute it, export it
 * or drop it as a set: DELETE FROM stationExits WHERE source = 'OSM').
 *
 * Each entrance goes to the nearest MRTJ station within MAX_DISTANCE_M, labelled
 * by its `ref` (else `name`), as signed. Unlabelled and unmatched nodes are
 * skipped and reported rather than guessed at. A duplicate label at one station
 * aborts the run, since the id is `${stationId}:${ref}`.
 *
 * Idempotent and non-destructive: the upsert only touches rows that are still
 * 'OSM', so a FIELD or OPERATOR row for the same exit is never overwritten, and
 * `name` (hand-written, OSM has no street) is never touched. Run:
 *   pnpm --filter api generate:station-exits [-- --remote]
 *   wrangler d1 execute commute --local --file=src/db/scripts/station_exits_osm_seed.sql
 * Then bump API_VERSION in wrangler.toml. Apply the seed BEFORE the deploy.
 */
const LOCAL = !process.argv.includes('--remote')
const DB_NAME = 'commute'
const OUT = `${__dirname}/station_exits_osm_seed.sql`
const MAX_DISTANCE_M = 250
// Jakarta MRT corridor, Lebak Bulus to Bundaran HI, with margin.
const BBOX = '-6.315,106.76,-6.17,106.84'
const OVERPASS = 'https://overpass-api.de/api/interpreter'

interface Station { id: string, latitude: number, longitude: number }
interface OsmNode { id: number, lat: number, lon: number, tags?: Record<string, string> }

function query<T>(sql: string): T[] {
  const args = ['wrangler', 'd1', 'execute', DB_NAME, LOCAL ? '--local' : '--remote', '--json', '--command', sql]
  const out = execFileSync('npx', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results: T[] }[]
  return parsed[0]!.results
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

const esc = (value: string) => value.replace(/'/g, '\'\'')
const round5 = (degrees: number) => Math.round(degrees * 1e5) / 1e5

async function main() {
  const stations = query<Station>('SELECT id, latitude, longitude FROM stations WHERE operator = \'MRTJ\' AND latitude IS NOT NULL')
  if (stations.length === 0) throw new Error('No MRTJ stations with coordinates in the database')

  const response = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': 'commute-station-exits-generator', 'Accept': 'application/json' },
    body: new URLSearchParams({ data: `[out:json][timeout:60];node["railway"="subway_entrance"](${BBOX});out;` })
  })
  if (!response.ok) throw new Error(`Overpass answered ${response.status}`)
  const { elements } = await response.json() as { elements: OsmNode[] }

  const rows = new Map<string, { stationId: string, ref: string, lat: number, lon: number, osmId: number }>()
  const skipped: string[] = []
  for (const node of elements) {
    const label = (node.tags?.ref ?? node.tags?.name ?? '').trim()
    let nearest = stations[0]!
    let nearestM = Infinity
    for (const station of stations) {
      const m = haversineM(node.lat, node.lon, station.latitude, station.longitude)
      if (m < nearestM) {
        nearest = station
        nearestM = m
      }
    }
    if (nearestM > MAX_DISTANCE_M) {
      skipped.push(`node/${node.id} "${label}" ${Math.round(nearestM)} m from ${nearest.id}: too far`)
      continue
    }
    if (!label) {
      skipped.push(`node/${node.id} ${Math.round(nearestM)} m from ${nearest.id}: no ref or name`)
      continue
    }
    const id = `${nearest.id}:${label}`
    const existing = rows.get(id)
    if (existing) throw new Error(`Duplicate exit ${id}: node/${existing.osmId} and node/${node.id}`)
    rows.set(id, { stationId: nearest.id, ref: label, lat: node.lat, lon: node.lon, osmId: node.id })
  }

  const statements = [...rows.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, r]) =>
      `INSERT INTO stationExits (id, stationId, ref, name, latitude, longitude, source, createdAt, updatedAt) VALUES `
      + `('${esc(id)}', '${r.stationId}', '${esc(r.ref)}', NULL, ${round5(r.lat)}, ${round5(r.lon)}, 'OSM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) `
      + `ON CONFLICT(id) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude, updatedAt = CURRENT_TIMESTAMP `
      + `WHERE stationExits.source = 'OSM';`
    )

  fs.writeFileSync(OUT, [
    '-- MRT Jakarta station exits from OpenStreetMap. Generated by db/scripts/generateStationExitsSQL.ts.',
    '-- (c) OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright',
    '-- source = \'OSM\' on every row; only rows still \'OSM\' are refreshed on re-run.',
    ...statements
  ].join('\n') + '\n')

  const perStation = new Map<string, number>()
  for (const r of rows.values()) perStation.set(r.stationId, (perStation.get(r.stationId) ?? 0) + 1)
  console.log(`station exits: ${rows.size} across ${perStation.size} stations -> ${OUT}`)
  for (const [stationId, count] of [...perStation].sort()) console.log(`  ${stationId}: ${count}`)
  if (skipped.length > 0) console.log(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
