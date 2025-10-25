import { ScheduleSchema } from './schedules'
import { StationLineSchema } from './station-lines'
import { StationSchema } from './stations'
import { TransferSchema } from './transfers'

export interface Database {
  stations: StationSchema
  schedules: ScheduleSchema
  stationLines: StationLineSchema
  transfers: TransferSchema
}
