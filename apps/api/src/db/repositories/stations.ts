import { Operator } from '@commute/constants'
import { db } from 'db'
import { NewSchedule } from 'db/schemas/schedules'
import { Amenity, NewStation, UpdatingStation } from 'db/schemas/stations'
import { sql } from 'kysely'
import { Repository } from 'models/repository'
import { chunkArray } from 'utils/chunk'
import { getLineByOperator } from 'utils/line'
import { mapify } from 'utils/mapify'
import { getOperatorByCode } from 'utils/operator'

/*
 * The public Station shape.
 *
 * Deliberately not a row: `createdAt`/`updatedAt`/`timetableSynced` describe our
 * database rather than the network, and `region` is 1:1 with `regionCode`, so
 * none of them are emitted. `operator` collapses to its code and `lines` to
 * operator-qualified keys — both resolve against /operators, which every client
 * already fetches, instead of repeating the same names and colours on all 393
 * stations.
 *
 * NOTE `officialName` is the operator's own spelling ("Stasiun Lebak Bulus"),
 * `name` the display one ("Lebak Bulus Bank Syariah Indonesia"). They are two
 * different names, not a formatted pair — search matches on both, and 236 of 361
 * indexed stations are reachable only via the official one ("sudirman baru" →
 * BNI City).
 */
export interface PublicStation {
  id: string
  name: string
  officialName: string
  code: string
  regionCode: string
  operator: Operator
  lines: string[]
  amenities: Amenity[]
  latitude: number | null
  longitude: number | null
  score: number
  searchable: boolean
}

/*
 * Station as referenced from another resource — hub members, transfers.
 *
 * `officialName` is carried despite the trim: it is the search alias, and hub
 * members are precisely where it earns its keep ("sudirman baru" must keep
 * finding the Dukuh Atas hub via its BNI City member).
 */
export interface StationRef {
  id: string
  name: string
  officialName: string
  code: string
  operator: Operator
  lines: string[]
}

/** Dictionary key for a line; qualified because codes collide across operators. */
export function lineKey(operator: Operator, lineCode: string): string {
  return `${operator}:${lineCode}`
}

export function toStationRef(station: PublicStation): StationRef {
  return {
    id: station.id,
    name: station.name,
    officialName: station.officialName,
    code: station.code,
    operator: station.operator,
    lines: station.lines
  }
}

function mapStationRow<T extends {
  id: string
  name: string
  formattedName: string | null
  code: string
  regionCode: string
  operator: Operator
  latitude: number | null
  longitude: number | null
  score: number
  lines: unknown
  amenities: unknown
  searchable: number
}>(station: T): PublicStation | null {
  const operator = getOperatorByCode(station.operator)
  if (operator === null) return null

  const lines: string[] = []
  const seen = new Set<string>()
  for (const lineCode of ((station.lines as string | null) ?? '').split(',')) {
    if (lineCode === '' || lineCode === 'NUL') continue
    const line = getLineByOperator(station.operator, lineCode)
    if (!line) continue
    const key = lineKey(station.operator, line.lineCode)
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(key)
  }

  const amenities = station.amenities ? JSON.parse(station.amenities as unknown as string) as Amenity[] : []

  return {
    id: station.id,
    // The display name wins the plain `name`; callers stop writing
    // `formattedName ?? name`.
    name: station.formattedName || station.name,
    officialName: station.name,
    code: station.code,
    regionCode: station.regionCode,
    operator: operator.code,
    lines,
    amenities,
    latitude: station.latitude,
    longitude: station.longitude,
    score: station.score,
    searchable: !!station.searchable
  }
}

export class StationRepository extends Repository {
  private d1: D1Database

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
  }

  private stationsQuery(stationFilter?: string | string[]) {
    let linesSubquery = db(this.d1)
      .selectFrom('stationLines')
      .select(({ fn }) => [
        fn('group_concat', [sql`DISTINCT stationLines.lineCode`]).as('lines'),
        'stationLines.stationId'
      ])
      .where('stationLines.lineCode', 'is not', 'NUL')

    if (stationFilter) {
      const ids = Array.isArray(stationFilter) ? stationFilter : [stationFilter]
      linesSubquery = linesSubquery.where('stationLines.stationId', 'in', ids)
    }

    // Explicit column list, not selectAll: the response shape is a design
    // decision, and selectAll would silently re-add every future column to it.
    return db(this.d1)
      .selectFrom('stations')
      .leftJoin(linesSubquery.groupBy('stationLines.stationId').as('linesSubquery'), 'linesSubquery.stationId', 'stations.id')
      .select([
        'stations.id',
        'stations.name',
        'stations.formattedName',
        'stations.code',
        'stations.regionCode',
        'stations.operator',
        'stations.latitude',
        'stations.longitude',
        'stations.score',
        'stations.amenities',
        'stations.searchable'
      ])
      .select(['linesSubquery.lines'])
  }

  async getAll(page?: number, limit?: number) {
    // Topology-only stops (TJ feeders) are routable but not listed; they stay
    // reachable via getById/getByIds (detail pages, transfers, fare legs).
    let query = this.stationsQuery().where('stations.searchable', '=', 1)
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations.map(station => mapStationRow(station)).filter((station): station is NonNullable<typeof station> => station !== null)
  }

  async getAllByOperator(operator: Operator, page?: number, limit?: number) {
    let query = this.stationsQuery().where('operator', '=', operator).where('stations.searchable', '=', 1)
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations.map(station => mapStationRow(station)).filter((station): station is NonNullable<typeof station> => station !== null)
  }

  async getById(id: string) {
    const station = await this.stationsQuery(id).where('id', '=', id).executeTakeFirst()
    return station ? mapStationRow(station) : null
  }

  /*
   * Chunked, because each id is bound TWICE — once in the lines subquery and
   * once in the outer filter — and D1 rejects a statement with too many bound
   * variables. A single fare journey never came close; a fare answer carrying
   * several alternative journeys unions ~55 stations and does, which surfaced
   * as a 500 on long cross-network pairs (Bogor <-> Rangkasbitung).
   *
   * 40 leaves generous headroom under the limit even doubled. The chunks are
   * issued together rather than in sequence, so this stays one round trip's
   * worth of latency rather than N.
   */
  async getByIds(ids: string[]) {
    const CHUNK = 40
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))

    const results = await Promise.all(
      chunks.map(chunk => this.stationsQuery(chunk).where('id', 'in', chunk).execute())
    )
    return results.flat()
      .map(station => mapStationRow(station))
      .filter((station): station is NonNullable<typeof station> => station !== null)
  }

  async checkIfExists(id: string, operator?: Operator) {
    let query = db(this.d1)
      .selectFrom('stations')
      .select(['id', 'timetableSynced'])
      .where('id', '=', id)

    if (operator) {
      query = query.where('operator', '=', operator)
    }

    const station = await query.executeTakeFirst()
    return {
      exists: !!station,
      station: station ? station : null
    }
  }

  async checkIfLineExists(id: string, lineCode: string, operator?: Operator) {
    let query = db(this.d1)
      .selectFrom('stationLines')
      .leftJoin('stations', 'stations.id', 'stationLines.stationId')
      .select(['stationLines.id', 'lineCode', 'stationId', 'stations.operator'])
      .where('lineCode', '=', lineCode)
      .where('stationId', '=', id)

    if (operator) {
      query = query.where('stations.operator', '=', operator)
    }

    const line = await query.executeTakeFirst()
    return {
      exists: !!line,
      line: line ? line : null
    }
  }

  async insert(data: NewStation) {
    await db(this.d1)
      .insertInto('stations').values(data)
      .onConflict((oc) => {
        return oc.column('id').doUpdateSet({
          name: data.name,
          formattedName: data.formattedName,
          region: data.region,
          operator: data.operator,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
      })
      .executeTakeFirstOrThrow()

    return data
  }

  async insertMany(data: NewStation[]) {
    await db(this.d1)
      .insertInto('stations').values(data)
      .onConflict((oc) => {
        return oc.column('id').doUpdateSet(eb => ({
          name: eb.ref('excluded.name'),
          formattedName: eb.ref('excluded.formattedName'),
          region: eb.ref('excluded.region'),
          operator: eb.ref('excluded.operator'),
          updatedAt: sql`CURRENT_TIMESTAMP`
        }))
      })
      .executeTakeFirstOrThrow()

    return data
  }

  async update(id: string, data: UpdatingStation) {
    await db(this.d1)
      .updateTable('stations')
      .set(data)
      .where('id', '=', id)
      .execute()

    return data
  }

  async del(id: string) {
    return await db(this.d1)
      .deleteFrom('stations')
      .where('id', '=', id)
      .executeTakeFirst()
  }

  // Lean rows for resolving schedule boundFor display names to station codes.
  async getNameIndexRowsByOperator(operator: Operator) {
    return await db(this.d1)
      .selectFrom('stations')
      .select(['code', 'name', 'formattedName'])
      .where('operator', '=', operator)
      .execute()
  }

  async getTimetableFromStationId(id: string, line?: string, page?: number, limit?: number) {
    let query = db(this.d1)
      .selectFrom('schedules')
      .selectAll()
      .where('stationId', '=', id)
      // Only the lines this station actually serves (per stationLines). KAI's
      // feed lists passage times for trains that pass through without stopping
      // (e.g. Soekarno-Hatta trains at Kalideres); those lines aren't in
      // stationLines, so this keeps them out of the timetable across resyncs.
      .where('lineCode', 'in', eb =>
        eb.selectFrom('stationLines').select('stationLines.lineCode').where('stationLines.stationId', '=', id))
      .orderBy('estimatedDeparture asc')
    if (line) {
      query = query.where('lineCode', '=', line)
    }

    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const timetable = await query.execute()
    return timetable
  }

  // Projected variant for the grouped-timetable compact path: selects only the
  // columns the grouping + compact response consume, so cache-miss requests
  // marshal fewer bytes from D1. Same filtering/ordering as
  // getTimetableFromStationId. See GroupingSchedule.
  async getGroupingTimetableFromStationId(id: string) {
    const timetable = await db(this.d1)
      .selectFrom('schedules')
      .select(['id', 'lineCode', 'boundFor', 'estimatedDeparture', 'tripNumber'])
      .where('stationId', '=', id)
      .where('lineCode', 'in', eb =>
        eb.selectFrom('stationLines').select('stationLines.lineCode').where('stationLines.stationId', '=', id))
      .orderBy('estimatedDeparture asc')
      .execute()
    return timetable
  }

  async getTransfersFromStationId(id: string) {
    const query = db(this.d1)
      .selectFrom('transfers')
      .selectAll()
      .where('fromStationId', '=', id)

    const transfers = await query.execute()

    // fetch INTERNAL stations
    const internalToStationIDs = transfers.filter(transfer => transfer.dataType === 'INTERNAL').map(transfer => transfer.toStationId!)
    const internalToStations = mapify((await this.getByIds(internalToStationIDs)), item => item.id)

    const returningTransfers = []
    for (const transfer of transfers) {
      let toStation
      if (transfer.dataType === 'INTERNAL') {
        if (!transfer.toStationId) continue
        const toStationData = internalToStations.get(transfer.toStationId)
        if (!toStationData) continue

        // `id`, not `stationId`: every other shape in the API refers to a
        // station by `id`, and `operator` as a code rather than a display name.
        toStation = toStationRef(toStationData)
      } else if (transfer.dataType === 'EXTERNAL') {
        if (!transfer.toStationData) continue
        toStation = JSON.parse(transfer.toStationData as unknown as string)
      } else {
        continue
      }

      returningTransfers.push({
        id: transfer.id,
        dataType: transfer.dataType,
        toStation,
        // `distanceM`, matching FareLeg.distanceM and FareResult.totalDistanceM.
        distanceM: transfer.distance,
        notes: transfer.notes
      })
    }

    return returningTransfers
  }

  // Atomically replaces a station's entire board with exactly what the feed
  // returned. The feed's train IDs are volatile (KAI has changed their format,
  // e.g. `1676` -> `1676C`), so an upsert keyed on id would pile new rows on top
  // of stale ones instead of updating them. Replacing wholesale keeps the board
  // in sync and drops orphaned/removed departures.
  async insertTimetable(id: string, timetable: NewSchedule[]) {
    const station = await this.getById(id)
    if (!station) return undefined

    // Success-but-empty upstream response: leave the existing board intact
    // rather than wiping the station.
    if (timetable.length === 0) return timetable

    // One row per id; dedupe (last wins) so a single batched INSERT can't roll
    // back on an intra-feed duplicate primary key.
    const deduped = Array.from(new Map(timetable.map(schedule => [schedule.id, schedule])).values())

    const databaseInstance = db(this.d1)

    // Clear the station's schedules, insert the fresh set (chunked to stay under
    // D1's bound-parameter limit), then flag it synced. D1 batch runs as a single
    // non-interactive transaction and rolls back on any failure — no partial-write
    // window and no moment where the station has no board.
    const queries = [
      databaseInstance.deleteFrom('schedules').where('stationId', '=', id),
      ...chunkArray(deduped, 10).map(chunk => databaseInstance.insertInto('schedules').values(chunk)),
      databaseInstance.updateTable('stations').set('timetableSynced', 1).where('id', '=', id)
    ]

    const statements = queries.map((query) => {
      const compiled = query.compile()
      return this.d1.prepare(compiled.sql).bind(...compiled.parameters)
    })

    await this.d1.batch(statements)

    return deduped
  }
}
