import { db } from 'db'
import { type HubKind, PLACE_HUB_KINDS } from 'db/schemas/hubs'
import { Repository } from 'models/repository'
import { mapify } from 'utils/mapify'
import { StationRef, StationRepository, toStationRef } from './stations'

export class HubRepository extends Repository {
  private d1: D1Database
  private stationRepository: StationRepository

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
    this.stationRepository = new StationRepository(d1)
  }

  // Assemble a hub with its member station refs (ordered by hubStations.position),
  // plus the deduped set of line keys reachable across those members.
  private async assemble(hub: {
    id: string
    slug: string
    name: string
    kind: HubKind
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

    // Members are references, not embedded stations: the full objects were 74%
    // of this payload while consumers read a handful of fields, and a station's
    // own detail endpoint is one hop away.
    const members: StationRef[] = []
    const aggregatedLines: string[] = []
    const seenLines = new Set<string>()
    for (const membership of memberships) {
      const station = stations.get(membership.stationId)
      if (!station) continue
      members.push(toStationRef(station))
      for (const line of station.lines) {
        if (seenLines.has(line)) continue
        seenLines.add(line)
        aggregatedLines.push(line)
      }
    }

    /*
     * `description`, `latitude`, `longitude` and the row timestamps are dropped:
     * nothing reads them, and a hub's location is its members'.
     *
     * `score` stays on this object — the searchables index ranks by it
     * (utils/searchables.ts) — but is stripped from the HTTP response in
     * routes/hubs.ts. It is our ranking, not a fact about the hub.
     */
    return {
      id: hub.id,
      slug: hub.slug,
      name: hub.name,
      kind: hub.kind,
      heroImage: hub.heroImage,
      score: hub.score,
      lines: aggregatedLines,
      members
    }
  }

  /*
   * `directional` hubs (TJ "Arah" halte pairs) are left out: they are one
   * halte, not an interchange, so they do not belong in the /hubs list, the
   * sitemap or search (which already folds the pair by name). Their own
   * /hubs/:slug still resolves through getBySlug.
   */
  async getAll() {
    return this.list(false)
  }

  /** Every hub including `directional` ones, for generators that must see them all. */
  async getAllIncludingDirectional() {
    return this.list(true)
  }

  private async list(includeDirectional: boolean) {
    const hubs = await db(this.d1)
      .selectFrom('hubs')
      .selectAll()
      .$if(!includeDirectional, qb => qb.where('kind', '!=', 'directional'))
      .orderBy('score desc')
      .execute()

    return Promise.all(hubs.map(hub => this.assemble(hub)))
  }

  /*
   * Member station ids of every `integrated` and `directional` hub, grouped by
   * hub. Those are the hubs that are one place to a rider (utils/places.ts); a
   * `hub`-kind complex like Dukuh Atas is several places and is deliberately
   * left out.
   */
  async getPlaceMemberIds(): Promise<string[][]> {
    const rows = await db(this.d1)
      .selectFrom('hubStations')
      .innerJoin('hubs', 'hubs.id', 'hubStations.hubId')
      .select(['hubStations.hubId', 'hubStations.stationId'])
      .where('hubs.kind', 'in', [...PLACE_HUB_KINDS])
      .execute()

    const byHub = new Map<string, string[]>()
    for (const row of rows) {
      const members = byHub.get(row.hubId)
      if (members) members.push(row.stationId)
      else byHub.set(row.hubId, [row.stationId])
    }
    return [...byHub.values()]
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
