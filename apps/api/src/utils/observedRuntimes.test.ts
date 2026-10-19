import { describe, expect, it } from 'vitest'
import type { RouteLeg } from '@commute/tsundere'
import { OBSERVED_CV_PROFILE } from '../db/data/headways.observed'
import { TJ_RUNTIMES } from '../db/data/runtimes.planner'
import { blockAt, bunchingFactor, estimateTjLeg, MAX_WAIT_CV, MIN_PRICED_SHARE } from './observedRuntimes'

/*
 * Fixtures come from the generated table itself, so a refit changes the numbers
 * these check against rather than breaking them.
 */

type RideLeg = Extract<RouteLeg, { type: 'RIDE' }>

const leg = (lineCode: string, stationIds: string[]): RideLeg => ({
  type: 'RIDE',
  lineCode,
  operator: 'TJ',
  fromStationId: stationIds[0]!,
  toStationId: stationIds.at(-1)!,
  stationIds,
  distanceM: 0
})

const at = (h: number, m = 0) => h * 3600 + m * 60
const MIDDAY = 3 // the 10-16 block

// A line-direction whose weekday midday bucket prices hops 1..4.
const [lineDir, line] = Object.entries(TJ_RUNTIMES).find(([, l]) => l.WD[MIDDAY] && l.WD[MIDDAY].s.slice(1, 5).every(s => s > 0))!
const code = lineDir.slice(0, lineDir.lastIndexOf('@'))
const bucket = line.WD[MIDDAY]!
const stops = line.stops.slice(1, 6)
const inputs = { day: 'WD' as const, headways: new Map([[code, 600]]), serviceHours: new Map() }

describe('blockAt', () => {
  it('maps the clock onto the runtime blocks, wrapping past midnight', () => {
    expect(blockAt(at(4, 59))).toBe(0)
    expect(blockAt(at(5))).toBe(1)
    expect(blockAt(at(9, 59))).toBe(2)
    expect(blockAt(at(12))).toBe(3)
    expect(blockAt(at(19))).toBe(4)
    expect(blockAt(at(23))).toBe(5)
    expect(blockAt(at(25))).toBe(0)
  })
})

describe('bunchingFactor', () => {
  // Synthetic keys can't collide with real ones, so these read the real table.
  const cell = Object.entries(OBSERVED_CV_PROFILE).find(([, cv]) => cv > 0.5 && cv < MAX_WAIT_CV)!
  const [dayType, hour, dir] = cell[0].split(':') as ['WD' | 'WE', string, string]

  it('lengthens the wait by 1 + CV² for the hour the rider arrives in', () => {
    expect(bunchingFactor(dayType, at(Number(hour), 30), dir)).toBeCloseTo(1 + cell[1] ** 2)
  })

  it('caps the spread at one full headway of wait', () => {
    const wild = Object.entries(OBSERVED_CV_PROFILE).find(([, cv]) => cv > MAX_WAIT_CV)!
    const [d, h, ld] = wild[0].split(':') as ['WD' | 'WE', string, string]
    expect(bunchingFactor(d, at(Number(h)), ld)).toBe(1 + MAX_WAIT_CV ** 2)
  })

  it('leaves the wait at half a headway where nothing was observed', () => {
    expect(bunchingFactor('WD', at(12), 'NO-SUCH-LINE@F')).toBe(1)
  })
})

describe('estimateTjLeg', () => {
  const bunching = bunchingFactor('WD', at(12), lineDir)

  it('waits half the headway scaled by bunching, then rides the hops\' medians with the line\'s bias', () => {
    const estimate = estimateTjLeg(leg(code, stops), at(12), inputs)!
    const sum = bucket.s.slice(1, 5).reduce((a, b) => a + b, 0)
    const interior = Math.max(1, line.stops.length - 3)
    const factor = 1 + (bucket.bias - 1) * Math.min(1, 4 / interior)
    expect(estimate.waitS).toBe(Math.round(300 * bunching))
    expect(estimate.rideS).toBe(Math.round(sum * factor))
  })

  it('sums the p75s, unbiased, for the cautious variant', () => {
    const estimate = estimateTjLeg(leg(code, stops), at(12), { ...inputs, statistic: 'p75' })!
    expect(estimate.rideS).toBe(bucket.p75.slice(1, 5).reduce((a, b) => a + b, 0))
  })

  it('prefers the stop\'s own headway over the line\'s', () => {
    const headways = new Map([[code, 600], [`${code}@${stops[0]}`, 240]])
    expect(estimateTjLeg(leg(code, stops), at(12), { ...inputs, headways })!.waitS).toBe(Math.round(120 * bunching))
  })

  it('gives up when the line has closed by the time a bus would come', () => {
    const serviceHours = new Map([[code, [at(5), at(12, 2)] as [number, number]]])
    expect(estimateTjLeg(leg(code, stops), at(12), { ...inputs, serviceHours })).toBeNull()
    expect(estimateTjLeg(leg(code, stops), at(11), { ...inputs, serviceHours })).not.toBeNull()
  })

  it('gives up without a headway, on a pair the table does not know, and off TransJakarta', () => {
    expect(estimateTjLeg(leg(code, stops), at(12), { ...inputs, headways: new Map() })).toBeNull()
    expect(estimateTjLeg(leg(code, [stops[1]!, stops[0]!]), at(12), inputs)).toBeNull()
    expect(estimateTjLeg({ ...leg(code, stops), operator: 'KCI' }, at(12), inputs)).toBeNull()
  })

  // A weekday bucket with a hole between two measured hops, if the data has one.
  const hole = (() => {
    for (const [ld, l] of Object.entries(TJ_RUNTIMES)) {
      for (const [b, bk] of l.WD.entries()) {
        const i = bk?.s.findIndex((s, k) => s === 0 && k > 0 && bk.s[k - 1]! > 0 && (bk.s[k + 1] ?? 0) > 0 && l.metres[k]! > 0) ?? -1
        if (i > 0) return { lineCode: ld.slice(0, ld.lastIndexOf('@')), line: l, block: b, i }
      }
    }
    return undefined
  })()

  it.skipIf(!hole)('prices an unmeasured hop at the leg\'s own pace only while most of it is measured', () => {
    const { lineCode, line: l, block, i } = hole!
    // Mid-block clocks, so the leg stays in `block` after a wait of up to one headway.
    const clock = [at(1), at(5, 30), at(8), at(12), at(17), at(21)][block]!
    const around = leg(lineCode, l.stops.slice(i - 1, i + 3))
    const measuredM = l.metres[i - 1]! + l.metres[i + 1]!
    const result = estimateTjLeg(around, clock, { ...inputs, headways: new Map([[lineCode, 600]]) })
    if (measuredM >= MIN_PRICED_SHARE * (measuredM + l.metres[i]!)) {
      const bk = l.WD[block]!
      const measuredS = bk.s[i - 1]! + bk.s[i + 1]!
      const priced = measuredS + l.metres[i]! * (measuredS / measuredM)
      expect(result!.rideS).toBeGreaterThanOrEqual(Math.round(priced))
    } else {
      expect(result).toBeNull()
    }
  })
})
