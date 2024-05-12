import { Operator } from "constant";
import { db } from "db";
import { NewStationRaw, StationRawUpdate } from "db/schemas/stations";
import { sql } from "kysely";
import { Repository } from "models/repository";
import Station from "models/station";

export class StationRepository extends Repository {
  static async getAll(page: number, limit: number) {
    const stations = await db.selectFrom("station").limit(limit).offset((page - 1) * limit).selectAll().execute()
    return stations
  }

  static async getById(id: string) {
    const station = await db.selectFrom("station").where("id", "=", id).selectAll().executeTakeFirst()
    return station
  }

  static async insert(data: NewStationRaw) {
    await db
      .insertInto("station").values(data)
      .onConflict((oc) => {
        return oc.column("id").doUpdateSet({
          name: data.name,
          originalName: data.originalName,
          region: data.region,
          operator: data.operator,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
      })
      .executeTakeFirstOrThrow()

      return data
  }

  static async insertMany(data: NewStationRaw[]) {
    await db
      .insertInto("station").values(data)
      .onConflict((oc) => {
        return oc.column("id").doUpdateSet((eb) => ({
          name: eb.ref('name'),
          originalName: eb.ref('originalName'),
          region: eb.ref('region'),
          operator: eb.ref('operator'),
          updatedAt: sql`CURRENT_TIMESTAMP`
        }))
      })
      .executeTakeFirstOrThrow()

      return data
  }

  static async update(data: StationRawUpdate) {
    await db
      .updateTable("station")
      .set(data)
      .where("id", "=", data.id)
      .execute()

    return data
  }

  static async del(id: string) {
    return await db
      .deleteFrom("station")
      .where("id", "=", id)
      .executeTakeFirst()
  }

  static prepareInsertFromStation(operator: Operator, station: Station): NewStationRaw {
    return {
      id: `${operator}-${station.code}`,
      name: station.name,
      originalName: station.originalName,
      code: station.code,
      region: station.regionCode,
      operator
    }
  }
}
