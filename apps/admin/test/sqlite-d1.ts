import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/*
 * The admin's SQL is its logic, so tests run it for real: every apps/api
 * migration against an in-memory SQLite, behind just enough of the D1 surface
 * (prepare/bind/all/first/run/batch) for the code under test.
 */
const MIGRATIONS = path.resolve(import.meta.dirname, '../../api/src/db/migrations')

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: SQLInputValue[] = []) {}
  bind(...params: SQLInputValue[]) { return new Statement(this.db, this.sql, params) }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} } }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

export function migratedD1() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  } as unknown as D1Database
  return { db, d1 }
}

export function seedStations(db: DatabaseSync, ids: string[]) {
  for (const id of ids) {
    const [operator, code] = id.split('-') as [string, string]
    db.prepare(`INSERT INTO stations (id, name, code, region, regionCode, operator) VALUES (?, ?, ?, 'Jakarta', 'JAK', ?)`)
      .run(id, `Station ${code}`, code, operator)
  }
}

export function seedTransfer(db: DatabaseSync, from: string, to: string, distance: number, notes: string | null = null) {
  db.prepare(`INSERT INTO transfers (id, dataType, fromStationId, toStationId, distance, notes) VALUES (?, 'INTERNAL', ?, ?, ?, ?)`)
    .run(`${from}->${to}`, from, to, distance, notes)
}

export function fakeKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  let failPuts = false
  return {
    store,
    failNextPuts(fail = true) { failPuts = fail },
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        if (failPuts) throw new Error('KV put failed')
        store.set(key, value)
      }
    } as unknown as KVNamespace
  }
}
