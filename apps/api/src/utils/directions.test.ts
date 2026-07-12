import { describe, expect, it } from 'vitest'
import { Schedule } from 'db/schemas/schedules'
import { findTopology } from 'utils/topology'
import {
  BoundForEntry,
  buildLineMembershipCount,
  buildStationNameIndex,
  groupDirections,
  resolveBoundForCode
} from 'utils/directions'

// Real TOPOLOGY pins the tests to the actual network; expected values come
// from direction-grouping-simulation.md at the repo root.
const DISPLAY: Record<string, string> = {
  CKR: 'Cikarang', TLM: 'Metland Telagamurni', CIT: 'Cibitung', TB: 'Tambun',
  BKST: 'Bekasi Timur', BKS: 'Bekasi', KRI: 'Kranji', CUK: 'Cakung',
  KLDB: 'Klender Baru', BUA: 'Buaran', KLD: 'Klender', JNG: 'Jatinegara',
  POK: 'Pondok Jati', KMT: 'Kramat', GST: 'Gang Sentiong', PSE: 'Pasar Senen',
  KMO: 'Kemayoran', RJW: 'Rajawali', KPB: 'Kampung Bandan', AK: 'Angke',
  DU: 'Duri', THB: 'Tanah Abang', KAT: 'Karet', SUDB: 'BNI City',
  SUD: 'Sudirman', MRI: 'Manggarai', MTR: 'Matraman',
  JAKK: 'Jakarta Kota', BOO: 'Bogor', NMO: 'Nambo', DP: 'Depok', CTA: 'Citayam',
  TNG: 'Tangerang', BPR: 'Batu Ceper', RW: 'Rawa Buaya',
  RK: 'Rangkasbitung'
}

const nameIndex = buildStationNameIndex(
  Object.entries(DISPLAY).map(([code, name]) => ({
    code,
    name: name.toUpperCase(),
    formattedName: name
  }))
)
const membership = buildLineMembershipCount('KCI')

let scheduleId = 0
function schedules(count: number, tripPrefix = '5'): Schedule[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `sched-${scheduleId++}`,
    stationId: 'KCI-TEST',
    tripNumber: `${tripPrefix}${100 + i}`,
    estimatedDeparture: new Date(),
    estimatedArrival: new Date(),
    boundFor: '',
    lineCode: 'C',
    createdAt: new Date(),
    updatedAt: new Date()
  }))
}

function entry(boundFor: string, count: number, via: string | null = null, tripPrefix = '5'): BoundForEntry {
  return { boundFor, via, schedules: schedules(count, tripPrefix) }
}

function group(params: { lineCode: string, stationCode: string, entries: BoundForEntry[] }) {
  return groupDirections({
    operator: 'KCI',
    lineCode: params.lineCode,
    stationCode: params.stationCode,
    topology: findTopology('KCI', params.lineCode),
    entries: params.entries,
    nameIndex,
    lineMembershipCount: membership
  })
}

describe('groupDirections', () => {
  it('collapses Cakung C from 8 boundFor buckets to 3 directions with derived labels', () => {
    const groups = group({
      lineCode: 'C',
      stationCode: 'CUK',
      entries: [
        entry('Angke', 62),
        entry('Bekasi', 81),
        entry('Cikarang', 76),
        entry('Jakartakota', 3, null, '6'),
        entry('Kampung Bandan', 50, 'Manggarai'),
        entry('Kampung Bandan', 40, 'Pasar Senen'),
        entry('Manggarai', 5),
        entry('Tambun', 3)
      ]
    })

    expect(groups).toHaveLength(3)
    // Busiest first: eastbound 160, via-Manggarai 117, via-Pasar Senen 43.
    expect(groups[0]).toMatchObject({ key: 'KRI:', label: ['Bekasi', 'Cikarang'], nextHopCode: 'KRI' })
    expect(groups[1]).toMatchObject({ key: 'KLDB:MRI', label: ['Manggarai', 'BNI City', 'Kampung Bandan'] })
    expect(groups[2]).toMatchObject({ key: 'KLDB:PSE', label: ['Kramat', 'Pasar Senen', 'Kampung Bandan'] })
  })

  it('merges via-less Angke and Manggarai short-turns into the via-Manggarai group (canonical via)', () => {
    const groups = group({
      lineCode: 'C',
      stationCode: 'CUK',
      entries: [
        entry('Angke', 62),
        entry('Manggarai', 5),
        entry('Kampung Bandan', 50, 'Manggarai')
      ]
    })
    expect(groups).toHaveLength(1)
    // Farthest-first destinations.
    expect(groups[0]!.destinations.map(d => d.boundFor)).toEqual(['Kampung Bandan', 'Angke', 'Manggarai'])
  })

  it('splits proxied Jakarta Kota trains by trip prefix at via-split stations', () => {
    const groups = group({
      lineCode: 'C',
      stationCode: 'CUK',
      entries: [
        entry('Jakartakota', 3, null, '6'),
        entry('Kampung Bandan', 50, 'Manggarai'),
        entry('Kampung Bandan', 40, 'Pasar Senen')
      ]
    })
    const pasarSenen = groups.find(g => g.key === 'KLDB:PSE')!
    expect(pasarSenen.destinations.map(d => d.boundFor)).toContain('Jakartakota')
    const manggarai = groups.find(g => g.key === 'KLDB:MRI')!
    expect(manggarai.destinations.map(d => d.boundFor)).not.toContain('Jakartakota')
  })

  it('merges Jakarta Kota trains without partition when the station is not via-split (Kramat)', () => {
    const groups = group({
      lineCode: 'C',
      stationCode: 'KMT',
      entries: [
        entry('Jakartakota', 3, null, '6'),
        entry('Kampung Bandan', 40),
        entry('Cikarang', 42)
      ]
    })
    expect(groups).toHaveLength(2)
    const toKpb = groups.find(g => g.nextHopCode === 'GST')!
    expect(toKpb.destinations.map(d => d.boundFor).sort()).toEqual(['Jakartakota', 'Kampung Bandan'])
  })

  it('splits the Citayam fork into three directions and labels the cityward spine', () => {
    const groups = group({
      lineCode: 'B',
      stationCode: 'CTA',
      entries: [
        entry('Jakartakota', 137),
        entry('Manggarai', 26),
        entry('Depok', 20),
        entry('Bogor', 164),
        entry('Nambo', 16)
      ]
    })
    expect(groups).toHaveLength(3)
    expect(groups[0]!.label).toEqual(['Depok', 'Manggarai', 'Jakarta Kota'])
    expect(groups[1]!.label).toEqual(['Bogor'])
    expect(groups[2]!.label).toEqual(['Nambo'])
  })

  it('labels a single-direction station without sibling-dropping its own spine', () => {
    const groups = group({
      lineCode: 'T',
      stationCode: 'TNG',
      entries: [entry('Duri', 60)]
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toEqual(['Batu Ceper', 'Rawa Buaya', 'Duri'])
  })

  it('lets a busy near short-turn extend, not truncate, the spine (Duri westbound)', () => {
    const groups = group({
      lineCode: 'C',
      stationCode: 'DU',
      entries: [
        entry('Angke', 71),
        entry('Kampung Bandan', 59),
        entry('Jakartakota', 3, null, '6'),
        entry('Cikarang', 54)
      ]
    })
    const west = groups.find(g => g.nextHopCode === 'AK')!
    // Angke (71x) does not own the spine; Kampung Bandan (59x) is farther and
    // qualifies. The 3-train Jakarta Kota diversion joins but never labels.
    expect(west.label).toEqual(['Angke', 'Kampung Bandan'])
    expect(west.destinations.map(d => d.boundFor)).toContain('Jakartakota')
  })

  it('derives canonical via from the path interior, not the origin (Manggarai)', () => {
    const groups = group({
      lineCode: 'C',
      stationCode: 'MRI',
      entries: [
        entry('Cikarang', 59),
        entry('Kampung Bandan', 59),
        entry('Angke', 71)
      ]
    })
    expect(groups.map(g => g.key).sort()).toEqual(['MTR:', 'SUD:'])
  })

  it('replaces the spine end with the real terminus for proxied off-topology walks (airport)', () => {
    const groups = group({
      lineCode: 'A',
      stationCode: 'DU',
      entries: [
        entry('Bandara Soekarno-Hatta', 32),
        entry('Manggarai', 32)
      ]
    })
    const airport = groups.find(g => g.nextHopCode === 'RW')!
    expect(airport.label).toEqual(['Rawa Buaya', 'Bandara Soekarno-Hatta'])
  })

  it('falls back to a synthetic group when the proxy target is the station itself', () => {
    const batuCeper = group({
      lineCode: 'A',
      stationCode: 'BPR',
      entries: [entry('Bandara Soekarno-Hatta', 32)]
    })
    expect(batuCeper[0]).toMatchObject({
      key: 'SYN:Bandara Soekarno-Hatta:',
      label: ['Bandara Soekarno-Hatta'],
      nextHopCode: null
    })

    const kampungBandan = group({
      lineCode: 'C',
      stationCode: 'KPB',
      entries: [entry('Jakartakota', 3, null, '6')]
    })
    expect(kampungBandan[0]!.key).toBe('SYN:Jakartakota:')
  })

  it('falls back to a synthetic group for unproxied off-topology termini (Manggarai on R)', () => {
    const groups = group({
      lineCode: 'R',
      stationCode: 'THB',
      entries: [
        entry('Rangkasbitung', 55),
        entry('Manggarai', 1)
      ]
    })
    expect(groups).toHaveLength(2)
    expect(groups[1]).toMatchObject({ key: 'SYN:Manggarai:', label: ['Manggarai'] })
  })

  it('emits one synthetic group per bucket when there is no topology', () => {
    const groups = groupDirections({
      operator: 'MRTJ',
      lineCode: 'Z',
      stationCode: 'XX',
      topology: null,
      entries: [entry('Bundaran HI', 10), entry('Lebak Bulus Grab', 10)],
      nameIndex,
      lineMembershipCount: membership
    })
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.label)).toEqual([['Bundaran HI'], ['Lebak Bulus Grab']])
    expect(groups.every(g => g.nextHopCode === null)).toBe(true)
  })
})

describe('resolveBoundForCode', () => {
  it('resolves dirty feed names through aliases', () => {
    expect(resolveBoundForCode('Jakartakota', nameIndex)).toBe('JAKK')
    expect(resolveBoundForCode('Tanahabang', nameIndex)).toBe('THB')
    expect(resolveBoundForCode('Tanjungpriuk', nameIndex)).toBe('TPK')
    expect(resolveBoundForCode('Bandara Soekarno-Hatta', nameIndex)).toBe('BST')
    expect(resolveBoundForCode('undefined Parungpanjang', nameIndex)).toBe('PRP')
  })

  it('resolves clean names via the index and rejects unknowns', () => {
    expect(resolveBoundForCode('Kampung Bandan', nameIndex)).toBe('KPB')
    expect(resolveBoundForCode('BEKASI', nameIndex)).toBe('BKS')
    expect(resolveBoundForCode('Stasiun Fiktif', nameIndex)).toBeNull()
  })
})
