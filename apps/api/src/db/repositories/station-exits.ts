import { db } from 'db'
import type { StationExit } from 'db/schemas/station-exits'
import { Repository } from 'models/repository'

export type ExitRef = { id: string, ref: string, name: string | null }

export function toExitRef(exit: Pick<StationExit, 'id' | 'ref' | 'name'>): ExitRef {
  return { id: exit.id, ref: exit.ref, name: exit.name }
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
}
