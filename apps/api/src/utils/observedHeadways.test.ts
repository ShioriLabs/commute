import { afterEach, describe, expect, it } from 'vitest'
import { HEADWAYS_S, LINE_TERMINI, STOP_HEADWAYS_S } from '../db/data/headways'
import {
  OBSERVED_GTFS_CAP_S,
  OBSERVED_GTFS_SCALE,
  OBSERVED_GTFS_SCALE_DIR,
  OBSERVED_PROFILE_INTERP_S,
  OBSERVED_PROFILE_S,
  OBSERVED_STOP_FACTOR
} from '../db/data/headways.observed'
import { clampHeadway } from './headwayBounds'
import { baseHeadways } from './headways'
import {
  dayTypeOf,
  observedDirHeadway,
  observedLineDirHeadway,
  observedLineHeadway,
  observedStopHeadway,
  plannerHeadways,
  resolveHeadway,
  scaledHeadway
} from './observedHeadways'
import {
  OBSERVED_HEADWAYS_FLAG_KEY,
  observedHeadwaysEnabled,
  observedHeadwaysEnabledFor,
  refreshObservedHeadwaysFlag,
  setObservedHeadwaysEnabled
} from './observedFlag'

/*
 * Fixtures come from the generated overlay, so a refit does not break these:
 * what is pinned is how the lookup combines the three exports, not their numbers.
 */
const COLUMN = 'WD:12'
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** What the scaled fallback should give: scale, capped, never below the schedule, clamped. */
const scaledExpected = (scheduleS: number, column: string) => {
  const scaled = scheduleS * OBSERVED_GTFS_SCALE[column]!
  const cap = OBSERVED_GTFS_CAP_S[column]
  return clampHeadway(Math.max(scheduleS, cap === undefined ? scaled : Math.min(scaled, cap)))
}

/** A line with a profile for both directions at the column. */
const profiledLine = (() => {
  for (const key of Object.keys(OBSERVED_PROFILE_S)) {
    if (!key.startsWith(`${COLUMN}:`) || !key.endsWith('@F')) continue
    const lineDir = key.slice(COLUMN.length + 1)
    const line = lineDir.slice(0, -2)
    if (OBSERVED_PROFILE_S[`${COLUMN}:${line}@R`] !== undefined && LINE_TERMINI[line]) return line
  }
  throw new Error('no line with both directions profiled')
})()

/** A stop of that line with a factor in both directions. */
const twoWayStop = (() => {
  for (const key of Object.keys(OBSERVED_STOP_FACTOR)) {
    if (!key.startsWith(`${profiledLine}@`) || !key.endsWith('@F')) continue
    const lineStop = key.slice(0, -2)
    if (OBSERVED_STOP_FACTOR[`${lineStop}@R`] !== undefined) return lineStop
  }
  throw new Error('no two-way stop')
})()
const stopId = twoWayStop.slice(twoWayStop.indexOf('@') + 1)

/**
 * Stops of a corridor the schedule knows (so the planner map has them) that the
 * fit gave no factor in either direction: an origin terminal, or a halte it
 * barely sees. Split by whether the SCHEDULE calls the stop as frequent as its
 * line (an artefact: takes the line's level) or rarer (a branch halte: must not).
 *
 * Each entry carries the weekday hour it was chosen at, because which hours a
 * line has a level for changes with the fit: the first hour from the list where
 * the line has an observed (measured or interpolated) level is used.
 */
const FIXTURE_HOURS = [12, 13, 14, 10, 15, 16, 8, 20, 21, 6]
const factorlessStops = (() => {
  type Entry = { key: string, line: string, stationId: string, scheduleS: number, hour: number }
  const common: Entry[] = []
  const rare: Entry[] = []
  for (const [key, scheduleS] of Object.entries(STOP_HEADWAYS_S)) {
    const line = key.slice(0, key.indexOf('@'))
    if (!LINE_TERMINI[line]) continue
    if (OBSERVED_STOP_FACTOR[`${key}@F`] !== undefined || OBSERVED_STOP_FACTOR[`${key}@R`] !== undefined) continue
    const hour = FIXTURE_HOURS.find(h => observedLineHeadway(line, 'WD', h) !== undefined && observedLineDirHeadway(line, 'F', 'WD', h) !== undefined)
    if (hour === undefined) continue
    const level = observedLineHeadway(line, 'WD', hour)!.seconds
    const entry = { key, line, stationId: key.slice(key.indexOf('@') + 1), scheduleS, hour }
    if (scheduleS <= level) common.push(entry)
    else rare.push(entry)
  }
  return { common, rare }
})()
const factorless = factorlessStops.common[0]

afterEach(() => setObservedHeadwaysEnabled(true))

describe('dayTypeOf', () => {
  it('reads Saturday and Sunday as the pooled weekend model', () => {
    expect(dayTypeOf('WD')).toBe('WD')
    expect(dayTypeOf('SAT')).toBe('WE')
    expect(dayTypeOf('SUN')).toBe('WE')
    expect(dayTypeOf('ALL')).toBe('WD')
  })
})

describe('observed lookups', () => {
  it('divides the line-direction profile by the stop factor', () => {
    const expected = clampHeadway(OBSERVED_PROFILE_S[`${COLUMN}:${profiledLine}@F`]! / OBSERVED_STOP_FACTOR[`${twoWayStop}@F`]!)
    expect(observedDirHeadway(profiledLine, stopId, 'F', 'WD', 12)).toEqual({ seconds: expected, interpolated: false })
  })

  it('has no value where the profile or the factor is absent', () => {
    expect(observedDirHeadway('NOPE', 'TJ-X', 'F', 'WD', 12)).toBeUndefined()
    expect(observedDirHeadway(profiledLine, 'TJ-NOT-A-STOP', 'F', 'WD', 12)).toBeUndefined()
    // A column with neither a measured nor an interpolated profile.
    const bare = Array.from({ length: 24 }, (_, h) => h)
      .find(h => OBSERVED_PROFILE_S[`WD:${h}:${profiledLine}@F`] === undefined && OBSERVED_PROFILE_INTERP_S[`WD:${h}:${profiledLine}@F`] === undefined)
    if (bare !== undefined) expect(observedDirHeadway(profiledLine, stopId, 'F', 'WD', bare)).toBeUndefined()
  })

  it('reports an interpolated profile as such, and never lets it displace a measured one', () => {
    const key = Object.keys(OBSERVED_PROFILE_INTERP_S).find(k => k.startsWith('WD:'))!
    const [, hour, lineDir] = key.split(':') as [string, string, string]
    const line = lineDir.slice(0, lineDir.lastIndexOf('@'))
    const dir = lineDir.slice(-1) as 'F' | 'R'
    expect(OBSERVED_PROFILE_S[key]).toBeUndefined()
    expect(observedLineHeadway(line, 'WD', Number(hour))?.interpolated).toBe(true)
    // The same line at a measured hour is not flagged.
    expect(observedLineHeadway(profiledLine, 'WD', 12)?.interpolated).toBe(false)
    expect(dir === 'F' || dir === 'R').toBe(true)
  })

  it('combines a stop\'s directions by their mean, since the rider\'s direction is unknown', () => {
    const f = OBSERVED_PROFILE_S[`${COLUMN}:${profiledLine}@F`]! / OBSERVED_STOP_FACTOR[`${twoWayStop}@F`]!
    const r = OBSERVED_PROFILE_S[`${COLUMN}:${profiledLine}@R`]! / OBSERVED_STOP_FACTOR[`${twoWayStop}@R`]!
    expect(observedStopHeadway(profiledLine, stopId, 'WD', 12)).toEqual({ seconds: clampHeadway(mean([f, r])), interpolated: false })
  })

  it('combines a line\'s directions by their mean', () => {
    const f = OBSERVED_PROFILE_S[`${COLUMN}:${profiledLine}@F`]!
    const r = OBSERVED_PROFILE_S[`${COLUMN}:${profiledLine}@R`]!
    expect(observedLineHeadway(profiledLine, 'WD', 12)).toEqual({ seconds: clampHeadway(mean([f, r])), interpolated: false })
  })

  it('reads a weekend day as the WE column', () => {
    const column = Object.keys(OBSERVED_PROFILE_S).find(k => k.startsWith('WE:'))!
    const [, hour, lineDir] = column.split(':')
    const line = lineDir!.slice(0, lineDir!.lastIndexOf('@'))
    expect(observedLineHeadway(line, 'SAT', Number(hour))).toBeDefined()
    expect(observedLineHeadway(line, 'SUN', Number(hour))).toEqual(observedLineHeadway(line, 'SAT', Number(hour)))
  })
})

describe('scaledHeadway', () => {
  it('multiplies a TJ schedule value by the column scale, clamped', () => {
    const line = Object.keys(LINE_TERMINI)[0]!
    expect(scaledHeadway(200, line, 'WD', 17)).toBe(scaledExpected(200, 'WD:17'))
    expect(scaledHeadway(100_000, line, 'WD', 12)).toBe(3600)
  })

  it('caps the scaled value at what comparable lines were observed to run', () => {
    const line = Object.keys(LINE_TERMINI)[0]!
    const cap = OBSERVED_GTFS_CAP_S['WD:12']!
    // A schedule value whose scaled result would be far past the cap.
    const long = Math.ceil(cap / OBSERVED_GTFS_SCALE['WD:12']!) + 50
    expect(long * OBSERVED_GTFS_SCALE['WD:12']!).toBeGreaterThan(cap)
    expect(scaledHeadway(long, line, 'WD', 12)).toBe(clampHeadway(Math.max(long, cap)))
  })

  it('never shortens a schedule value, even one already past the cap', () => {
    const line = Object.keys(LINE_TERMINI)[0]!
    const cap = OBSERVED_GTFS_CAP_S['WD:12']!
    const past = Math.min(3000, Math.ceil(cap) + 500)
    expect(scaledHeadway(past, line, 'WD', 12)).toBe(clampHeadway(past))
  })

  it('uses the directional scale for a directional schedule value, and the pooled one otherwise', () => {
    const line = Object.keys(LINE_TERMINI)[0]!
    const column = 'WD:12'
    const cap = OBSERVED_GTFS_CAP_S[column]!
    const x = 100
    const dir = OBSERVED_GTFS_SCALE_DIR[column]!
    const pooled = OBSERVED_GTFS_SCALE[column]!
    expect(dir).toBeLessThan(pooled)
    expect(scaledHeadway(x, line, 'WD', 12, true, true)).toBe(clampHeadway(Math.max(x, Math.min(x * dir, cap))))
    expect(scaledHeadway(x, line, 'WD', 12, true, false)).toBe(clampHeadway(Math.max(x, Math.min(x * pooled, cap))))
  })

  it('applies to a line the caller says is TransJakarta even when it is not a routed corridor', () => {
    expect(scaledHeadway(300, '6C', 'WD', 12)).toBeUndefined()
    expect(scaledHeadway(300, '6C', 'WD', 12, true)).toBe(scaledExpected(300, 'WD:12'))
  })

  it('never scales a line that is not a TransJakarta corridor', () => {
    expect(scaledHeadway(300, 'NOT-TJ', 'WD', 12)).toBeUndefined()
  })
})

describe('plannerHeadways', () => {
  it('is exactly the schedule map when switched off', () => {
    expect(plannerHeadways('WD', 12, false)).toBe(baseHeadways('WD'))
  })

  it('is built once per day and hour', () => {
    expect(plannerHeadways('WD', 12, true)).toBe(plannerHeadways('WD', 12, true))
    expect(plannerHeadways('WD', 12, true)).not.toBe(plannerHeadways('WD', 13, true))
  })

  it('overlays observed values and leaves the schedule table\'s own keys in place', () => {
    const map = plannerHeadways('WD', 12, true)
    expect(map.get(twoWayStop)).toBe(observedStopHeadway(profiledLine, stopId, 'WD', 12)!.seconds)
    expect(map.get(profiledLine)).toBe(observedLineHeadway(profiledLine, 'WD', 12)!.seconds)
    // Every schedule key survives, so nothing the planner could look up goes missing.
    for (const key of baseHeadways('WD').keys()) expect(map.has(key)).toBe(true)
  })

  // A TJ corridor and a weekday hour where it has no profile of either kind. Any
  // hour will do, so a fit that profiles every line somewhere still has one; if
  // none exists at all, the test is reported SKIPPED, not silently passed.
  const withoutProfile = (() => {
    const has = (hour: number, line: string) => [OBSERVED_PROFILE_S, OBSERVED_PROFILE_INTERP_S]
      .some(table => table[`WD:${hour}:${line}@F`] !== undefined || table[`WD:${hour}:${line}@R`] !== undefined)
    for (const line of Object.keys(LINE_TERMINI)) {
      if (HEADWAYS_S[line] === undefined) continue
      const hour = [...Array(24).keys()].find(h => !has(h, line))
      if (hour !== undefined) return { line, hour }
    }
    return undefined
  })()

  it.skipIf(withoutProfile === undefined)('falls back to the scaled schedule where there is no profile at all, measured or interpolated', () => {
    const { line, hour } = withoutProfile!
    expect(plannerHeadways('WD', hour, true).get(line)).toBe(scaledExpected(HEADWAYS_S[line]!, `WD:${hour}`))
  })

  it('uses the interpolated profile in a blind hour rather than the scaled schedule', () => {
    const key = Object.keys(OBSERVED_PROFILE_INTERP_S).find(k => k.startsWith('WD:') && k.endsWith('@F'))!
    const [, hour, lineDir] = key.split(':') as [string, string, string]
    const line = lineDir.slice(0, lineDir.lastIndexOf('@'))
    const expected = observedLineHeadway(line, 'WD', Number(hour))!.seconds
    expect(plannerHeadways('WD', Number(hour), true).get(line)).toBe(expected)
  })

  it('leaves non-TJ keys untouched', () => {
    const rail = Object.keys(HEADWAYS_S).find(k => !LINE_TERMINI[k])
    expect(rail).toBeDefined()
    expect(plannerHeadways('WD', 12, true).get(rail!)).toBe(HEADWAYS_S[rail!])
  })

  it('stays inside the clamp bounds', () => {
    for (const hour of [0, 3, 12, 17, 23]) {
      for (const value of plannerHeadways('WD', hour, true).values()) {
        expect(value).toBeGreaterThanOrEqual(120)
        expect(value).toBeLessThanOrEqual(3600)
      }
    }
  })
})

describe('resolveHeadway', () => {
  const base = { lineCode: profiledLine, stationId: stopId, day: 'WD' as const, hour: 12, enabled: true }

  it('is the schedule value for rail, for a line that does not run, and with the switch off', () => {
    expect(resolveHeadway({ ...base, nominalS: 300, kind: 'stop', lineCode: 'NOT-TJ' })).toEqual({ headwayS: 300, basis: 'SCHEDULE' })
    expect(resolveHeadway({ ...base, nominalS: null, kind: 'line' })).toEqual({ headwayS: null, basis: 'SCHEDULE' })
    expect(resolveHeadway({ ...base, nominalS: 300, kind: 'stop', enabled: false })).toEqual({ headwayS: 300, basis: 'SCHEDULE' })
  })

  it('prefers the measured value, then the interpolated one, then the scaled schedule value', () => {
    const measured = resolveHeadway({ ...base, nominalS: 120, kind: 'stop' })
    expect(measured.basis).toBe('OBSERVED')

    // A stop of the profiled line in an hour that only has an interpolated profile.
    const hour = Number(Object.keys(OBSERVED_PROFILE_INTERP_S)
      .find(k => k.startsWith(`WD:`) && k.includes(`:${profiledLine}@F`))?.split(':')[1])
    if (Number.isFinite(hour)) {
      expect(resolveHeadway({ ...base, nominalS: 120, kind: 'stop', hour }).basis).toBe('INTERPOLATED')
    }

    // A column with no profile of either kind for this line falls to the scaled schedule.
    const bare = Array.from({ length: 24 }, (_, h) => h).find(h =>
      OBSERVED_PROFILE_S[`WD:${h}:${profiledLine}@F`] === undefined
      && OBSERVED_PROFILE_INTERP_S[`WD:${h}:${profiledLine}@F`] === undefined
      && OBSERVED_GTFS_SCALE[`WD:${h}`] !== undefined)
    if (bare !== undefined) {
      expect(resolveHeadway({ ...base, nominalS: 120, kind: 'stop', hour: bare }))
        .toEqual({ headwayS: scaledExpected(120, `WD:${bare}`), basis: 'SCALED' })
    }
  })

  it('scales a TransJakarta line that is not a routed corridor, and never a rail one', () => {
    // 6C is an integration line: in the schedule table, not in the topology.
    expect(LINE_TERMINI['6C']).toBeUndefined()
    expect(HEADWAYS_S['6C']).toBeDefined()
    const common = { nominalS: 514, kind: 'line' as const, stationId: 'TJ-X', day: 'WD' as const, hour: 12, enabled: true }

    // Without the operator, a bare code cannot be told from rail: unchanged.
    expect(resolveHeadway({ ...common, lineCode: '6C' })).toEqual({ headwayS: 514, basis: 'SCHEDULE' })
    // With it, the scale applies and the basis says so.
    expect(resolveHeadway({ ...common, lineCode: '6C', tj: true }))
      .toEqual({ headwayS: scaledExpected(514, 'WD:12'), basis: 'SCALED' })
    // A rail row says it is not TJ, whatever its code.
    expect(resolveHeadway({ ...common, lineCode: '6C', tj: false })).toEqual({ headwayS: 514, basis: 'SCHEDULE' })
  })

  it('scales a SCALED directional row with the directional scale', () => {
    const column = 'WD:12'
    const x = 300
    const row = resolveHeadway({ nominalS: x, kind: 'dir', dir: 'F', lineCode: '6C', stationId: 'TJ-X', day: 'WD', hour: 12, enabled: true, tj: true })
    const cap = OBSERVED_GTFS_CAP_S[column]!
    expect(row).toEqual({
      headwayS: clampHeadway(Math.max(x, Math.min(x * OBSERVED_GTFS_SCALE_DIR[column]!, cap))),
      basis: 'SCALED'
    })
  })

  it('reads a directional row from its own direction', () => {
    const row = resolveHeadway({ ...base, nominalS: 120, kind: 'dir', dir: 'R' })
    expect(row).toEqual({ headwayS: observedDirHeadway(profiledLine, stopId, 'R', 'WD', 12)!.seconds, basis: 'OBSERVED' })
  })
})

describe('kill switch', () => {
  const kv = (value: string | null | Error) => ({
    get: async () => {
      if (value instanceof Error) throw value
      return value
    }
  }) as unknown as KVNamespace

  it('is on by default and by absence', async () => {
    await refreshObservedHeadwaysFlag(kv(null))
    expect(observedHeadwaysEnabled()).toBe(true)
  })

  it('turns off only on the exact value `off`', async () => {
    await refreshObservedHeadwaysFlag(kv('off'))
    expect(observedHeadwaysEnabled()).toBe(false)
    await refreshObservedHeadwaysFlag(kv('on'))
    expect(observedHeadwaysEnabled()).toBe(true)
    await refreshObservedHeadwaysFlag(kv('OFF'))
    expect(observedHeadwaysEnabled()).toBe(true)
  })

  it('keeps the last value when KV fails or is missing', async () => {
    await refreshObservedHeadwaysFlag(kv('off'))
    await refreshObservedHeadwaysFlag(kv(new Error('kv down')))
    expect(observedHeadwaysEnabled()).toBe(false)
    await refreshObservedHeadwaysFlag(undefined)
    expect(observedHeadwaysEnabled()).toBe(false)
  })

  it('pins the value a request started with, whatever later requests do to the module value', async () => {
    const a = new Request('https://x.test/a')
    const b = new Request('https://x.test/b')
    await refreshObservedHeadwaysFlag(kv('off'), a)
    expect(observedHeadwaysEnabledFor(a)).toBe(false)

    // A concurrent request flips the shared value while `a` is still in flight.
    await refreshObservedHeadwaysFlag(kv('on'), b)
    expect(observedHeadwaysEnabled()).toBe(true)
    expect(observedHeadwaysEnabledFor(b)).toBe(true)
    // `a` keeps what it started with, so its cache key and its search agree.
    expect(observedHeadwaysEnabledFor(a)).toBe(false)
  })

  it('falls back to the module value for a request that was never snapshotted', async () => {
    await refreshObservedHeadwaysFlag(kv('off'))
    expect(observedHeadwaysEnabledFor(new Request('https://x.test/never'))).toBe(false)
  })

  it('uses the documented key', () => {
    expect(OBSERVED_HEADWAYS_FLAG_KEY).toBe('config:observed-headways')
  })
})

describe('a stop the fit gave no factor', () => {
  it('exists in the current fit, as both kinds (otherwise these tests prove nothing)', () => {
    expect(factorlessStops.common.length).toBeGreaterThan(0)
    expect(factorlessStops.rare.length).toBeGreaterThan(0)
  })

  it('takes its line\'s observed level in the planner map when the schedule agrees it is as frequent', () => {
    const { key, line, hour } = factorless!
    const level = observedLineHeadway(line, 'WD', hour)!
    expect(plannerHeadways('WD', hour, true).get(key)).toBe(level.seconds)
  })

  it('is NOT shortened to the line\'s level when the schedule says it is rarer', () => {
    // 12@TJ-H00261S: 3600s in the schedule, ~900-980s at its line's level. The first
    // version of the fallback priced the branch halte as the trunk.
    for (const { key, line, scheduleS, hour } of factorlessStops.rare) {
      const level = observedLineHeadway(line, 'WD', hour)!.seconds
      const mapped = plannerHeadways('WD', hour, true).get(key)!
      expect(scheduleS, key).toBeGreaterThan(level)
      expect(mapped, key).toBeGreaterThanOrEqual(scheduleS)
      expect(mapped, key).not.toBe(level)
    }
  })

  it('takes the line-direction\'s own level on a directional row, when not rarer than the schedule', () => {
    const { line, stationId, scheduleS, hour } = factorless!
    const row = resolveHeadway({ nominalS: scheduleS, kind: 'dir', dir: 'F', lineCode: line, stationId, day: 'WD', hour, enabled: true, tj: true })
    const level = observedLineDirHeadway(line, 'F', 'WD', hour)!
    expect(row).toEqual({ headwayS: level.seconds, basis: level.interpolated ? 'INTERPOLATED' : 'OBSERVED' })
  })

  it('takes the line\'s level on a per-stop row, when not rarer than the schedule', () => {
    const { line, stationId, scheduleS, hour } = factorless!
    const row = resolveHeadway({ nominalS: scheduleS, kind: 'stop', lineCode: line, stationId, day: 'WD', hour, enabled: true, tj: true })
    const level = observedLineHeadway(line, 'WD', hour)!
    expect(row).toEqual({ headwayS: level.seconds, basis: level.interpolated ? 'INTERPOLATED' : 'OBSERVED' })
  })

  it('does not call a rarer stop OBSERVED, and never shortens it below its schedule value', () => {
    for (const { line, stationId, scheduleS, hour } of factorlessStops.rare) {
      const row = resolveHeadway({ nominalS: scheduleS, kind: 'stop', lineCode: line, stationId, day: 'WD', hour, enabled: true, tj: true })
      expect(row.basis).toBe('SCALED')
      expect(row.headwayS!).toBeGreaterThanOrEqual(scheduleS)
    }
  })

  it('does not affect a stop that has a factor', () => {
    expect(resolveHeadway({ nominalS: 120, kind: 'stop', lineCode: profiledLine, stationId: stopId, day: 'WD', hour: 12, enabled: true }).headwayS)
      .toBe(observedStopHeadway(profiledLine, stopId, 'WD', 12)!.seconds)
  })
})

describe('planner and endpoint agree', () => {
  /*
   * The planner map and the station endpoint are two implementations of one
   * rule. They drifted once (a stop with a factor but no profile at an hour got
   * the line level in the planner and the scaled schedule on the endpoint), so
   * every corridor stop is compared at hours that exercise each branch.
   */
  it.each([0, 4, 12, 17, 22])('gives the same per-stop value at hour %i', (hour) => {
    const map = plannerHeadways('WD', hour, true)
    let compared = 0
    for (const [key, scheduleS] of Object.entries(STOP_HEADWAYS_S)) {
      const line = key.slice(0, key.indexOf('@'))
      if (!LINE_TERMINI[line]) continue
      const row = resolveHeadway({
        nominalS: scheduleS,
        kind: 'stop',
        lineCode: line,
        stationId: key.slice(key.indexOf('@') + 1),
        day: 'WD',
        hour,
        enabled: true,
        tj: true
      })
      expect(map.get(key), `${key} at ${hour}:00`).toBe(row.headwayS)
      compared++
    }
    expect(compared).toBeGreaterThan(100)
  })
})
