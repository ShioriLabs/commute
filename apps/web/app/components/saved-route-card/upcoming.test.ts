import type { FareJourney } from '@commute/schemas'
import { describe, expect, it } from 'vitest'
import { resumeTimeOf, upcomingJourneys } from './upcoming'

const station = (id: string) => ({ id, name: id })

const journey = (line: string, departureAt?: string): FareJourney => ({
  legs: [{
    type: 'RIDE',
    line,
    operator: 'KCI',
    from: station('KCI-A'),
    to: station('KCI-B'),
    stationCount: 2,
    stops: [station('KCI-A'), station('KCI-B')],
    headsign: null,
    distanceM: 1000,
    ...(departureAt ? { departureAt } : {})
  }],
  segments: [],
  totalFare: 3000,
  totalDistanceM: 1000,
  transferCount: 0,
  labels: [],
  boardings: 1,
  walkDistanceM: 0
})

const now = Date.parse('2026-10-01T08:00:00+07:00')

describe('upcomingJourneys', () => {
  it('sorts timed rows by boarding time and drops departed ones', () => {
    const rows = upcomingJourneys([
      journey('KCI:B', '2026-10-01T08:20:00+07:00'),
      journey('KCI:B', '2026-10-01T07:55:00+07:00'),
      journey('KCI:C', '2026-10-01T08:05:00+07:00')
    ], now, 3)
    expect(rows.map(row => row.legs[0]!.type === 'RIDE' && row.legs[0]!.departureAt)).toEqual([
      '2026-10-01T08:05:00+07:00',
      '2026-10-01T08:20:00+07:00'
    ])
  })

  it('puts untimed journeys after timed ones, in planner order', () => {
    const rows = upcomingJourneys([
      journey('TJ:1'),
      journey('KCI:B', '2026-10-01T08:20:00+07:00'),
      journey('TJ:9')
    ], now, 3)
    expect(rows.map(row => row.legs[0]!.type === 'RIDE' && row.legs[0]!.line)).toEqual(['KCI:B', 'TJ:1', 'TJ:9'])
  })

  it('caps the list', () => {
    const rows = upcomingJourneys([
      journey('KCI:B', '2026-10-01T08:10:00+07:00'),
      journey('KCI:B', '2026-10-01T08:20:00+07:00'),
      journey('KCI:B', '2026-10-01T08:30:00+07:00')
    ], now, 2)
    expect(rows).toHaveLength(2)
  })
})

describe('ended routes', () => {
  const ended = (resumesAt: string): FareJourney => ({ ...journey('KCI:C'), resumesAt })

  it('drops routes whose service has ended instead of listing them untimed', () => {
    expect(upcomingJourneys([ended('2026-10-02T04:28:00+07:00')], now, 3)).toEqual([])
  })

  it('keeps live rows beside an ended route', () => {
    const live = journey('KCI:B', '2026-10-01T08:20:00+07:00')
    expect(upcomingJourneys([ended('2026-10-02T04:28:00+07:00'), live], now, 3)).toEqual([live])
  })

  it('reports the earliest restart', () => {
    expect(resumeTimeOf([
      ended('2026-10-02T05:10:00+07:00'),
      journey('TJ:1'),
      ended('2026-10-02T04:28:00+07:00')
    ])).toBe('2026-10-02T04:28:00+07:00')
    expect(resumeTimeOf([journey('TJ:1')])).toBeNull()
  })
})
