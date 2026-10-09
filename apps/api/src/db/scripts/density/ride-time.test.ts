import { describe, expect, it } from 'vitest'
import { TRIP_PATTERNS, type TripPattern } from '../../data/trips'
import { CORE_STATIONS, rideMinutesToCore } from './ride-time'

const pattern = (stations: string[], times: number[]): TripPattern =>
  ({ line: 'X', stations, trips: [{ t: '1', d: 7, f: 'x', s: times }] })

describe('rideMinutesToCore', () => {
  it('is 0 at a core station and the scheduled minutes elsewhere, in either direction of travel', () => {
    const m = rideMinutesToCore([pattern(['A', 'B', 'CORE'], [0, 600, 1500])], ['CORE'])
    expect(m.get('CORE')).toBe(0)
    expect(m.get('B')).toBe(15)
    expect(m.get('A')).toBe(25)
  })

  it('takes the median hop over trips, so one slow train does not move it', () => {
    const p: TripPattern = { line: 'X', stations: ['A', 'CORE'], trips: [
      { t: '1', d: 7, f: 'x', s: [0, 600] }, { t: '2', d: 7, f: 'x', s: [0, 600] }, { t: '3', d: 7, f: 'x', s: [0, 3000] }
    ] }
    expect(rideMinutesToCore([p], ['CORE']).get('A')).toBe(10)
  })

  it('crosses patterns at shared stations with a transfer penalty', () => {
    const m = rideMinutesToCore([
      pattern(['FAR', 'HUB'], [0, 1200]),
      pattern(['HUB', 'CORE'], [0, 300])
    ], ['CORE'])
    expect(m.get('FAR')).toBe(20 + 5 + 5) // ride + TRANSFER_PENALTY_MIN + ride
  })

  it('leaves unreachable stations out', () => {
    expect(rideMinutesToCore([pattern(['ISLAND1', 'ISLAND2'], [0, 120])], ['CORE']).has('ISLAND1')).toBe(false)
  })

  it('orders the real network the way the spec observed it', () => {
    const m = rideMinutesToCore(TRIP_PATTERNS, CORE_STATIONS)
    expect(m.get('KCI-SUD')).toBe(0)
    const tebet = m.get('KCI-TEB')!, kranji = m.get('KCI-KRI')!, bekasi = m.get('KCI-BKS')!, bogor = m.get('KCI-BOO')!
    expect(tebet).toBeLessThan(kranji)
    expect(kranji).toBeLessThan(bekasi)
    expect(bekasi).toBeLessThan(bogor)
    expect(bogor).toBeGreaterThan(45)
  })
})
