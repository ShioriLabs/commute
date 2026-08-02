import { execFileSync } from 'node:child_process'
import { loadGraph } from '@commute/tsundere'
import type { RouteLeg } from '@commute/tsundere'
import { summarizeFares } from '../../utils/fare-summary'
import { mergeInterlinedLegs } from '../../utils/interlining'
import { HEADWAYS_S } from '../data/headways'
import { ENDPOINT_RESTRICTIONS } from '../data/topology'

/*
 * Diff the multi-criteria planner against findRoute on the real network.
 *
 * Not a test and not a production path — a throwaway harness for the one
 * question Phase 2 cannot answer from fixtures: does the new engine agree with
 * the old one where it should, and where it differs, is the difference
 * explainable?
 *
 * Every difference must land in one of two buckets:
 *   - the `incomingLine` state-space fix (findRoute applied a line-change
 *     penalty against a predecessor a later relaxation superseded), or
 *   - the wait model (waiting is now an explicit criterion rather than being
 *     folded into LINE_CHANGE_PENALTY_M).
 * Anything else is a bug.
 *
 * Also reports bag pressure, which fixtures cannot measure: the caps are an
 * approximation, and TJ's overlapping corridors are the shape that stresses them.
 *
 * Run: pnpm --filter api tsx ./src/db/scripts/compareRouters.ts
 */

const OD_PAIRS: [string, string][] = [
  // The golden set, exercising each known behaviour.
  ['KCI-SUD', 'MRTJ-LBB'],
  ['MRTJ-BNH', 'LRTJBDB-RAS'],
  ['KCI-AC', 'MRTJ-DKA'],
  ['TJ-H00061S', 'KCI-AC'],
  ['KCI-PSE', 'KCI-GST'],
  ['KCI-GST', 'KCI-PSE'],
  ['KCI-SUD', 'LRTJBDB-DKA'],
  ['LRTJBDB-DKA', 'LRTJBDB-JTM'],
  ['TJ-H00003P', 'TJ-H00061S'],
  ['TJ-H00061S', 'TJ-H00003P'],
  ['TJ-H00010P', 'TJ-H00069P'],
  // Corridor-overlap shapes, where bags are most likely to blow up.
  ['TJ-H00093P', 'TJ-H00069P'],
  ['KCI-BOO', 'KCI-JAKK'],
  ['KCI-BKS', 'MRTJ-BLA'],
  ['MRTJ-LBB', 'LRTJBDB-JTM']
]

interface Row {
  lineCode: string
  fromStationId: string
  toStationId: string
  distance: number
}
interface TransferRow {
  fromStationId: string
  toStationId: string | null
  distance: number
  noTap: number
}

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

const restrictions = ENDPOINT_RESTRICTIONS.map(r => ({
  stationId: `${r.operator}-${r.station}`,
  forbiddenNeighborId: `${r.operator}-${r.forbiddenNeighbor}`
}))

const tsun = loadGraph({
  edges,
  transfers,
  restrictions,
  headwaysS: new Map(Object.entries(HEADWAYS_S))
})

console.log(`graph: ${tsun.stopCount} stops, ${edges.length} edges, ${transfers.length} transfers\n`)

/*
 * The real fare pipeline, as the scorer.
 *
 * This is the interface the engine has never actually been run against: the
 * unit tests stub the hook, so nothing has yet proved that legs produced by the
 * planner survive mergeInterlinedLegs (which matches stationIds against
 * TOPOLOGY paths) and summarizeFares (which reads noTap and positional
 * neighbours). Order matters and mirrors routes/fares.ts: merge first, then
 * price.
 */
const context = { paymentMethod: 'STORED_VALUE' as const, departureAt: new Date('2026-08-03T12:00:00+07:00') }
let scorerCalls = 0
let scorerFailures = 0
const scoreFare = (legs: readonly RouteLeg[]): number | null => {
  scorerCalls++
  try {
    return summarizeFares(mergeInterlinedLegs([...legs]), context).totalFare
  } catch (error) {
    scorerFailures++
    console.log(`    SCORER THREW: ${(error as Error).message}`)
    return null
  }
}

const shape = (legs: readonly { type: string, fromStationId: string, toStationId: string }[]) =>
  legs.map(l => `${l.type[0]}:${l.fromStationId}>${l.toStationId}`).join(' ')

let identical = 0
let differing = 0
let unroutable = 0

for (const [from, to] of OD_PAIRS) {
  const started = Date.now()
  const single = tsun.findRoute(from, to)
  const multi = tsun.findRoutes(from, to, { scoreFare })
  const elapsed = Date.now() - started

  const primary = multi[0]
  if (!single && !primary) {
    unroutable++
    console.log(`— ${from} -> ${to}: both unroutable`)
    continue
  }
  if (!single || !primary) {
    differing++
    console.log(`! ${from} -> ${to}: findRoute=${single ? 'route' : 'null'} plan=${primary ? 'route' : 'null'}`)
    continue
  }

  const same = shape(single) === shape(primary.legs)
  if (same) identical++
  else differing++

  const c = primary.criteria
  console.log(
    `${same ? '=' : 'D'} ${from} -> ${to}  ${elapsed}ms  alts=${multi.length}`
    + `  [board ${c.boardings}, ride ${c.rideDistanceM}m, walk ${c.walkDistanceM}m,`
    + ` wait ${Math.round(c.waitS)}s, fare ${c.fare ?? 'unknown'}]`
  )
  if (!same) {
    console.log(`    findRoute: ${shape(single)}`)
    console.log(`    plan[0]:   ${shape(primary.legs)}`)
  }
}

console.log(`\nprimary route identical: ${identical} | differing: ${differing} | both unroutable: ${unroutable}`)
console.log(`fare scorer: ${scorerCalls} calls, ${scorerFailures} threw`)

/*
 * Cross-check: the fare the engine reports for its primary route must match
 * what the API's own pipeline computes for the same legs. A mismatch means the
 * hook is being handed something different from what fares.ts would build.
 */
let fareMismatches = 0
for (const [from, to] of OD_PAIRS) {
  const [primary] = tsun.findRoutes(from, to, { scoreFare })
  if (!primary) continue
  const direct = summarizeFares(mergeInterlinedLegs([...primary.legs]), context).totalFare
  if (direct !== primary.criteria.fare) {
    fareMismatches++
    console.log(`fare mismatch ${from} -> ${to}: hook=${primary.criteria.fare} direct=${direct}`)
  }
}
console.log(`fare cross-check mismatches: ${fareMismatches}`)
