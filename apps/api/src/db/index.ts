import { Kysely } from 'kysely'

import { Database } from './schemas'
import { D1Dialect } from 'kysely-d1'

export const db = (d1: D1Database) => new Kysely<Database>({
  dialect: new D1Dialect({ database: d1 }),
})
