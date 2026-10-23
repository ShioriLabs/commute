import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import type { EdgeInput, RouteLeg, TransferInput, Tsundere } from '@commute/tsundere'
import { routerFromInputs } from '../../routes/fares'
import { searchTrips } from '../../routes/internal'
import type { PlaceIndex } from '../../utils/places'
import { percentile, samplePairs, stopsOf } from './benchShared'

/*
 * Before/after for a change to how the SEARCH ranks journeys: what each pair's
 * journeys are, in order, and what a search costs, through the real request
 * path (`searchTrips`, observed headways on) on the committed network snapshot.
 *
 *   pnpm --filter api ab:search-order --save before.json
 *   pnpm --filter api ab:search-order --baseline before.json [--examples 20]
 *
 * Compare against a baseline saved from the build before the change. The
 * engine resolves `@commute/tsundere` from dist, so rebuild it between runs.
 * findRoute runs beside each search as the machine's control, so two runs can
 * be compared on time as well as on answers.
 */

const { values: args } = parseArgs({
  options: {
    pairs: { type: 'string', default: '2000' },
    seed: { type: 'string', default: '42' },
    examples: { type: 'string', default: '20' },
    save: { type: 'string' },
    baseline: { type: 'string' }
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

const describe = (legs: readonly RouteLeg[]) => legs
  .map(l => (l.type === 'RIDE' ? `${l.operator}:${l.lineCode} ${l.fromStationId}>${l.toStationId}` : `walk ${Math.round(l.distanceM)}m`))
  .join(' | ')
const hasTj = (journey: string) => journey.includes('TJ:')

interface Run {
  /** `${moment}|${from}>${to}` -> journeys in engine order. */
  answers: Record<string, string[]>
  searchMs: number[]
  controlMs: number[]
}

function measure(): Run {
  const pairs = samplePairs(stopsOf(snapshot.edges), Number(args.pairs), Number(args.seed))
  const run: Run = { answers: {}, searchMs: [], controlMs: [] }
  for (const moment of MOMENTS) {
    const context = { paymentMethod: 'STORED_VALUE' as const, departureAt: new Date(moment.at) }
    for (const [from, to] of pairs) {
      const c0 = performance.now()
      router.findRoute(from, to)
      run.controlMs.push(performance.now() - c0)
      const t0 = performance.now()
      const { journeys } = searchTrips(router, from, to, { places, context, observed: true })
      run.searchMs.push(performance.now() - t0)
      run.answers[`${moment.label}|${from}>${to}`] = journeys.map(j => describe(j.legs))
    }
  }
  return run
}

function timing(label: string, run: Run) {
  const s = [...run.searchMs].sort((a, b) => a - b)
  const c = [...run.controlMs].sort((a, b) => a - b)
  const control = percentile(c, 0.5)
  console.log(`${label}: search p50 ${percentile(s, 0.5).toFixed(2)} ms, p95 ${percentile(s, 0.95).toFixed(2)} ms, max ${s.at(-1)!.toFixed(1)} ms; findRoute control p50 ${control.toFixed(3)} ms (search/control p50 ${(percentile(s, 0.5) / control).toFixed(1)}x)`)
}

function compare(before: Run, after: Run) {
  const examples = Number(args.examples)
  for (const moment of MOMENTS) {
    let compared = 0, topChanged = 0, setChanged = 0
    const kinds = new Map<string, number>()
    const shown: string[] = []
    for (const [key, was] of Object.entries(before.answers)) {
      if (!key.startsWith(`${moment.label}|`)) continue
      const now = after.answers[key]
      if (!now || was.length === 0 || now.length === 0) continue
      compared++
      if ([...was].sort().join('\n') !== [...now].sort().join('\n')) setChanged++
      if (was[0] === now[0]) continue
      topChanged++
      const kind = `${hasTj(now[0]!) ? 'TJ' : 'no-TJ'} over ${hasTj(was[0]!) ? 'TJ' : 'no-TJ'}`
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      if (shown.length < examples) shown.push(`  ${key.split('|')[1]}\n    was: ${was[0]}\n    now: ${now[0]}`)
    }
    const pct = (n: number) => (compared === 0 ? '-' : `${((100 * n) / compared).toFixed(1)}%`)
    console.log(`## ${moment.label}: ${compared} pairs; top journey changed ${topChanged} (${pct(topChanged)}), journey set changed ${setChanged} (${pct(setChanged)})`)
    console.log(`  ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`)
    if (shown.length > 0) console.log(shown.join('\n'))
  }
}

function main() {
  const run = measure()
  timing('this build', run)
  if (args.save) writeFileSync(args.save, JSON.stringify(run))
  if (args.baseline) {
    const before = JSON.parse(readFileSync(args.baseline, 'utf-8')) as Run
    timing('baseline', before)
    compare(before, run)
  }
}

main()
