import { describe, expect, it } from 'vitest'
import type { DayTrips, Edge } from './dayTrips'
import {
  fitRuntimes,
  fitWindows,
  lineGeometry,
  MIN_HOP_N,
  MIN_TRIPS,
  MAX_TRIP_BIAS,
  poolTrips,
  renderPlannerRuntimes,
  renderRuntimes,
  type StratumScore,
  tripBias,
  type TripScore,
  vouchedBias,
  vouchedStrata
} from './runtimes'

// Six stops 1 km apart: hops 0 and 4 are terminus hops, 1..3 interior.
const geometry = lineGeometry([{
  operator: 'TJ',
  lineCode: 'T',
  path: ['A', 'B', 'C', 'D', 'E', 'F'].map((station, i) => ({ station, cumM: i * 1000 })),
  pathReverse: undefined
}] as never)

const day = (over: Partial<DayTrips> = {}): DayTrips => ({
  schema: 2,
  day: '20261007',
  dayType: 'WD',
  serviceDay: 'WD',
  snaps: 1,
  healthySecByBlock: [0, 0, 0, 0, 0, 0],
  transitions: { transitions: 0, adjacent: 0, jump: 0, unknownStop: 0, wideGap: 0, routeChange: 0, ambiguousDir: 0 },
  tripCounts: {},
  hops: {},
  trips: {},
  edges: {},
  ...over
})
const times = (n: number, s: number) => new Array<number>(n).fill(s)

describe('lineGeometry', () => {
  it('derives reverse hop lengths from the forward cumM when there is no pathReverse', () => {
    expect(geometry.get('T@F')!.hopMetres).toEqual([1000, 1000, 1000, 1000, 1000])
    expect(geometry.get('T@R')!.stops).toEqual(['F', 'E', 'D', 'C', 'B', 'A'])
    expect(geometry.get('T@R')!.hopMetres).toEqual([1000, 1000, 1000, 1000, 1000])
  })
})

describe('fitRuntimes', () => {
  // Midday (block 3) fully observed; the AM peak (block 2) has only full trips, 1.5x slower.
  const pool = poolTrips([day({
    hops: {
      'T@F|1|3': times(MIN_HOP_N, 100),
      'T@F|2|3': times(MIN_HOP_N, 120),
      'T@F|3|3': times(MIN_HOP_N, 140),
      'T@F|0|3': times(MIN_HOP_N, 900) // layover-laden origin hop: never OBSERVED
    },
    trips: { 'T@F|3': times(MIN_TRIPS + 5, 360), 'T@F|2': times(MIN_TRIPS, 540) }
  })])

  it('takes observed medians for interior hops and never for terminus hops', () => {
    const fit = fitRuntimes(pool, geometry)
    expect(fit.hops.get('WD|T@F|1|3')).toEqual({ s: 100, p75: 100, basis: 'OBSERVED' })
    expect(fit.hops.get('WD|T@F|0|3')!.basis).toBe('DISTANCE')
  })

  it('prices terminus hops at the bucket pace of the chosen cells', () => {
    const fit = fitRuntimes(pool, geometry)
    // (100 + 120 + 140) s over 3 km -> 120 s per km.
    expect(fit.hops.get('WD|T@F|0|3')).toEqual({ s: 120, p75: 120, basis: 'DISTANCE' })
    expect(fit.hops.get('WD|T@F|4|3')).toEqual({ s: 120, p75: 120, basis: 'DISTANCE' })
  })

  it('scales the best-covered block by the full-trip ratio where hops are thin', () => {
    const fit = fitRuntimes(pool, geometry)
    expect(fit.hops.get('WD|T@F|2|2')).toEqual({ s: 180, p75: 180, basis: 'SCALED' })
  })

  it('leaves a block out entirely when it has neither hops nor enough trips', () => {
    const fit = fitRuntimes(pool, geometry)
    expect([...fit.hops.keys()].some(k => k.endsWith('|4'))).toBe(false)
  })

  it('drops filtered strata, and with them the DISTANCE cells they would price', () => {
    const fit = fitRuntimes(pool, geometry, (_dt, block, basis) => !(block === 2 && basis === 'SCALED'))
    expect(fit.hops.has('WD|T@F|2|2')).toBe(false)
    expect(fit.hops.has('WD|T@F|0|2')).toBe(false)
    expect(fit.hops.has('WD|T@F|0|3')).toBe(true)
  })

  it('flags an interior hop never seen next to one seen often', () => {
    const gappy = poolTrips([day({ hops: { 'T@F|1|3': times(MIN_HOP_N, 100), 'T@F|3|3': times(MIN_HOP_N, 100) } })])
    expect(fitRuntimes(gappy, geometry).mismatches.get('T@F')).toEqual([2])
  })
})

describe('vouchedStrata', () => {
  const score = (over: Partial<StratumScore>): StratumScore =>
    ({ dt: 'WD', block: 2, basis: 'SCALED', buckets: 100, model: 0.1, baseline: 0.2, ...over })

  it('ships a stratum only with enough buckets and a win over the baseline', () => {
    const allow = vouchedStrata([
      score({}),
      score({ block: 3, buckets: 10 }),
      score({ block: 4, model: 0.3 })
    ])
    expect(allow('WD', 2, 'SCALED')).toBe(true)
    expect(allow('WD', 3, 'SCALED')).toBe(false)
    expect(allow('WD', 4, 'SCALED')).toBe(false)
    expect(allow('WD', 5, 'OBSERVED')).toBe(false)
    expect(allow('WD', 5, 'DISTANCE')).toBe(true)
  })
})

describe('fitWindows', () => {
  // 2026-10-07 is a Wednesday; WIB = UTC+7.
  const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+07:00`)
  const edge = (date: string, first: string, last: string, over: Partial<Edge> = {}): Edge =>
    ({ first: at(date, first), last: at(date, last), firstOk: true, lastOk: true, count: 50, night: false, ...over })
  const weekday = (d: string, e: Edge) => day({ day: d, edges: { 'T@F': e } })

  it('takes the median of agreeing weekdays', () => {
    const w = fitWindows([
      weekday('20261006', edge('2026-10-06', '05:00', '22:00')),
      weekday('20261007', edge('2026-10-07', '05:02', '22:10')),
      weekday('20261008', edge('2026-10-08', '05:04', '22:20'))
    ])
    expect(w.get('T@F')!.WD).toEqual({ first: 5 * 3600 + 120, last: 22 * 3600 + 600, days: 3 })
  })

  it('needs three weekdays and ignores untrusted edges and stray buses', () => {
    const w = fitWindows([
      weekday('20261006', edge('2026-10-06', '05:00', '22:00')),
      weekday('20261007', edge('2026-10-07', '05:00', '22:00', { firstOk: false })),
      weekday('20261008', edge('2026-10-08', '05:00', '22:00', { count: 3 }))
    ])
    expect(w.has('T@F')).toBe(false)
  })

  it('calls a line with night service all-day', () => {
    const w = fitWindows(['20261006', '20261007', '20261008'].map(d =>
      weekday(d, edge(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, '00:20', '23:40', { night: true, firstOk: false }))))
    expect(w.get('T@F')!.WD).toEqual({ allDay: true, days: 3 })
  })
})

describe('renderRuntimes', () => {
  it('writes station-keyed cells and evaluates to the same values', () => {
    const pool = poolTrips([day({ hops: { 'T@F|1|3': times(MIN_HOP_N, 100), 'T@F|2|3': times(MIN_HOP_N, 120), 'T@F|3|3': times(MIN_HOP_N, 140) } })])
    const text = renderRuntimes({
      fit: fitRuntimes(pool, geometry),
      windows: new Map([['T@F', { SUN: { first: 36000, days: 2 } }]]),
      geometry,
      range: { from: '20261006', to: '20261008' },
      dayCounts: { WD: 3, SAT: 0, SUN: 0 }
    })
    // Evaluate the generated module: strip the TS-only syntax and read the objects back.
    const js = text
      .replace(/^\/\*[\s\S]*?\*\/\n/, '')
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .replace(/export interface \w+ \{[\s\S]*?\n\}\n/g, '')
      .replace(/export type .*\n/g, '')
      .replace(/export const (\w+)(: [^=]+)? = /g, 'var $1 = ')
      .replace(/ as Record<string, readonly string\[\]>/g, '')
      .replace(/ as const/g, '')
    const mod = new Function(`${js}\nreturn { OBSERVED_HOP_S, OBSERVED_SERVICE_WINDOWS, OBSERVED_RUNTIMES_META }`)() as {
      OBSERVED_HOP_S: Record<string, unknown>
      OBSERVED_SERVICE_WINDOWS: Record<string, unknown>
    }
    expect(mod.OBSERVED_HOP_S['WD:10-16:T@F:TJ-B>TJ-C']).toEqual([100, 100, 'OBSERVED'])
    expect(mod.OBSERVED_HOP_S['WD:10-16:T@F:TJ-A>TJ-B']).toEqual([120, 120, 'DISTANCE'])
    expect(mod.OBSERVED_SERVICE_WINDOWS['T@F']).toEqual({ SUN: { first: 36000, days: 2 } })
  })
})

describe('tripBias', () => {
  const pool = (tripS: number) => poolTrips([day({
    hops: { 'T@F|1|3': times(MIN_HOP_N, 100), 'T@F|2|3': times(MIN_HOP_N, 100), 'T@F|3|3': times(MIN_HOP_N, 100) },
    trips: { 'T@F|3': times(MIN_TRIPS, tripS) }
  })])

  it('is the trip median over the summed interior hop medians', () => {
    expect(tripBias(fitRuntimes(pool(315), geometry), geometry).get('WD|T@F|3')).toBeCloseTo(1.05)
  })

  it('is clamped to [1, MAX_TRIP_BIAS]', () => {
    expect(tripBias(fitRuntimes(pool(250), geometry), geometry).get('WD|T@F|3')).toBe(1)
    expect(tripBias(fitRuntimes(pool(900), geometry), geometry).get('WD|T@F|3')).toBe(MAX_TRIP_BIAS)
  })

  it('skips strata the backtest does not vouch for', () => {
    const allow = vouchedBias([
      { dt: 'WD', block: 3, buckets: 50, model: 0.05, biased: 0.03, baseline: 0.2 },
      { dt: 'WE', block: 3, buckets: 50, model: 0.05, biased: 0.08, baseline: 0.2 }
    ] satisfies TripScore[])
    expect(allow('WD', 3)).toBe(true)
    expect(allow('WE', 3)).toBe(false)
    expect(tripBias(fitRuntimes(pool(315), geometry), geometry, () => false).size).toBe(0)
  })
})

describe('renderPlannerRuntimes', () => {
  it('lays cells out by hop position, with 0 for a missing cell and null for an empty block', () => {
    // Hop 2 seen, but too thinly for a cell (with no sightings at all it would be a mismatch, DISTANCE-priced).
    const pool = poolTrips([day({ hops: { 'T@F|1|3': times(MIN_HOP_N, 100), 'T@F|2|3': times(3, 500), 'T@F|3|3': times(MIN_HOP_N, 140) } })])
    const fit = fitRuntimes(pool, geometry)
    const text = renderPlannerRuntimes({ fit, bias: new Map([['WD|T@F|3', 1.04]]), geometry, range: { from: '20261006', to: '20261008' } })
    const js = text
      .replace(/^\/\*[\s\S]*?\*\/\n/, '')
      .replace(/export interface \w+ \{[\s\S]*?\n\}\n/g, '')
      .replace(/export const (\w+)(: [^=]+)? = /g, 'var $1 = ')
      .replace(/ as const/g, '')
    const { TJ_RUNTIMES } = new Function(`${js}\nreturn { TJ_RUNTIMES }`)() as {
      TJ_RUNTIMES: Record<string, { stops: string[], metres: number[], WD: ({ s: number[], bias: number } | null)[] }>
    }
    const line = TJ_RUNTIMES['T@F']!
    expect(line.stops).toEqual(['TJ-A', 'TJ-B', 'TJ-C', 'TJ-D', 'TJ-E', 'TJ-F'])
    expect(line.metres).toEqual([1000, 1000, 1000, 1000, 1000])
    // Hop 2 has no cell; the terminus hops are DISTANCE-priced at (100 + 140) / 2 km.
    expect(line.WD[3]).toEqual({ s: [120, 100, 0, 140, 120], p75: [120, 100, 0, 140, 120], bias: 1.04 })
    expect(line.WD[2]).toBeNull()
  })
})
