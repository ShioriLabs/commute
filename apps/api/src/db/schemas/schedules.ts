import { ColumnType, Insertable, Selectable, Updateable } from 'kysely'
import type { Line } from 'models/line'

export interface ScheduleSchema {
  id: string
  stationId: string
  tripNumber: string | null
  estimatedDeparture: ColumnType<Date, string | Date, string | Date>
  estimatedArrival: ColumnType<Date, string | Date, string | Date>
  boundFor: string
  lineCode: string
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type Schedule = Selectable<ScheduleSchema>
export type NewSchedule = Insertable<ScheduleSchema>
export type UpdatingSchedule = Updateable<ScheduleSchema>

export interface ScheduleWithLineInfo extends Schedule {
  line: Line | null
}

export interface LineTimetable {
  name: string
  lineCode: string
  colorCode: `#${string}`
  timetable: {
    boundFor: string
    via: string | null
    schedules: Schedule[]
  }[]
}

export type LineGroupedTimetable = LineTimetable[]
