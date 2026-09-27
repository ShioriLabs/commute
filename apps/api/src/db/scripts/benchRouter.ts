import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  assertBuildIsCurrent,
  DEFAULT_PAIRS,
  DEFAULT_SEED,
  loadNetwork,
  percentile,
  samplePairs,
  stopsOf
} from './benchShared'

/*
 * Time findRoute and findRoutes over a deterministic sample of the real network.
 *
 * Not a test and not a production path. It exists because the planner's cost has
 * moved several times and every guess about where it went has been wrong — the
 * only way to know whether a change is affordable is to measure it against the
 * whole graph, twice, on the same machine.
 *
 * Run:
 *   pnpm --filter api tsx ./src/db/scripts/benchRouter.ts
 *   pnpm --filter api tsx ./src/db/scripts/benchRouter.ts --save baseline.json
 *   pnpm --filter api tsx ./src/db/scripts/benchRouter.ts --baseline baseline.json
 *   pnpm --filter api tsx ./src/db/scripts/benchRouter.ts --od KCI-BOO MRTJ-LBB
 *
 * Three things this is shaped around, each of which has cost someone a round:
 *
 * 1. `@commute/tsundere` resolves to its BUILT output, not to src. Editing the
 *    planner and re-running this measures the previous build — silently, with
 *    plausible numbers. `assertBuildIsCurrent` (benchShared) refuses to run
 *    rather than report a comparison between two identical builds.
 *
 * 2. Some ODs never finish. The search explodes in its last round on at least
 *    two pairs (Pisangan -> Warung Jati, Pasar Enjo -> Terminal 1), and since
 *    the planner is synchronous nothing inside this process can interrupt it.
 *    Measuring therefore happens in a child process the parent can kill, and
 *    resume past. A run that just hung would tell you nothing about the other
 *    299 pairs.
 *
 * 3. Absolute milliseconds do not travel between machines. findRoute is the
 *    control: it is untouched by planner work, so its median converts any
 *    machine into a factor. Compare planner numbers only after dividing by it.
 */

// Generous: the slowest legitimate OD measured is ~150ms, and a pair that has
// not answered in four seconds is not slow, it is gone.
const DEFAULT_TIMEOUT_MS = 4000

interface Measurement { index: number, from: string, to: string, findRouteMs: number, planMs: number, journeys: number }
interface Baseline { calibrationMedianMs: number, pairs: [string, number][] }

/*
 * Planner knobs are passed through to the child rather than read from DEFAULTS,
 * so a sweep runs without editing source between configurations — which the
 * staleness guard would otherwise turn into a rebuild per data point.
 */
interface BenchOptions { pairs: number, seed: number, timeoutMs: number, bag?: number, rounds?: number }

// ── child: measures, one pair per line of NDJSON ─────────────────────────────

function runChild(startIndex: number, skip: Set<number>, options: BenchOptions): void {
  const { router, edges } = loadNetwork()
  const pairs = samplePairs(stopsOf(edges), options.pairs, options.seed)

  for (let index = startIndex; index < pairs.length; index++) {
    if (skip.has(index)) continue
    const [from, to] = pairs[index]!

    const routeStart = performance.now()
    router.findRoute(from, to)
    const findRouteMs = performance.now() - routeStart

    const planStart = performance.now()
    const journeys = router.findRoutes(from, to, {
      ...(options.bag !== undefined ? { maxBagSize: options.bag } : {}),
      ...(options.rounds !== undefined ? { maxRounds: options.rounds } : {})
    }).length
    const planMs = performance.now() - planStart

    const line: Measurement = { index, from, to, findRouteMs, planMs, journeys }
    // Synchronous write: the parent's per-pair deadline is armed by these lines
    // arriving, so a buffered stdout would look exactly like a hang.
    writeFileSync(1, `${JSON.stringify(line)}\n`)
  }
}

// ── parent: supervises, resumes past pairs that never answer ─────────────────

async function measureAll(options: BenchOptions): Promise<{ results: Measurement[], timedOut: number[] }> {
  const results: Measurement[] = []
  const timedOut: number[] = []
  let next = 0

  for (;;) {
    /*
     * The last index THIS child reported, not the highest ever seen. A global max
     * stays pinned at an earlier child's furthest result once anything has been
     * skipped, so every later timeout resolves to the same index and the run never
     * ends. Latent here until a configuration produces several timeouts.
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
        ...(options.rounds !== undefined ? ['--rounds', String(options.rounds)] : [])
      ], { stdio: ['ignore', 'pipe', 'inherit'] })

      let buffer = ''
      let timer: NodeJS.Timeout
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve('timeout')
        // The first pair also pays for process start and graph load, so the very
        // first deadline is generous; every later one is the real budget.
        // Every child pays process start and graph load before its first line,
        // not just the first child — a resumed one reloads the whole network.
        }, lastInChild === -1 ? options.timeoutMs + 30_000 : options.timeoutMs)
      }
      arm()

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const measurement = JSON.parse(line) as Measurement
          results.push(measurement)
          lastInChild = measurement.index
          arm()
        }
      })
      child.on('exit', () => {
        clearTimeout(timer)
        resolve('done')
      })
    })

    if (outcome === 'done') return { results, timedOut }

    // The pair that never answered is the one after the last this child reported.
    const stuck = (lastInChild === -1 ? next - 1 : lastInChild) + 1
    timedOut.push(stuck)
    next = stuck + 1
    if (next >= options.pairs) return { results, timedOut }
  }
}

// ── reporting ────────────────────────────────────────────────────────────────

function summarise(label: string, times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  const median = percentile(sorted, 0.5)
  console.log(
    `${label.padEnd(24)} n=${sorted.length}  median ${median.toFixed(2)}ms`
    + `  p95 ${percentile(sorted, 0.95).toFixed(2)}ms  max ${(sorted[sorted.length - 1] ?? 0).toFixed(2)}ms`
  )
  return median
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

  const options: BenchOptions = {
    pairs: Number(flag('--pairs') ?? DEFAULT_PAIRS),
    seed: Number(flag('--seed') ?? DEFAULT_SEED),
    timeoutMs: Number(flag('--timeout') ?? DEFAULT_TIMEOUT_MS),
    bag: num('--bag'),
    rounds: num('--rounds')
  }

  const childStart = flag('--child')
  if (childStart !== undefined) {
    const skip = new Set((flag('--skip') ?? '').split(',').filter(Boolean).map(Number))
    runChild(Number(childStart), skip, options)
    return
  }

  assertBuildIsCurrent()

  const od = args.indexOf('--od')
  if (od !== -1) {
    const [from, to] = [args[od + 1]!, args[od + 2]!]
    const { router } = loadNetwork()
    console.log(`${from} -> ${to}`)
    // Five runs: the first pays for a cold cache and JIT warmup, and reporting
    // it alone would overstate the cost of every OD.
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      const journeys = router.findRoutes(from, to, {
        ...(options.bag !== undefined ? { maxBagSize: options.bag } : {}),
        ...(options.rounds !== undefined ? { maxRounds: options.rounds } : {})
      }).length
      console.log(`  ${(performance.now() - start).toFixed(1)}ms (${journeys} journeys)`)
    }
    return
  }

  const settings = [
    options.bag !== undefined ? `bag ${options.bag}` : 'bag default',
    options.rounds !== undefined ? `rounds ${options.rounds}` : 'rounds default'
  ].join(', ')
  console.log(`sampling ${options.pairs} OD pairs (seed ${options.seed}, ${options.timeoutMs}ms per pair, ${settings})\n`)

  const { results, timedOut } = await measureAll(options)

  const calibrationMedian = summarise('findRoute (control)', results.map(r => r.findRouteMs))
  summarise('findRoutes (planner)', results.map(r => r.planMs))
  console.log(`\nmachine factor: findRoute median is ${(calibrationMedian / 1.6).toFixed(2)}x the 1.6ms reference`)
  console.log('divide planner numbers by that before comparing them to anyone else\'s')

  if (timedOut.length > 0) {
    const pairs = samplePairs(stopsOf(loadNetwork().edges), options.pairs, options.seed)
    console.log(`\nnever answered within ${options.timeoutMs}ms (${timedOut.length}):`)
    for (const index of timedOut) console.log(`  #${index}  ${pairs[index]![0]} -> ${pairs[index]![1]}`)
  }

  console.log('\nslowest:')
  for (const r of [...results].sort((a, b) => b.planMs - a.planMs).slice(0, 8)) {
    console.log(`  ${r.planMs.toFixed(1).padStart(7)}ms  ${r.from} -> ${r.to}  (${r.journeys} journeys)`)
  }

  const savePath = flag('--save')
  if (savePath) {
    const baseline: Baseline = { calibrationMedianMs: calibrationMedian, pairs: results.map(r => [`${r.from}>${r.to}`, r.planMs]) }
    writeFileSync(savePath, JSON.stringify(baseline))
    console.log(`\nsaved baseline to ${savePath}`)
  }

  const baselinePath = flag('--baseline')
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as Baseline
    const before = new Map(baseline.pairs)
    /*
     * Normalised by each run's own control, so a comparison survives the machine
     * being busier during one of them. It does not survive the machine being
     * busy during PART of one — interleave runs if a result looks marginal.
     */
    const drift = calibrationMedian / baseline.calibrationMedianMs
    const ratios: number[] = []
    const regressions: [string, number, number][] = []
    for (const r of results) {
      const was = before.get(`${r.from}>${r.to}`)
      if (was === undefined || was < 1) continue
      const ratio = (r.planMs / drift) / was
      ratios.push(ratio)
      if (ratio > 1.25) regressions.push([`${r.from} -> ${r.to}`, was, r.planMs / drift])
    }
    const sorted = ratios.sort((a, b) => a - b)
    console.log(`\nvs baseline (control drift ${drift.toFixed(2)}x): median ${(percentile(sorted, 0.5) * 100 - 100).toFixed(1)}% change over ${sorted.length} shared pairs`)
    if (regressions.length > 0) {
      console.log(`${regressions.length} pairs >25% slower:`)
      for (const [pair, was, now] of regressions.sort((a, b) => b[2] / b[1] - a[2] / a[1]).slice(0, 8)) {
        console.log(`  ${was.toFixed(1)}ms -> ${now.toFixed(1)}ms  ${pair}`)
      }
    }
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
