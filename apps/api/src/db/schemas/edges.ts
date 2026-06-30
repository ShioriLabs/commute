import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

/*
 * Directed in-vehicle (ride) adjacency between two stations on a line. Both
 * directions are stored as separate rows. `distance` (metres) is the fare input
 * and routing weight; `durationSeconds` is an optional typical run time.
 * Cross-operator interchange lives in `transfers`, not here.
 */
export interface EdgeSchema {
  id: string // `${lineCode}:${fromStationId}->${toStationId}`
  lineCode: string
  fromStationId: string
  toStationId: string
  distance: number // metres
  durationSeconds: ColumnType<number | null, number | null, number | null>
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type Edge = Selectable<EdgeSchema>
export type NewEdge = Insertable<EdgeSchema>
export type UpdatingEdge = Updateable<EdgeSchema>
