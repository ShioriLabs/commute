import { Operator, RegionCode } from 'constant'
import { ColumnType, Insertable, Selectable } from 'kysely'

export interface StationSchema {
  id: string
  name: string
  formattedName: string | null
  code: string
  region: string
  regionCode: ColumnType<RegionCode, string | RegionCode, string | RegionCode>
  operator: ColumnType<Operator, string | Operator, string | Operator>
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
  timetableSynced: ColumnType<number, number | undefined, number | undefined>
}

export type Station = Selectable<StationSchema>
export type NewStation = Insertable<StationSchema>
export type UpdatingStation = Insertable<StationSchema>
