import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

/*
 * A station's exit or gate. Owned by the station rather than by a POI or a
 * transfer, so several of either can point at the same exit. `ref` is kept as
 * signed on site ('A', 'Utara') because riders match what they see. `source` is
 * required so provenance is never ambiguous and OSM-derived rows (ODbL) can be
 * exported, attributed or dropped as a set.
 */
export type StationExitSource = 'FIELD' | 'OPERATOR' | 'OSM'

export interface StationExitSchema {
  id: string // `${stationId}:${ref}`, e.g. 'MRTJ-IST:B'
  stationId: string
  ref: string
  name: ColumnType<string | null, string | null | undefined, string | null | undefined>
  latitude: ColumnType<number | null, number | null | undefined, number | null | undefined>
  longitude: ColumnType<number | null, number | null | undefined, number | null | undefined>
  signs: ColumnType<string | null, string | null | undefined, string | null | undefined> // JSON array of ExitSign
  source: StationExitSource
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type StationExit = Selectable<StationExitSchema>
export type NewStationExit = Insertable<StationExitSchema>
export type UpdatingStationExit = Updateable<StationExitSchema>
