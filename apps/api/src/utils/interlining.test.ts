import { describe, expect, it } from 'vitest'
import { findInterliningLineCodes, mergeInterlinedLegs } from 'utils/interlining'
import type { RideLeg, RouteLeg } from 'utils/router'

const ride = (lineCode: string, stations: string[], distanceM: number): RideLeg => ({
  type: 'RIDE',
  lineCode,
  operator: 'LRTJBDB',
  fromStationId: `LRTJBDB-${stations[0]}`,
  toStationId: `LRTJBDB-${stations[stations.length - 1]}`,
  stationIds: stations.map(s => `LRTJBDB-${s}`),
  distanceM
})

// LRT Jabodebek shares the DKA..CWG trunk between the Bekasi (BK) and Cibubur
// (CB) service lines, then forks at Cawang. A leg lying entirely on the trunk
// can be served by either line; a leg that reaches a branch is single-line.
const TRUNK = ['DKA', 'SET', 'RAS', 'KUA', 'PAN', 'CKK', 'CIL', 'CWG']

describe('findInterliningLineCodes', () => {
  it('returns both trunk lines for a leg entirely on the shared trunk', () => {
    expect(findInterliningLineCodes('LRTJBDB', TRUNK)).toEqual(['BK', 'CB'])
  })

  it('detects the trunk regardless of travel direction', () => {
    expect(findInterliningLineCodes('LRTJBDB', [...TRUNK].reverse())).toEqual(['BK', 'CB'])
  })

  it('detects a mid-trunk leg that never reaches Dukuh Atas', () => {
    expect(findInterliningLineCodes('LRTJBDB', ['CKK', 'CIL', 'CWG'])).toEqual(['BK', 'CB'])
  })

  it('returns a single line for a leg that reaches the Cibubur branch', () => {
    expect(findInterliningLineCodes('LRTJBDB', [...TRUNK, 'TMI', 'KAM', 'CRC', 'HAR'])).toEqual(['CB'])
  })

  it('returns a single line for a branch-only leg (Cibubur, Harjamukti side)', () => {
    expect(findInterliningLineCodes('LRTJBDB', ['HAR', 'CRC', 'KAM', 'TMI', 'CWG'])).toEqual(['CB'])
  })

  it('returns a single line for a branch-only leg (Bekasi side)', () => {
    expect(findInterliningLineCodes('LRTJBDB', ['CWG', 'HAL', 'JBU', 'CK1', 'CK2', 'BEK', 'JTM'])).toEqual(['BK'])
  })

  it('is gated to interlining operators — KCI never reports multiple lines', () => {
    expect(findInterliningLineCodes('KCI', ['MRI', 'CKI', 'TEB'])).toEqual([])
  })

  // TransJakarta 13-family: 13E is the all-stops extended corridor whose topology
  // path contains this Puri Beta 2 → Karet Kuningan run contiguously; L13E is
  // skip-stop and does NOT contain the all-stops run, so only 13E matches.
  it('finds the TJ all-stops through-line (13E) for a Puri Beta 2 → Karet run', () => {
    const run = ['H00190P', 'H00189P', 'H00001P', 'H00091P', 'H00234P', 'H00040P', 'H00214P', 'H00101P', 'H00257P', 'H00130P', 'H00041P', 'H00249P', 'H00192P']
    expect(findInterliningLineCodes('TJ', run)).toContain('13E')
  })

  // Koridor 1 is asymmetric: Kejagung (H00266P) is served in the Kota→Blok M
  // direction only, so it appears in K1's `pathReverse`, never in `path`. A run
  // through it must still resolve to line '1' — the match has to consult
  // pathReverse, not just path.
  it('matches a reverse-only run (K1 via Kejagung) against pathReverse', () => {
    const run = ['H00127P', 'H00266P', 'H00014P'] // Masjid Agung → Kejagung → Blok M
    expect(findInterliningLineCodes('TJ', run)).toContain('1')
  })
})

describe('mergeInterlinedLegs', () => {
  it('merges a trunk+branch split into one through-line leg (Dukuh Atas → Harjamukti)', () => {
    // The router rides the trunk on Bekasi edges then switches to Cibubur at
    // Cawang, but a single Cibubur train runs the whole way — no change.
    const legs: RouteLeg[] = [
      ride('BK', ['DKA', 'SET', 'RAS', 'KUA', 'PAN', 'CKK', 'CIL', 'CWG'], 8000),
      ride('CB', ['CWG', 'TMI', 'KAM', 'CRC', 'HAR'], 5000)
    ]
    const merged = mergeInterlinedLegs(legs)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      type: 'RIDE',
      lineCode: 'CB',
      fromStationId: 'LRTJBDB-DKA',
      toStationId: 'LRTJBDB-HAR',
      distanceM: 13000,
      stationIds: ['DKA', 'SET', 'RAS', 'KUA', 'PAN', 'CKK', 'CIL', 'CWG', 'TMI', 'KAM', 'CRC', 'HAR'].map(s => `LRTJBDB-${s}`)
    })
  })

  it('keeps a genuine change-of-trains split (Harjamukti → Jatimulya)', () => {
    // No single line runs Harjamukti↔Jatimulya, so the change at Cawang is real.
    const legs: RouteLeg[] = [
      ride('CB', ['HAR', 'CRC', 'KAM', 'TMI', 'CWG'], 5000),
      ride('BK', ['CWG', 'HAL', 'JBU', 'CK1', 'CK2', 'BEK', 'JTM'], 9000)
    ]
    expect(mergeInterlinedLegs(legs).map(l => l.type)).toEqual(['RIDE', 'RIDE'])
  })

  it('leaves ordinary same-line legs untouched', () => {
    const legs: RouteLeg[] = [ride('BK', ['DKA', 'SET', 'RAS'], 2000)]
    expect(mergeInterlinedLegs(legs)).toEqual(legs)
  })
})
