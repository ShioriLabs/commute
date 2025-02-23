import { Operator } from 'constant'
import { db } from 'db'
import { NewSchedule } from 'db/schemas/schedules'
import { NewStation, UpdatingStation } from 'db/schemas/stations'
import { sql } from 'kysely'
import { Repository } from 'models/repository'

export class StationRepository extends Repository {
  static async getAll(page?: number, limit?: number) {
    let query = db.selectFrom('stations').selectAll()
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations
  }

  static async getAllByOperator(operator: Operator, page?: number, limit?: number) {
    let query = db.selectFrom('stations').selectAll().where('operator', '==', operator)
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations
  }

  static async getById(id: string) {
    const station = await db.selectFrom('stations').where('id', '=', id).selectAll().executeTakeFirst()
    return station
  }

  static async insert(data: NewStation) {
    await db
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

  static async insertMany(data: NewStation[]) {
    await db
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

  static async update(data: UpdatingStation) {
    await db
      .updateTable('stations')
      .set(data)
      .where('id', '=', data.id)
      .execute()

    return data
  }

  static async del(id: string) {
    return await db
      .deleteFrom('stations')
      .where('id', '=', id)
      .executeTakeFirst()
  }

  static async getTimetableFromStationId(id: string, page?: number, limit?: number) {
    let query = db.selectFrom('schedules').selectAll().where('stationId', '=', id)
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const timetable = await query.execute()
    return timetable
  }

  static async insertTimetable(id: string, timetable: NewSchedule[]) {
    const station = await this.getById(id)
    if (!station) return undefined

    await db.transaction().execute(async (tx) => {
      const insertTimetable = await tx
        .insertInto('schedules')
        .values(timetable)
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
        .execute()
      await tx.updateTable('stations').set('timetableSynced', 1).where("id", "==", id).executeTakeFirstOrThrow()
      return insertTimetable
    })

    return timetable
  }
}
