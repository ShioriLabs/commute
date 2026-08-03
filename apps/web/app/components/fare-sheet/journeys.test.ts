import { describe, expect, it } from 'vitest'
import type { FareJourney, FareResult, TripResult } from '@commute/schemas'
import { JOURNEY_LABELS, JOURNEY_LABEL_DESCRIPTIONS } from './journey-labels'
import { journeysOf, sortJourneyLabels, walkDistanceOf } from './journeys'

const legacy: FareResult = {
  from: { id: 'KCI-SUD', name: 'Sudirman' },
  to: { id: 'MRTJ-LBB', name: 'Stasiun Lebak Bulus' },
  legs: [],
  segments: [],
  totalFare: 14000,
  totalDistanceM: 13388,
  transferCount: 1
}

const journey = (over: Partial<FareJourney> = {}): FareJourney => ({
  legs: [],
  segments: [],
  totalFare: 10500,
  totalDistanceM: 27463,
  transferCount: 2,
  labels: [],
  boardings: 3,
  walkDistanceM: 460,
  ...over
})

describe('journeysOf', () => {
  it('returns the alternatives when the response carries them', () => {
    const cheap = journey({ labels: ['CHEAPEST'] })
    expect(journeysOf({ from: legacy.from, to: legacy.to, journeys: [journey(), cheap] })).toHaveLength(2)
  })

  /*
   * The API's KV holds pre-change bodies for 20 hours and the app caches
   * responses itself, so a fare answer with no `journeys` is a real thing to
   * render, not a defensive hypothetical.
   */
  it('promotes the primary when the response predates alternatives', () => {
    const [only] = journeysOf(legacy)
    expect(journeysOf(legacy)).toHaveLength(1)
    expect(only!.totalFare).toBe(14000)
    expect(only!.transferCount).toBe(1)
  })

  it('gives a promoted primary no labels', () => {
    // It was never compared against anything, so it has won nothing.
    expect(journeysOf(legacy)[0]!.labels).toEqual([])
  })

  it('treats an empty journeys array as absent', () => {
    // Should never happen — the endpoint 404s rather than returning an empty
    // front — but falling through to the flat fields beats rendering nothing.
    expect(journeysOf({ ...legacy, journeys: [] } as FareResult & TripResult)).toHaveLength(1)
  })

  it('derives boardings from the interchange count', () => {
    expect(journeysOf(legacy)[0]!.boardings).toBe(2)
    expect(journeysOf({ ...legacy, transferCount: 0 })[0]!.boardings).toBe(1)
  })
})

/*
 * The release gate, as FareResultCard applies it.
 *
 * Asserted on the data rather than the DOM (vitest collects `.test.ts` only, so
 * the component itself is uncoverable) — but this IS the gate: the component
 * does `alternatives ? all : all.slice(0, 1).map(j => ({ ...j, labels: [] }))`
 * and renders whatever comes out. If this shape is right, /fare is right.
 */
describe('the alternatives gate', () => {
  const gate = (result: FareResult | TripResult, alternatives: boolean) => {
    const all = journeysOf(result)
    return alternatives ? all : all.slice(0, 1).map(j => ({ ...j, labels: [] }))
  }

  const twoOptions: TripResult = {
    from: legacy.from,
    to: legacy.to,
    journeys: [
      journey({ totalFare: 11000, labels: ['FEWEST_CHANGES', 'LEAST_WALKING'] }),
      journey({ totalFare: 10500, labels: ['CHEAPEST'] })
    ]
  }

  it('offers every option when the surface opts in', () => {
    expect(gate(twoOptions, true)).toHaveLength(2)
  })

  it('shows only the primary when it does not', () => {
    const shown = gate(twoOptions, false)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.totalFare).toBe(11000)
  })

  /*
   * The subtle half. Slicing to one journey keeps that journey's labels, which
   * would badge "paling sedikit transit" on a card with nothing beside it —
   * boasting about a choice the rider was never offered. /fare showed three
   * such badges before this was fixed.
   */
  it('strips the badges from a gated primary', () => {
    expect(gate(twoOptions, false)[0]!.labels).toEqual([])
  })

  it('leaves the journey otherwise untouched', () => {
    const [gated] = gate(twoOptions, false)
    const [full] = journeysOf(twoOptions)
    expect({ ...gated, labels: full!.labels }).toEqual(full)
  })
})

describe('walkDistanceOf', () => {
  it('reports a real distance', () => {
    expect(walkDistanceOf(journey({ walkDistanceM: 460 }))).toBe(460)
    // A genuine zero is a claim the response actually made.
    expect(walkDistanceOf(journey({ walkDistanceM: 0 }))).toBe(0)
  })

  it('reports null for a promoted primary, which never knew', () => {
    // Rendering 0 here would tell a rider a journey involves no walking when
    // the old response simply never said.
    expect(walkDistanceOf(journeysOf(legacy)[0]!)).toBeNull()
  })
})

describe('sortJourneyLabels', () => {
  it('puts price first, whatever order the engine assigned', () => {
    expect(sortJourneyLabels(['SHORTEST_WAIT', 'CHEAPEST'])).toEqual(['CHEAPEST', 'SHORTEST_WAIT'])
  })

  it('orders a one-seat ride that wins several axes', () => {
    expect(sortJourneyLabels(['LEAST_WALKING', 'SHORTEST_WAIT', 'FEWEST_CHANGES']))
      .toEqual(['FEWEST_CHANGES', 'LEAST_WALKING', 'SHORTEST_WAIT'])
  })

  it('drops nothing and invents nothing', () => {
    expect(sortJourneyLabels([])).toEqual([])
    expect(sortJourneyLabels(['CHEAPEST'])).toEqual(['CHEAPEST'])
  })
})

describe('journey label copy', () => {
  it('has a label and a description for every axis', () => {
    for (const [key, label] of Object.entries(JOURNEY_LABELS)) {
      expect(label.length, key).toBeGreaterThan(0)
      expect(JOURNEY_LABEL_DESCRIPTIONS[key as keyof typeof JOURNEY_LABELS].length, key).toBeGreaterThan(0)
    }
  })

  /*
   * The engine has no timetable and no duration model. Copy that reads as a
   * time promise ("tercepat", "sampai 20 menit lagi") would claim something it
   * cannot compute, which is the rule utils/fare-criteria.ts sets out. Guard it
   * here so a later copy edit has to argue with a failing test.
   */
  it('never promises a duration or an arrival time', () => {
    const forbidden = /cepat|menit|jam |tiba|sampai lebih/i
    for (const [key, text] of Object.entries({ ...JOURNEY_LABELS, ...JOURNEY_LABEL_DESCRIPTIONS })) {
      expect(text, `${key}: "${text}"`).not.toMatch(forbidden)
    }
  })
})
