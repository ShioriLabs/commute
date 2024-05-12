import { ColumnType, Insertable, Selectable } from "kysely";

export interface StationSchema {
  id: string
  name: string
  originalName: string | null
  code: string
  region: string
  operator: string
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type StationRaw = Selectable<StationSchema>
export type NewStationRaw = Insertable<StationSchema>
export type StationRawUpdate = Insertable<StationSchema>
