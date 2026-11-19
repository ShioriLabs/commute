import * as fs from 'node:fs'
import * as path from 'node:path'
import { DAY_MASK_ALL } from 'db/schemas/schedules'
import { chunkArray } from 'utils/chunk'
import { fromFeedStationCode } from '../formatters'
import { APT_CGK_LINE, BOGOR_LINE, CIKARANG_LINE, RANGKASBITUNG_LINE, TANGERANG_LINE, TANJUNG_PRIOK_LINE } from '../lines'

/*
 * KCI timetable for the 1 December 2026 GAPEKA (KP DJKA 116/2026), as SQL.
 *
 * ONE-OFF. The ordinary boards come from a kci.id browser dump
 * (generateTimetableFromDumpSQL) and line A from the booking app
 * (generateBasoettaTimetableSQL); both stay as they are. This reads the
 * published GAPEKA instead, because the new edition lands before either source
 * serves it, and because it is the only place KA Bandara's new Bogor runs exist.
 *
 * Input is the JSON from extract_gapeka.py. Usage:
 *   python3 extract_gapeka.py <gapeka.pdf> gapeka.json 660 1513
 *   pnpm --filter api generate:gapeka-timetable gapeka.json
 *
 * Reading a train's table:
 *   a time          scheduled
 *   Ls (langsung)   the train does not stop; Berangkat is only its pass time
 *   Berh (berhenti) the train stops but the GAPEKA prints no time for it
 * A stop is the origin, the terminus, or any row whose Datang is a time or Berh.
 * The unprinted times are filled by interpolating between the nearest printed
 * ones, the same way a rider would estimate them.
 */

const OUTPUT_SQL_PATH = path.resolve(__dirname, '../../../db/scripts/kci_gapeka_timetable.sql')

/** [row number, station code, Datang, Berangkat] */
export type GapekaRow = [number, string, string, string]

export interface GapekaTrip {
  ka: string
  label: string
  from: string
  to: string
  rows: GapekaRow[]
}

export interface GapekaFile {
  source?: string
  trips: GapekaTrip[]
}

const LINE_BY_LABEL: Record<string, string> = {
  'Commuter Line Bogor': BOGOR_LINE.lineCode,
  'Commuter Line Cikarang': CIKARANG_LINE.lineCode,
  'Commuter Line Rangkasbitung': RANGKASBITUNG_LINE.lineCode,
  'Commuter Line Tangerang': TANGERANG_LINE.lineCode,
  'Commuter Line Tanjungpriuk': TANJUNG_PRIOK_LINE.lineCode,
  // The airport train, Bogor runs included: it stays line A, see ka-bandara-routing.
  'Commuter Line BST': APT_CGK_LINE.lineCode,
  // Not lines we model; the kci.id feed stores them as NUL too.
  'Commuter Line Merak': 'NUL',
  'Commuter Line Walahar': 'NUL',
  'Commuter Line Jatiluhur': 'NUL'
}

/** Display name of every terminus a board can be "bound for". */
const TERMINUS_NAMES: Record<string, string> = {
  JAKK: 'Jakarta Kota',
  BOO: 'Bogor',
  DP: 'Depok',
  BJD: 'Bojonggede',
  NMO: 'Nambo',
  MRI: 'Manggarai',
  DU: 'Duri',
  BST: 'Bandara Soekarno-Hatta',
  THB: 'Tanah Abang',
  RK: 'Rangkasbitung',
  PRP: 'Parung Panjang',
  SRP: 'Serpong',
  TGS: 'Tigaraksa',
  MJ: 'Maja',
  TNG: 'Tangerang',
  AK: 'Angke',
  KPB: 'Kampung Bandan',
  CKR: 'Cikarang',
  BKS: 'Bekasi',
  TB: 'Tambun',
  TPK: 'Tanjung Priok',
  MER: 'Merak',
  PWK: 'Purwakarta',
  CKP: 'Cikampek',
  JNG: 'Jatinegara',
  KRI: 'Kranji',
  CC: 'Cicayur'
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
const isTime = (cell: string): boolean => TIME.test(cell)

function toSeconds(cell: string): number {
  const match = TIME.exec(cell)!
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
}

export function formatTime(seconds: number): string {
  const wrapped = ((Math.round(seconds / 60) * 60) % 86400 + 86400) % 86400
  const hours = Math.floor(wrapped / 3600)
  const minutes = Math.floor((wrapped % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

export interface TripStop {
  station: string
  /** Seconds since the trip's service-day midnight; runs past 86400 after midnight. */
  arrival: number
  departure: number
}

/*
 * Every stop of a trip with a time, unprinted ones interpolated by row position
 * between the nearest printed times, and the clock unrolled past midnight.
 */
export function stopsOf(trip: GapekaTrip): TripStop[] {
  const { rows } = trip
  // The best printed time near each row, for interpolation. Arrival is what a
  // later row looks back at, departure what an earlier row looks forward from.
  const printed = rows.map(([, , arrival, departure]) => ({
    arrival: isTime(arrival) ? toSeconds(arrival) : null,
    departure: isTime(departure) ? toSeconds(departure) : null
  }))

  // Unroll midnight: a time that goes backwards is the next day.
  let offset = 0
  let last = -1
  for (const cell of printed) {
    for (const key of ['arrival', 'departure'] as const) {
      const value = cell[key]
      if (value === null) continue
      if (value + offset < last) offset += 86400
      cell[key] = value + offset
      last = value + offset
    }
  }

  const known = (index: number): number | null => printed[index]!.departure ?? printed[index]!.arrival
  const stops: TripStop[] = []

  rows.forEach(([, station, arrivalCell, departureCell], index) => {
    const isEnd = index === 0 || index === rows.length - 1
    if (!isEnd && !isTime(arrivalCell) && arrivalCell !== 'Berh') return

    const { arrival, departure } = printed[index]!
    let at = arrival ?? departure
    if (at === null) {
      let before = index - 1
      while (before >= 0 && known(before) === null) before--
      let after = index + 1
      while (after < rows.length && known(after) === null) after++
      if (before < 0 || after >= rows.length) throw new Error(`KA ${trip.ka}: no printed time to place ${station}`)
      const t0 = printed[before]!.departure ?? printed[before]!.arrival!
      const t1 = printed[after]!.arrival ?? printed[after]!.departure!
      at = t0 + (t1 - t0) * (index - before) / (after - before)
    }
    void departureCell
    stops.push({ station, arrival: arrival ?? at, departure: departure ?? at })
  })
  return stops
}

/** What a board row needs of one run of the timetable (possibly two chained trips). */
interface Run {
  tripNumber: string
  lineCode: string
  stops: TripStop[]
  terminus: string
}

/*
 * BNI City (SUDB) is a stop on every airport run but the GAPEKA prints no time
 * for it, and counting rows puts it halfway between Manggarai and Tanah Abang
 * when it is nearer Manggarai. The booking app's board has real times for it,
 * and they are the same on all 35 trips: northbound it leaves 7 minutes after
 * Manggarai, southbound 9 minutes after Duri. Pinned to those rather than
 * interpolated, which was 2 minutes out northbound and 1 southbound.
 */
const SUDB_AFTER_MRI_SECONDS = 7 * 60
const SUDB_AFTER_DU_SECONDS = 9 * 60

export function pinBniCity(stops: TripStop[]): TripStop[] {
  const at = stops.findIndex(stop => stop.station === 'SUDB')
  if (at < 0) return stops
  const anchor = (station: string, offset: number): TripStop[] | null => {
    const from = stops.findIndex(stop => stop.station === station)
    if (from < 0 || from > at) return null
    const time = stops[from]!.departure + offset
    return stops.map((stop, index) => (index === at ? { ...stop, arrival: time, departure: time } : stop))
  }
  return anchor('MRI', SUDB_AFTER_MRI_SECONDS) ?? anchor('DU', SUDB_AFTER_DU_SECONDS) ?? stops
}

const digits = (ka: string): string => ka.replace(/\D/g, '')

/*
 * The airport train is one run split in two numbers at Duri (809 Bogor-Duri,
 * 810 Duri-Bandara). The booking app, and so the existing board, sells it as one
 * trip, 809A810A, so the legs are joined here the same way: consecutive numbers,
 * the first ending where the second starts, within a few minutes. A leg with no
 * partner (e.g. 940 Duri-Manggarai) stands alone as its number + 'A'.
 */
const MAX_JOIN_GAP_SECONDS = 10 * 60

function airportRuns(trips: GapekaTrip[]): Run[] {
  const byNumber = new Map(trips.map(trip => [Number(digits(trip.ka)), trip]))
  const used = new Set<GapekaTrip>()
  const runs: Run[] = []

  for (const trip of [...trips].sort((a, b) => Number(digits(a.ka)) - Number(digits(b.ka)))) {
    if (used.has(trip)) continue
    used.add(trip)
    const stops = pinBniCity(stopsOf(trip))
    const next = byNumber.get(Number(digits(trip.ka)) + 1)
    let tripNumber = `${digits(trip.ka)}A`
    let terminus = trip.to

    if (next && !used.has(next) && next.from === trip.to) {
      const nextStops = pinBniCity(stopsOf(next))
      const arrives = stops[stops.length - 1]!.arrival
      // The next leg's clock restarts at its own midnight; compare on one day.
      const departs = nextStops[0]!.departure
      const gap = ((departs - arrives) % 86400 + 86400) % 86400
      if (gap <= MAX_JOIN_GAP_SECONDS) {
        used.add(next)
        // Shift the second leg onto the first's clock before concatenating.
        const shift = Math.round((arrives + gap - departs) / 86400) * 86400
        tripNumber = `${digits(trip.ka)}A${digits(next.ka)}A`
        terminus = next.to
        // The junction is one stop: arrive on the first leg, leave on the second.
        const junction = stops.pop()!
        stops.push({ station: junction.station, arrival: junction.arrival, departure: nextStops[0]!.departure + shift })
        stops.push(...nextStops.slice(1).map(stop => ({ ...stop, arrival: stop.arrival + shift, departure: stop.departure + shift })))
      }
    }
    runs.push({ tripNumber, lineCode: APT_CGK_LINE.lineCode, stops, terminus })
  }
  return runs
}

export interface BoardRow {
  id: string
  stationId: string
  tripNumber: string
  estimatedDeparture: string
  estimatedArrival: string
  boundFor: string
  lineCode: string
}

export interface Conversion {
  /** Rows by our station code. */
  boards: Map<string, BoardRow[]>
  /** Trips left out, by label, with the reason. */
  skipped: Map<string, number>
}

export function convertGapeka(file: GapekaFile): Conversion {
  const boards = new Map<string, BoardRow[]>()
  const skipped = new Map<string, number>()

  const runs: Run[] = []
  const airport: GapekaTrip[] = []
  for (const trip of file.trips) {
    const lineCode = LINE_BY_LABEL[trip.label]
    if (!lineCode) {
      skipped.set(trip.label, (skipped.get(trip.label) ?? 0) + 1)
      continue
    }
    if (lineCode === APT_CGK_LINE.lineCode) airport.push(trip)
    else runs.push({ tripNumber: trip.ka, lineCode, stops: stopsOf(trip), terminus: trip.to })
  }
  runs.push(...airportRuns(airport))

  for (const run of runs) {
    const boundFor = TERMINUS_NAMES[run.terminus]
    if (!boundFor) throw new Error(`No display name for terminus ${run.terminus} (trip ${run.tripNumber}), add it to TERMINUS_NAMES`)
    const arrival = formatTime(run.stops[run.stops.length - 1]!.arrival)

    // Every stop but the last is a departure; the terminus is nowhere to board.
    for (const stop of run.stops.slice(0, -1)) {
      const station = fromFeedStationCode(stop.station)
      const stationId = `KCI-${station}`
      const rows = boards.get(station) ?? []
      // One row per id, last wins, as the feed's dedupe does (a loop train stops twice).
      const id = `${stationId}-${run.tripNumber}`
      const row: BoardRow = {
        id, stationId, tripNumber: run.tripNumber, estimatedDeparture: formatTime(stop.departure),
        estimatedArrival: arrival, boundFor, lineCode: run.lineCode
      }
      const existing = rows.findIndex(r => r.id === id)
      if (existing >= 0) rows[existing] = row
      else rows.push(row)
      boards.set(station, rows)
    }
  }

  for (const rows of boards.values()) rows.sort((a, b) => a.estimatedDeparture.localeCompare(b.estimatedDeparture) || a.id.localeCompare(b.id))
  return { boards, skipped }
}

const INSERT_CHUNK_ROWS = 100
const esc = (value: string): string => value.replace(/'/g, '\'\'')
const lit = (value: string): string => `'${esc(value)}'`

export function buildSQL(boards: Map<string, BoardRow[]>, source: string): string {
  const blocks = [...boards].sort(([a], [b]) => a.localeCompare(b)).map(([station, rows]) => {
    const stationId = `KCI-${station}`
    const values = rows.map(row =>
      `  (${lit(row.id)}, ${lit(row.stationId)}, ${lit(row.tripNumber)}, ${lit(row.estimatedDeparture)},`
      + ` ${lit(row.estimatedArrival)}, ${lit(row.boundFor)}, ${lit(row.lineCode)}, ${DAY_MASK_ALL}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    return `-- ${stationId}: ${rows.length} departures\n`
      // The whole board: this edition replaces line A's rows too (Bogor runs), unlike the dump's SQL.
      + `DELETE FROM schedules WHERE stationId = ${lit(stationId)} AND dayMask = ${DAY_MASK_ALL};\n`
      + chunkArray(values, INSERT_CHUNK_ROWS).map(chunk =>
        'INSERT INTO schedules (id, stationId, tripNumber, estimatedDeparture, estimatedArrival, boundFor, lineCode, dayMask, createdAt, updatedAt)\n'
        + 'SELECT * FROM (VALUES\n' + chunk.join(',\n') + '\n'
        + `) WHERE EXISTS (SELECT 1 FROM stations WHERE id = ${lit(stationId)});\n`).join('')
      + `UPDATE stations SET timetableSynced = 1 WHERE id = ${lit(stationId)};\n`
  })

  const header
    = '-- KCI timetable for GAPEKA 2026 (KP DJKA 116/2026, effective 2026-12-01) — GENERATED, do not edit by hand.\n'
      + `-- Source: ${source}. Regenerate with:\n`
      + '--   pnpm --filter api generate:gapeka-timetable <gapeka.json>\n'
      + '--\n'
      + '-- Replaces every board it lists, line A included. Apply, then bump API_VERSION:\n'
      + '--   wrangler d1 execute commute --local  --file=src/db/scripts/kci_gapeka_timetable.sql\n'
      + '--   wrangler d1 execute commute --remote --file=src/db/scripts/kci_gapeka_timetable.sql\n\n'
  return header + blocks.join('\n')
}

function main(): void {
  const input = process.argv[2]
  if (!input) {
    console.error('Usage: generate:gapeka-timetable <gapeka.json>')
    process.exit(1)
  }
  const file = JSON.parse(fs.readFileSync(input, 'utf-8')) as GapekaFile
  const { boards, skipped } = convertGapeka(file)
  fs.writeFileSync(OUTPUT_SQL_PATH, buildSQL(boards, file.source ? path.basename(file.source) : input))
  const rowCount = [...boards.values()].reduce((sum, rows) => sum + rows.length, 0)
  console.log(`${boards.size} stations, ${rowCount} departures -> ${path.relative(process.cwd(), OUTPUT_SQL_PATH)}`)
  for (const [label, count] of skipped) console.log(`Skipped ${count} x "${label}" (not a Jabodetabek line we store)`)
}

if (require.main === module) main()
