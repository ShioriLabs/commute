import { describe, expect, it } from 'vitest'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import { deriveSavedStopRows } from './saved-stops'

// Fixed clock: 08:00 local. Departures are expressed as minutes since midnight,
// so 08:00 is minute 480.
const NOW = new Date('2026-07-27T08:00:00')
const MINUTE_AT_8AM = 480
const at = (minutesFromNow: number) => MINUTE_AT_8AM + minutesFromNow

const group = (key: string, boundFor: string, minutes: number[], platformCode: string | null = null) => ({
  key,
  label: [boundFor],
  platformCode,
  destinations: [{
    boundFor,
    via: null,
    schedules: minutes.map(m => [null, m] as [string | null, number])
  }]
})

const line = (lineCode: string, groups: ReturnType<typeof group>[]) => ({
  lineCode,
  name: `Lin ${lineCode}`,
  colorCode: '#E4322A',
  timetable: groups
}) as unknown as CompactLineGroupedTimetable[number]

describe('deriveSavedStopRows', () => {
  it('returns no rows for an empty timetable', () => {
    expect(deriveSavedStopRows([], NOW)).toEqual({ rows: [], truncatedCount: 0 })
    expect(deriveSavedStopRows(undefined, NOW)).toEqual({ rows: [], truncatedCount: 0 })
  })

  it('takes the soonest departure out of each direction group', () => {
    const timetable = [line('BOG', [
      group('g1', 'Bogor', [at(3), at(18)]),
      group('g2', 'Jakarta Kota', [at(7), at(22)])
    ])]
    const { rows } = deriveSavedStopRows(timetable, NOW)
    expect(rows.map(r => r.boundFor)).toEqual(['Bogor', 'Jakarta Kota'])
    expect(rows[0].departure.getHours()).toBe(8)
    expect(rows[0].departure.getMinutes()).toBe(3)
  })

  // Manggarai's shape: two lines, both directions each. Two rows can't show
  // four directions, so the two soonest win and the rest are counted.
  it('truncates a four-group station to the two soonest distinct directions', () => {
    const timetable = [
      line('BOG', [
        group('bog-down', 'Bogor', [at(9)]),
        group('bog-up', 'Jakarta Kota', [at(2)])
      ]),
      line('CKR', [
        group('ckr-down', 'Cikarang', [at(5)]),
        group('ckr-up', 'Angke', [at(14)])
      ])
    ]
    const { rows, truncatedCount } = deriveSavedStopRows(timetable, NOW)
    expect(rows.map(r => r.boundFor)).toEqual(['Jakarta Kota', 'Cikarang'])
    expect(truncatedCount).toBe(2)
    // Distinct directions, never two of the same.
    expect(new Set(rows.map(r => r.key)).size).toBe(2)
  })

  // Departing "3 minutes ago" is still worth showing — you can see you just
  // missed it. Matches LineCard's 60s grace.
  it('keeps a train that departed within the last minute', () => {
    const timetable = [line('BOG', [group('g1', 'Bogor', [at(-1), at(25)])])]
    const { rows } = deriveSavedStopRows(timetable, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].departure.getMinutes()).toBe(59)
    expect(rows[0].departure.getHours()).toBe(7)
  })

  it('skips a train that departed well before the grace window', () => {
    const timetable = [line('BOG', [group('g1', 'Bogor', [at(-30), at(25)])])]
    const { rows } = deriveSavedStopRows(timetable, NOW)
    expect(rows[0].departure.getMinutes()).toBe(25)
  })

  // Late at night everything for today has gone; showing the first train of the
  // next service day beats showing an empty card.
  it('falls back to the first departure of the day when all have passed', () => {
    const timetable = [line('BOG', [group('g1', 'Bogor', [at(-300), at(-200)])])]
    const { rows, truncatedCount } = deriveSavedStopRows(timetable, NOW)
    expect(rows).toHaveLength(1)
    expect(truncatedCount).toBe(0)
    // The earliest of the two, not the latest.
    expect(rows[0].departure.getHours()).toBe(3)
  })

  it('respects a custom limit', () => {
    const timetable = [line('BOG', [
      group('g1', 'Bogor', [at(3)]),
      group('g2', 'Jakarta Kota', [at(7)]),
      group('g3', 'Nambo', [at(11)])
    ])]
    expect(deriveSavedStopRows(timetable, NOW, 1)).toMatchObject({ truncatedCount: 2 })
    expect(deriveSavedStopRows(timetable, NOW, 3).rows).toHaveLength(3)
  })

  it('carries the line and platform metadata each row needs to render', () => {
    const timetable = [line('BOG', [group('g1', 'Bogor', [at(4)], '5')])]
    const [row] = deriveSavedStopRows(timetable, NOW).rows
    expect(row).toMatchObject({
      lineCode: 'BOG',
      lineName: 'Lin BOG',
      colorCode: '#E4322A',
      boundFor: 'Bogor',
      platformCode: '5'
    })
  })
})
