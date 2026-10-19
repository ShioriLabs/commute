import { clampHeadway, columnDayType, columnHour, type FactorisedModel, type Pool, pooledCv } from './fit'
import type { ColumnScale } from './scale'

/*
 * The generated overlay, headways.observed.ts.
 *
 * Sorted and rounded so a re-run with the same data produces the same bytes.
 * It carries no timestamp for the same reason; the fitted date range is in
 * OBSERVED_META.
 */

export interface OverlayInput {
  model: FactorisedModel
  pool: Pool
  modelName: string
  /** First and last WIB day fitted, YYYYMMDD. */
  range: { from: string, to: string }
  dayCounts: { WD: number, WE: number }
  /** Profile cells filled by interpolation (see interpolate.ts): `${line}@${dir}|${column}` -> seconds. */
  interpolated: ReadonlyMap<string, number>
  /** Columns whose interpolation was rejected because it contradicted the model's own values. */
  rejectedColumns: readonly number[]
  /** Per-column GTFS scale (see scale.ts), the fallback where the profile is absent. */
  scales: readonly ColumnScale[]
  /** Columns (fit.column) with at least one vouched stratum. */
  vouched: ReadonlySet<number>
  /**
   * The profile cells that ship, as `${line}@${dir}|${column}`. A column is
   * vouched per stratum (frequent / sparse), so a vouched column can ship only
   * part of its cells. Omitted: every cell of a vouched column ships.
   */
  shippedCells?: ReadonlySet<string>
  /** Pre-formatted one-line backtest results for the header. */
  backtestLines: string[]
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

/**
 * A string as a single-quoted TypeScript literal. Keys are line codes and
 * station ids from the topology; one containing a quote or a backslash would
 * otherwise write a file that does not compile.
 */
export const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`

export function profileKey(ld: string, column: number): string {
  return `${columnDayType(column)}:${columnHour(column)}:${ld}`
}

export function renderOverlay(input: OverlayInput): string {
  const { model, pool } = input
  const profile = [...model.profile]
    .filter(([id]) => input.shippedCells
      ? input.shippedCells.has(id)
      : input.vouched.has(Number(id.split('|')[1])))
    .map(([id, perSecond]) => {
      const [ld, column] = id.split('|')
      return [profileKey(ld!, Number(column)), clampHeadway(1 / perSecond)] as const
    })
    .sort(([a], [b]) => naturalCompare(a, b))
  const interpolated = [...input.interpolated]
    .map(([id, seconds]) => {
      const [ld, column] = id.split('|')
      return [profileKey(ld!, Number(column)), clampHeadway(seconds)] as const
    })
    .sort(([a], [b]) => naturalCompare(a, b))
  // A stop factor only means something next to a profile of its line-direction.
  // A line-direction whose every cell was held back (a weekend-only line whose
  // sparse cells lost to the fallback) would otherwise ship factors nothing reads.
  const shippedLineDirs = new Set(profile.map(([key]) => key.split(':').slice(2).join(':')))
  const factors = [...model.factor]
    .filter(([key]) => shippedLineDirs.has(`${key.slice(0, key.indexOf('@'))}@${key.slice(-1)}`))
    .map(([key, f]) => [key, Math.round(f * 100) / 100] as const)
    .sort(([a], [b]) => naturalCompare(a, b))

  const healthyHours: Record<string, number> = {}
  for (let c = 0; c < pool.healthySec.length; c++) {
    const hours = pool.healthySec[c]! / 3600
    if (hours >= 0.05) healthyHours[`${columnDayType(c)}:${columnHour(c)}`] = Math.round(hours * 10) / 10
  }
  const shipped = new Set(profile.map(([key]) => key))
  const cv = [...pooledCv(pool)]
    .map(([id, value]) => {
      const [ld, column] = id.split('|')
      return [profileKey(ld!, Number(column)), Math.round(value * 100) / 100] as const
    })
    .filter(([key]) => shipped.has(key))
    .sort(([a], [b]) => naturalCompare(a, b))

  const present = new Set(profile.map(([key]) => key.split(':').slice(0, 2).join(':')))
  const hoursPresent = (dayType: string) => {
    const hours = [...present].filter(k => k.startsWith(`${dayType}:`)).map(k => Number(k.split(':')[1])).sort((a, b) => a - b)
    return hours.length === 0 ? 'none' : hours.map(h => String(h).padStart(2, '0')).join(' ')
  }

  const scaleEntries = [...input.scales]
    .map(s => [s.id, Math.round(s.scale * 1000) / 1000] as const)
    .sort(([a], [b]) => naturalCompare(a, b))
  const scaleDirEntries = input.scales
    .filter((s): s is ColumnScale & { scaleDir: number } => s.scaleDir !== undefined)
    .map(s => [s.id, Math.round(s.scaleDir * 1000) / 1000] as const)
    .sort(([a], [b]) => naturalCompare(a, b))
  const rejectedIds = input.rejectedColumns.map(c => `${columnDayType(c)}:${columnHour(c)}`)
  const capEntries = input.scales
    .filter((s): s is ColumnScale & { cap: number } => s.cap !== undefined)
    .map(s => [s.id, Math.round(s.cap)] as const)
    .sort(([a], [b]) => naturalCompare(a, b))
  const scaleMeasured = input.scales.filter(s => s.measured).map(s => s.id).sort(naturalCompare)

  const header = [
    '/*',
    ' * Observed TransJakarta headways, fitted from ward\'s vehicle snapshots.',
    ' *',
    ' * GENERATED — do not edit by hand; re-run `pnpm --filter api fit:headways`.',
    ' * See scripts/fitObservedHeadways.ts and docs/adr/ward-collector.md.',
    ' *',
    ' * A multiplicative model: the headway of a stop at an hour is',
    ' *',
    ' *     OBSERVED_PROFILE_S[`${dayType}:${hour}:${line}@${dir}`] / OBSERVED_STOP_FACTOR[`${line}@${stationId}@${dir}`]',
    ' *',
    ' * where the profile is the headway at an average stop of that line-direction',
    ' * and the factor (mean 1 per line-direction) says how much more or less often',
    ' * than average this stop is served. A stop with no factor takes its',
    ' * line-direction\'s profile at factor 1 where the schedule does not call it',
    ' * rarer, and the scaled schedule otherwise. Hour is the WIB hour of day;',
    ' * dayType is WD (Mon-Fri) or WE (Sat+Sun pooled — too few weekends yet to split).',
    ' *',
    ' * It is the RATE headway: healthy time divided by arrivals, what "every N',
    ' * minutes" means. Bunching makes the wait a rider experiences longer than half',
    ' * of it; the pooled CV is kept in OBSERVED_CV_PROFILE for that decision.',
    ' *',
    ' * A profile cell is ABSENT when it fails the floors (fewer than 3 days with 15',
    ' * healthy minutes, or under 30 pooled arrivals) or when the backtest does not',
    ' * vouch for its stratum of its (dayType, hour): cells the model puts under 15',
    ' * minutes apart and cells it puts at or over are judged separately, each needing',
    ' * at least 100 held-out buckets (counted with zeros, so a stop that barely ran is',
    ' * scored on that) and a lower Poisson deviance than the fallback that would be',
    ' * shown instead. A consumer then reads,',
    ' * in order, OBSERVED_PROFILE_INTERP_S, the scaled schedule below, and',
    ' * finally headways.ts as it was. The upstream relay is almost never healthy',
    ' * in the weekday rush hours, so those hours have nothing to fit or to',
    ' * validate.',
    ' *',
    ` * Hours present, WIB: weekday ${hoursPresent('WD')}; weekend ${hoursPresent('WE')}.`,
    ' *',
    ' * The hours the backtest did not vouch for are filled in two steps, so the',
    ' * curve across a day stays continuous:',
    ' *   1. OBSERVED_PROFILE_INTERP_S: the line-direction\'s own profile',
    ' *      interpolated between its nearest measured hours (at most 8h apart; held',
    ' *      for at most 2h past the first or last). Same key format as the profile.',
    ' *      A column is left out (see interpolationRejected) where the model\'s own',
    ' *      unvouched values contradict the interpolation by more than 1.3x in the',
    ' *      median: those are hours that WERE observed, across a service-regime',
    ' *      change (overnight), so a line between the neighbours would be wrong.',
    ' *      The hours between two measured hours are judged together, a single',
    ' *      cell more than 2x from the model\'s own value is dropped on its own,',
    ' *      and a line-direction the model saw in a column that had data but found',
    ' *      too few arrivals to fit (it barely ran there) is not filled from its',
    ' *      busier neighbours.',
    ' *   2. OBSERVED_GTFS_SCALE (pooled per-stop schedule values) and',
    ' *      OBSERVED_GTFS_SCALE_DIR (directional ones): the schedule value',
    ' *      (headways.ts) times the column\'s scale, for what is left, never above',
    ' *      OBSERVED_GTFS_CAP_S for that column (observed headways saturate; see',
    ' *      scale.ts) and never below the schedule value itself. Scales are measured',
    ' *      for every column the model had data for, vouched or not, and only',
    ' *      columns with no data (the weekday rush hours) are interpolated (see',
    ' *      scaleMeasured). Caps are measured only on vouched columns.',
    ' *',
    ' * Profile values are clamped to the same [120, 3600] seconds as headways.ts.',
    ' * Read by utils/observedHeadways.ts (planner and station headway endpoint).',
    ' *',
    ' * Unverified: this is consistent from day to day (see the backtest below) but',
    ' * its absolute level is not checked against ground truth. Arrivals the method',
    ' * misses would make every value read long.',
    ' *',
    ` * Model ${input.modelName}, days ${input.range.from}..${input.range.to} (${input.dayCounts.WD} weekday, ${input.dayCounts.WE} weekend).`,
    ...input.backtestLines.map(line => ` * ${line}`),
    ' */',
    ''
  ].join('\n')

  const entries = (rows: ReadonlyArray<readonly [string, number]>) =>
    rows.map(([k, v]) => `  ${quote(k)}: ${v}`).join(',\n')

  const meta = [
    '{',
    `  model: ${quote(input.modelName)},`,
    `  from: ${quote(input.range.from)},`,
    `  to: ${quote(input.range.to)},`,
    `  days: { WD: ${input.dayCounts.WD}, WE: ${input.dayCounts.WE} },`,
    `  scaleMeasured: [${scaleMeasured.map(quote).join(', ')}],`,
    `  interpolationRejected: [${rejectedIds.map(quote).join(', ')}],`,
    '  /** Healthy hours behind each `${dayType}:${hour}`, summed over the fitted days. */',
    '  healthyHours: {',
    Object.entries(healthyHours).sort(([a], [b]) => naturalCompare(a, b)).map(([k, v]) => `    ${quote(k)}: ${v}`).join(',\n'),
    '  }',
    '}'
  ].join('\n')

  return `${header}
/** Headway at an average stop of a line-direction. Key: \`\${dayType}:\${hour}:\${line}@\${dir}\`. */
export const OBSERVED_PROFILE_S: Record<string, number> = {
${entries(profile)}
}

/** Relative arrival rate of a stop within its line-direction (mean 1); absent means no observed value. Key: \`\${line}@\${stationId}@\${dir}\`. */
export const OBSERVED_STOP_FACTOR: Record<string, number> = {
${entries(factors)}
}

/** Interpolated profile cells for hours with no measured one. Same keys as the profile; never overlaps it. */
export const OBSERVED_PROFILE_INTERP_S: Record<string, number> = {
${entries(interpolated)}
}

/** Schedule-to-observed multiplier per \`\${dayType}:\${hour}\`: the fallback where the profile is absent. */
export const OBSERVED_GTFS_SCALE: Record<string, number> = {
${entries(scaleEntries)}
}

/** As OBSERVED_GTFS_SCALE, for the schedule's directional values (\`line@stop@dir\`), measured against those. */
export const OBSERVED_GTFS_SCALE_DIR: Record<string, number> = {
${entries(scaleDirEntries)}
}

/** Ceiling for the scaled schedule value per \`\${dayType}:\${hour}\`: the 90th percentile of the measured line-level headways. */
export const OBSERVED_GTFS_CAP_S: Record<string, number> = {
${entries(capEntries)}
}

/** Diagnostic: CV of consecutive headways, pooled over a line-direction's stops. Same keys as the profile (where a CV exists). */
export const OBSERVED_CV_PROFILE: Record<string, number> = {
${entries(cv)}
}

export const OBSERVED_META = ${meta} as const
`
}
