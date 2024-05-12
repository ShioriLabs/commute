import { db } from 'db'
import { NewStation, UpdatingStation } from 'db/schemas/stations'
import { sql } from 'kysely'
import { Repository } from 'models/repository'

export class StationRepository extends Repository {
  static async getAll(page?: number, limit?: number) {
    let query = db.selectFrom('station').selectAll()
    if (page && limit) {
      query = query.limit(limit).offset((page - 1) * limit)
    }

    const stations = await query.execute()
    return stations
  }

  static async getById(id: string) {
    const station = await db.selectFrom('station').where('id', '=', id).selectAll().executeTakeFirst()
    return station
  }

  static async insert(data: NewStation) {
    await db
      .insertInto('station').values(data)
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
      .insertInto('station').values(data)
      .onConflict((oc) => {
        return oc.column('id').doUpdateSet(eb => ({
          name: eb.ref('name'),
          formattedName: eb.ref('formattedName'),
          region: eb.ref('region'),
          operator: eb.ref('operator'),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        }))
      })
      .executeTakeFirstOrThrow()

    return data
  }

  static async update(data: UpdatingStation) {
    await db
      .updateTable('station')
      .set(data)
      .where('id', '=', data.id)
      .execute()

    return data
  }

  static async del(id: string) {
    return await db
      .deleteFrom('station')
      .where('id', '=', id)
      .executeTakeFirst()
  }
}
