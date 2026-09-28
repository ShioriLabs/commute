import { describe, expect, it } from 'vitest'
import { DAY_S } from '@commute/tsundere'
import { feedTerminusArrivalS, hopRunTimesS, signedStation } from './tripTerminus'

describe('signedStation', () => {
  const line = [
    { id: 'KCI-BKS', name: 'BEKASI' },
    { id: 'KCI-BKST', name: 'BEKASI TIMUR' },
    { id: 'KCI-BOO', name: 'BOGOR' },
    { id: 'MRTJ-LBB', name: 'Stasiun Lebak Bulus' },
    { id: 'LRTJBDB-DKA', name: 'Dukuh Atas' }
  ]

  it('matches KCI headsigns against upper-case station names', () => {
    expect(signedStation('Bogor', line)).toBe('KCI-BOO')
  })

  it('matches a headsign carrying a sponsor suffix', () => {
    expect(signedStation('Lebak Bulus Bank Syariah Indonesia', line)).toBe('MRTJ-LBB')
    expect(signedStation('Dukuh Atas Bank Syariah Indonesia', line)).toBe('LRTJBDB-DKA')
  })

  it('prefers the exact or longest name when one station name prefixes another', () => {
    // "Bekasi Timur" also starts with "Bekasi"; it must not land on Bekasi.
    expect(signedStation('Bekasi Timur', line)).toBe('KCI-BKST')
    expect(signedStation('Bekasi', line)).toBe('KCI-BKS')
  })

  it('finds nothing for a headsign no station on the line carries', () => {
    expect(signedStation('Tanah Abang', line)).toBeNull()
  })
})

describe('feedTerminusArrivalS', () => {
  it('reads the terminus arrival as a time after the last departure', () => {
    expect(feedTerminusArrivalS(10 * 3600, '10:07:00')).toBe(10 * 3600 + 7 * 60)
  })

  it('carries the arrival across midnight', () => {
    // Trip 1458: last departure 00:05 (already +DAY_S), arrives Bogor 00:13.
    expect(feedTerminusArrivalS(DAY_S + 5 * 60, '00:13:00')).toBe(DAY_S + 13 * 60)
    // Last departure 23:59, arrival 00:06 the next day.
    expect(feedTerminusArrivalS(23 * 3600 + 59 * 60, '00:06:00')).toBe(DAY_S + 6 * 60)
  })

  it('refuses an arrival too far from the last departure to be one hop', () => {
    expect(feedTerminusArrivalS(10 * 3600, '11:30:00')).toBeNull()
  })
})

describe('hopRunTimesS', () => {
  const trip = (stationIds: string[], departuresS: number[]) => ({
    lineCode: 'M',
    stops: stationIds.map((stationId, i) => ({ stationId, departureS: departuresS[i]! }))
  })

  it('takes the median departure gap per directed hop', () => {
    const runs = hopRunTimesS([
      trip(['LBB', 'FTM', 'CPR'], [0, 180, 360]),
      trip(['LBB', 'FTM'], [1000, 1200]),
      trip(['LBB', 'FTM'], [2000, 2150])
    ])
    expect(runs.get('M|LBB|FTM')).toBe(180)
    expect(runs.get('M|FTM|CPR')).toBe(180)
    expect(runs.has('M|FTM|LBB')).toBe(false)
  })
})
