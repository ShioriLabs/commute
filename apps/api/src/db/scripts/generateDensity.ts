import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { RIDERSHIP_BY_STATION_ID } from '../data/ridership'
import { TRIP_PATTERNS } from '../data/trips'
import { DAY_MASK } from '../schemas/schedules'
import { rideMinutesToCore } from './density/ride-time'
import { CAPACITY, hourlyLevels, LINE_CAPACITY, type LevelRange, type StationInput } from './density/model'
import type { DayBucket } from './density/roles'

/*
 * Generates db/data/density.ts: a forecast crowding range (0 Lengang, 1 Ramai,
 * 2 Padat, 3 Sangat Padat, as min~max) for each rail station, day type and hour.
 * The model is in ./density/ and documented in docs/station-density.md.
 *
 * Reads D1 like generate:station-scores. Run with --remote for the real
 * output (the local D1 is stale; see docs/station-score.md runbook):
 *   pnpm --filter api generate:density -- --remote
 * `--persist-to <dir>` reads a local D1 kept somewhere other than .wrangler/.
 */
const OUTPUT = `${__dirname}/../data/density.ts`
const DB_NAME = 'commute'
const LOCAL = !process.argv.includes('--remote')
const PERSIST_AT = process.argv.indexOf('--persist-to')
const PERSIST_TO = PERSIST_AT === -1 ? [] : ['--persist-to', process.argv[PERSIST_AT + 1]!]
const DAYS: DayBucket[] = ['WD', 'SAT', 'SUN']

interface Row { [k: string]: string | number | null }
function d1(sql: string): Row[] {
  const target = LOCAL ? ['--local', ...PERSIST_TO] : ['--remote']
  const args = ['wrangler', 'd1', 'execute', DB_NAME, ...target, '--json', '--command', sql]
  const out = execFileSync('npx', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  // wrangler prints a JSON array of result objects; grab the first result set.
  return JSON.parse(out.slice(out.indexOf('[')))[0]?.results ?? []
}

/** One hour as a pair of digits, '-' when there is no estimate. */
const encode = (levels: LevelRange[], side: 'min' | 'max') => levels.map(l => l === null ? '-' : String(l[side])).join('')

function main() {
  const operators = Object.keys(CAPACITY).map(o => `'${o}'`).join(',')
  const stations = d1(`SELECT id, operator, score FROM stations WHERE searchable = 1 AND operator IN (${operators})`)
  const deps = d1(`SELECT stationId, lineCode, dayMask, CAST(substr(estimatedDeparture, 1, 2) AS INTEGER) AS h, COUNT(*) AS n
    FROM schedules WHERE lineCode != 'NUL' GROUP BY stationId, lineCode, dayMask, h`)
  const operatorOf = new Map(stations.map(s => [String(s.id), String(s.operator) as StationInput['operator']]))

  // Departures in trains of the operator's usual stock, so a 300-seat airport
  // train counts as 0.15 of a KRL rather than as a whole one (LINE_CAPACITY).
  const byStation = new Map<string, Record<DayBucket, number[]>>()
  for (const r of deps) {
    const id = String(r.stationId)
    const operator = operatorOf.get(id)
    if (!operator) continue
    const weight = (LINE_CAPACITY[String(r.lineCode)] ?? CAPACITY[operator]) / CAPACITY[operator]
    if (!byStation.has(id)) byStation.set(id, { WD: new Array(24).fill(0), SAT: new Array(24).fill(0), SUN: new Array(24).fill(0) })
    for (const day of DAYS) {
      if (Number(r.dayMask) & DAY_MASK[day]) {
        const hours = byStation.get(id)![day]
        const h = Number(r.h) % 24
        hours[h] = hours[h]! + Number(r.n) * weight
      }
    }
  }

  const ride = rideMinutesToCore(TRIP_PATTERNS)
  const lines: string[] = []
  for (const s of stations) {
    const id = String(s.id)
    const departures = byStation.get(id)
    if (!departures) continue
    const input: StationInput = {
      stationId: id,
      operator: String(s.operator) as StationInput['operator'],
      anchor: RIDERSHIP_BY_STATION_ID.get(id),
      score: Number(s.score ?? 0),
      rideMin: ride.get(id),
      departures
    }
    const days = DAYS
      .map(day => [day, hourlyLevels(input, day)] as const)
      .filter(([, levels]) => levels.some(l => l !== null))
      .map(([day, levels]) => `${day}: { min: '${encode(levels, 'min')}', max: '${encode(levels, 'max')}' }`)
    if (days.length) lines.push(`  '${id}': { ${days.join(', ')} }`)
  }
  lines.sort()

  fs.writeFileSync(OUTPUT, `/*
 * Forecast platform crowding per station, day type and hour.
 *
 * GENERATED, do not edit by hand; re-run \`pnpm --filter api generate:density -- --remote\`.
 *
 * Each day is two 24-character strings, index = hour (WIB): the low and high
 * end of the model's range. 0 Lengang, 1 Ramai, 2 Padat, 3 Sangat Padat, and
 * '-' for no estimate (no or thin service). A modelled ESTIMATE from schedules,
 * ridership anchors and rider curves; never a live measurement.
 * Model: db/scripts/density/, rationale: docs/station-density.md.
 */
export interface DensityDay { min: string, max: string }

export const DENSITY_LEVELS: Record<string, Partial<Record<'WD' | 'SAT' | 'SUN', DensityDay>>> = {
${lines.join(',\n')}
}
`)
  console.log(`wrote ${lines.length} stations to ${OUTPUT}${LOCAL ? ' (LOCAL D1, re-run with --remote before shipping)' : ''}`)
}

main()
