import { db } from 'db'
import type { StationExit } from 'db/schemas/station-exits'
import { Repository } from 'models/repository'

export type ExitRef = { id: string, ref: string, name: string | null }

export interface PinnedTransfer {
  fromStationId: string
  toStationId: string | null
  fromExit: ExitRef | null
  toExit: ExitRef | null
}

export function toExitRef(exit: Pick<StationExit, 'id' | 'ref' | 'name'>): ExitRef {
  return { id: exit.id, ref: exit.ref, name: exit.name }
}

/*
 * A pin is only trusted when the exit belongs to the station it is pinned on
 * (ids are `${stationId}:${ref}`); the foreign key alone would let a seed typo
 * show another station's door.
 */
export function ownedExit(exitId: string | null | undefined, stationId: string | null | undefined): exitId is string {
  return !!exitId && !!stationId && exitId.startsWith(`${stationId}:`)
}

export class StationExitRepository extends Repository {
  private d1: D1Database

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
  }

  async getByStationId(stationId: string) {
    return await db(this.d1)
      .selectFrom('stationExits')
      .select(['id', 'ref', 'name', 'latitude', 'longitude', 'source'])
      .where('stationId', '=', stationId)
      .orderBy('ref asc')
      .execute()
  }

  // Resolves exit ids to refs in one query. Unknown ids are simply absent, so a
  // dangling pin degrades to the exit-less wording instead of failing a request.
  async getRefsByIds(ids: string[]) {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map<string, ExitRef>()
    const rows = await db(this.d1)
      .selectFrom('stationExits')
      .select(['id', 'ref', 'name'])
      .where('id', 'in', unique)
      .execute()
    return new Map(rows.map(row => [row.id, toExitRef(row)]))
  }

  // Every INTERNAL transfer with at least one exit pinned, the exits resolved in
  // the same query. A join rather than a second `id IN (...)` lookup: that binds
  // one parameter per exit, and D1 caps a statement at 100, so the pin count
  // would have been a hidden limit on every uncached trips request.
  // A pin whose exit row is gone joins to NULL and simply comes back unpinned.
  async getPinnedTransfers(): Promise<PinnedTransfer[]> {
    const rows = await db(this.d1)
      .selectFrom('transfers')
      .leftJoin('stationExits as fe', 'fe.id', 'transfers.fromExitId')
      .leftJoin('stationExits as te', 'te.id', 'transfers.toExitId')
      .select([
        'transfers.fromStationId',
        'transfers.toStationId',
        'fe.id as feId', 'fe.ref as feRef', 'fe.name as feName',
        'te.id as teId', 'te.ref as teRef', 'te.name as teName'
      ])
      .where('transfers.dataType', '=', 'INTERNAL')
      .where(eb => eb.or([eb('transfers.fromExitId', 'is not', null), eb('transfers.toExitId', 'is not', null)]))
      .execute()
    return rows.map(row => ({
      fromStationId: row.fromStationId,
      toStationId: row.toStationId,
      fromExit: row.feId === null ? null : { id: row.feId, ref: row.feRef!, name: row.feName },
      toExit: row.teId === null ? null : { id: row.teId, ref: row.teRef!, name: row.teName }
    }))
  }
}
