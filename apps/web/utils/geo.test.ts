import { describe, expect, it } from 'vitest'
import type { Station } from 'models/stations'
import type { Operator } from 'models/operator'
import {
  FIX_TTL_MS,
  findCurrentStation,
  formatDistance,
  haversineMeters,
  isFixFresh,
  rankNearby,
  type Fix
} from './geo'

const KCI: Operator = { code: 'KCI', name: 'Commuter Line' }
const MRTJ: Operator = { code: 'MRTJ', name: 'MRT Jakarta' }
const TJ: Operator = { code: 'TJ', name: 'TransJakarta' }

interface StationSeed {
  id: string
  name: string
  code: string
  operator: Operator
  latitude: number | null
  longitude: number | null
  regionCode?: Station['regionCode']
  searchable?: boolean
}

// Coordinates below are the real production values, so the expected distances
// in these tests are the ones the app actually renders.
function station(seed: StationSeed): Station {
  return {
    id: seed.id,
    name: seed.name,
    formattedName: seed.name,
    code: seed.code,
    region: 'Jabodetabek',
    regionCode: seed.regionCode ?? 'CGK',
    operator: seed.operator,
    lines: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    timetableSynced: 0,
    score: 0,
    searchable: seed.searchable ?? true,
    amenities: [],
    latitude: seed.latitude,
    longitude: seed.longitude
  }
}

const DUKUH_ATAS = station({ id: 'MRTJ-DKA', name: 'Dukuh Atas BNI', code: 'DKA', operator: MRTJ, latitude: -6.2007, longitude: 106.8227 })
const SUDIRMAN = station({ id: 'KCI-SUD', name: 'Sudirman', code: 'SUD', operator: KCI, latitude: -6.2024, longitude: 106.8237 })
const TOSARI = station({ id: 'TJ-H00251P', name: 'Tosari', code: 'H00251P', operator: TJ, latitude: -6.196892, longitude: 106.82309 })
const MANGGARAI = station({ id: 'KCI-MRI', name: 'Manggarai', code: 'MRI', operator: KCI, latitude: -6.21, longitude: 106.8498 })
const BOGOR = station({ id: 'KCI-BOO', name: 'Bogor', code: 'BOO', operator: KCI, latitude: -6.5956, longitude: 106.7904 })
const CILEBUT = station({ id: 'KCI-CLT', name: 'Cilebut', code: 'CLT', operator: KCI, latitude: -6.5308, longitude: 106.8005 })

// One physical halte split across two rows, 168 m apart on opposite sides of
// the road. Codes are real: joinDirectionalStations picks the lower one.
const KALI_GROGOL_UTARA = station({ id: 'TJ-H00138S', name: 'Kali Grogol Arah Utara', code: 'H00138S', operator: TJ, latitude: -6.16106, longitude: 106.790684 })
const KALI_GROGOL_SELATAN = station({ id: 'TJ-H00197S', name: 'Kali Grogol Arah Selatan', code: 'H00197S', operator: TJ, latitude: -6.159755, longitude: 106.791453 })

const fixAt = (lat: number, lng: number, accuracy = 20): Fix => ({ lat, lng, accuracy, at: 0 })

const AT_DUKUH_ATAS = fixAt(-6.2001, 106.8228)
const AT_MANGGARAI = fixAt(-6.2103, 106.85)
const AT_BOGOR = fixAt(-6.595, 106.79)

describe('haversineMeters', () => {
  it('approximates ~111 km per degree of latitude', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -2)
  })

  it('is zero for a point against itself', () => {
    expect(haversineMeters(-6.2103, 106.85, -6.2103, 106.85)).toBe(0)
  })
})

describe('formatDistance', () => {
  it('rounds metres to the nearest ten', () => {
    expect(formatDistance(68)).toBe('70 m')
    expect(formatDistance(274)).toBe('270 m')
  })

  it('switches to kilometres with an Indonesian decimal comma', () => {
    expect(formatDistance(1234)).toBe('1,2 km')
    expect(formatDistance(2000)).toBe('2,0 km')
  })

  it('promotes a distance that rounds up to a full kilometre', () => {
    expect(formatDistance(999)).toBe('1,0 km')
  })
})

describe('isFixFresh', () => {
  const NOW = 1_800_000_000_000
  const aged = (ms: number): Fix => ({ lat: -6.21, lng: 106.85, accuracy: 20, at: NOW - ms })

  it('accepts a fix taken moments ago', () => {
    expect(isFixFresh(aged(60_000), NOW)).toBe(true)
  })

  it('accepts a fix exactly at the TTL', () => {
    expect(isFixFresh(aged(FIX_TTL_MS), NOW)).toBe(true)
  })

  it('rejects a fix one millisecond past the TTL', () => {
    expect(isFixFresh(aged(FIX_TTL_MS + 1), NOW)).toBe(false)
  })

  it('rejects a missing fix', () => {
    expect(isFixFresh(null, NOW)).toBe(false)
  })

  it('tolerates a future-dated fix rather than discarding it', () => {
    // Clock skew across a suspend/resume shouldn't throw away a good fix.
    expect(isFixFresh(aged(-5_000), NOW)).toBe(true)
  })
})

describe('rankNearby', () => {
  it('orders stations by distance from the fix', () => {
    const result = rankNearby([SUDIRMAN, TOSARI, DUKUH_ATAS], AT_DUKUH_ATAS)

    expect(result.map(entry => entry.group.name)).toEqual(['Dukuh Atas BNI', 'Sudirman', 'Tosari'])
    expect(result[0]!.distanceM).toBeCloseTo(68, -1)
    expect(result[1]!.distanceM).toBeCloseTo(274, -1)
    expect(result[2]!.distanceM).toBeCloseTo(358, -1)
  })

  it('drops stations beyond the radius', () => {
    // Cilebut is the next station up the line from Bogor, 7.2 km away.
    const result = rankNearby([BOGOR, CILEBUT], AT_BOGOR)

    expect(result).toHaveLength(1)
    expect(result[0]!.group.name).toBe('Bogor')
  })

  it('folds a directional halte pair into one entry at its nearest side', () => {
    const fix = fixAt(-6.16106, 106.790684)
    const result = rankNearby([KALI_GROGOL_UTARA, KALI_GROGOL_SELATAN], fix)

    expect(result).toHaveLength(1)
    expect(result[0]!.group.name).toBe('Kali Grogol')
    expect(result[0]!.distanceM).toBeCloseTo(0, 0)
  })

  it('caps the number of results', () => {
    const many = Array.from({ length: 12 }, (_, index) => station({
      id: `KCI-X${index}`,
      name: `Stasiun ${index}`,
      code: `X${index}`,
      operator: KCI,
      latitude: -6.2001 + index * 0.0001,
      longitude: 106.8228
    }))

    expect(rankNearby(many, AT_DUKUH_ATAS)).toHaveLength(5)
  })

  it('ignores stations outside Jakarta, hidden stations, and ones without coordinates', () => {
    const bandung = station({ id: 'KCI-BD', name: 'Bandung', code: 'BD', operator: KCI, latitude: -6.2001, longitude: 106.8228, regionCode: 'BDO' })
    const topologyOnly = station({ id: 'KCI-HID', name: 'Hidden', code: 'HID', operator: KCI, latitude: -6.2001, longitude: 106.8228, searchable: false })
    const uncharted = station({ id: 'KCI-NUL', name: 'Uncharted', code: 'NUL', operator: KCI, latitude: null, longitude: null })

    const result = rankNearby([bandung, topologyOnly, uncharted, DUKUH_ATAS], AT_DUKUH_ATAS)

    expect(result.map(entry => entry.group.name)).toEqual(['Dukuh Atas BNI'])
  })

  it('returns nothing when everything is out of range', () => {
    expect(rankNearby([MANGGARAI], AT_BOGOR)).toEqual([])
  })
})

describe('findCurrentStation', () => {
  it('identifies the station the user is standing in', () => {
    expect(findCurrentStation([SUDIRMAN, MANGGARAI], AT_MANGGARAI)?.id).toBe('KCI-MRI')
  })

  it('picks the nearest when several are in range', () => {
    expect(findCurrentStation([SUDIRMAN, DUKUH_ATAS], AT_DUKUH_ATAS)?.id).toBe('MRTJ-DKA')
  })

  it('returns null just outside the radius', () => {
    // ~430 m due north of Manggarai.
    expect(findCurrentStation([MANGGARAI], fixAt(-6.2061, 106.8498))).toBeNull()
  })

  it('refuses to guess when the fix is too imprecise', () => {
    // Standing at Manggarai, but a 900 m accuracy circle covers Tebet too.
    expect(findCurrentStation([MANGGARAI], fixAt(-6.2103, 106.85, 900))).toBeNull()
  })

  it('returns null when no saved station has coordinates', () => {
    const uncharted = station({ id: 'KCI-NUL', name: 'Uncharted', code: 'NUL', operator: KCI, latitude: null, longitude: null })

    expect(findCurrentStation([uncharted], AT_MANGGARAI)).toBeNull()
  })
})
