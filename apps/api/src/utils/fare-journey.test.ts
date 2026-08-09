import { describe, expect, it } from 'vitest'
import type { FareContext } from '@commute/constants'
import type { Criteria, RideLeg, RouteLeg, TransferLeg } from '@commute/tsundere'
import { assembleJourney, planJourney, stationNamer } from 'utils/fare-journey'

/*
 * The assembly pipeline, lifted out of routes/fares.ts.
 *
 * It was untestable while it lived inside the request handler, which is how a
 * 130-line block of corridor folding, interlining and headsign resolution ended
 * up with no coverage at all. The fixtures below are captured from real
 * production responses, so these double as the regression harness proving the
 * extraction changed nothing.
 */

const CONTEXT: FareContext = {
  paymentMethod: 'STORED_VALUE',
  departureAt: new Date('2026-08-03T12:00:00+07:00')
}

const criteria = (over: Partial<Criteria> = {}): Criteria => ({
  boardings: 1,
  rideDistanceM: 0,
  walkDistanceM: 0,
  waitS: 0,
  fare: null,
  ...over
})

const ride = (operator: string, lineCode: string, stations: string[], distanceM: number): RideLeg => ({
  type: 'RIDE',
  lineCode,
  operator,
  fromStationId: `${operator}-${stations[0]}`,
  toStationId: `${operator}-${stations[stations.length - 1]}`,
  stationIds: stations.map(s => `${operator}-${s}`),
  distanceM
})

const walk = (from: string, to: string, distanceM: number): TransferLeg => ({
  type: 'TRANSFER',
  fromStationId: from,
  toStationId: to,
  distanceM,
  noTap: false
})

/** Names every id as `Name:<id>`, so a missing lookup is visible in assertions. */
const namerFor = (legs: RouteLeg[], extra: string[] = []) => {
  const ids = new Set([
    ...legs.flatMap(l => l.type === 'RIDE' ? l.stationIds : [l.fromStationId, l.toStationId]),
    ...extra
  ])
  return stationNamer([...ids].map(id => ({ id, name: `Name:${id}` })))
}

const build = (legs: RouteLeg[], over: Partial<Criteria> = {}, labels: Parameters<typeof planJourney>[2] = []) => {
  const plan = planJourney(legs, criteria(over), labels, CONTEXT)
  return { plan, journey: assembleJourney(plan, namerFor(plan.legs, plan.stationIds), CONTEXT) }
}

describe('planJourney', () => {
  it('reports every station it will need a name for, including headsign termini', () => {
    // The batched lookup in routes/fares.ts is built from exactly this list, so
    // an id missing here surfaces as a raw `KCI-BOO` leaking into the response
    // rather than as a crash — the failure mode that makes it worth pinning.
    const { plan } = build([ride('LRTJBDB', 'BK', ['DKA', 'SET', 'RAS'], 3000)])
    for (const id of ['LRTJBDB-DKA', 'LRTJBDB-SET', 'LRTJBDB-RAS']) {
      expect(plan.stationIds).toContain(id)
    }
    // Headsign termini are off-path but still rendered, so they must be fetched.
    expect(plan.stationIds.length).toBeGreaterThan(3)
  })

  it('deduplicates ids shared between legs', () => {
    const { plan } = build([
      ride('KCI', 'C', ['BOO', 'MRI'], 1000),
      ride('KCI', 'C', ['MRI', 'SUD'], 1000)
    ])
    expect(plan.stationIds.filter(id => id === 'KCI-MRI')).toHaveLength(1)
  })
})

describe('assembleJourney', () => {
  it('renders a plain ride leg with its full stop list', () => {
    const { journey } = build([ride('KCI', 'C', ['BOO', 'MRI', 'SUD'], 4000)])
    expect(journey.legs).toHaveLength(1)
    const leg = journey.legs[0]!
    expect(leg.type).toBe('RIDE')
    if (leg.type !== 'RIDE') return
    expect(leg.line).toBe('KCI:C')
    expect(leg.stationCount).toBe(3)
    expect(leg.stops.map(s => s.id)).toEqual(['KCI-BOO', 'KCI-MRI', 'KCI-SUD'])
    expect(leg.distanceM).toBe(4000)
  })

  it('renders an ordinary walk as a free transfer', () => {
    const { journey } = build([
      ride('KCI', 'C', ['BOO', 'SUD'], 4000),
      walk('KCI-SUD', 'MRTJ-DKA', 90),
      ride('MRTJ', 'M', ['DKA', 'LBB'], 8000)
    ], { boardings: 2, walkDistanceM: 90 })

    const transfer = journey.legs.find(l => l.type === 'TRANSFER')
    expect(transfer).toBeDefined()
    if (transfer?.type !== 'TRANSFER') return
    expect(transfer.distanceM).toBe(90)
    // Free walks carry neither field; only surcharged corridors do.
    expect(transfer.fare).toBeUndefined()
    expect(transfer.corridorLabel).toBeUndefined()
    expect(journey.transferCount).toBe(1)
  })

  /*
   * Interlining: the LRT Jabodebek DKA..CWG trunk is served by both the Bekasi
   * and Cibubur lines, so either train gets the rider there. Captured from
   * production's /fares/LRTJBDB-DKA/LRTJBDB-CWG.
   */
  it('exposes both service lines on an interlined trunk leg, primary first', () => {
    const { journey } = build([
      ride('LRTJBDB', 'BK', ['DKA', 'SET', 'RAS', 'KUA', 'PAN', 'CKK', 'CIL', 'CWG'], 8164)
    ])
    const leg = journey.legs[0]!
    if (leg.type !== 'RIDE') throw new Error('expected a ride leg')
    expect(leg.serviceLines?.map(l => l.line)).toEqual(['LRTJBDB:BK', 'LRTJBDB:CB'])
    expect(leg.line).toBe(leg.serviceLines![0]!.line)
    expect(journey.totalDistanceM).toBe(8164)
  })

  it('omits serviceLines on an ordinary single-line leg', () => {
    const { journey } = build([ride('KCI', 'C', ['BOO', 'MRI'], 1000)])
    const leg = journey.legs[0]!
    if (leg.type !== 'RIDE') throw new Error('expected a ride leg')
    expect(leg.serviceLines).toBeUndefined()
  })

  it('omits a headsign whose terminus is not in the database', () => {
    // A terminus the lookup cannot resolve would otherwise echo its raw id into
    // rider-facing text.
    const legs = [ride('LRTJBDB', 'BK', ['DKA', 'SET', 'RAS'], 3000)]
    const plan = planJourney(legs, criteria(), [], CONTEXT)
    // Deliberately resolve only the stops, never the headsign termini.
    const partial = stationNamer(legs[0]!.stationIds.map(id => ({ id, name: `Name:${id}` })))
    const journey = assembleJourney(plan, partial, CONTEXT)
    const leg = journey.legs[0]!
    if (leg.type !== 'RIDE') throw new Error('expected a ride leg')
    expect(leg.headsign).toBeNull()
  })

  /*
   * The Dukuh Atas corridor: MRT Dukuh Atas -> KCI Sudirman -> LRT Dukuh Atas is
   * two walks in the graph but one paid interchange to a rider, and it hides a
   * 140m walk inside the paid area that no edge accounts for. Captured from
   * /fares/MRTJ-BNH/LRTJBDB-CWG?paymentMethod=QRIS_TAP, which returns exactly
   * one 540m transfer at Rp 3.000.
   */
  describe('surcharged corridor folding', () => {
    const corridorLegs = () => [
      ride('MRTJ', 'M', ['BNH', 'DKA'], 2000),
      walk('MRTJ-DKA', 'KCI-SUD', 90),
      walk('KCI-SUD', 'LRTJBDB-DKA', 310),
      ride('LRTJBDB', 'BK', ['DKA', 'SET', 'RAS'], 3000)
    ]
    const qris: FareContext = { ...CONTEXT, paymentMethod: 'QRIS_TAP' }
    const assemble = () => {
      const plan = planJourney(corridorLegs(), criteria({ boardings: 2, walkDistanceM: 400 }), [], qris)
      return assembleJourney(plan, namerFor(plan.legs, plan.stationIds), qris)
    }

    it('folds the two walks into a single priced interchange', () => {
      const transfers = assemble().legs.filter(l => l.type === 'TRANSFER')
      expect(transfers).toHaveLength(1)
      const [transfer] = transfers
      if (transfer?.type !== 'TRANSFER') throw new Error('expected a transfer leg')
      expect(transfer.from.id).toBe('MRTJ-DKA')
      expect(transfer.to.id).toBe('LRTJBDB-DKA')
      expect(transfer.fare).toBe(3000)
      expect(transfer.corridorLabel).toBe('Transit berbayar via Peron Sudirman')
    })

    it('adds the internal peron walk no edge accounts for', () => {
      // 90 + 310 walked between stations, plus 140m inside the paid area.
      const transfer = assemble().legs.find(l => l.type === 'TRANSFER')
      if (transfer?.type !== 'TRANSFER') throw new Error('expected a transfer leg')
      expect(transfer.distanceM).toBe(540)
    })

    it('counts the folded pair as one interchange, not two', () => {
      expect(assemble().transferCount).toBe(1)
    })
  })

  it('carries the engine criteria onto the journey', () => {
    const { journey } = build([ride('KCI', 'C', ['BOO', 'MRI'], 1000)], { boardings: 3, walkDistanceM: 460 })
    expect(journey.boardings).toBe(3)
    expect(journey.walkDistanceM).toBe(460)
  })

  /*
   * /fares/:from/:to runs this pipeline on a findRoute result, which has no
   * criteria vector at all — only the planner produces one. Both figures are
   * then counted off the legs, and must agree with what the planner would have
   * reported for the same journey.
   */
  describe('without an engine criteria vector', () => {
    const legs = [
      ride('KCI', 'C', ['BOO', 'SUD'], 4000),
      walk('KCI-SUD', 'MRTJ-DKA', 90),
      ride('MRTJ', 'M', ['DKA', 'LBB'], 8000)
    ]
    const assemble = () => {
      const plan = planJourney(legs, null, [], CONTEXT)
      return assembleJourney(plan, namerFor(plan.legs, plan.stationIds), CONTEXT)
    }

    it('counts one boarding per ride leg', () => {
      expect(assemble().boardings).toBe(2)
    })

    it('sums the transfer distances for walking', () => {
      expect(assemble().walkDistanceM).toBe(90)
    })

    it('agrees with the planner on the same journey', () => {
      // The planner increments boardings exactly when it boards a line, which
      // is one per RIDE leg once interlined legs have been merged.
      const planned = planJourney(legs, criteria({ boardings: 2, walkDistanceM: 90 }), [], CONTEXT)
      const fromCriteria = assembleJourney(planned, namerFor(planned.legs, planned.stationIds), CONTEXT)
      expect(assemble().boardings).toBe(fromCriteria.boardings)
      expect(assemble().walkDistanceM).toBe(fromCriteria.walkDistanceM)
    })
  })

  it('passes labels through unchanged, including none at all', () => {
    const { journey } = build([ride('KCI', 'C', ['BOO', 'MRI'], 1000)], {}, ['CHEAPEST', 'LEAST_WALKING'])
    expect(journey.labels).toEqual(['CHEAPEST', 'LEAST_WALKING'])

    // Empty is normal and correct: a journey that wins nothing outright has
    // nothing to badge, and inventing one would claim an untested property.
    const { journey: plain } = build([ride('KCI', 'C', ['BOO', 'MRI'], 1000)])
    expect(plain.labels).toEqual([])
  })
})

describe('stationNamer', () => {
  it('falls back to the raw id for an unknown station', () => {
    const { ref } = stationNamer([{ id: 'KCI-BOO', name: 'BOGOR' }])
    expect(ref('KCI-BOO').name).toBe('BOGOR')
    expect(ref('KCI-NOPE').name).toBe('KCI-NOPE')
  })

  it('reports whether an id resolved', () => {
    const { known } = stationNamer([{ id: 'KCI-BOO', name: 'BOGOR' }])
    expect(known('KCI-BOO')).toBe(true)
    expect(known('KCI-NOPE')).toBe(false)
    expect(known(null)).toBe(false)
  })
})
