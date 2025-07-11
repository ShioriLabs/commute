import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

export interface StationLineSchema {
  id: string
  stationId: string
  lineCode: string
  stationNumber: ColumnType<string, string | undefined, string | undefined>
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type StationLine = Selectable<StationLineSchema>
export type NewStationLine = Insertable<StationLineSchema>
export type UpdatingStationLine = Updateable<StationLineSchema>
