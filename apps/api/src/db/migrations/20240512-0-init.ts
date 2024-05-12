import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('station')
    .addColumn('id', 'varchar(32)', (col) => col.notNull().primaryKey().unique())
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('code', 'varchar(32)', (col) => col.notNull())
    .addColumn('formattedName', 'varchar(128)')
    .addColumn('region', 'varchar(32)', (col) => col.notNull())
    .addColumn('regionCode', 'varchar(4)', (col) => col.notNull())
    .addColumn('operator', 'varchar(8)', (col) => col.notNull())
    .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .addColumn('updatedAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('station').execute()
}
