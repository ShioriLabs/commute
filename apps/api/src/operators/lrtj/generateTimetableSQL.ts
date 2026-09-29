import * as fs from 'node:fs'
import * as path from 'node:path'
import { TOPOLOGY } from 'db/data/topology'
import { DAY_MASK_ALL } from 'db/schemas/schedules'

/*
 * CSV -> SQL generator for the LRT Jakarta Lin Selatan timetable (source: the
 * printed "Jadwal Perjalanan LRT Jakarta, Lin Selatan", berlaku mulai 17
 * September 2026, photographed at a station). Reads ./timetables/S_<DEST>.csv,
 * one row per poster row, and overwrites db/scripts/lrtj_S_timetable.sql, so
 * `git diff` is the transcription review. See ./timetables/README.md.
 *
 * Unlike the scraped board in ./sync.ts, the poster numbers every train (KA),
 * so these rows chain into real trips: tripNumber is `LRTJ-<KA>` at every stop
 * the train calls at.
 *
 * The poster prints each working's terminal arrival in its last column, but a
 * departure board has no row where a train terminates (every other feed is a
 * board, and generateTrips appends the terminus itself; see tripTerminus.ts).
 * So that cell is validated and then dropped. The one exception is the evening
 * Kelapa Gading -> Velodrome shuttle, whose rows stop at Equestrian and leave
 * the Velodrome turnback blank: there the first blank after the last time is
 * the terminus, and every printed time is a real departure.
 */

const INPUT_DIR = path.join(__dirname, 'timetables')
const OUTPUT_PATH = path.resolve(__dirname, '../../db/scripts/lrtj_S_timetable.sql')

const LINE_CODE = 'S'

// boundFor uses the terminus's display name (stations.formattedName).
export const BOUND_FOR: Record<string, string> = {
  MGI: 'Manggarai',
  PGD: 'Kelapa Gading',
  VEL: 'Velodrome'
}

/*
 * The poster's own numbering: Manggarai-bound trains are even, Kelapa
 * Gading-bound odd. Checked per row, since a KA filed under the wrong
 * direction would chain its stops in the wrong order.
 */
export const KA_PARITY: Record<string, number> = { MGI: 0, PGD: 1 }

/*
 * Cells that deliberately break the modal run time, keyed `KA FROM->TO`, each
 * with the reason it was accepted. Empty: the 17 Sep 2026 poster has none.
 */
export const POSTER_ERRATA: Record<string, string> = {}

const LINE = TOPOLOGY.find(l => l.operator === 'LRTJ' && l.lineCode === LINE_CODE)!
const PASS_THROUGH = new Set(LINE.path.filter(s => s.passThrough).map(s => s.station))

export interface Trip {
  ka: number
  dest: string
  terminus: string
  // Every printed time in travel order, the terminal arrival included.
  timed: { station: string, time: string }[]
  // The subset that becomes schedule rows.
  departures: { station: string, time: string }[]
}

export function expectedHeader(dest: string): string[] {
  const stations = LINE.path.map(s => s.station)
  return ['ka', 'loop', ...(dest === stations[0] ? [...stations].reverse() : stations)]
}

/*
 * Zero-padding is load-bearing, not cosmetic: timetables sort lexically on
 * estimatedDeparture, so an unpadded '6:18:00' sorts after the 11pm departures.
 */
export function normalizeTime(raw: string): string | null {
  const match = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match?.[1] || !match[2]) return null
  return `${match[1].padStart(2, '0')}:${match[2]}:00`
}

const minutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

export function parseTimetable(dest: string, csv: string, file = `S_${dest}.csv`): { trips: Trip[], errors: string[] } {
  const errors: string[] = []
  const trips: Trip[] = []
  const lines = csv.split(/\r?\n/).filter(line => line.trim())
  const header = lines[0]?.split(',').map(cell => cell.trim()) ?? []
  const expected = expectedHeader(dest)
  if (header.join(',') !== expected.join(',')) {
    return { trips, errors: [`${file}: header must be ${expected.join(',')}`] }
  }
  const stations = header.slice(2)

  for (const [index, line] of lines.slice(1).entries()) {
    const where = `${file}:${index + 2}`
    const cells = line.split(',').map(cell => cell.trim())
    if (cells.length !== header.length) {
      errors.push(`${where} has ${cells.length} cells, expected ${header.length}`)
      continue
    }
    const ka = Number(cells[0])
    if (!Number.isInteger(ka)) {
      errors.push(`${where} KA "${cells[0]}" is not a number`)
      continue
    }
    if (ka % 2 !== KA_PARITY[dest]) {
      errors.push(`${where} KA ${ka} has the wrong parity for ${BOUND_FOR[dest]}-bound`)
      continue
    }

    // Walk the calling pattern with pass-through columns set aside, as a
    // leading run of blanks, then times, then a trailing run of blanks.
    let rowOk = true
    const called: { station: string, cell: string }[] = []
    for (const [i, cell] of cells.slice(2).entries()) {
      const station = stations[i]!
      if (PASS_THROUGH.has(station)) {
        if (cell !== 'Ls' && cell !== '-') {
          errors.push(`${where} ${station} is passed through (topology) but reads "${cell}"`)
          rowOk = false
        }
        continue
      }
      if (cell === 'Ls') {
        errors.push(`${where} ${station} reads Ls, but the topology says trains call there`)
        rowOk = false
        continue
      }
      called.push({ station, cell })
    }
    const shape = called.map(c => (c.cell === '-' ? '-' : 'T')).join('')
    if (!/^-*T{2,}-*$/.test(shape)) {
      errors.push(`${where} calling pattern "${shape}" is not one contiguous run of at least two times`)
      rowOk = false
    }
    if (!rowOk) continue

    const timed: Trip['timed'] = []
    for (const { station, cell } of called) {
      if (cell === '-') continue
      const time = normalizeTime(cell)
      if (!time) {
        errors.push(`${where} ${station} invalid time "${cell}"`)
        rowOk = false
        continue
      }
      if (timed.length > 0 && time <= timed[timed.length - 1]!.time) {
        errors.push(`${where} ${station} ${time} is not after the previous stop`)
        rowOk = false
      }
      timed.push({ station, time })
    }
    if (!rowOk) continue

    const lastTimed = called.findLastIndex(c => c.cell !== '-')
    const turnback = called[lastTimed + 1]
    const terminus = turnback ? turnback.station : timed[timed.length - 1]!.station
    if (!BOUND_FOR[terminus]) {
      errors.push(`${where} terminates at ${terminus}, which has no boundFor name`)
      continue
    }
    trips.push({
      ka,
      dest,
      terminus,
      timed,
      departures: turnback ? timed : timed.slice(0, -1)
    })
  }

  return { trips, errors }
}

/*
 * Every hop's run time must equal the most common one among the trips that run
 * the same working (same first stop and terminus). The source is a phone photo
 * of a printed sheet, and each working runs to rigid timings, so an off-pattern
 * cell is far more likely a misread than a real difference. Flag it for a look
 * at the photo; never correct it here.
 *
 * Per working rather than per line because the workings genuinely differ: the
 * evening Velodrome -> Kelapa Gading shuttle takes 2 min BVS -> BVU and 5 min
 * BVU -> PGD on every row, against 3 and 4 by day.
 */
export function checkRunTimes(trips: Trip[]): string[] {
  const hops = new Map<string, { ka: number, run: number }[]>()
  for (const trip of trips) {
    for (let i = 1; i < trip.timed.length; i++) {
      const a = trip.timed[i - 1]!
      const b = trip.timed[i]!
      const key = `${trip.timed[0]!.station}..${trip.terminus} ${a.station}->${b.station}`
      const list = hops.get(key) ?? []
      list.push({ ka: trip.ka, run: minutes(b.time) - minutes(a.time) })
      hops.set(key, list)
    }
  }

  const errors: string[] = []
  for (const [hop, runs] of hops) {
    const counts = new Map<number, number>()
    for (const { run } of runs) counts.set(run, (counts.get(run) ?? 0) + 1)
    const mode = [...counts].sort((a, b) => b[1] - a[1])[0]![0]
    for (const { ka, run } of runs) {
      const errataKey = `${ka} ${hop.split(' ')[1]}`
      if (run === mode || POSTER_ERRATA[errataKey]) continue
      errors.push(`KA ${errataKey} ${run} min (mode ${mode} on ${hop.split(' ')[0]})`)
    }
  }
  return errors
}

const esc = (value: string): string => value.replace(/'/g, '\'\'')

// D1 caps a single statement at 100 KB; the full line is ~900 rows.
const INSERT_CHUNK = 100

export function buildTimetableSQL(trips: Trip[]): string {
  const rows = trips.flatMap(trip => trip.departures.map(({ station, time }) => {
    const stationId = `LRTJ-${station}`
    return `  ('${esc(`${stationId}-${trip.ka}`)}', '${esc(stationId)}', 'LRTJ-${trip.ka}', '${time}', '${time}',`
      + ` '${esc(BOUND_FOR[trip.terminus]!)}', '${LINE_CODE}', ${DAY_MASK_ALL}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  }))

  const inserts: string[] = []
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    inserts.push('INSERT INTO schedules (id, stationId, tripNumber, estimatedDeparture, estimatedArrival, boundFor, lineCode, dayMask, createdAt, updatedAt) VALUES\n'
      + rows.slice(i, i + INSERT_CHUNK).join(',\n') + ';\n')
  }

  const served = [...new Set(trips.flatMap(trip => trip.departures.map(d => `'LRTJ-${d.station}'`)))].sort()

  /*
   * The delete takes every LRTJ row, on purpose: the poster covers the whole
   * line, and what it replaces is the scraped per-station board from sync.ts,
   * whose rows cannot chain and would otherwise sit beside these as phantom
   * one-stop trips.
   */
  return `-- LRT Jakarta Lin Selatan, berlaku mulai 17 September 2026 (${trips.length} trips, ${rows.length} departures)\n`
    + '-- GENERATED by operators/lrtj/generateTimetableSQL.ts from timetables/*.csv — do not edit by hand.\n'
    + 'DELETE FROM schedules WHERE stationId LIKE \'LRTJ-%\';\n'
    + inserts.join('\n')
    + `\nUPDATE stations SET timetableSynced = 1 WHERE id IN (${served.join(', ')});\n`
}

function main(): void {
  const errors: string[] = []
  const trips: Trip[] = []
  for (const dest of Object.keys(KA_PARITY)) {
    const file = path.join(INPUT_DIR, `S_${dest}.csv`)
    if (!fs.existsSync(file)) {
      errors.push(`missing ${file}`)
      continue
    }
    const parsed = parseTimetable(dest, fs.readFileSync(file, 'utf8'))
    trips.push(...parsed.trips)
    errors.push(...parsed.errors)
  }

  const seen = new Set<number>()
  for (const { ka } of trips) {
    if (seen.has(ka)) errors.push(`KA ${ka} appears more than once`)
    seen.add(ka)
  }
  errors.push(...checkRunTimes(trips))

  if (errors.length > 0) {
    console.error(`${errors.length} error(s):`)
    for (const error of errors) console.error(`  ${error}`)
    process.exit(1)
  }

  fs.writeFileSync(OUTPUT_PATH, buildTimetableSQL(trips))
  for (const dest of Object.keys(KA_PARITY)) {
    const own = trips.filter(t => t.dest === dest)
    const short = own.filter(t => t.terminus !== dest).length
    console.log(`${BOUND_FOR[dest]}-bound: ${own.length} trips (${short} short workings)`)
  }
  console.log(`Wrote ${OUTPUT_PATH}`)
}

if (require.main === module) {
  main()
}
