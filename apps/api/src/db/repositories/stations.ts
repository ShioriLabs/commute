import { Operator } from '@commute/constants'
import { db } from 'db'
import { NewSchedule } from 'db/schemas/schedules'
import { NewStation, UpdatingStation } from 'db/schemas/stations'
import { sql } from 'kysely'
import { Repository } from 'models/repository'

export class StationRepository extends Repository {
  private d1: D1Database

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
  }

  async getAll(page?: number, limit?: number) {
    let query = db(this.d1).selectFrom('stations').selectAll()
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations
  }

  async getAllByOperator(operator: Operator, page?: number, limit?: number) {
    let query = db(this.d1).selectFrom('stations').selectAll().where('operator', '==', operator)
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations
  }

  async getById(id: string) {
    const station = await db(this.d1).selectFrom('stations').where('id', '=', id).selectAll().executeTakeFirst()
    return station
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
          updatedAt: sql`CURRENT_TIMESTAMP`,
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
          updatedAt: sql`CURRENT_TIMESTAMP`,
        }))
      })
      .executeTakeFirstOrThrow()

    return data
  }

  async update(data: UpdatingStation) {
    await db(this.d1)
      .updateTable('stations')
      .set(data)
      .where('id', '=', data.id)
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
          return oc.column('id').doUpdateSet((eb) => ({
            boundFor: eb.ref('excluded.boundFor'),
            estimatedArrival: eb.ref('excluded.estimatedArrival'),
            estimatedDeparture: eb.ref('excluded.estimatedDeparture'),
            stationId: eb.ref('stationId'),
            tripNumber: eb.ref(`excluded.tripNumber`),
            updatedAt: sql`CURRENT_TIMESTAMP`,
          }))
        })
        .executeTakeFirstOrThrow()
    }
    await databaseInstance.updateTable('stations').set('timetableSynced', 1).where("id", "==", id).executeTakeFirstOrThrow()

    return timetable
  }
}
