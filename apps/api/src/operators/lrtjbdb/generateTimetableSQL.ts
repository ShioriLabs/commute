import * as fs from 'node:fs'
import * as path from 'node:path'
import { LINES } from './lines'

/*
 * Batch CSV -> SQL generator for the hand-transcribed LRT Jabodebek
 * timetables (source: official @lrt_jabodebek Instagram schedule posters —
 * there is no public API). Reads every `<STATION>_<LINE>_<DEST>.csv` in
 * ./timetables (one departure per line, H:MM or HH:MM) and overwrites the
 * committed `lrtjbdb_<STATION>_<LINE>_<DEST>_timetable.sql` files in
 * db/scripts, so `git diff` is the transcription review. See
 * ./timetables/README.md for the workflow and transcription checklist.
 */

const INPUT_DIR = path.join(__dirname, 'timetables')
const OUTPUT_DIR = path.resolve(__dirname, '../../db/scripts')

export const DEST_BOUND_FOR: Record<string, string> = {
  DKA: 'Dukuh Atas BNI',
  JTM: 'Jatimulya',
  HAR: 'Harjamukti'
}

const LINE_CODES = new Set<string>(LINES.map(line => line.lineCode))

export interface TimetableFileKey {
  station: string
  line: string
  dest: string
}

export function parseTimetableFilename(basename: string): TimetableFileKey | { error: string } {
  const match = basename.match(/^([A-Z0-9]{2,4})_([A-Z]{2})_([A-Z]{3})\.csv$/)
  if (!match?.[1] || !match[2] || !match[3]) {
    return { error: `"${basename}" does not match <STATION>_<LINE>_<DEST>.csv` }
  }

  const [, station, line, dest] = match
  if (!LINE_CODES.has(line)) {
    return { error: `"${basename}" has unknown line code "${line}" (expected ${[...LINE_CODES].join('/')})` }
  }
  if (!DEST_BOUND_FOR[dest]) {
    return { error: `"${basename}" has unknown destination "${dest}" (expected ${Object.keys(DEST_BOUND_FOR).join('/')})` }
  }
  if (station === dest) {
    return { error: `"${basename}" departs from its own destination` }
  }

  return { station, line, dest }
}

// Zero-padding is a deliberate fix: the previously committed SQL stored
// unpadded hours ('6:18:00') and timetables sort lexically on
// estimatedDeparture, so 6am departures sorted after 11pm ones.
export function normalizeTime(raw: string): string | null {
  const match = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match?.[1] || !match[2]) return null
  return `${match[1].padStart(2, '0')}:${match[2]}:00`
}

export function buildTimetableSQL(station: string, line: string, dest: string, times: string[]): string {
  const stationId = `LRTJBDB-${station}`
  const boundFor = DEST_BOUND_FOR[dest]

  const rows = times.map((time, index) => {
    const id = `${stationId}-${line}-${index + 1}-${dest}`
    return `('${id}', '${stationId}', '${index + 1}', '${time}', '${time}', '${boundFor}', '${line}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  })

  // The delete makes re-applying a file safe on an already-loaded station
  // (a resync would otherwise hit primary-key conflicts). Scoped to the
  // station+line+direction this file owns.
  const clearStatement = `DELETE FROM schedules WHERE stationId = '${stationId}' AND lineCode = '${line}' AND boundFor = '${boundFor}';\n`
  const insertStatement = 'INSERT INTO schedules (id, stationId, tripNumber, estimatedDeparture, estimatedArrival, boundFor, lineCode, createdAt, updatedAt) VALUES\n'
  const switchTimetableSynced = `UPDATE stations SET timetableSynced = 1 WHERE id = '${stationId}';\n`
  return clearStatement + insertStatement + rows.join(',\n') + ';\n\n' + switchTimetableSynced
}

function expectedCombos(): Set<string> {
  const combos = new Set<string>()
  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    const match = file.match(/^lrtjbdb_([A-Z0-9]{2,4})_([A-Z]{2})_([A-Z]{3})_timetable\.sql$/)
    if (match) combos.add(`${match[1]}_${match[2]}_${match[3]}`)
  }
  return combos
}

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Input directory not found: ${INPUT_DIR}`)
    console.error('Create it and add <STATION>_<LINE>_<DEST>.csv files (one HH:MM departure per line).')
    process.exit(1)
  }

  const csvFiles = fs.readdirSync(INPUT_DIR).filter(file => file.endsWith('.csv'))
  if (csvFiles.length === 0) {
    console.error(`No CSV files in ${INPUT_DIR}. Expected <STATION>_<LINE>_<DEST>.csv, e.g. SET_BK_JTM.csv.`)
    process.exit(1)
  }

  const errors: string[] = []
  const written: string[] = []
  const transcribed = new Set<string>()

  for (const file of csvFiles.sort()) {
    const key = parseTimetableFilename(file)
    if ('error' in key) {
      errors.push(key.error)
      continue
    }

    const lines = fs.readFileSync(path.join(INPUT_DIR, file), 'utf8').split(/\r?\n/)
    const times: string[] = []
    let fileHasErrors = false
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue
      const time = normalizeTime(line)
      if (!time) {
        errors.push(`${file}:${index + 1} invalid time "${line.trim()}" (expected H:MM or HH:MM)`)
        fileHasErrors = true
        continue
      }
      if (times.length > 0 && time <= times[times.length - 1]!) {
        console.warn(`${file}:${index + 1} time ${time} is not after the previous departure`)
      }
      times.push(time)
    }

    if (fileHasErrors) continue
    if (times.length === 0) {
      errors.push(`${file} contains no departures`)
      continue
    }

    const outputPath = path.join(OUTPUT_DIR, `lrtjbdb_${key.station}_${key.line}_${key.dest}_timetable.sql`)
    fs.writeFileSync(outputPath, buildTimetableSQL(key.station, key.line, key.dest, times))
    written.push(outputPath)
    transcribed.add(`${key.station}_${key.line}_${key.dest}`)
  }

  for (const outputPath of written) {
    console.log(`Wrote ${outputPath}`)
  }

  const expected = expectedCombos()
  const missing = [...expected].filter(combo => !transcribed.has(combo)).sort()
  console.log(`\nTranscribed ${transcribed.size}/${expected.size} station/line/direction combos.`)
  if (missing.length > 0) {
    console.log(`Missing: ${missing.join(', ')}`)
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`)
    for (const error of errors) {
      console.error(`  ${error}`)
    }
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
