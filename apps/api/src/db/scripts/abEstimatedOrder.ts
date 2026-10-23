import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import type { EdgeInput, RouteLeg, TransferInput, Tsundere } from '@commute/tsundere'
import { estimateInputs, routerFromInputs } from '../../routes/fares'
import { searchTrips } from '../../routes/internal'
import { estimateTjLeg, type RuntimeStatistic } from '../../utils/observedRuntimes'
import type { PlaceIndex } from '../../utils/places'
import { DAY_MASK } from '../schemas/schedules'
import { percentile, samplePairs, stopsOf } from './benchShared'
import { serviceDay } from '../../utils/fare'

/*
 * A/B for the observed-runtimes sort mode (config:observed-runtimes = sort;
 * docs/tj-observed-timings.md): how often, and how, ordering journeys by
 * estimated arrival changes the top journey a rider sees.
 *
 *   pnpm --filter api ab:estimated-order [--pairs 2000] [--seed 42] [--examples 20]
 *
 * Runs on the committed network snapshot (db/data/network.snapshot.json), the
 * same graph as the route regression suite, through `searchTrips` with observed
 * headways on. Ordering is emulated at the engine level with the same rule as
 * journey-times.ts `byArrival`: journeys with a timetable arrival (or, in sort
 * mode, an estimated one) sort by it, the rest keep the engine's order behind.
 * The wire pass also merges walks and interlined legs first; neither changes
 * which journey arrives first, so the engine level answers the question.
 *
 * Arms: `fields` (the engine's order behind timetabled arrivals), `sort` on the
 * median estimate, `sort` on the p75 estimate, and `sort` on the median where a
 * journey only overtakes the engine's order by --margin seconds or more (what
 * ships; journey-times.ts byArrival, ESTIMATE_OVERTAKE_S). Nothing here changes
 * behaviour; it only measures.
 */

const { values: args } = parseArgs({
  options: {
    pairs: { type: 'string', default: '2000' },
    seed: { type: 'string', default: '42' },
    examples: { type: 'string', default: '20' },
    margin: { type: 'string', default: '180' }
  }
})

interface NetworkSnapshot {
  edges: EdgeInput[]
  transfers: TransferInput[]
  places: string[][]
}

const snapshot = JSON.parse(readFileSync(`${__dirname}/../data/network.snapshot.json`, 'utf-8')) as NetworkSnapshot
const router: Tsundere = routerFromInputs(snapshot)
const places: PlaceIndex = new Map(snapshot.places.flatMap((group) => {
  const members = new Set(group)
  return group.map(id => [id, members] as const)
}))

const MOMENTS = [
  { label: 'WD 07:30', at: '2026-10-14T07:30:00+07:00' },
  { label: 'WD 12:00', at: '2026-10-14T12:00:00+07:00' },
  { label: 'WD 17:30', at: '2026-10-14T17:30:00+07:00' },
  { label: 'WD 21:00', at: '2026-10-14T21:00:00+07:00' },
  { label: 'WE 12:00', at: '2026-10-18T12:00:00+07:00' }
]

type Legs = readonly RouteLeg[]
type Arm = 'median' | 'p75' | 'margin'
const ARMS: readonly Arm[] = ['median', 'p75', 'margin']
const MARGIN_S = Number(args.margin)
const hasTj = (legs: Legs) => legs.some(l => l.type === 'RIDE' && l.operator === 'TJ')
const describe = (legs: Legs) => legs
  .map(l => (l.type === 'RIDE' ? `${l.operator}:${l.lineCode} ${l.fromStationId}>${l.toStationId}` : `walk ${Math.round(l.distanceM)}m`))
  .join(' | ')
const hhmm = (s: number) => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

interface Row {
  legs: Legs
  /** Timetable arrival, seconds since midnight, or null. */
  exact: number | null
  median: number | null
  p75: number | null
}

/** An arm's sort key for a row with no timetable arrival. */
function estimateFor(r: Row, arm: Arm): number | null {
  return arm === 'p75' ? r.p75 : r.median
}

/** byArrival as it runs for `fields`, or for the sort mode with the given arm. Returns row indexes in order. */
function order(rows: Row[], key: 'none' | Arm): number[] {
  const arrival = (r: Row) => r.exact ?? (key === 'none' ? null : estimateFor(r, key))
  const idx = rows.map((_, i) => i)
  const timed = idx.filter(i => arrival(rows[i]!) !== null)
  const untimed = idx.filter(i => arrival(rows[i]!) === null)
  if (rows.length < 2 || timed.length < 2) return idx
  if (key !== 'margin') return [...[...timed].sort((a, b) => arrival(rows[a]!)! - arrival(rows[b]!)!), ...untimed]
  // The overtake rule, as in byArrival: zero margin between two timetabled rows.
  const margin = (a: Row, b: Row) => (a.exact === null || b.exact === null ? MARGIN_S : 0)
  const remaining = [...timed]
  const ordered: number[] = []
  while (remaining.length > 0) {
    let lead = remaining[0]!
    for (const i of remaining) if (arrival(rows[i]!)! < arrival(rows[lead]!)!) lead = i
    const next = remaining.findIndex((i) => {
      const behind = arrival(rows[i]!)! - arrival(rows[lead]!)!
      return behind <= 0 || behind < margin(rows[i]!, rows[lead]!)
    })
    ordered.push(...remaining.splice(next, 1))
  }
  return [...ordered, ...untimed]
}

function main() {
  const pairs = samplePairs(stopsOf(snapshot.edges), Number(args.pairs), Number(args.seed))
  const examples = Number(args.examples)
  console.log(`${pairs.length} seeded pairs (seed ${args.seed}) x ${MOMENTS.length} moments, network snapshot\n`)

  for (const moment of MOMENTS) {
    const departureAt = new Date(moment.at)
    const context = { paymentMethod: 'STORED_VALUE' as const, departureAt }
    const departureS = Math.round((departureAt.getTime() / 1000 + 7 * 3600) % 86_400)
    const dayMask = DAY_MASK[serviceDay(departureAt)]
    const inputs = estimateInputs(context, true)

    const stats = {
      routed: 0, multi: 0, tjRows: 0, tjEstimated: 0,
      changed: { median: 0, p75: 0, margin: 0 } as Record<Arm, number>,
      kinds: { median: new Map(), p75: new Map(), margin: new Map() } as Record<Arm, Map<string, number>>,
      gains: { median: [], p75: [], margin: [] } as Record<Arm, number[]>,
      estimateMs: [] as number[]
    }
    const shown: string[] = []

    for (const [from, to] of pairs) {
      const { journeys } = searchTrips(router, from, to, { places, context, observed: true })
      if (journeys.length === 0) continue
      stats.routed++
      const t0 = performance.now()
      const rows: Row[] = journeys.map((j) => {
        const timings = router.timeJourney(j.legs, { departureS, dayMask })
        const exact = router.journeyArrival(j.legs, timings)
        if (exact !== null || !hasTj(j.legs)) return { legs: j.legs, exact, median: null, p75: null }
        const estimate = (statistic: RuntimeStatistic) => router.estimateJourney(j.legs, {
          departureS,
          dayMask,
          estimateUntimed: (leg, s) => estimateTjLeg(leg, s, { ...inputs, statistic })
        })?.arrivalS ?? null
        return { legs: j.legs, exact, median: estimate('median'), p75: estimate('p75') }
      })
      stats.estimateMs.push(performance.now() - t0)

      for (const r of rows) {
        if (r.exact === null && hasTj(r.legs)) {
          stats.tjRows++
          if (r.median !== null) stats.tjEstimated++
        }
      }
      if (rows.length < 2) continue
      stats.multi++

      const before = order(rows, 'none')[0]!
      for (const key of ARMS) {
        const after = order(rows, key)[0]!
        if (after === before) continue
        stats.changed[key]++
        const kindOf = (r: Row) => (r.exact !== null ? 'timetabled' : 'estimated')
        const kind = `${kindOf(rows[after]!)} over ${kindOf(rows[before]!)}`
        stats.kinds[key].set(kind, (stats.kinds[key].get(kind) ?? 0) + 1)
        // Both sides on the same footing: the timetable where there is one, the median estimate otherwise.
        const arrival = (r: Row) => r.exact ?? r.median
        const gain = arrival(rows[before]!) !== null && arrival(rows[after]!) !== null
          ? arrival(rows[before]!)! - arrival(rows[after]!)!
          : null
        if (gain !== null) stats.gains[key].push(gain / 60)
        if (key === 'margin' && shown.length < examples) {
          const b = rows[before]!, a = rows[after]!
          shown.push([
            `  ${from} -> ${to}`,
            `    was: ${describe(b.legs)}  [${b.exact !== null ? `arrives ${hhmm(b.exact)}` : b.median !== null ? `est ${hhmm(b.median)}` : 'untimed'}]`,
            `    now: ${describe(a.legs)}  [${a.exact !== null ? `arrives ${hhmm(a.exact)}` : `est ${hhmm(a.median!)} (p75 ${a.p75 !== null ? hhmm(a.p75) : '-'})`}]`
          ].join('\n'))
        }
      }
    }

    const pct = (n: number, d: number) => (d === 0 ? '-' : `${((100 * n) / d).toFixed(1)}%`)
    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
    console.log(`## ${moment.label}`)
    console.log(`  routed ${stats.routed}, with 2+ journeys ${stats.multi}`)
    console.log(`  TJ rows without a timetable arrival: ${stats.tjRows}, estimated ${stats.tjEstimated} (${pct(stats.tjEstimated, stats.tjRows)})`)
    for (const key of ARMS) {
      const g = sorted(stats.gains[key])
      const kinds = [...stats.kinds[key]].map(([k, n]) => `${k} ${n}`).join(', ')
      console.log(`  sort/${key}: top changes on ${stats.changed[key]} of ${stats.multi} (${pct(stats.changed[key], stats.multi)}); ${kinds || '-'}`)
      if (g.length > 0) console.log(`    estimated gain min: median ${percentile(g, 0.5).toFixed(1)}, p90 ${percentile(g, 0.9).toFixed(1)}, min ${g[0]!.toFixed(1)}`)
    }
    const ms = sorted(stats.estimateMs)
    console.log(`  timing + estimate per pair: p50 ${percentile(ms, 0.5).toFixed(2)} ms, p95 ${percentile(ms, 0.95).toFixed(2)} ms`)
    if (shown.length > 0) console.log(`  examples (sort/margin):\n${shown.join('\n')}`)
    console.log()
  }
}

main()
