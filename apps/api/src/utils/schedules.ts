import { Schedule } from 'db/schemas/schedules'

export function mapSchedule(schedules: Schedule[], compactMode = false) {
  if (compactMode) {
    return schedules.map(schedule => ({
      id: schedule.id,
      estimatedDeparture: schedule.estimatedDeparture
    }))
  }

  return schedules
}
