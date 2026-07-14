import { CompactSchedule, GroupingSchedule, Schedule } from 'db/schemas/schedules'

// Compact mode trims to id + estimatedDeparture (satisfied by the projected
// GroupingSchedule rows); full mode passes whole Schedule rows through.
export function mapSchedule(schedules: Schedule[], compactMode?: false): Schedule[]
export function mapSchedule(schedules: GroupingSchedule[], compactMode: true): CompactSchedule[]
export function mapSchedule(schedules: GroupingSchedule[], compactMode = false) {
  if (compactMode) {
    return schedules.map(schedule => ({
      id: schedule.id,
      estimatedDeparture: schedule.estimatedDeparture
    }))
  }

  return schedules
}
