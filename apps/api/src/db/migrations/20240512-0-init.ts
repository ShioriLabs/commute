import { Kysely, sql } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('stations')
    .addColumn('id', 'varchar(32)', col => col.notNull().primaryKey().unique())
    .addColumn('name', 'varchar(128)', col => col.notNull())
    .addColumn('code', 'varchar(32)', col => col.notNull())
    .addColumn('formattedName', 'varchar(128)')
    .addColumn('region', 'varchar(32)', col => col.notNull())
    .addColumn('regionCode', 'varchar(4)', col => col.notNull())
    .addColumn('operator', 'varchar(8)', col => col.notNull())
    .addColumn('timetableSynced', 'boolean', col => col.notNull().defaultTo(false))
    .addColumn('createdAt', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updatedAt', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .ifNotExists()
    .execute()

  await db.schema
    .createTable('schedules')
    .addColumn('id', 'varchar(32)', col => col.notNull().primaryKey().unique())
    .addColumn('stationId', 'varchar(32)', col => col.notNull().references('stations.id').onDelete('cascade').onUpdate('cascade'))
    .addColumn('tripNumber', 'varchar(12)', col => col.notNull())
    .addColumn('estimatedDeparture', 'time', col => col.notNull())
    .addColumn('estimatedArrival', 'time', col => col.notNull())
    .addColumn('boundFor', 'varchar(64)', col => col.notNull())
    .addColumn('createdAt', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updatedAt', 'timestamp', col => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .ifNotExists()
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('stations').execute()
  await db.schema.dropTable('schedules').execute()
}
