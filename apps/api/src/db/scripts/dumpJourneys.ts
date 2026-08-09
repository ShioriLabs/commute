import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { loadGraph } from '@commute/tsundere'
import type { RouteLeg } from '@commute/tsundere'
import { summarizeFares } from '../../utils/fare-summary'
import { mergeInterlinedLegs } from '../../utils/interlining'
import { HEADWAYS_S } from '../data/headways'
import { ENDPOINT_RESTRICTIONS } from '../data/topology'

/*
 * Dump real findRoutes output as JSON, for design work.
 *
 * Not a test and not a production path. The UI sketches for the multi-journey
 * results screen need numbers the engine actually produces — inventing
 * plausible ones hides exactly the cases the design has to survive (a journey
 * with no fare, four near-identical options, a 900m walk).
 *
 * Run: pnpm --filter api tsx ./src/db/scripts/dumpJourneys.ts
 */

const OD_PAIRS: [string, string][] = [
  ['KCI-CUK', 'TJ-H00098P'],
  ['MRTJ-LBB', 'LRTJBDB-JTM'],
  ['KCI-BKS', 'MRTJ-BLA'],
  ['KCI-SUD', 'MRTJ-LBB'],
  ['TJ-H00061S', 'KCI-AC']
]

interface Row { lineCode: string, fromStationId: string, toStationId: string, distance: number }
interface TransferRow { fromStationId: string, toStationId: string | null, distance: number, noTap: number }
interface StationRow { id: string, name: string, operator: string }

function query<T>(sql: string): T[] {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'commute', '--local', '--command', sql, '--json'],
    { cwd: `${__dirname}/../../..`, encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 }
  )
  return JSON.parse(raw.slice(raw.indexOf('[')))[0].results as T[]
}

const edges = query<Row>('SELECT lineCode, fromStationId, toStationId, distance FROM edges')
const transfers = query<TransferRow>(
  'SELECT fromStationId, toStationId, distance, noTap FROM transfers WHERE dataType = \'INTERNAL\''
)
const stations = query<StationRow>('SELECT id, name, operator FROM stations')
const stationName = new Map(stations.map(s => [s.id, s.name]))

/*
 * Line names and colours are not in D1 — they live behind /operators, which is
 * the same dictionary the web app resolves `KCI:C` against. Fetch once into
 * scratch/operators.json:
 *   curl -s https://api.commute.shiorilabs.id/operators -o scratch/operators.json
 */
interface OperatorDoc {
  data: { code: string, lines: { lineCode: string, name: string, colorCode: string }[] }[]
}
const operators: OperatorDoc = JSON.parse(
  readFileSync(`${__dirname}/../../../../../scratch/operators.json`, 'utf-8')
)
const lineName = new Map<string, string>()
const lineColor = new Map<string, string>()
const lineOperator = new Map<string, string>()
for (const operator of operators.data) {
  for (const line of operator.lines) {
    lineName.set(line.lineCode, line.name)
    lineColor.set(line.lineCode, line.colorCode)
    lineOperator.set(line.lineCode, operator.code)
  }
}

const tsun = loadGraph({
  edges,
  transfers,
  restrictions: ENDPOINT_RESTRICTIONS.map(r => ({
    stationId: `${r.operator}-${r.station}`,
    forbiddenNeighborId: `${r.operator}-${r.forbiddenNeighbor}`
  })),
  headwaysS: new Map(Object.entries(HEADWAYS_S))
})

const context = {
  paymentMethod: 'STORED_VALUE' as const,
  departureAt: new Date('2026-08-03T09:00:00+07:00')
}
const scoreFare = (legs: readonly RouteLeg[]): number | null => {
  try {
    return summarizeFares(mergeInterlinedLegs([...legs]), context).totalFare
  } catch {
    return null
  }
}

const describe = (leg: RouteLeg) => {
  const base = {
    type: leg.type,
    from: stationName.get(leg.fromStationId) ?? leg.fromStationId,
    to: stationName.get(leg.toStationId) ?? leg.toStationId,
    fromId: leg.fromStationId,
    toId: leg.toStationId
  }
  if (leg.type !== 'RIDE') return { ...base, distanceM: leg.distanceM }
  return {
    ...base,
    lineCode: leg.lineCode,
    lineName: lineName.get(leg.lineCode) ?? leg.lineCode,
    lineColor: lineColor.get(leg.lineCode) ?? '#888888',
    operator: lineOperator.get(leg.lineCode) ?? leg.fromStationId.split('-')[0],
    distanceM: leg.distanceM,
    stopCount: leg.stationIds.length - 1,
    stations: leg.stationIds.map(id => stationName.get(id) ?? id)
  }
}

const output = OD_PAIRS.map(([from, to]) => {
  const journeys = tsun.findRoutes(from, to, { scoreFare })
  return {
    from: stationName.get(from) ?? from,
    to: stationName.get(to) ?? to,
    fromId: from,
    toId: to,
    journeys: journeys.map(j => ({
      criteria: j.criteria,
      labels: j.labels,
      legs: j.legs.map(describe)
    }))
  }
})

const path = `${__dirname}/../../../../../scratch/journeys.json`
writeFileSync(path, JSON.stringify(output, null, 2))
console.log(`wrote ${path}`)
for (const od of output) {
  console.log(`\n${od.from} -> ${od.to}: ${od.journeys.length} journeys`)
  for (const j of od.journeys) {
    const c = j.criteria
    console.log(
      `  [${j.labels.join(', ') || '-'}] board ${c.boardings}, ride ${c.rideDistanceM}m,`
      + ` walk ${c.walkDistanceM}m, wait ${Math.round(c.waitS)}s, fare ${c.fare ?? '?'}`
    )
    for (const leg of j.legs) {
      const what = 'lineName' in leg ? `${leg.lineName} (${leg.stopCount} stops)` : 'walk'
      console.log(`      ${what}: ${leg.from} > ${leg.to} ${leg.distanceM}m`)
    }
  }
}
