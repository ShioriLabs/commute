import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

/*
 * A transit hub: a named grouping of multiple physically-distinct stations that
 * form one interchange complex (e.g. Dukuh Atas = Sudirman + Dukuh Atas BNI +
 * Dukuh Atas LRT + BNI City). Membership lives in `hubStations`; the grouping is
 * layered on the transfer graph, not a new kind of station. See
 * docs/transit-hubs.md.
 */
export interface HubSchema {
  id: string // stable PK, e.g. 'HUB-DKA'
  slug: string // URL key, mutable, e.g. 'dukuh-atas'
  name: string
  description: ColumnType<string | null, string | null, string | null>
  heroImage: ColumnType<string | null, string | null, string | null>
  latitude: ColumnType<number | null, number | null, number | null>
  longitude: ColumnType<number | null, number | null, number | null>
  score: ColumnType<number, number | undefined, number | undefined>
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type Hub = Selectable<HubSchema>
export type NewHub = Insertable<HubSchema>
export type UpdatingHub = Updateable<HubSchema>

/*
 * Membership of a station in a hub. `position` orders members in the hub view.
 */
export interface HubStationSchema {
  id: string // `${hubId}:${stationId}`
  hubId: string
  stationId: string
  position: ColumnType<number, number | undefined, number | undefined>
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type HubStation = Selectable<HubStationSchema>
export type NewHubStation = Insertable<HubStationSchema>
export type UpdatingHubStation = Updateable<HubStationSchema>
