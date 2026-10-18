import { EdgeSchema } from './edges'
import { HubSchema, HubStationSchema } from './hubs'
import { ScheduleSchema } from './schedules'
import { StationExitSchema } from './station-exits'
import { StationLineSchema } from './station-lines'
import { StationSchema } from './stations'
import { TransferSchema } from './transfers'

export interface Database {
  stations: StationSchema
  schedules: ScheduleSchema
  stationLines: StationLineSchema
  transfers: TransferSchema
  edges: EdgeSchema
  hubs: HubSchema
  hubStations: HubStationSchema
  stationExits: StationExitSchema
}
