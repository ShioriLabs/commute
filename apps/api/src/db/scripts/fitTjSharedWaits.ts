import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { TOPOLOGY } from '../data/topology'
import { aggregationFingerprint, type Cell, dayTypeOf, type DayType } from './observedHeadways/aggregate'
import { DEFAULT_ARRIVAL_OPTIONS, buildOrder, extractArrivals } from './observedHeadways/arrivals'
import { SnapshotCollector } from './observedHeadways/collector'
import { blockLabel, RUNTIME_BLOCKS } from './observedHeadways/dayTrips'
import { DEFAULT_GATE, intervals } from './observedHeadways/health'
import { enumerateSharedSets, mergedCells, MIN_SHARED_GAPS, pooledSharedCv } from './observedHeadways/shared'
import { dayFiles, lines, type SnapshotRecord } from './observedHeadways/snapshots'

/*
 * How unevenly buses come on stretches several TJ lines share, measured from
 * ward's archives, for the planner's shared waits (utils/tjWaits.ts,
 * observedHeadways/shared.ts, docs/adr/tj-shared-waits.md).
 *
 *   pnpm --filter api fit:tj-shared-waits --dir <archive dir> [--cache <dir>] [--no-write]
 *
 * Writes db/data/headways.shared.ts. Days are cached like fit:headways's, keyed
 * on the arrival rules and the set list, so a topology change re-reads them.
 */

const OUT_PATH = `${__dirname}/../data/headways.shared.ts`
const SCHEMA = 1

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'cache': { type: 'string' },
    'out': { type: 'string', default: OUT_PATH },
    'no-write': { type: 'boolean', default: false }
  }
})

interface SharedDay {
  day: string
  dayType: DayType
  cells: Record<string, Record<number, Cell>>
}

async function loadDays(dir: string, cacheDir: string): Promise<SharedDay[]> {
  fs.mkdirSync(cacheDir, { recursive: true })
  const order = buildOrder(TOPOLOGY)
  const sets = enumerateSharedSets()
  const fingerprint = createHash('sha256')
    .update(`${SCHEMA}|${aggregationFingerprint(order, DEFAULT_GATE)}|${JSON.stringify(sets)}`)
    .digest('hex')
    .slice(0, 16)
  const out: SharedDay[] = []
  for (const { day, files } of dayFiles(dir)) {
    const source = files.map(f => ({ file: path.basename(f), size: fs.statSync(f).size }))
    const cachePath = path.join(cacheDir, `shared-${day}.json`)
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { source: typeof source, fingerprint: string, cells: SharedDay['cells'] }
      if (cached.fingerprint === fingerprint && JSON.stringify(cached.source) === JSON.stringify(source)) {
        out.push({ day, dayType: dayTypeOf(day), cells: cached.cells })
        continue
      }
    }
    console.log(`aggregating ${day} (${files.length} file${files.length === 1 ? '' : 's'})`)
    const collector = new SnapshotCollector(new Set(order.keys()), DEFAULT_GATE)
    for (const file of files) {
      for await (const line of lines(file)) {
        if (line) collector.add(JSON.parse(line) as SnapshotRecord)
      }
    }
    const cells = collector.snapCount === 0
      ? {}
      : mergedCells(extractArrivals(collector.series.values(), order, DEFAULT_ARRIVAL_OPTIONS).arrivals, sets, intervals(collector.gaps))
    fs.writeFileSync(cachePath, JSON.stringify({ source, fingerprint, cells }))
    out.push({ day, dayType: dayTypeOf(day), cells })
  }
  return out
}

function render(cv: Map<string, number>, days: readonly SharedDay[], setCount: number): string {
  const entries = [...cv].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `  '${key}': ${value.toFixed(2)},`)
  return `/*
 * Bunching on stretches several TransJakarta lines share: the CV of the gaps
 * between consecutive buses of ANY of a set's lines at a stop.
 *
 * GENERATED — do not edit by hand; re-run \`pnpm --filter api fit:tj-shared-waits\`.
 * See db/scripts/observedHeadways/shared.ts and docs/adr/tj-shared-waits.md.
 *
 * SHARED_CV[\`\${dayType}:\${block}:\${stop}>\${next}|\${lines}\`], where block
 * indexes SHARED_CV_BLOCKS (or is \`*\` for the day type pooled over every block),
 * stop and next are full station ids (next says which way) and lines are the
 * set's codes, sorted, comma-joined. A cell needs ${MIN_SHARED_GAPS} pooled gaps.
 * Read through utils/tjWaits.ts.
 */

export const SHARED_CV_BLOCKS = [${RUNTIME_BLOCKS.map((_, b) => `'${blockLabel(b)}'`).join(', ')}] as const

export const SHARED_CV_META = {
  from: '${days[0]?.day ?? ''}',
  to: '${days.at(-1)?.day ?? ''}',
  sets: ${setCount}
} as const

export const SHARED_CV: Record<string, number> = {
${entries.join('\n').replace(/,$/, '')}
}
`
}

async function main() {
  if (!args.dir) throw new Error('--dir <archive dir> is required')
  const cacheDir = args.cache ?? path.join(args.dir, '.fit-cache')
  const days = await loadDays(args.dir, cacheDir)
  if (days.length === 0) throw new Error(`no snapshot files in ${args.dir}`)
  const sets = enumerateSharedSets()
  const cv = pooledSharedCv(days)

  const pooled = [...cv].filter(([k]) => k.split(':')[1] === '*')
  const values = pooled.map(([, v]) => v).sort((a, b) => a - b)
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))]?.toFixed(2) ?? '-'
  console.log(`${days.length} days ${days[0]!.day}..${days.at(-1)!.day}; ${sets.length} shared sets`)
  for (const type of ['WD', 'WE'] as const) {
    const covered = new Set(pooled.filter(([k]) => k.startsWith(`${type}:`)).map(([k]) => k.slice(k.indexOf(':', 3) + 1)))
    console.log(`  ${type}: ${covered.size} of ${sets.length} sets have a pooled CV`)
  }
  console.log(`  pooled CV p10 ${q(0.1)}, p50 ${q(0.5)}, p90 ${q(0.9)}, max ${q(1)}; ${cv.size} cells in all`)

  if (!args['no-write']) {
    fs.writeFileSync(args.out, render(cv, days, sets.length))
    console.log(`wrote ${args.out} (${(fs.statSync(args.out).size / 1024).toFixed(0)} KB)`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
