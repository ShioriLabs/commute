import { describe, expect, it } from 'vitest'
import { MRTJDatumRow, buildStationTimetable, cleanDisplayName, isStationRow, parseDepartureTimes, resolveTerminusNames, synthesizeTripNumbers } from 'operators/mrtj/datum'

// Trimmed copies of real datum rows (2026-08-03): a mid-line station with both
// directions, the Bundaran HI terminus (Start fields only), and a news row.
const midlineRow: MRTJDatumRow = {
  id: 39,
  name: 'Stasiun MRT Bendungan Hilir',
  slug: 'stasiun-bendungan-hilir',
  object: {
    schedule: {
      start: 'Lebak Bulus',
      end: 'Bundaran HI',
      weekdaysStart: '05:13:10; 05:28:10; 05:40:10',
      weekdaysEnd: '05:09:30; 05:22:10',
      weekendsStart: '05:13:10; 05:28:10',
      weekendsEnd: '05:09:30'
    }
  }
}

const terminusRow: MRTJDatumRow = {
  id: 6,
  name: 'Bundaran HI Bank Jakarta',
  slug: 'bundaran-hi-bank-jakarta',
  object: {
    schedule: {
      start: 'Lebak Bulus',
      weekdaysStart: '05:06:30; 05:21:30',
      weekendsStart: '05:06:30'
    }
  }
}

const lebakBulusRow: MRTJDatumRow = {
  id: 4,
  name: ' Stasiun MRT Lebak Bulus Bank Syariah Indonesia',
  slug: 'stasiun-lebak-bulus',
  object: {
    schedule: {
      end: 'Bundaran HI',
      weekdaysEnd: '05:00:00; 05:15:00',
      weekendsEnd: '05:00:00'
    }
  }
}

const newsRow: MRTJDatumRow = {
  id: 15581,
  name: 'Oktober 2024, 3,8 Juta Orang Naik MRT Jakarta',
  slug: 'oktober-2024-38-juta-orang-naik-mrt-jakarta',
  object: {
    schedule: undefined
  }
}

describe('isStationRow', () => {
  it('accepts rows whose object.schedule is a dict', () => {
    expect(isStationRow(midlineRow)).toBe(true)
    expect(isStationRow(terminusRow)).toBe(true)
  })

  it('rejects news rows without a schedule', () => {
    expect(isStationRow(newsRow)).toBe(false)
  })

  it('rejects rows with a missing or malformed object', () => {
    expect(isStationRow({ id: 1, name: 'X', slug: 'x' })).toBe(false)
    expect(isStationRow({ id: 1, name: 'X', slug: 'x', object: null })).toBe(false)
    expect(isStationRow({ id: 1, name: 'X', slug: 'x', object: { schedule: 'closed' } })).toBe(false)
    expect(isStationRow({ id: 1, name: 'X', slug: 'x', object: { schedule: [] } })).toBe(false)
  })
})

describe('cleanDisplayName', () => {
  it('strips leading whitespace and the "Stasiun MRT" prefix, keeping the sponsor', () => {
    expect(cleanDisplayName(' Stasiun MRT Lebak Bulus Bank Syariah Indonesia')).toBe('Lebak Bulus Bank Syariah Indonesia')
  })

  it('strips a bare "Stasiun" prefix', () => {
    expect(cleanDisplayName('Stasiun ASEAN')).toBe('ASEAN')
  })

  it('leaves names without the prefix untouched', () => {
    expect(cleanDisplayName('Bundaran HI Bank Jakarta')).toBe('Bundaran HI Bank Jakarta')
  })

  it('is idempotent on already-clean input', () => {
    expect(cleanDisplayName('Lebak Bulus Bank Syariah Indonesia')).toBe('Lebak Bulus Bank Syariah Indonesia')
  })

  it('collapses internal whitespace', () => {
    expect(cleanDisplayName('Stasiun MRT Blok  M BCA')).toBe('Blok M BCA')
  })
})

describe('parseDepartureTimes', () => {
  it('splits a semicolon-space separated list', () => {
    expect(parseDepartureTimes('05:13:10; 05:28:10; 05:40:10')).toEqual(['05:13:10', '05:28:10', '05:40:10'])
  })

  it('tolerates trailing separators and extra whitespace', () => {
    expect(parseDepartureTimes('05:13:10;05:28:10; ')).toEqual(['05:13:10', '05:28:10'])
  })

  it('normalizes HH:MM and H:MM to HH:MM:SS', () => {
    expect(parseDepartureTimes('05:13; 5:28')).toEqual(['05:13:00', '05:28:00'])
  })

  it('drops malformed tokens', () => {
    expect(parseDepartureTimes('05:13:10; berangkat; 05:28:10')).toEqual(['05:13:10', '05:28:10'])
  })

  it('returns [] for empty or missing input', () => {
    expect(parseDepartureTimes(undefined)).toEqual([])
    expect(parseDepartureTimes('')).toEqual([])
  })
})

describe('resolveTerminusNames', () => {
  it('uses the sponsored display names from the terminus rows', () => {
    expect(resolveTerminusNames([midlineRow, terminusRow, lebakBulusRow])).toEqual({
      southbound: 'Lebak Bulus Bank Syariah Indonesia',
      northbound: 'Bundaran HI Bank Jakarta'
    })
  })

  it('falls back to unsponsored literals when a terminus row is missing', () => {
    expect(resolveTerminusNames([midlineRow])).toEqual({
      southbound: 'Lebak Bulus',
      northbound: 'Bundaran HI'
    })
  })
})

describe('buildStationTimetable', () => {
  const terminusNames = { southbound: 'Lebak Bulus Bank Syariah Indonesia', northbound: 'Bundaran HI Bank Jakarta' }
  const noTripNumbers = new Map<string, string>()

  it('emits both directions with sponsored boundFor labels', () => {
    const timetable = buildStationTimetable(midlineRow, 'MRTJ-BNH', terminusNames, noTripNumbers)

    const southbound = timetable.filter(schedule => schedule.boundFor === terminusNames.southbound)
    const northbound = timetable.filter(schedule => schedule.boundFor === terminusNames.northbound)
    expect(southbound).toHaveLength(3)
    expect(northbound).toHaveLength(2)
  })

  it('builds ids from station, time, and direction, falling back likewise for unmapped trip numbers', () => {
    const timetable = buildStationTimetable(midlineRow, 'MRTJ-BNH', terminusNames, noTripNumbers)

    expect(timetable[0]?.id).toBe('MRTJ-BNH-05:13:10-SOUTHBOUND')
    expect(timetable[0]?.tripNumber).toBe('MRTJ-BNH-05:13:10-SOUTHBOUND')
    expect(timetable[0]?.stationId).toBe('MRTJ-BNH')
    expect(timetable[0]?.lineCode).toBe('M')
  })

  it('uses synthesized trip numbers when the lookup provides them, keeping ids unchanged', () => {
    const tripNumbers = new Map([['BNH:SOUTHBOUND:05:13:10', 'MRTJ-1001']])
    const timetable = buildStationTimetable(midlineRow, 'MRTJ-BNH', terminusNames, tripNumbers)

    expect(timetable[0]?.tripNumber).toBe('MRTJ-1001')
    expect(timetable[0]?.id).toBe('MRTJ-BNH-05:13:10-SOUTHBOUND')
  })

  it('sets estimatedArrival equal to estimatedDeparture', () => {
    for (const schedule of buildStationTimetable(midlineRow, 'MRTJ-BNH', terminusNames, noTripNumbers)) {
      expect(schedule.estimatedArrival).toBe(schedule.estimatedDeparture)
    }
  })

  it('yields only the departing direction for termini', () => {
    const fromBundaranHI = buildStationTimetable(terminusRow, 'MRTJ-BHI', terminusNames, noTripNumbers)
    expect(fromBundaranHI).toHaveLength(2)
    expect(fromBundaranHI.every(schedule => schedule.boundFor === terminusNames.southbound)).toBe(true)

    const fromLebakBulus = buildStationTimetable(lebakBulusRow, 'MRTJ-LBB', terminusNames, noTripNumbers)
    expect(fromLebakBulus).toHaveLength(2)
    expect(fromLebakBulus.every(schedule => schedule.boundFor === terminusNames.northbound)).toBe(true)
  })

  it('returns [] for rows without a schedule', () => {
    expect(buildStationTimetable(newsRow, 'MRTJ-XXX', terminusNames, noTripNumbers)).toEqual([])
  })
})

describe('synthesizeTripNumbers', () => {
  // A three-board line using real slugs (the synthesis walks stations the
  // slug map knows): LBB -> BLM -> DKA northbound with 3-minute hops.
  const makeRow = (slug: string, name: string, schedule: object): MRTJDatumRow => ({
    id: 0,
    name,
    slug,
    object: { schedule }
  })

  const network = [
    makeRow('stasiun-lebak-bulus', 'Stasiun MRT Lebak Bulus', {
      weekdaysEnd: '05:00:00; 05:10:00; 05:20:00; 23:00:00'
    }),
    makeRow('stasiun-blok-m-bca', 'Stasiun MRT Blok M BCA', {
      // 05:10:00 has no upstream predecessor: a train entering service here.
      // The LBB 23:00:00 trip never appears: a short-working ending upstream.
      weekdaysEnd: '05:03:00; 05:10:00; 05:13:00; 05:23:00',
      weekdaysStart: '06:03:00; 06:13:00'
    }),
    makeRow('stasiun-dukuh-atas-bni', 'Stasiun MRT Dukuh Atas BNI', {
      weekdaysEnd: '05:06:00; 05:13:00; 05:16:00; 05:26:00',
      weekdaysStart: '06:00:00; 06:10:00'
    })
  ]

  const tripNumbers = synthesizeTripNumbers(network)

  it('assigns the same number to a trip at every station it serves', () => {
    expect(tripNumbers.get('LBB:NORTHBOUND:05:00:00')).toBe('MRTJ-1000')
    expect(tripNumbers.get('BLM:NORTHBOUND:05:03:00')).toBe('MRTJ-1000')
    expect(tripNumbers.get('DKA:NORTHBOUND:05:06:00')).toBe('MRTJ-1000')
  })

  it('numbers northbound even and southbound odd, ordered by origin departure', () => {
    expect(tripNumbers.get('LBB:NORTHBOUND:05:20:00')).toBe('MRTJ-1006')
    expect(tripNumbers.get('DKA:SOUTHBOUND:06:00:00')).toBe('MRTJ-1001')
    expect(tripNumbers.get('BLM:SOUTHBOUND:06:03:00')).toBe('MRTJ-1001')
    expect(tripNumbers.get('DKA:SOUTHBOUND:06:10:00')).toBe('MRTJ-1003')
    expect(tripNumbers.get('BLM:SOUTHBOUND:06:13:00')).toBe('MRTJ-1003')
  })

  it('gives a mid-line service entry its own trip, tie-broken after the upstream origin', () => {
    // LBB and BLM both have an 05:10:00 departure; the upstream (LBB) one
    // takes the lower number and the BLM starter gets its own.
    expect(tripNumbers.get('LBB:NORTHBOUND:05:10:00')).toBe('MRTJ-1002')
    expect(tripNumbers.get('BLM:NORTHBOUND:05:10:00')).toBe('MRTJ-1004')
    expect(tripNumbers.get('DKA:NORTHBOUND:05:13:00')).toBe('MRTJ-1004')
    expect(tripNumbers.get('BLM:NORTHBOUND:05:13:00')).toBe('MRTJ-1002')
  })

  it('terminates a short-working without cascading misalignment downstream', () => {
    expect(tripNumbers.get('LBB:NORTHBOUND:23:00:00')).toBe('MRTJ-1008')
    // No BLM/DKA departure belongs to the short-working trip, and later
    // boards were matched to their own trips (asserted above), not shifted.
    const assignedTo1008 = [...tripNumbers.entries()].filter(([, trip]) => trip === 'MRTJ-1008')
    expect(assignedTo1008).toEqual([['LBB:NORTHBOUND:23:00:00', 'MRTJ-1008']])
  })
})
