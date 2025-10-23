import { Operator } from '@commute/constants'
import { db } from 'db'
import { NewSchedule } from 'db/schemas/schedules'
import { Amenity, NewStation, UpdatingStation } from 'db/schemas/stations'
import { sql } from 'kysely'
import { Line } from 'models/line'
import { Repository } from 'models/repository'
import { getLineByOperator } from 'utils/line'
import { getOperatorByCode } from 'utils/operator'

export class StationRepository extends Repository {
  private d1: D1Database

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
  }

  async getAll(page?: number, limit?: number) {
    const linesSubquery = db(this.d1)
      .selectFrom('stationLines')
      .select(({ fn }) => [
        fn('group_concat', [sql`DISTINCT stationLines.lineCode`]).as('lines'),
        'stationLines.stationId'
      ])
      .where('stationLines.lineCode', 'is not', 'NUL')
      .groupBy('stationLines.stationId')

    let query = db(this.d1)
      .selectFrom('stations')
      .leftJoin(linesSubquery.as('linesSubquery'), 'linesSubquery.stationId', 'stations.id')
      .selectAll('stations')
      .select(['linesSubquery.lines'])

    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    const mappedStations = []

    for (const station of stations) {
      const operator = getOperatorByCode(station.operator)
      if (operator === null) continue

      const lines: Set<Line> = new Set()
      if (station.lines !== null) {
        for (const lineCode of (station.lines as string).split(',')) {
          if (lineCode === 'NUL') continue
          const line = getLineByOperator(station.operator, lineCode)
          if (line === null) continue
          lines.add(line)
        }
      }

      const amenities = station.amenities ? JSON.parse(station.amenities as unknown as string) as Amenity[] : []
      mappedStations.push({
        ...station,
        amenities,
        operator,
        lines: Array.from(lines)
      })
    }

    return mappedStations
  }

  async getAllByOperator(operator: Operator, page?: number, limit?: number) {
    const linesSubquery = db(this.d1)
      .selectFrom('stationLines')
      .select(({ fn }) => [
        fn('group_concat', [sql`DISTINCT stationLines.lineCode`]).as('lines'),
        'stationLines.stationId'
      ])
      .where('stationLines.lineCode', 'is not', 'NUL')
      .groupBy('stationLines.stationId')

    let query = db(this.d1)
      .selectFrom('stations')
      .leftJoin(linesSubquery.as('linesSubquery'), 'linesSubquery.stationId', 'stations.id')
      .selectAll('stations')
      .select(['linesSubquery.lines'])
      .where('operator', '=', operator)

    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    const mappedStations = []

    for (const station of stations) {
      const operator = getOperatorByCode(station.operator)
      if (operator === null) continue

      const lines: Set<Line> = new Set()
      if (station.lines !== null) {
        for (const lineCode of (station.lines as string).split(',')) {
          if (lineCode === 'NUL') continue
          const line = getLineByOperator(station.operator, lineCode)
          if (line === null) continue
          lines.add(line)
        }
      }

      const amenities = station.amenities ? JSON.parse(station.amenities as unknown as string) as Amenity[] : []
      mappedStations.push({
        ...station,
        amenities,
        operator,
        lines: Array.from(lines)
      })
    }

    return mappedStations
  }

  async getById(id: string) {
    const linesSubquery = db(this.d1)
      .selectFrom('stationLines')
      .select(({ fn }) => [
        fn('group_concat', [sql`DISTINCT stationLines.lineCode`]).as('lines'),
        'stationLines.stationId'
      ])
      .where('stationLines.lineCode', 'is not', 'NUL')
      .where('stationLines.stationId', '=', id)
      .groupBy('stationLines.stationId')

    const station = await db(this.d1)
      .selectFrom('stations')
      .leftJoin(linesSubquery.as('linesSubquery'), 'linesSubquery.stationId', 'stations.id')
      .selectAll('stations')
      .select(['linesSubquery.lines'])
      .where('id', '=', id)
      .executeTakeFirst()

    if (!station) return null
    const operator = getOperatorByCode(station.operator)
    if (operator === null) return null

    const lines: Set<Line> = new Set()
    if (station.lines !== null) {
      for (const lineCode of (station.lines as string).split(',')) {
        if (lineCode === 'NUL') continue
        const line = getLineByOperator(station.operator, lineCode)
        if (line === null) continue
        lines.add(line)
      }
    }

    const amenities = station.amenities ? JSON.parse(station.amenities as unknown as string) as Amenity[] : []

    return {
      ...station,
      amenities,
      operator,
      lines: Array.from(lines)
    }
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

  async getTimetableFromStationId(id: string, page?: number, limit?: number) {
    let query = db(this.d1).selectFrom('schedules').selectAll().where('stationId', '=', id).orderBy('estimatedDeparture asc')
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const timetable = await query.execute()
    return timetable
  }

  async insertTimetable(id: string, timetable: NewSchedule[]) {
    const station = await this.getById(id)
    if (!station) return undefined

    // Chunk timetable by 100
    const chunkedTimetable: NewSchedule[][] = []
    for (let i = 0; i < timetable.length; i += 10) {
      chunkedTimetable.push(timetable.slice(i, i + 10))
    }

    const databaseInstance = db(this.d1)

    for (const chunk of chunkedTimetable) {
      await databaseInstance
        .insertInto('schedules')
        .values(chunk)
        .onConflict((oc) => {
          return oc.column('id').doUpdateSet(eb => ({
            boundFor: eb.ref('excluded.boundFor'),
            estimatedArrival: eb.ref('excluded.estimatedArrival'),
            estimatedDeparture: eb.ref('excluded.estimatedDeparture'),
            stationId: eb.ref('stationId'),
            tripNumber: eb.ref(`excluded.tripNumber`),
            updatedAt: sql`CURRENT_TIMESTAMP`
          }))
        })
        .executeTakeFirstOrThrow()
    }
    await databaseInstance.updateTable('stations').set('timetableSynced', 1).where('id', '==', id).executeTakeFirstOrThrow()

    return timetable
  }
}
