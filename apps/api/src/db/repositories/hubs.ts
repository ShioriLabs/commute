import { db } from 'db'
import { Line } from 'models/line'
import { Repository } from 'models/repository'
import { mapify } from 'utils/mapify'
import { StationRepository } from './stations'

export class HubRepository extends Repository {
  private d1: D1Database
  private stationRepository: StationRepository

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
    this.stationRepository = new StationRepository(d1)
  }

  // Assemble a hub with its member stations (ordered by hubStations.position),
  // each carrying its own lines, plus a deduped Line[] aggregated across members.
  private async assemble(hub: {
    id: string
    slug: string
    name: string
    description: string | null
    heroImage: string | null
    latitude: number | null
    longitude: number | null
    score: number
  }) {
    const memberships = await db(this.d1)
      .selectFrom('hubStations')
      .select(['stationId', 'position'])
      .where('hubId', '=', hub.id)
      .orderBy('position asc')
      .execute()

    const stationIds = memberships.map(m => m.stationId)
    const stations = mapify(await this.stationRepository.getByIds(stationIds), s => s.id)

    const members = []
    const aggregatedLines = new Map<string, Line>()
    for (const membership of memberships) {
      const station = stations.get(membership.stationId)
      if (!station) continue
      members.push(station)
      for (const line of station.lines) {
        if (!aggregatedLines.has(line.lineCode)) aggregatedLines.set(line.lineCode, line)
      }
    }

    return {
      ...hub,
      lines: Array.from(aggregatedLines.values()),
      members
    }
  }

  async getAll() {
    const hubs = await db(this.d1)
      .selectFrom('hubs')
      .selectAll()
      .orderBy('score desc')
      .execute()

    const assembled = []
    for (const hub of hubs) {
      assembled.push(await this.assemble(hub))
    }

    return assembled
  }

  async getBySlug(slug: string) {
    const hub = await db(this.d1)
      .selectFrom('hubs')
      .selectAll()
      .where('slug', '=', slug)
      .executeTakeFirst()

    if (!hub) return null
    return this.assemble(hub)
  }
}
