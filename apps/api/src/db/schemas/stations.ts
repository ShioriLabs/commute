import type { AmenityType, Operator, RegionCode } from '@commute/constants'
import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

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
  score: ColumnType<number, number | undefined, number | undefined>
  amenities: ColumnType<Amenity[] | null, string | Amenity[] | null, string | Amenity[] | null>
  latitude: ColumnType<number | null, number | null, number | null>
  longitude: ColumnType<number | null, number | null, number | null>
}

export type Station = Selectable<StationSchema>
export type NewStation = Insertable<StationSchema>
export type UpdatingStation = Updateable<StationSchema>

export interface Amenity {
  type: AmenityType
  text?: string
}
