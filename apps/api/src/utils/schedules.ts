import { CompactSchedule, GroupingSchedule, Schedule } from 'db/schemas/schedules'

// Parses a wall-clock "HH:MM[:SS]" string into minutes since midnight. The stored
// value is already Asia/Jakarta local time, so we read the fields literally rather
// than routing through Date (Workers run in UTC, which would shift the result).
function toMinuteOfDay(value: string): number {
  const [hours, minutes] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}

// Compact mode emits wire-optimized [tripNumber, minuteSinceMidnight] tuples
// (satisfied by the projected GroupingSchedule rows); full mode passes whole
// Schedule rows through.
export function mapSchedule(schedules: Schedule[], compactMode?: false): Schedule[]
export function mapSchedule(schedules: GroupingSchedule[], compactMode: true): CompactSchedule[]
export function mapSchedule(schedules: GroupingSchedule[], compactMode = false) {
  if (compactMode) {
    return schedules.map((schedule): CompactSchedule => [
      schedule.tripNumber,
      toMinuteOfDay(schedule.estimatedDeparture as unknown as string)
    ])
  }

  return schedules
}
