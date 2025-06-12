import { ScheduleSchema } from './schedules'
import { StationLineSchema } from './station-lines'
import { StationSchema } from './stations'

export interface Database {
  stations: StationSchema
  schedules: ScheduleSchema
  stationLines: StationLineSchema
}
