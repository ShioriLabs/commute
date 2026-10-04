import { EdgeSchema } from './edges'
import { HubSchema, HubStationSchema } from './hubs'
import { ScheduleSchema } from './schedules'
import { StationLineSchema } from './station-lines'
import { StationSchema } from './stations'
import { TransferSchema } from './transfers'

export interface Database {
  stations: StationSchema
  schedules: ScheduleSchema
  stationLines: StationLineSchema
  transfers: TransferSchema
  // Imported transfers with published admin overrides applied (migration 0017).
  // Read-only: write `transfers` (importers) or `transfer_overrides` (admin).
  transfers_effective: TransferSchema
  edges: EdgeSchema
  hubs: HubSchema
  hubStations: HubStationSchema
}
