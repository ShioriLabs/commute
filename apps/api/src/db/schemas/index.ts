import { ScheduleSchema } from './schedules'
import { StationSchema } from './stations'

export interface Database {
  stations: StationSchema,
  schedules: ScheduleSchema
}
