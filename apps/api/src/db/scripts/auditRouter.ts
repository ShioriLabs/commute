import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { newInstrument, type PlanInstrument, type RouteLeg } from '@commute/tsundere'
import {
  assertBuildIsCurrent,
  DEFAULT_PAIRS,
  DEFAULT_SEED,
  loadNetwork,
  samplePairs,
  stopsOf
} from './benchShared'

/*
 * Measure what the planner RETURNS, over the same sample benchRouter times.
 *
 * The sibling of benchRouter, and the answer to a question timing cannot reach:
 * a change that costs 2x is only worth it if it finds journeys the old one
 * missed, and until now nothing counted those. The caps are documented as lossy
 * (see Bag.maxSize) but the size of the loss has never been measured, so every
 * argument about widening the search has been an argument about adjectives.
 *
 * Run:
 *   pnpm --filter api tsx ./src/db/scripts/auditRouter.ts
 *   pnpm --filter api tsx ./src/db/scripts/auditRouter.ts --save audit.json
 *   pnpm --filter api tsx ./src/db/scripts/auditRouter.ts --baseline audit.json
 *   pnpm --filter api tsx ./src/db/scripts/auditRouter.ts --bag 8 --slack 2
 *
 * Deliberately shares benchShared with benchRouter rather than loading its own
 * graph: an accuracy delta and a timing delta are only comparable when they
 * describe the same 300 pairs on the same network. It also runs WITHOUT
 * scoreFare, matching benchRouter — pricing changes which journeys win the
 * CHEAPEST label but not which ones the search finds, and leaving it out keeps
 * the two scripts measuring one variable.
 *
 * Child-process supervision is copied in shape from benchRouter for the same
 * reason it exists there: some ODs never finish, and an audit that hangs on pair
 * 47 says nothing about 48-299. A pair that never answers is itself a result
 * here — see the timed-out set in the report, which is a hard gate on any
 * configuration, since a percentile is only computed over pairs that ANSWERED.
 */

const DEFAULT_TIMEOUT_MS = 4000

interface Audit {
  index: number
  from: string
  to: string
  journeys: number
  /** Stops visited and where the walks fall, per journey — the rider-visible shape. */
  fingerprint: string
  counters: PlanInstrument
}

interface Baseline { pairs: [string, { journeys: number, fingerprint: string }][] }

interface Options { pairs: number, seed: number, timeoutMs: number, bag?: number, slack?: number, rounds?: number }

/*
 * The stops a journey visits and which of them it walks between.
 *
 * Mirrors plan.ts's own journeyPath, which is module-private and should stay
 * that way — the library exports what a caller cannot compute itself, and this
 * is computable from the legs it already returns. Blind to line codes on
 * purpose, so "the same trip on a different corridor" is one shape, matching how
 * the planner dedupes.
 */
function fingerprintOf(journeys: { legs: RouteLeg[] }[]): string {
  return journeys.map((journey) => {
    const path: string[] = []
    const push = (id: string) => {
      if (path[path.length - 1] !== id) path.push(id)
    }
    for (const leg of journey.legs) {
      if (leg.type === 'RIDE') {
        for (const id of leg.stationIds) push(id)
      } else {
        push(leg.fromStationId)
        path.push('~')
        path.push(leg.toStationId)
      }
    }
    return path.join('>')
  }).sort().join(' | ')
}

// ── child ────────────────────────────────────────────────────────────────────

function runChild(startIndex: number, skip: Set<number>, options: Options): void {
  const { router, edges } = loadNetwork()
  const pairs = samplePairs(stopsOf(edges), options.pairs, options.seed)

  for (let index = startIndex; index < pairs.length; index++) {
    if (skip.has(index)) continue
    const [from, to] = pairs[index]!

    const counters = newInstrument()
    const journeys = router.findRoutes(from, to, {
      instrument: counters,
      ...(options.bag !== undefined ? { maxBagSize: options.bag } : {}),
      ...(options.rounds !== undefined ? { maxRounds: options.rounds } : {})
    })

    const line: Audit = { index, from, to, journeys: journeys.length, fingerprint: fingerprintOf(journeys), counters }
    // Synchronous, for the same reason as benchRouter: the parent's deadline is
    // armed by these lines arriving, so buffering would look like a hang.
    writeFileSync(1, `${JSON.stringify(line)}\n`)
  }
}

// ── parent ───────────────────────────────────────────────────────────────────

async function auditAll(options: Options): Promise<{ results: Audit[], timedOut: number[] }> {
  const results: Audit[] = []
  const timedOut: number[] = []
  let next = 0

  for (;;) {
    /*
     * The last index THIS child reported, not the highest ever seen.
     *
     * A global max is wrong once any pair has been skipped: it stays pinned at
     * the furthest result from an earlier child, so every later timeout resolves
     * to the same `stuck` index, which is then skipped again, forever. The
     * symptom is a --skip list with one index repeated hundreds of times and a
     * run that never ends.
     */
    let lastInChild = -1
    const outcome = await new Promise<'done' | 'timeout'>((resolve) => {
      const child = spawn(process.execPath, [
        ...process.execArgv,
        __filename,
        '--child', String(next),
        '--skip', timedOut.join(','),
        '--pairs', String(options.pairs),
        '--seed', String(options.seed),
        ...(options.bag !== undefined ? ['--bag', String(options.bag)] : []),
        ...(options.slack !== undefined ? ['--slack', String(options.slack)] : []),
        ...(options.rounds !== undefined ? ['--rounds', String(options.rounds)] : [])
      ], { stdio: ['ignore', 'pipe', 'inherit'] })

      let buffer = ''
      let timer: NodeJS.Timeout
      /*
       * EVERY child pays process start and graph load before its first line, not
       * just the first one — a resumed child loads the whole network again. Arming
       * the real budget before anything has been reported therefore kills healthy
       * children and records pairs as non-terminating that answer fine, which is
       * the worst possible failure for a script whose timed-out set is a gate.
       */
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve('timeout')
        }, lastInChild === -1 ? options.timeoutMs + 30_000 : options.timeoutMs)
      }
      arm()

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const audit = JSON.parse(line) as Audit
          results.push(audit)
          lastInChild = audit.index
          arm()
        }
      })
      child.on('exit', () => {
        clearTimeout(timer)
        resolve('done')
      })
    })

    if (outcome === 'done') return { results, timedOut }

    const stuck = (lastInChild === -1 ? next - 1 : lastInChild) + 1
    timedOut.push(stuck)
    next = stuck + 1
    if (next >= options.pairs) return { results, timedOut }
  }
}

// ── reporting ────────────────────────────────────────────────────────────────

const COUNTER_KEYS = Object.keys(newInstrument()) as (keyof PlanInstrument)[]

function report(results: Audit[], timedOut: number[], options: Options): void {
  const answered = results.length
  const totals = newInstrument()
  for (const r of results) for (const key of COUNTER_KEYS) totals[key] += r.counters[key]

  const histogram = new Map<number, number>()
  for (const r of results) histogram.set(r.journeys, (histogram.get(r.journeys) ?? 0) + 1)

  console.log(`\njourneys returned (n=${answered}):`)
  for (const count of [...histogram.keys()].sort((a, b) => a - b)) {
    const pairs = histogram.get(count)!
    console.log(`  ${count} journeys  ${String(pairs).padStart(4)} pairs  ${(pairs / answered * 100).toFixed(1)}%`)
  }
  const mean = results.reduce((sum, r) => sum + r.journeys, 0) / answered
  console.log(`  mean ${mean.toFixed(3)} journeys/OD`)

  console.log('\nbag pressure (totals over the sample):')
  console.log(`  inserts offered        ${totals.inserts}`)
  console.log(`  accepted               ${totals.acceptedInserts}`)
  console.log(`  rejected by dominance  ${totals.rejectedByDominance}`)
  console.log(`  rejected as duplicate  ${totals.rejectedByDuplicate}`)
  console.log(`  dominated out          ${totals.dominatedOut}`)
  console.log(`  offered to a FULL bag  ${totals.saturatedInserts}`
    + `  (${(totals.saturatedInserts / Math.max(1, totals.inserts) * 100).toFixed(1)}% of offers)`)
  console.log(`  evictions              ${totals.evictions}`)
  console.log(`    of which self        ${totals.selfEvictions}`)
  console.log(`    LEAVING LINE EMPTY   ${totals.evictionsLeavingLineEmpty}`
    + '   <- the cap undoing per-line dominance')

  console.log('\nsearch shape:')
  console.log(`  adjacency lookups      ${totals.adjacencyLookups}`)
  console.log(`  labels expanded        ${totals.labelsExpanded}`)
  console.log(`  boardings-bound prunes ${totals.boardingsBoundPrunes}   <- heuristic, not sound`)
  console.log(`  target prunes          ${totals.targetPrunes}`)
  console.log(`  round-budget prunes    ${totals.roundBudgetPrunes}`)
  console.log(`  destination inserts    ${totals.destinationInserts}`)
  const deepest = results.reduce((max, r) => Math.max(max, r.counters.roundsUsed), 0)
  const atMax = results.filter(r => r.counters.roundsUsed >= (options.rounds ?? 4)).length
  console.log(`  deepest round reached  ${deepest}  (${atMax} pairs reached the round cap)`)

  console.log(`\nnever answered within ${options.timeoutMs}ms (${timedOut.length}):`)
  if (timedOut.length === 0) console.log('  none')
  else {
    const pairs = samplePairs(stopsOf(loadNetwork().edges), options.pairs, options.seed)
    for (const index of timedOut) console.log(`  #${index}  ${pairs[index]![0]} -> ${pairs[index]![1]}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const at = args.indexOf(name)
    return at === -1 ? undefined : args[at + 1]
  }
  const num = (name: string) => {
    const raw = flag(name)
    return raw === undefined ? undefined : Number(raw)
  }

  const options: Options = {
    pairs: Number(flag('--pairs') ?? DEFAULT_PAIRS),
    seed: Number(flag('--seed') ?? DEFAULT_SEED),
    timeoutMs: Number(flag('--timeout') ?? DEFAULT_TIMEOUT_MS),
    bag: num('--bag'),
    slack: num('--slack'),
    rounds: num('--rounds')
  }

  const childStart = flag('--child')
  if (childStart !== undefined) {
    const skip = new Set((flag('--skip') ?? '').split(',').filter(Boolean).map(Number))
    runChild(Number(childStart), skip, options)
    return
  }

  assertBuildIsCurrent()

  const settings = [
    options.bag !== undefined ? `bag ${options.bag}` : 'bag default',
    options.slack !== undefined ? `slack ${options.slack}` : 'slack default',
    options.rounds !== undefined ? `rounds ${options.rounds}` : 'rounds default'
  ].join(', ')
  console.log(`auditing ${options.pairs} OD pairs (seed ${options.seed}, ${settings})`)

  const { results, timedOut } = await auditAll(options)
  report(results, timedOut, options)

  const savePath = flag('--save')
  if (savePath) {
    const baseline: Baseline = {
      pairs: results.map(r => [`${r.from}>${r.to}`, { journeys: r.journeys, fingerprint: r.fingerprint }])
    }
    writeFileSync(savePath, JSON.stringify(baseline))
    console.log(`\nsaved audit baseline to ${savePath}`)
  }

  const baselinePath = flag('--baseline')
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as Baseline
    const before = new Map(baseline.pairs)
    let gained = 0
    let lost = 0
    let changedShape = 0
    const examples: string[] = []
    for (const r of results) {
      const was = before.get(`${r.from}>${r.to}`)
      if (!was) continue
      if (r.journeys > was.journeys) gained++
      if (r.journeys < was.journeys) lost++
      if (r.fingerprint !== was.fingerprint) {
        changedShape++
        if (examples.length < 10) {
          examples.push(`  ${r.from} -> ${r.to}: ${was.journeys} -> ${r.journeys} journeys`)
        }
      }
    }
    const shared = results.filter(r => before.has(`${r.from}>${r.to}`)).length
    console.log(`\nvs baseline over ${shared} shared pairs:`)
    console.log(`  more journeys   ${gained}`)
    console.log(`  fewer journeys  ${lost}`)
    console.log(`  result set changed at all  ${changedShape}`)
    /*
     * A changed result set is not by itself an improvement — it has to be read.
     * A wider bag can just as easily surface a near-duplicate as a genuinely
     * different option, and only a person looking at the journeys can tell.
     */
    if (examples.length > 0) {
      console.log('\nchanged (first 10, inspect these rather than trusting the count):')
      for (const line of examples) console.log(line)
    }
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
