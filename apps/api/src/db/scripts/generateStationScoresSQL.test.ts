import { describe, expect, it } from 'vitest'
import { STATION_SCORE_MAX } from '@commute/constants'
import { anchorDemand, RIDERSHIP_ANCHORS, RIDERSHIP_BY_STATION_ID } from '../data/ridership'
import { ESTIMATE_MAX, isAnchored, serviceTerm, stationScore, structureTerm, type StationFacts } from './generateStationScoresSQL'

// Real service figures, from the peak-departures-per-line query x CAPACITY.
const KCI_TRUNK = 348 * 2000 //      Bogor line, the busiest on the network
const KCI_BRANCH = 64 * 2000 //      Soekarno-Hatta, the quietest KCI line
const MRTJ_THROUGH = 284 * 1200
const LRTJBDB_THROUGH = (214 + 216) * 740
const LRTJ_THROUGH = 204 * 270 //    LRT Jakarta, the smallest operator

function facts(overrides: Partial<StationFacts> = {}): StationFacts {
  return {
    service: MRTJ_THROUGH,
    lineCount: 1,
    interchangePartners: 0,
    hubMember: false,
    terminus: false,
    ...overrides
  }
}

describe('stationScore', () => {
  it('stays within [0, STATION_SCORE_MAX] across the whole input range', () => {
    const services = [0, 1, LRTJ_THROUGH, MRTJ_THROUGH, KCI_TRUNK, 1e9]
    const demands = [undefined, 0, 1, 1_000, 250_000, 1e9]
    for (const service of services) {
      for (const measuredDemand of demands) {
        for (const lineCount of [0, 1, 4, 40]) {
          const score = stationScore(facts({
            service,
            lineCount,
            interchangePartners: 99,
            hubMember: true,
            terminus: true,
            ...(measuredDemand === undefined ? {} : { measuredDemand })
          }))
          expect(score).toBeGreaterThanOrEqual(0)
          expect(score).toBeLessThanOrEqual(STATION_SCORE_MAX)
          expect(Number.isInteger(score)).toBe(true)
        }
      }
    }
  })

  it('reproduces the published ranking for every anchored station', () => {
    // The anchors are the only ground truth we have; if the demand curve ever
    // stops being monotonic in measured demand, the score has stopped meaning
    // what the ridership table says it means.
    const ranked = [...RIDERSHIP_ANCHORS]
      .map(anchor => ({ anchor, score: stationScore(facts({ measuredDemand: anchorDemand(anchor) })) }))
      .sort((a, b) => anchorDemand(b.anchor) - anchorDemand(a.anchor))

    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score)
    }
    // Tanah Abang carries the largest measured figure on the network.
    expect(ranked[0].anchor.stationId).toBe('KCI-THB')
    expect(ranked[0].score).toBe(STATION_SCORE_MAX)
  })

  it('ranks a terminus above a quieter through station on another operator', () => {
    // The bug the anchors exist to correct: LRT Jabodebek's Dukuh Atas is a
    // terminus, so a station-local departure count ranks it LAST on its own
    // operator. Measured, it is first — and must beat an unanchored MRT stop.
    const dukuhAtas = RIDERSHIP_BY_STATION_ID.get('LRTJBDB-DKA')!
    const measured = stationScore(facts({
      service: LRTJBDB_THROUGH,
      measuredDemand: anchorDemand(dukuhAtas),
      terminus: true
    }))
    const plainMrt = stationScore(facts({ service: MRTJ_THROUGH }))
    expect(measured).toBeGreaterThan(plainMrt)
  })

  it('does not penalise a terminus against a through station on the same line', () => {
    // Service is read as the line's peak, not the station's own count, so the
    // one-directional service at a terminus must not show up as less service.
    const through = stationScore(facts({ service: KCI_TRUNK }))
    const terminus = stationScore(facts({ service: KCI_TRUNK, terminus: true }))
    expect(terminus).toBeGreaterThanOrEqual(through)
  })

  it('never lets structure lift a branch halte above a trunk station', () => {
    // Structure is the only discriminator within a line, so it has to move a
    // station — but a single-line stop on the quietest line must still sit under
    // a plain stop on the busiest one, however well-connected it is otherwise.
    //
    // lineCount stays at 1 deliberately: service is summed over a station's
    // lines, so a multi-line station cannot hold branch-level service, and
    // pairing a high lineCount with a single line's service tests a station
    // that cannot exist.
    const maximalOnBranch = stationScore(facts({
      service: KCI_BRANCH,
      lineCount: 1,
      interchangePartners: 5,
      hubMember: true,
      terminus: true
    }))
    const plainOnTrunk = stationScore(facts({ service: KCI_TRUNK }))
    expect(maximalOnBranch).toBeLessThan(plainOnTrunk)
  })

  it('keeps every estimate below the measured interchanges', () => {
    // The intended asymmetry: we should not claim a station is busy on
    // structural grounds alone, so no estimate may reach a top anchor's score.
    const maximalEstimate = stationScore(facts({
      service: 1e9,
      lineCount: 40,
      interchangePartners: 99,
      hubMember: true,
      terminus: true
    }))
    expect(maximalEstimate).toBe(Math.round(STATION_SCORE_MAX * ESTIMATE_MAX))

    const manggarai = stationScore(facts({ measuredDemand: anchorDemand(RIDERSHIP_BY_STATION_ID.get('KCI-MRI')!) }))
    expect(maximalEstimate).toBeLessThan(manggarai)
  })

  it('orders the operators by the service they actually run', () => {
    const score = (service: number) => stationScore(facts({ service }))
    expect(score(KCI_TRUNK)).toBeGreaterThan(score(MRTJ_THROUGH))
    expect(score(MRTJ_THROUGH)).toBeGreaterThan(score(LRTJBDB_THROUGH))
    expect(score(LRTJBDB_THROUGH)).toBeGreaterThan(score(LRTJ_THROUGH))
  })

  it('scores negligible service at zero rather than crashing', () => {
    // Commuter Line Merak: real stations, 7-14 departures a day, no line rows.
    expect(stationScore(facts({ service: 7 * 2000, lineCount: 0 }))).toBe(0)
    expect(stationScore(facts({ service: 0, lineCount: 0 }))).toBe(0)
  })
})

describe('serviceTerm', () => {
  it('is monotonic and bounded', () => {
    expect(serviceTerm(0)).toBe(0)
    expect(serviceTerm(-1)).toBe(0)
    expect(serviceTerm(1e9)).toBe(1)
    expect(serviceTerm(KCI_TRUNK)).toBeGreaterThan(serviceTerm(LRTJ_THROUGH))
  })
})

describe('structureTerm', () => {
  it('is bounded even when every signal maxes out', () => {
    expect(structureTerm(facts())).toBe(0)
    // The four weights sum to 1 in decimal but not in binary floating point.
    expect(structureTerm(facts({
      lineCount: 99,
      interchangePartners: 99,
      hubMember: true,
      terminus: true
    }))).toBeCloseTo(1, 10)
  })

  it('weights interchange above terminus', () => {
    const interchange = structureTerm(facts({ lineCount: 3 }))
    const terminus = structureTerm(facts({ terminus: true }))
    expect(interchange).toBeGreaterThan(terminus)
  })
})

describe('isAnchored', () => {
  it('distinguishes measured stations from estimated ones', () => {
    expect(isAnchored(facts({ measuredDemand: 1000 }))).toBe(true)
    expect(isAnchored(facts())).toBe(false)
  })
})

describe('RIDERSHIP_ANCHORS', () => {
  it('has no duplicate stations', () => {
    expect(RIDERSHIP_BY_STATION_ID.size).toBe(RIDERSHIP_ANCHORS.length)
  })

  it('cites a source and a period for every figure', () => {
    for (const anchor of RIDERSHIP_ANCHORS) {
      expect(anchor.source).toMatch(/^https:\/\//)
      expect(anchor.period).not.toBe('')
      expect(anchor.published).not.toBe('')
      expect(anchorDemand(anchor)).toBeGreaterThan(0)
    }
  })
})
