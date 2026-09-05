import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { loadGraph } from '@commute/tsundere'
import { HEADWAYS_S } from '../data/headways'
import { ENDPOINT_RESTRICTIONS, SERVICE_BREAKS, TOPOLOGY } from '../data/topology'

/*
 * The parts benchRouter and auditRouter must not disagree about.
 *
 * The two scripts answer different questions — one times the planner, the other
 * measures what it returns — but a timing delta and an accuracy delta are only
 * comparable if they describe the SAME population. That means the same graph,
 * the same seeded sample, and the same refusal to measure a stale build. Kept
 * here rather than copied so the two can never drift into measuring different
 * networks and reporting it as a result.
 */

export const DEFAULT_PAIRS = 300
export const DEFAULT_SEED = 42

// ── graph ────────────────────────────────────────────────────────────────────

/*
 * Read from the local D1 file directly rather than through `wrangler d1
 * execute`, which hangs on tables this size. Local D1 is expected to hold a full
 * prod dump — refresh it with `wrangler d1 export commute --remote` and import
 * with sqlite3, since wrangler's own importer chokes on the dump.
 */
function localD1Path(): string {
  const dir = `${__dirname}/../../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject`
  const files = readdirSync(dir).filter(f => f.endsWith('.sqlite'))
  if (files.length !== 1) throw new Error(`expected exactly one .sqlite in ${dir}, found ${files.length}`)
  return `${dir}/${files[0]}`
}

function query<T>(sql: string): T[] {
  let raw: string
  try {
    raw = execFileSync('sqlite3', ['-readonly', '-json', localD1Path(), sql], { encoding: 'utf-8', maxBuffer: 1 << 28 })
  } catch (error) {
    throw new Error(`sqlite3 failed (is it installed?): ${(error as Error).message}`)
  }
  return raw.trim() ? JSON.parse(raw) as T[] : []
}

/*
 * Mirrors EdgeRepository.getGraphInputs plus routes/fares.ts getRouter. Kept in
 * step by hand, which is a liability — if the graph the API builds ever stops
 * matching this one, every number here is measuring a network nobody rides.
 */
export function loadNetwork() {
  const routableLineCodes = [...new Set(TOPOLOGY.map(t => t.lineCode))].filter(code => code !== 'A')
  const codes = routableLineCodes.map(code => `'${code}'`).join(',')
  const edges = query<{ lineCode: string, fromStationId: string, toStationId: string, distance: number }>(
    `SELECT lineCode, fromStationId, toStationId, distance FROM edges WHERE lineCode IN (${codes})`
  )
  const transfers = query<{ fromStationId: string, toStationId: string | null, distance: number, noTap: number }>(
    'SELECT fromStationId, toStationId, distance, noTap FROM transfers WHERE dataType = \'INTERNAL\''
  )
  const router = loadGraph({
    edges,
    transfers,
    restrictions: ENDPOINT_RESTRICTIONS.map(r => ({
      stationId: `${r.operator}-${r.station}`,
      forbiddenNeighborId: `${r.operator}-${r.forbiddenNeighbor}`
    })),
    serviceBreaks: SERVICE_BREAKS.map(b => ({
      lineCode: b.lineCode,
      viaStationId: `${b.operator}-${b.via}`,
      fromStationId: `${b.operator}-${b.from}`,
      toStationId: `${b.operator}-${b.to}`
    })),
    headwaysS: new Map(Object.entries(HEADWAYS_S))
  })
  return { router, edges, transfers }
}

/** Every stop the routable graph mentions, in a stable order. */
export const stopsOf = (edges: { fromStationId: string, toStationId: string }[]): string[] =>
  [...new Set(edges.flatMap(e => [e.fromStationId, e.toStationId]))]

/*
 * A fixed LCG, not Math.random: the sample has to be identical across runs or a
 * before/after comparison is measuring two different questions.
 */
export function samplePairs(stops: string[], count: number, seed: number): [string, string][] {
  let state = seed
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const pairs: [string, string][] = []
  while (pairs.length < count) {
    const from = stops[Math.floor(rnd() * stops.length)]!
    const to = stops[Math.floor(rnd() * stops.length)]!
    if (from !== to) pairs.push([from, to])
  }
  return pairs
}

// ── reporting ────────────────────────────────────────────────────────────────

export const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0

/*
 * Refuse to measure a build that predates the source.
 *
 * The whole point of these scripts is comparing two versions of the planner, and
 * the import resolves to dist — so without this they will happily report that a
 * change you just made costs exactly nothing, or changes exactly nothing, which
 * is the more dangerous of the two because it looks like a finding.
 */
export function assertBuildIsCurrent(): void {
  const root = `${__dirname}/../../../../../libs/tsundere`
  const newest = (dir: string): number => {
    let latest = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs)
    }
    return latest
  }
  let dist: number
  try {
    dist = newest(`${root}/dist`)
  } catch {
    throw new Error('libs/tsundere is not built. Run: pnpm --filter @commute/tsundere build')
  }
  if (newest(`${root}/src`) > dist) {
    throw new Error(
      'libs/tsundere/src is newer than dist — this would measure the PREVIOUS build.\n'
      + 'Run: pnpm --filter @commute/tsundere build'
    )
  }
}
