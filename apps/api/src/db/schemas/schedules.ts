import { ColumnType, Insertable, Selectable, Updateable } from "kysely"

export interface ScheduleSchema {
  id: string
  stationId: string
  tripNumber: string | null
  estimatedDeparture: ColumnType<Date, string | Date, string | Date>
  estimatedArrival: ColumnType<Date, string | Date, string | Date>
  boundFor: string
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type Schedule = Selectable<ScheduleSchema>
export type NewSchedule = Insertable<ScheduleSchema>
export type UpdatingSchedule = Updateable<ScheduleSchema>
