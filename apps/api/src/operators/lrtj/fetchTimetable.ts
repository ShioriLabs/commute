import * as fs from 'node:fs'
import * as path from 'node:path'
import { expectedHeader, KA_PARITY } from 'operators/lrtj/generateTimetableSQL'

/*
 * API -> CSV for the LRT Jakarta Lin Selatan timetable. Replaces the printed
 * poster as the source: the website's own schedule query now returns every
 * train's full run as `stop_detail`, and its times are the ones in service
 * (they differ from the 17 Sep 2026 poster: 12 min headways, runs to 22:00).
 *
 * Writes the same ./timetables/S_<DEST>.csv files generateTimetableSQL.ts
 * reads, so its validation (header, contiguous calls, run-time modes) still
 * gates the data. See ./timetables/README.md.
 *
 * The API has no train numbers, so each trip gets a SYNTHETIC KA: 2000 + 2n
 * (Manggarai-bound, even) / 2001 + 2n (Kelapa Gading-bound, odd), n being the
 * trip's order in the day. It only has to be unique and stable within one
 * fetch; the 1xxx range stays the poster's, so the two never collide.
 */

const ENDPOINT = 'https://www.lrtjakarta.co.id/api/schedules/get'
const OUTPUT_DIR = path.join(__dirname, 'timetables')
const SYNTHETIC_KA_BASE = 2000

// The API's opaque ids -> our codes (timetables/README.md).
export const STATION_IDS: Record<string, string> = {
  O6PpoaxXR8: 'PGD',
  '63zpjAqWLe': 'BVU',
  Kre96Z9B5D: 'BVS',
  oJQxvy93rY: 'PUM',
  KAVp3P97ry: 'EQS',
  RnAx41q5G1: 'VEL',
  LPDxKkxBor: 'RWM',
  lZQpDA9kyK: 'PKA',
  zXl98Mx2Mk: 'KYM',
  Jj59kaqwnO: 'MAT',
  DBN9nAp5nJ: 'MGI'
}
const ID_OF = Object.fromEntries(Object.entries(STATION_IDS).map(([id, code]) => [code, id]))

// Stations the API lists but trains do not actually call at yet (the station
// is not open: the entrance stairs are unfinished). Written as `Ls`.
export const NOT_CALLING = new Set(['KYM', 'MAT'])

interface ApiStop { id: string, start_at: string | null, arrival_at: string | null }
export interface ApiTrip { time_at: string, stop_detail: ApiStop[] }

const unpad = (time: string): string => time.replace(/^0/, '')

/*
 * One CSV row per trip. A stop's cell is its departure (`start_at`); the
 * terminus has none, so it prints its arrival, which the generator validates
 * and drops. Stops the trip does not visit are `-`.
 */
export function tripsToCsv(dest: string, trips: ApiTrip[]): string {
  const header = expectedHeader(dest)
  const stations = header.slice(2)
  const lines = [header.join(',')]
  for (const [n, trip] of trips.entries()) {
    const cells = new Map<string, string>()
    for (const stop of trip.stop_detail) {
      const code = STATION_IDS[stop.id]
      if (!code) throw new Error(`unknown station id ${stop.id} in trip ${trip.time_at}`)
      const time = stop.start_at ?? stop.arrival_at
      if (!time) throw new Error(`${code} has no time in trip ${trip.time_at}`)
      cells.set(code, unpad(time))
    }
    const ka = SYNTHETIC_KA_BASE + 2 * n + KA_PARITY[dest]!
    lines.push([ka, n + 1, ...stations.map(s => (NOT_CALLING.has(s) ? 'Ls' : cells.get(s) ?? '-'))].join(','))
  }
  return lines.join('\n') + '\n'
}

async function query(from: string, to: string): Promise<ApiTrip[]> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ src_station_id: ID_OF[from], dst_station_id: ID_OF[to] })
  })
  if (!response.ok) throw new Error(`${from}->${to}: HTTP ${response.status}`)
  const body = await response.json() as { data?: ApiTrip[] }
  if (!body.data?.length) throw new Error(`${from}->${to}: no trips`)
  return body.data
}

async function main(): Promise<void> {
  // The end-to-end query returns every train's full run (checked 2026-11-11:
  // every MGI arrival from a mid-line origin is also an end-to-end trip).
  const workings: [dest: string, from: string, to: string][] = [['MGI', 'PGD', 'MGI'], ['PGD', 'MGI', 'PGD']]
  for (const [dest, from, to] of workings) {
    const trips = await query(from, to)
    fs.writeFileSync(path.join(OUTPUT_DIR, `S_${dest}.csv`), tripsToCsv(dest, trips))
    console.log(`S_${dest}.csv: ${trips.length} trips (${trips[0]!.time_at}-${trips.at(-1)!.time_at})`)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
