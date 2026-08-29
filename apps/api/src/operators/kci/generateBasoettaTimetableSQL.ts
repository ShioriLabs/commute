import * as fs from 'node:fs'
import * as path from 'node:path'

/*
 * Timetable generator for the Soekarno-Hatta airport line (A), a.k.a. Basoetta.
 *
 * KAI moved this service off the commuter API onto a separate Next.js booking
 * app: `kci.id/api/krl/schedules?stationid=BST` returns 404, and the service is
 * absent from every other line-A station's board too. The live data now only
 * exists at airport-train.kci.id as a React Server Component action.
 *
 * That endpoint is a BOOKING api, not a departure board — it is date-scoped,
 * returns fares and seat availability, and is pinned to a build hash that
 * changes whenever KCI redeploys. It has no business in the live /sync path, so
 * this is an offline generator that emits a committed .sql file for manual
 * review and apply, exactly like the hand-transcribed LRT Jabodebek timetables
 * (operators/lrtjbdb/generateTimetableSQL.ts) which exist for the same reason.
 *
 * Usage:
 *   pnpm --filter api generate:basoetta-timetable
 *   pnpm --filter api generate:basoetta-timetable --date=2026-09-05
 */

const ENDPOINT = 'https://airport-train.kci.id/train-schedule'
const OUTPUT_SQL_PATH = path.resolve(__dirname, '../../db/scripts/kci_basoetta_timetable.sql')

/*
 * Next.js server-action id. This is a BUILD HASH: it changes every time KCI
 * redeploys the booking app, and a stale value makes the endpoint return the
 * page shell with no trips at all rather than an error — which is why main()
 * treats an empty result as fatal instead of writing an empty timetable.
 *
 * Re-grab it from DevTools > Network > train-schedule > Request Headers >
 * next-action.
 */
const NEXT_ACTION = '60d62eb3c0832dc3737b081fa312549ac7c295df27'

/*
 * The API matches on these name strings as well as the station code, and a
 * mismatch returns ZERO TRIPS SILENTLY rather than an error — passing
 * stadestinationcode 'BST' with the wrong name reads exactly like "the airport
 * is not served". Deliberately NOT stations.formattedName: the booking app
 * wants 'bni city' and an unspaced 'batuceper'.
 */
const QUERY_NAMES: Record<string, string> = {
  MRI: 'manggarai',
  SUDB: 'bni city',
  DU: 'duri',
  RW: 'rawa buaya',
  BPR: 'batuceper',
  BST: 'bandara soekarno hatta'
}

// boundFor uses the terminus's display name (stations.formattedName).
const BOUND_FOR: Record<string, string> = {
  BST: 'Bandara Soekarno-Hatta',
  MRI: 'Manggarai'
}

/*
 * A response carries only the ORIGIN departure and the DESTINATION arrival — no
 * intermediate stop times — so a per-station board needs one query per origin.
 * Ten queries cover the whole line in both directions.
 */
const NORTHBOUND_ORIGINS = ['MRI', 'SUDB', 'DU', 'RW', 'BPR'] // -> BST
const SOUTHBOUND_ORIGINS = ['BST', 'BPR', 'RW', 'DU', 'SUDB'] // -> MRI

// Courtesy delay between requests: this is someone's live booking backend.
const REQUEST_DELAY_MS = 400

export interface Trip {
  noka: string
  departure: string
  arrival: string
  fare: number | null
}

export interface ScheduleRow {
  station: string
  terminus: string
  trip: Trip
}

/*
 * The two-element server-action payload. The second element is the empty
 * arrival/depart filter the booking form sends; the endpoint expects both.
 */
export function buildRequestBody(origin: string, destination: string, tripdate: string): string {
  const originName = QUERY_NAMES[origin]
  const destinationName = QUERY_NAMES[destination]
  if (!originName || !destinationName) {
    throw new Error(`No query name for ${!originName ? origin : destination} — see QUERY_NAMES`)
  }

  return JSON.stringify([
    {
      staorigincode: origin,
      stadestinationcode: destination,
      tripdate,
      passengercount: 1,
      staoriginname: `${originName}, jabodetabek`,
      staoriginstation: originName,
      stadestinationname: `${destinationName}, jabodetabek`,
      stadestinationstation: destinationName,
      staregioncode: 'JABO'
    },
    { arrival: [], depart: [] }
  ])
}

/*
 * The response is an RSC flight stream, not JSON: trip objects sit inline among
 * chunk references and cannot be parsed whole. Find each `"noka":"` marker,
 * scan back to the enclosing brace, then forward tracking depth to its match,
 * and parse that slice. Objects repeat across the stream, so dedupe by noka.
 *
 * A slice that fails to parse is skipped rather than fatal — the stream is
 * truncated at the tail often enough that one bad object should not lose the
 * other 34 trips.
 */
export function parseFlightStream(text: string): Trip[] {
  const byNoka = new Map<string, Trip>()

  for (const match of text.matchAll(/"noka":"/g)) {
    const start = text.lastIndexOf('{', match.index)
    if (start === -1) continue

    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i++) {
      const char = text[i]
      if (char === '{') depth++
      else if (char === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      continue
    }

    const noka = parsed.noka
    const departure = parsed.departure
    const arrival = parsed.arrival
    if (typeof noka !== 'string' || typeof departure !== 'string' || typeof arrival !== 'string') continue
    if (byNoka.has(noka)) continue

    const fareLists = parsed.fareLists
    const firstFare = Array.isArray(fareLists) ? fareLists[0] as Record<string, unknown> | undefined : undefined
    const totamount = firstFare?.totamount

    byNoka.set(noka, {
      noka,
      departure,
      arrival,
      fare: typeof totamount === 'number' ? totamount : null
    })
  }

  return [...byNoka.values()]
}

/*
 * The feed gives 'HHMM'; schedules stores 'HH:MM:SS'. The zero-padded hour is
 * load-bearing rather than cosmetic: timetables sort lexically on
 * estimatedDeparture, so an unpadded '6:18:00' sorts after the 11pm departures.
 */
export function normalizeTime(raw: string): string | null {
  const match = raw.trim().match(/^([01]\d|2[0-3])([0-5]\d)$/)
  if (!match?.[1] || !match[2]) return null
  return `${match[1]}:${match[2]}:00`
}

const esc = (value: string): string => value.replace(/'/g, '\'\'')

/*
 * Emits one file for the whole line. Per station: clear the rows this file owns,
 * insert the fresh set, then flag the station synced.
 *
 * The DELETE is scoped by stationId AND lineCode. These stations also carry
 * Cikarang/Tangerang/Rangkasbitung rows written by the ordinary KCI sync, and a
 * station-wide delete would take those with it.
 */
export function buildTimetableSQL(rows: ScheduleRow[], tripdate: string): string {
  const byStation = new Map<string, ScheduleRow[]>()
  for (const row of rows) {
    const existing = byStation.get(row.station) ?? []
    existing.push(row)
    byStation.set(row.station, existing)
  }

  const blocks: string[] = []
  for (const [station, stationRows] of byStation) {
    const stationId = `KCI-${station}`
    const values = stationRows
      .slice()
      .sort((a, b) => a.trip.departure.localeCompare(b.trip.departure))
      .map((row) => {
        const departure = normalizeTime(row.trip.departure)
        const arrival = normalizeTime(row.trip.arrival)
        const boundFor = BOUND_FOR[row.terminus]!
        return `  ('${esc(`${stationId}-${row.trip.noka}`)}', '${esc(stationId)}', '${esc(row.trip.noka)}',`
          + ` '${departure}', '${arrival}', '${esc(boundFor)}', 'A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      })

    blocks.push(
      `-- ${stationId}: ${stationRows.length} departures\n`
      + `DELETE FROM schedules WHERE stationId = '${esc(stationId)}' AND lineCode = 'A';\n`
      + 'INSERT INTO schedules (id, stationId, tripNumber, estimatedDeparture, estimatedArrival, boundFor, lineCode, createdAt, updatedAt) VALUES\n'
      + values.join(',\n') + ';\n'
      + `UPDATE stations SET timetableSynced = 1 WHERE id = '${esc(stationId)}';\n`
    )
  }

  const header
    = '-- Soekarno-Hatta line (A) timetable — GENERATED, do not edit by hand.\n'
      + '-- Source: airport-train.kci.id server action (the commuter API no longer\n'
      + '-- carries this service). Regenerate with:\n'
      + '--   pnpm --filter api generate:basoetta-timetable\n'
      + `-- Captured from trip date ${tripdate}; stored as a plain daily board.\n`
      + '--\n'
      + '-- Apply:\n'
      + '--   wrangler d1 execute commute --local  --file=src/db/scripts/kci_basoetta_timetable.sql\n'
      + '--   wrangler d1 execute commute --remote --file=src/db/scripts/kci_basoetta_timetable.sql\n\n'

  return header + blocks.join('\n')
}

export function resolveTripDate(argv: string[], today = new Date()): string | { error: string } {
  const flag = argv.find(arg => arg.startsWith('--date='))
  if (!flag) {
    // Two days out: today's early departures have already gone, and the booking
    // app stops selling same-day seats close to departure.
    const target = new Date(today)
    target.setDate(target.getDate() + 2)
    return target.toISOString().slice(0, 10)
  }

  const value = flag.slice('--date='.length)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `--date must be YYYY-MM-DD, got "${value}"` }
  }
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    return { error: `--date "${value}" is not a real date` }
  }
  if (value < today.toISOString().slice(0, 10)) {
    return { error: `--date "${value}" is in the past; the booking app only sells forward` }
  }
  return value
}

async function fetchTrips(origin: string, destination: string, tripdate: string): Promise<Trip[]> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Accept': 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Origin': 'https://airport-train.kci.id',
      'Referer': ENDPOINT,
      'User-Agent': 'Mozilla/5.0',
      'next-action': NEXT_ACTION
    },
    body: buildRequestBody(origin, destination, tripdate)
  })

  if (!response.ok) throw new Error(`${origin}->${destination}: HTTP ${response.status}`)
  return parseFlightStream(await response.text())
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const tripdate = resolveTripDate(process.argv.slice(2))
  if (typeof tripdate !== 'string') {
    console.error(tripdate.error)
    process.exit(1)
  }

  const queries = [
    ...NORTHBOUND_ORIGINS.map(origin => ({ origin, destination: 'BST' })),
    ...SOUTHBOUND_ORIGINS.map(origin => ({ origin, destination: 'MRI' }))
  ]

  const rows: ScheduleRow[] = []
  const errors: string[] = []
  const fareMatrix: string[] = []
  const countsByDirection = new Map<string, Set<number>>()

  console.log(`Trip date ${tripdate}; ${queries.length} queries.\n`)

  for (const [index, { origin, destination }] of queries.entries()) {
    if (index > 0) await sleep(REQUEST_DELAY_MS)

    let trips: Trip[]
    try {
      trips = await fetchTrips(origin, destination, tripdate)
    } catch (error) {
      errors.push(`${origin}->${destination}: ${(error as Error).message}`)
      continue
    }

    if (trips.length === 0) {
      errors.push(`${origin}->${destination}: no trips returned`)
      continue
    }

    for (const trip of trips) {
      if (!normalizeTime(trip.departure) || !normalizeTime(trip.arrival)) {
        errors.push(`${origin}->${destination} ${trip.noka}: unparseable time (dep "${trip.departure}", arr "${trip.arrival}")`)
      }
    }

    const sorted = trips.slice().sort((a, b) => a.departure.localeCompare(b.departure))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.departure <= sorted[i - 1]!.departure) {
        console.warn(`  ${origin}->${destination}: ${sorted[i]!.noka} at ${sorted[i]!.departure} does not follow ${sorted[i - 1]!.departure}`)
      }
    }

    const counts = countsByDirection.get(destination) ?? new Set<number>()
    counts.add(trips.length)
    countsByDirection.set(destination, counts)

    const fares = [...new Set(trips.map(trip => trip.fare).filter(fare => fare !== null))]
    fareMatrix.push(`  ${origin}->${destination}  ${String(trips.length).padStart(2)} trips  fare ${fares.join('/') || 'n/a'}`)
    console.log(`  ${origin}->${destination}: ${trips.length} trips`)

    for (const trip of trips) rows.push({ station: origin, terminus: destination, trip })
  }

  for (const [destination, counts] of countsByDirection) {
    if (counts.size > 1) {
      errors.push(`->${destination} queries disagree on trip count (${[...counts].sort((a, b) => a - b).join(' vs ')})`)
    }
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`)
    for (const error of errors) console.error(`  ${error}`)
    console.error(
      '\nNothing written. If every query came back empty, the next-action build hash'
      + '\nis almost certainly stale — re-grab it from DevTools > Network >'
      + '\ntrain-schedule > Request Headers > next-action and update NEXT_ACTION.'
    )
    process.exit(1)
  }

  fs.writeFileSync(OUTPUT_SQL_PATH, buildTimetableSQL(rows, tripdate))

  const stations = new Set(rows.map(row => row.station))
  console.log(`\nWrote ${rows.length} rows across ${stations.size} stations to "${OUTPUT_SQL_PATH}".`)
  console.log('\nFare matrix (logged only — schedules has no fare column):')
  for (const line of fareMatrix) console.log(line)
}

if (require.main === module) {
  main().catch((error) => {
    console.error('An error occurred during timetable generation:', error)
    process.exit(1)
  })
}
