import { clampHeadway, columnDayType, columnHour, type FactorisedModel, type Pool, pooledCv } from './fit'

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
  /** Columns (fit.column) the backtest vouches for; the profile is restricted to them. */
  vouched: ReadonlySet<number>
  /** Pre-formatted one-line backtest results for the header. */
  backtestLines: string[]
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function profileKey(ld: string, column: number): string {
  return `${columnDayType(column)}:${columnHour(column)}:${ld}`
}

export function renderOverlay(input: OverlayInput): string {
  const { model, pool } = input
  const profile = [...model.profile]
    .filter(([id]) => input.vouched.has(Number(id.split('|')[1])))
    .map(([id, perSecond]) => {
      const [ld, column] = id.split('|')
      return [profileKey(ld!, Number(column)), clampHeadway(1 / perSecond)] as const
    })
    .sort(([a], [b]) => naturalCompare(a, b))
  const factors = [...model.factor]
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
    ' * than average this stop is served. A stop with no factor has no observed',
    ' * value: use headways.ts for it. Hour is the WIB hour of day;',
    ' * dayType is WD (Mon-Fri) or WE (Sat+Sun pooled — too few weekends yet to split).',
    ' *',
    ' * It is the RATE headway: healthy time divided by arrivals, what "every N',
    ' * minutes" means. Bunching makes the wait a rider experiences longer than half',
    ' * of it; the pooled CV is kept in OBSERVED_CV_PROFILE for that decision.',
    ' *',
    ' * Cells are ABSENT, and a consumer must fall back to headways.ts, when they',
    ' * fail the floors (fewer than 3 days with 15 healthy minutes, or under 30',
    ' * pooled arrivals) or when the backtest does not vouch for their (dayType,',
    ' * hour): at least 100 held-out buckets, and a lower median error than GTFS',
    ' * scaled by a per-hour factor. The upstream relay is almost never healthy in',
    ' * the weekday rush hours, so those hours have nothing to fit or to validate.',
    ' *',
    ` * Hours present, WIB: weekday ${hoursPresent('WD')}; weekend ${hoursPresent('WE')}.`,
    ' *',
    ' * Profile values are clamped to the same [120, 3600] seconds as headways.ts.',
    ' * Not yet read by the planner or the station headway endpoint.',
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
    rows.map(([k, v]) => `  '${k}': ${v}`).join(',\n')

  const meta = [
    '{',
    `  model: '${input.modelName}',`,
    `  from: '${input.range.from}',`,
    `  to: '${input.range.to}',`,
    `  days: { WD: ${input.dayCounts.WD}, WE: ${input.dayCounts.WE} },`,
    '  /** Healthy hours behind each `${dayType}:${hour}`, summed over the fitted days. */',
    '  healthyHours: {',
    Object.entries(healthyHours).sort(([a], [b]) => naturalCompare(a, b)).map(([k, v]) => `    '${k}': ${v}`).join(',\n'),
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

/** Diagnostic: CV of consecutive headways, pooled over a line-direction's stops. Same keys as the profile (where a CV exists). */
export const OBSERVED_CV_PROFILE: Record<string, number> = {
${entries(cv)}
}

export const OBSERVED_META = ${meta} as const
`
}
