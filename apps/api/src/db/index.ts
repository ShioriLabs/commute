import SQLite from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'

import { Database } from './schemas'

const dialect = new SqliteDialect({
  database: new SQLite("commute.db")
})

export const db = new Kysely<Database>({
  dialect
})
