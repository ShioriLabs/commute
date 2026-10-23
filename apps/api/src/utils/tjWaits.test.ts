import { describe, expect, it } from 'vitest'
import { OBSERVED_CV_PROFILE } from '../db/data/headways.observed'
import { SHARED_CV } from '../db/data/headways.shared'
import { tjDirOf } from './tjHops'
import { bunchingFactor, expectedWaitS, MAX_WAIT_CV, UNFITTED_SHARED_CV } from './tjWaits'

const at = (h: number, m = 0) => h * 3600 + m * 60
const KARET_KUNINGAN = 'TJ-H00098P'
const KUNINGAN_MADYA = 'TJ-H00114P'

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

describe('expectedWaitS', () => {
  const headways = new Map([['6', 600], ['6A', 900], ['13E', 1200], ['L13E', 1800], ['C', 600]])
  const ctx = { day: 'WD' as const, clockS: at(12), headways, observed: true }
  const own = (line: string, h: number) =>
    (h / 2) * bunchingFactor('WD', at(12), `${line}@${tjDirOf(line, KARET_KUNINGAN, KUNINGAN_MADYA)}`)

  it('waits half the boarded line\'s headway off TransJakarta, or with observed headways off', () => {
    expect(expectedWaitS(['C', 'B'], 'KCI-MRI', 'KCI-JNG', ctx)).toBe(300)
    expect(expectedWaitS(['6', '6A'], KARET_KUNINGAN, KUNINGAN_MADYA, { ...ctx, observed: false })).toBe(300)
  })

  it('bunches a single TJ line by its own direction', () => {
    expect(expectedWaitS(['6'], KARET_KUNINGAN, KUNINGAN_MADYA, ctx)).toBeCloseTo(own('6', 600))
  })

  /*
   * Karet Kuningan toward Kuningan Madya at weekday midday: 6, 6A, 13E and L13E,
   * whose merged stream the fit puts at CV 0.80. Equal 20-minute headways keep
   * the arithmetic legible and the best single line's cap out of the way.
   */
  it('pools a shared stretch at its fitted CV', () => {
    const lines = ['6', '6A', '13E', 'L13E']
    const key = `WD:3:${KARET_KUNINGAN}>${KUNINGAN_MADYA}|13E,6,6A,L13E`
    expect(SHARED_CV[key]).toBe(0.8)
    const headwaysEach = new Map(lines.map(line => [line, 1200]))
    const wait = expectedWaitS(lines, KARET_KUNINGAN, KUNINGAN_MADYA, { ...ctx, headways: headwaysEach })!
    // Four lines every 20 minutes: a bus every 5 on average, (300 / 2)(1 + 0.8²).
    expect(wait).toBeCloseTo(150 * 1.64)
  })

  it('never waits longer on a shared stretch than for the best line alone', () => {
    // 6 every 2 minutes and three rare lines: the merged figure would exceed 6's own.
    const lines = ['6', '6A', '13E', 'L13E']
    const skewed = new Map([['6', 120], ['6A', 3600], ['13E', 3600], ['L13E', 3600]])
    const wait = expectedWaitS(lines, KARET_KUNINGAN, KUNINGAN_MADYA, { ...ctx, headways: skewed })!
    expect(wait).toBeLessThanOrEqual(own('6', 120) + 1e-9)
  })

  it('takes the merged stream as Poisson where the fit has no cell', () => {
    // A set no fit could have produced: two lines that never share a stretch.
    const wait = expectedWaitS(['6', 'C'], KARET_KUNINGAN, KUNINGAN_MADYA, { ...ctx, headways: new Map([['6', 6000], ['C', 6000]]) })!
    const merged = 3000
    expect(wait).toBeCloseTo(Math.min(own('6', 6000), (merged / 2) * (1 + UNFITTED_SHARED_CV ** 2)))
  })

  it('has no wait without any headway, unless given a fallback', () => {
    expect(expectedWaitS(['NOPE'], KARET_KUNINGAN, KUNINGAN_MADYA, ctx)).toBeUndefined()
    expect(expectedWaitS(['NOPE'], KARET_KUNINGAN, KUNINGAN_MADYA, ctx, 900)).toBe(450)
  })
})
