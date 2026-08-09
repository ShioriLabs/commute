import { describe, expect, it } from 'vitest'
import type { FareResultLeg, FareResultRideLeg } from '@commute/schemas'
import { getForegroundColor } from '../../../utils/colors'
import { LINE_COLOR_FALLBACK } from '../transit-geometry'
import { type LineResolver, type RouteBarRide, routeBarSegments } from './route-bar-segments'

const station = (id: string, name: string) => ({ id, name })

const ride = (over: Partial<FareResultRideLeg> = {}): FareResultRideLeg => ({
  type: 'RIDE',
  line: 'KCI:C',
  operator: 'KCI',
  from: station('KCI-SUD', 'Sudirman'),
  to: station('KCI-MRI', 'Manggarai'),
  stationCount: 3,
  stops: [station('KCI-SUD', 'Sudirman'), station('KCI-MRI', 'Manggarai')],
  headsign: 'Bogor',
  distanceM: 4000,
  ...over
})

const transfer = (): FareResultLeg => ({
  type: 'TRANSFER',
  from: station('KCI-SUD', 'Sudirman'),
  to: station('MRTJ-DKA', 'Dukuh Atas BNI'),
  distanceM: 460
})

/* Stands in for the line dictionary: keys resolve, anything else does not. */
const DICTIONARY: Record<string, { code: string, name: string, color: string }> = {
  'KCI:C': { code: 'C', name: 'Commuter Line Bogor', color: '#d31145' },
  'MRTJ:M': { code: 'M', name: 'Ratangga', color: '#0b5eab' },
  'LRTJBDB:BK': { code: 'BK', name: 'Lin Bekasi', color: '#0f9648' }
}

const resolver: LineResolver = leg =>
  (leg.serviceLines ?? [{ line: leg.line, headsign: leg.headsign }])
    .map(ref => DICTIONARY[ref.line] ?? { code: ref.line, name: ref.line, color: LINE_COLOR_FALLBACK })

const ridesOf = (segments: ReturnType<typeof routeBarSegments>) =>
  segments.filter((segment): segment is RouteBarRide => segment.kind === 'RIDE')

describe('routeBarSegments', () => {
  it('carries every service colour on interlined track', () => {
    const legs = [ride({
      line: 'LRTJBDB:BK',
      serviceLines: [
        { line: 'LRTJBDB:BK', headsign: 'Jatimulya' },
        { line: 'MRTJ:M', headsign: 'Lebak Bulus' }
      ]
    })]

    const [segment] = ridesOf(routeBarSegments(legs, resolver))
    expect(segment!.colors).toEqual(['#0f9648', '#0b5eab'])
    // The primary leads, so the bar's code and name follow it.
    expect(segment!.code).toBe('BK')
  })

  /*
   * The API's KV holds pre-change bodies for 20 hours, so a leg without
   * serviceLines is a real response to render, not a defensive hypothetical.
   */
  it('falls back to the leg\'s own line when serviceLines is absent', () => {
    const [segment] = ridesOf(routeBarSegments([ride()], resolver))
    expect(segment!.colors).toEqual(['#d31145'])
    expect(segment!.name).toBe('Commuter Line Bogor')
  })

  /*
   * The roundel signs itself the way its operator does — TJ corridors filled,
   * rail ringed — so the leg's operator has to survive into the segment.
   */
  it('carries the operator through, so the roundel can style itself', () => {
    const [rail] = ridesOf(routeBarSegments([ride()], resolver))
    expect(rail!.operator).toBe('KCI')

    const [bus] = ridesOf(routeBarSegments([ride({ operator: 'TJ', line: 'TJ:5' })], resolver))
    expect(bus!.operator).toBe('TJ')
  })

  it('uses the fallback colour for a line the dictionary does not know', () => {
    const [segment] = ridesOf(routeBarSegments([ride({ line: 'KCI:ZZ' })], resolver))
    expect(segment!.colors).toEqual([LINE_COLOR_FALLBACK])
  })

  it('gives every transfer a walk segment, paid or not', () => {
    const segments = routeBarSegments([ride(), transfer(), ride()], resolver)
    expect(segments.map(s => s.kind)).toEqual(['RIDE', 'WALK', 'RIDE'])
  })

  it('carries the measured distance so the walk can report it', () => {
    const [, walk] = routeBarSegments([ride(), transfer(), ride()], resolver)
    expect(walk).toEqual({ kind: 'WALK', distanceM: 460 })
  })

  /*
   * A zero-distance transfer means the walk was never measured, not that it is
   * free — 11 pairs are still unmeasured. Reporting "0 m" would state a fact
   * the data does not have, so the figure is dropped and the badge stands alone.
   */
  it('reports no distance for an unmeasured transfer rather than zero', () => {
    const unmeasured: FareResultLeg = { ...transfer(), distanceM: 0 } as FareResultLeg
    const [, walk] = routeBarSegments([ride(), unmeasured, ride()], resolver)
    expect(walk).toEqual({ kind: 'WALK', distanceM: null })
  })

  it('shares the bar between ride legs in proportion to distance', () => {
    const legs = [ride({ distanceM: 3000 }), transfer(), ride({ distanceM: 1000 })]
    const shares = ridesOf(routeBarSegments(legs, resolver)).map(s => s.share)

    expect(shares).toEqual([0.75, 0.25])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1)
  })

  /*
   * A journey whose legs all report zero distance would divide by zero. The
   * share feeds the fit test, and NaN there silently drops every segment to its
   * barest rendering rather than failing loudly.
   */
  it('yields no NaN share when every ride leg reports zero distance', () => {
    const shares = ridesOf(routeBarSegments([ride({ distanceM: 0 }), ride({ distanceM: 0 })], resolver))
      .map(s => s.share)

    expect(shares).toEqual([0, 0])
    expect(shares.every(Number.isFinite)).toBe(true)
  })

  it('renders no segments for a journey with no legs', () => {
    expect(routeBarSegments([], resolver)).toEqual([])
  })

  it('renders no segments for a journey that never boards anything', () => {
    expect(routeBarSegments([transfer()], resolver)).toEqual([])
  })

  /*
   * A journey often opens or closes with a walk. A notch at the edge has
   * nothing on one side of it and reads as an orphaned icon rather than a break
   * between two rides — the timeline below still draws the walk in full.
   */
  it('drops leading and trailing transfers, keeping the ones between rides', () => {
    const legs = [transfer(), ride(), transfer(), ride(), transfer()]
    expect(routeBarSegments(legs, resolver).map(s => s.kind)).toEqual(['RIDE', 'WALK', 'RIDE'])
  })
})

/*
 * Every ride leg names itself, however short.
 *
 * This regressed once: the bar sized each roundel to its segment and hid it
 * below a threshold, so Blok M -> Cakung rendered its 634m first hop as an
 * anonymous stub. Short unfamiliar legs are the ones a rider is least able to
 * guess, so a leg's identity must not depend on how much ground it covers.
 */
describe('every ride names itself', () => {
  it('gives a leg a code even when it is a sliver of the journey', () => {
    const legs = [
      ride({ line: 'MRTJ:M', distanceM: 634 }),
      transfer(),
      ride({ line: 'KCI:C', distanceM: 14440 })
    ]

    const rides = ridesOf(routeBarSegments(legs, resolver))
    expect(rides.map(segment => segment.code)).toEqual(['M', 'C'])
    // The sliver is still drawn as a sliver; only its identity is unconditional.
    expect(rides[0]!.share).toBeLessThan(0.05)
  })
})

/*
 * getForegroundColor parses the fallback to pick a text colour. A malformed
 * value yields NaN luminance, which resolves to 'LIGHT' and paints white text
 * on a white ground — invisible, and only on the deploy-skew path nobody looks
 * at. Cheaper to assert the shape than to find that in the wild.
 */
describe('LINE_COLOR_FALLBACK', () => {
  it('is a six-digit hex getForegroundColor can read', () => {
    expect(LINE_COLOR_FALLBACK).toMatch(/^#[0-9a-f]{6}$/i)
    expect(['LIGHT', 'DARK']).toContain(getForegroundColor(LINE_COLOR_FALLBACK))
  })
})
