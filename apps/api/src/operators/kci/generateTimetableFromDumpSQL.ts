import * as fs from 'node:fs'
import * as path from 'node:path'
import { DAY_MASK_ALL, type NewSchedule } from 'db/schemas/schedules'
import { chunkArray } from 'utils/chunk'
import { fromFeedStationCode } from './formatters'
import { toTimetableRows } from './sync'

/*
 * KCI timetable from a browser dump of kci.id, as SQL.
 *
 * kci.id now blocks every non-browser client on its schedule paths — the page
 * and `/api/krl/schedules` alike, while `/api/krl/stations` still answers — and
 * keys the block on how the client connects, not on its headers: a curl copied
 * header-for-header from Edge is still refused. So the live /sync path cannot
 * reach the board any more, and the data comes from a dump taken in a real
 * browser instead: open kci.id/perjalanan-krl/jadwal-kereta, and in DevTools'
 * console run
 *
 *   const xhr = { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
 *   const st = await (await fetch('/api/krl/stations', xhr)).json()
 *   const ids = st.data.filter(s => s.fg_enable !== 0).map(s => s.sta_id)
 *   const out = {}
 *   for (const id of ids) {
 *     const r = await fetch(`/api/krl/schedules?stationid=${id}&timefrom=00%3A00&timeto=23%3A59`, xhr)
 *     out[id] = r.ok ? await r.json() : { status: r.status, data: [] }
 *     console.log(id, r.status, out[id].data?.length)
 *     await new Promise(res => setTimeout(res, 1500))
 *   }
 *   const a = document.createElement('a')
 *   a.href = URL.createObjectURL(new Blob([JSON.stringify({ fetchedAt: new Date().toISOString(), stations: st, schedules: out })], { type: 'application/json' }))
 *   a.download = `kci-dump-${new Date().toISOString().slice(0, 10)}.json`
 *   a.click()
 *
 * The 1.5s gap keeps it at a person's pace; ~110 stations take about three
 * minutes.
 *
 * The board changes with GAPEKA, a few times a year, so a dump per timetable
 * change is the whole job; this is not meant to run on a schedule.
 *
 * Rows go through toTimetableRows, the same conversion /sync uses, so a dump
 * writes exactly what a live sync would have. The SQL mirrors
 * StationRepository.insertTimetable statement for statement, with one deliberate
 * difference, noted on the DELETE below.
 *
 * Usage:
 *   pnpm --filter api generate:kci-timetable <path/to/kci-dump-YYYY-MM-DD.json>
 */

const OUTPUT_SQL_PATH = path.resolve(__dirname, '../../db/scripts/kci_timetable.sql')

/** What the console snippet saves. Each schedules entry is the raw API body. */
export interface KCIDump {
  fetchedAt: string
  /** The raw /api/krl/stations body, which carries each station's region. */
  stations?: { data?: { sta_id: string, group_wil: number }[] }
  schedules: Record<string, unknown>
}

/*
 * Jabodetabek's `group_wil`, the same value syncStations maps to REGIONS.CGK.
 * The feed also carries Bandung (2) and Yogyakarta (6), which this app does not
 * route, so their boards are left out of the SQL entirely.
 */
const JABODETABEK_GROUP = 0

export interface DumpBoard {
  stationCode: string
  rows: NewSchedule[]
}

export interface DumpConversion {
  boards: DumpBoard[]
  /** Feed codes whose response was not a success, so their board is untouched. */
  failed: string[]
  /** Feed codes that answered with no departures, also left untouched. */
  empty: string[]
  /** Feed codes outside Jabodetabek, skipped on purpose. */
  outsideRegion: string[]
}

/*
 * Every board in the dump, keyed back to OUR station codes.
 *
 * Failed and empty responses are reported rather than written: insertTimetable
 * leaves a station's existing board in place on an empty success, and a failed
 * fetch never reaches it at all, so neither may wipe a board here either.
 */
export function convertDump(dump: KCIDump): DumpConversion {
  const result: DumpConversion = { boards: [], failed: [], empty: [], outsideRegion: [] }

  /*
   * Region by station, from the list in the same dump. Checked under our code as
   * well as the feed's, because the list can lag a rename: in October 2026 it
   * still said GGL for Grogol while the schedules API only answered to GRG.
   * A dump without a station list skips no one, as /sync never filtered either.
   */
  const groupOf = new Map((dump.stations?.data ?? []).map(station => [station.sta_id, station.group_wil]))

  for (const [feedCode, body] of Object.entries(dump.schedules)) {
    const stationCode = fromFeedStationCode(feedCode)
    const group = groupOf.get(feedCode) ?? groupOf.get(stationCode)
    if (groupOf.size > 0 && group !== JABODETABEK_GROUP) {
      result.outsideRegion.push(feedCode)
      continue
    }
    const rows = toTimetableRows(stationCode, body)
    if (!rows) result.failed.push(feedCode)
    else if (rows.length === 0) result.empty.push(feedCode)
    else {
      // One row per id, last wins, exactly as insertTimetable dedupes.
      const deduped = [...new Map(rows.map(row => [row.id, row])).values()]
      result.boards.push({ stationCode, rows: deduped })
    }
  }

  return result
}

const INSERT_CHUNK_ROWS = 100

const esc = (value: string): string => value.replace(/'/g, '\'\'')
const literal = (value: unknown): string => (value === null || value === undefined ? 'NULL' : `'${esc(String(value))}'`)

export function buildTimetableSQL(boards: DumpBoard[], fetchedAt: string): string {
  const blocks = boards.map(({ stationCode, rows }) => {
    const stationId = `KCI-${stationCode}`
    const values = rows.map(row =>
      `  (${literal(row.id)}, ${literal(row.stationId)}, ${literal(row.tripNumber)}, ${literal(row.estimatedDeparture)},`
      + ` ${literal(row.estimatedArrival)}, ${literal(row.boundFor)}, ${literal(row.lineCode)}, ${DAY_MASK_ALL}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)

    return `-- ${stationId}: ${rows.length} departures\n`
      /*
       * Unlike insertTimetable, line A is spared. The airport service left this
       * feed for its own booking app and is written by
       * generateBasoettaTimetableSQL at MRI/SUDB/DU/RW/BPR, at the same day
       * mask; a station-wide delete here would wipe it, and nothing in this
       * dump would put it back.
       */
      + `DELETE FROM schedules WHERE stationId = '${esc(stationId)}' AND dayMask = ${DAY_MASK_ALL} AND lineCode <> 'A';\n`
      /*
       * Guarded on the station existing, as insertTimetable is: the feed lists
       * stations we do not carry, and their rows must not land orphaned.
       * Chunked so no one statement nears D1's size limit; the busiest boards
       * run past 300 departures.
       */
      + chunkArray(values, INSERT_CHUNK_ROWS).map(chunk =>
        'INSERT INTO schedules (id, stationId, tripNumber, estimatedDeparture, estimatedArrival, boundFor, lineCode, dayMask, createdAt, updatedAt)\n'
        + 'SELECT * FROM (VALUES\n'
        + chunk.join(',\n') + '\n'
        + `) WHERE EXISTS (SELECT 1 FROM stations WHERE id = '${esc(stationId)}');\n`).join('')
      + `UPDATE stations SET timetableSynced = 1 WHERE id = '${esc(stationId)}';\n`
  })

  const header
    = '-- KCI timetable — GENERATED from a browser dump of kci.id, do not edit by hand.\n'
      + `-- Dump fetched ${fetchedAt}. Regenerate with:\n`
      + '--   pnpm --filter api generate:kci-timetable <dump.json>\n'
      + '--\n'
      + '-- Apply, then bump API_VERSION so cached boards and routes pick it up:\n'
      + '--   wrangler d1 execute commute --local  --file=src/db/scripts/kci_timetable.sql\n'
      + '--   wrangler d1 execute commute --remote --file=src/db/scripts/kci_timetable.sql\n\n'

  return header + blocks.join('\n')
}

function main(): void {
  const dumpPath = process.argv[2]
  if (!dumpPath) {
    console.error('Usage: generate:kci-timetable <path/to/kci-dump.json>')
    process.exit(1)
  }

  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf-8')) as KCIDump
  const { boards, failed, empty, outsideRegion } = convertDump(dump)

  // A dump where nothing converted is a broken dump, not an empty network.
  if (boards.length === 0) {
    console.error(`No usable boards in ${dumpPath} (${failed.length} failed, ${empty.length} empty)`)
    process.exit(1)
  }

  fs.writeFileSync(OUTPUT_SQL_PATH, buildTimetableSQL(boards, dump.fetchedAt))

  const rowCount = boards.reduce((sum, board) => sum + board.rows.length, 0)
  console.log(`${boards.length} stations, ${rowCount} departures -> ${path.relative(process.cwd(), OUTPUT_SQL_PATH)}`)
  if (failed.length > 0) console.warn(`Failed, boards left as they are: ${failed.join(', ')}`)
  if (outsideRegion.length > 0) console.log(`Outside Jabodetabek, skipped: ${outsideRegion.join(', ')}`)
  if (empty.length > 0) console.warn(`Empty, boards left as they are: ${empty.join(', ')}`)
  const unknownLines = boards.flatMap(board => board.rows).filter(row => row.lineCode === 'NUL').length
  if (unknownLines > 0) console.warn(`${unknownLines} departures on an unrecognised line name (stored as NUL)`)
}

if (require.main === module) main()
