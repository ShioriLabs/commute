import { describe, expect, it } from 'vitest'
import { GroupingSchedule } from 'db/schemas/schedules'
import { mapSchedule } from 'utils/schedules'

// GroupingSchedule.estimatedDeparture is typed as a Date column, but at runtime
// D1 returns the stored "HH:MM:SS" wall-clock string; cast to build fixtures.
function grouping(tripNumber: string | null, estimatedDeparture: string): GroupingSchedule {
  return {
    id: `sched-${tripNumber ?? 'x'}`,
    lineCode: 'C',
    boundFor: 'Cikarang',
    tripNumber,
    estimatedDeparture: estimatedDeparture as unknown as GroupingSchedule['estimatedDeparture']
  }
}

describe('mapSchedule compact mode', () => {
  it('emits [tripNumber, minuteSinceMidnight] tuples', () => {
    expect(mapSchedule([grouping('1234', '05:27:00')], true)).toEqual([['1234', 327]])
  })

  it('keeps a null tripNumber (operators without trip numbers)', () => {
    expect(mapSchedule([grouping(null, '00:30:00')], true)).toEqual([[null, 30]])
  })

  it('handles late-night times past 23:00', () => {
    expect(mapSchedule([grouping('7', '23:45:00')], true)).toEqual([['7', 1425]])
  })
})
