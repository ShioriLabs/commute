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

// boundFor uses the terminus's sponsored display name (stations.formattedName)
// — keep in sync with lrtjbdb_stations_insert.sql when a sponsor changes.
export const DEST_BOUND_FOR: Record<string, string> = {
  DKA: 'Dukuh Atas Bank Syariah Indonesia',
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
  if (TRIP_NUMBER_BASE[`${line}_${dest}`] === undefined) {
    return { error: `"${basename}" pairs line ${line} with destination ${dest}, which is not a service pattern (expected ${Object.keys(TRIP_NUMBER_BASE).join('/')})` }
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

/**
 * Network-wide trip numbers, derived from poster column order. The source
 * posters are trip matrices (columns = trains), and each CSV preserves that
 * column order, so line k of every station's CSV in a direction is the same
 * physical train — no correlation needed, unlike the MRTJ sync. This only
 * holds while every trip serves every station; main() enforces it by
 * requiring equal departure counts across a direction's CSVs.
 *
 * Numbering mirrors the MRTJ convention: towards the central terminus
 * (Dukuh Atas) even, away odd, ordered by origin departure; Bekasi line
 * takes the 1000-series and Cibubur the 2000-series so trunk stations
 * (SET..CWG) serving both lines never collide.
 */
export const TRIP_NUMBER_BASE: Record<string, number> = {
  BK_DKA: 1000,
  BK_JTM: 1001,
  CB_DKA: 2000,
  CB_HAR: 2001
}

export function buildTimetableSQL(station: string, line: string, dest: string, times: string[]): string {
  const stationId = `LRTJBDB-${station}`
  const boundFor = DEST_BOUND_FOR[dest]
  const tripNumberBase = TRIP_NUMBER_BASE[`${line}_${dest}`]

  const rows = times.map((time, index) => {
    const id = `${stationId}-${line}-${index + 1}-${dest}`
    const tripNumber = `LRTJBDB-${tripNumberBase! + index * 2}`
    return `('${id}', '${stationId}', '${tripNumber}', '${time}', '${time}', '${boundFor}', '${line}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  })

  // The delete makes re-applying a file safe on an already-loaded station
  // (a resync would otherwise hit primary-key conflicts). Scoped by id
  // pattern rather than boundFor: ids are stable while boundFor labels
  // change on terminus re-sponsoring, which would strand old rows.
  const clearStatement = `DELETE FROM schedules WHERE id LIKE '${stationId}-${line}-%-${dest}';\n`
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
  const parsedFiles: { key: TimetableFileKey, times: string[] }[] = []

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

    parsedFiles.push({ key, times })
  }

  // Trip numbers are assigned by CSV line index, which identifies the same
  // train across stations only if every trip serves every station. A count
  // mismatch within a direction means a short-working or a transcription
  // slip — refuse to number rather than misalign silently.
  const countsByDirection = new Map<string, Set<number>>()
  for (const { key, times } of parsedFiles) {
    const direction = `${key.line}_${key.dest}`
    const counts = countsByDirection.get(direction) ?? new Set()
    counts.add(times.length)
    countsByDirection.set(direction, counts)
  }
  for (const [direction, counts] of countsByDirection) {
    if (counts.size > 1) {
      errors.push(`${direction} CSVs disagree on departure count (${[...counts].sort().join(' vs ')}) — trip numbers cannot align by index`)
    }
  }

  if (!errors.some(error => error.includes('cannot align'))) {
    for (const { key, times } of parsedFiles) {
      const outputPath = path.join(OUTPUT_DIR, `lrtjbdb_${key.station}_${key.line}_${key.dest}_timetable.sql`)
      fs.writeFileSync(outputPath, buildTimetableSQL(key.station, key.line, key.dest, times))
      written.push(outputPath)
      transcribed.add(`${key.station}_${key.line}_${key.dest}`)
    }
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
