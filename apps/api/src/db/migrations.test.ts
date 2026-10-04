import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

/*
 * The view is SQL semantics, which a mocked Kysely `execute` cannot prove. So
 * this runs every real migration, in order, against an in-memory SQLite.
 */
const MIGRATIONS = path.resolve(__dirname, 'migrations')

function migratedDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

function station(db: DatabaseSync, id: string) {
  const [operator, code] = id.split('-')
  db.prepare(`INSERT INTO stations (id, name, code, region, regionCode, operator) VALUES (?, ?, ?, 'Jakarta', 'JAK', ?)`)
    .run(id, `Station ${code}`, code!, operator!)
}

function transfer(db: DatabaseSync, from: string, to: string, distance: number) {
  db.prepare(`INSERT INTO transfers (id, dataType, fromStationId, toStationId, distance) VALUES (?, 'INTERNAL', ?, ?, ?)`)
    .run(`${from}->${to}`, from, to, distance)
}

function override(db: DatabaseSync, row: { id: string, status: string, op: string, from: string, to: string, distance?: number | null, notes?: string | null }) {
  db.prepare(`INSERT INTO transfer_overrides (id, status, op, fromStationId, toStationId, distance, noTap, notes, editedBy) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'test')`)
    .run(row.id, row.status, row.op, row.from, row.to, row.distance ?? null, row.notes ?? null)
}

const effective = (db: DatabaseSync) =>
  db.prepare('SELECT id, distance, notes, dataType FROM transfers_effective ORDER BY id').all()

describe('transfers_effective', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = migratedDb()
    for (const id of ['KCI-AAA', 'KCI-BBB', 'TJ-CCC']) station(db, id)
    transfer(db, 'KCI-AAA', 'KCI-BBB', 0)
  })

  it('equals the base table when there are no overrides', () => {
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 0, notes: null, dataType: 'INTERNAL' }])
  })

  it('replaces the base distance with a published upsert', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 300 })
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 300, notes: null, dataType: 'INTERNAL' }])
  })

  it('keeps the base distance when a published upsert only annotates', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: null, notes: 'blocked: flyover' })
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 0, notes: 'blocked: flyover', dataType: 'INTERNAL' }])
  })

  it('ignores drafts, including a draft that sits on top of a published override', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 300 })
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'draft', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 999 })
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 300, notes: null, dataType: 'INTERNAL' }])
  })

  it('adds a transfer that has no base row', () => {
    override(db, { id: 'KCI-BBB->TJ-CCC', status: 'published', op: 'upsert', from: 'KCI-BBB', to: 'TJ-CCC', distance: 530 })
    expect(effective(db)).toEqual([
      { id: 'KCI-AAA->KCI-BBB', distance: 0, notes: null, dataType: 'INTERNAL' },
      { id: 'KCI-BBB->TJ-CCC', distance: 530, notes: null, dataType: 'INTERNAL' }
    ])
  })

  it('hides a base row with a published delete', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'delete', from: 'KCI-AAA', to: 'KCI-BBB' })
    expect(effective(db)).toEqual([])
  })

  it('passes EXTERNAL rows through untouched', () => {
    db.prepare(`INSERT INTO transfers (id, dataType, fromStationId, toStationData, distance) VALUES ('KCI-AAA->EXT', 'EXTERNAL', 'KCI-AAA', '{"name":"X","operatorName":"Y"}', 120)`).run()
    expect(effective(db)).toContainEqual({ id: 'KCI-AAA->EXT', distance: 120, notes: null, dataType: 'EXTERNAL' })
  })

  it('rejects distance 0 and a published revert', () => {
    expect(() => override(db, { id: 'KCI-AAA->KCI-BBB', status: 'draft', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 0 })).toThrow()
    expect(() => override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'revert', from: 'KCI-AAA', to: 'KCI-BBB' })).toThrow()
  })
})
