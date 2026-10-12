import { afterEach, describe, expect, it } from 'vitest'
import { HEADWAYS_S, LINE_TERMINI } from '../db/data/headways'
import { OBSERVED_GTFS_SCALE, OBSERVED_PROFILE_INTERP_S, OBSERVED_PROFILE_S, OBSERVED_STOP_FACTOR } from '../db/data/headways.observed'
import { clampHeadway } from './headwayBounds'
import { baseHeadways } from './headways'
import {
  dayTypeOf,
  observedDirHeadway,
  observedLineHeadway,
  observedStopHeadway,
  plannerHeadways,
  resolveHeadway,
  scaledHeadway
} from './observedHeadways'
import { OBSERVED_HEADWAYS_FLAG_KEY, observedHeadwaysEnabled, refreshObservedHeadwaysFlag, setObservedHeadwaysEnabled } from './observedFlag'

/*
 * Fixtures come from the generated overlay, so a refit does not break these:
 * what is pinned is how the lookup combines the three exports, not their numbers.
 */
const COLUMN = 'WD:12'
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

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
    expect(scaledHeadway(200, line, 'WD', 17)).toBe(clampHeadway(200 * OBSERVED_GTFS_SCALE['WD:17']!))
    expect(scaledHeadway(100_000, line, 'WD', 12)).toBe(3600)
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

  it('falls back to the scaled schedule where there is no profile at all, measured or interpolated', () => {
    const line = Object.keys(LINE_TERMINI).find(l => HEADWAYS_S[l] !== undefined
      && !Object.keys(OBSERVED_PROFILE_S).some(k => k.startsWith('WD:') && k.includes(`:${l}@`))
      && !Object.keys(OBSERVED_PROFILE_INTERP_S).some(k => k.startsWith('WD:') && k.includes(`:${l}@`)))
    if (line === undefined) return // every TJ line has a profile in this fit
    expect(plannerHeadways('WD', 17, true).get(line)).toBe(clampHeadway(HEADWAYS_S[line]! * OBSERVED_GTFS_SCALE['WD:17']!))
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
        .toEqual({ headwayS: clampHeadway(120 * OBSERVED_GTFS_SCALE[`WD:${bare}`]!), basis: 'SCALED' })
    }
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

  it('uses the documented key', () => {
    expect(OBSERVED_HEADWAYS_FLAG_KEY).toBe('config:observed-headways')
  })
})
