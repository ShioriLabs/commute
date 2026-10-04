import { DATA_VERSION_KV_KEY } from '@commute/constants'

export type Tab = 'unmeasured' | 'missing-reverse' | 'deletes' | 'drafts'
export const TABS: Tab[] = ['unmeasured', 'missing-reverse', 'deletes', 'drafts']

type Op = 'upsert' | 'delete' | 'revert'

export interface QueueRow {
  id: string
  fromStationId: string
  fromName: string
  fromOperator: string
  toStationId: string
  toName: string
  toOperator: string
  distance: number
  notes: string | null
  draftOp: Op | null
}

export interface OverrideRow { op: Op, distance: number | null, noTap: number, notes: string | null, editedBy: string, updatedAt: string }

export interface TransferDetail {
  id: string
  fromStationId: string
  fromName: string
  toStationId: string
  toName: string
  base: { distance: number, noTap: number, notes: string | null } | null
  published: OverrideRow | null
  draft: OverrideRow | null
}

export interface DraftInput {
  fromStationId: string
  toStationId: string
  distance: number | null
  noTap: boolean
  notes: string | null
  applyReverse: boolean
}

export const transferId = (from: string, to: string) => `${from}->${to}`

const STATION_JOINS = `
  JOIN stations f ON f.id = x.fromStationId
  JOIN stations t ON t.id = x.toStationId`
const STATION_COLUMNS = `
  x.fromStationId, f.name AS fromName, f.operator AS fromOperator,
  x.toStationId, t.name AS toName, t.operator AS toOperator`
// Busiest interchanges first: the station score is the planner's own measure of
// how much a stop matters.
const ORDER = 'ORDER BY MAX(f.score, t.score) DESC, x.id'

const EFFECTIVE_WHERE: Record<'unmeasured' | 'missing-reverse', string> = {
  'unmeasured': 'x.distance = 0',
  'missing-reverse': `NOT EXISTS (
    SELECT 1 FROM transfers_effective r
    WHERE r.fromStationId = x.toStationId AND r.toStationId = x.fromStationId)`
}

export async function listQueue(db: D1Database, tab: Tab): Promise<QueueRow[]> {
  if (tab === 'unmeasured' || tab === 'missing-reverse') {
    const { results } = await db.prepare(`
      SELECT x.id, ${STATION_COLUMNS}, x.distance, x.notes, d.op AS draftOp
      FROM transfers_effective x ${STATION_JOINS}
      LEFT JOIN transfer_overrides d ON d.id = x.id AND d.status = 'draft'
      WHERE x.dataType = 'INTERNAL' AND ${EFFECTIVE_WHERE[tab]}
      ${ORDER}`).all<QueueRow>()
    return results
  }

  // Deleted rows are gone from the view, and drafts are invisible to it, so
  // these two tabs read the overrides directly.
  const where = tab === 'deletes' ? 'x.op = \'delete\'' : 'x.status = \'draft\''
  const { results } = await db.prepare(`
    SELECT x.id, ${STATION_COLUMNS},
      COALESCE(x.distance, b.distance, 0) AS distance, x.notes,
      CASE WHEN x.status = 'draft' THEN x.op END AS draftOp
    FROM transfer_overrides x ${STATION_JOINS}
    LEFT JOIN transfers b ON b.id = x.id
    WHERE ${where}
    ${ORDER}`).all<QueueRow>()
  return results
}

export async function countDrafts(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM transfer_overrides WHERE status = \'draft\'').first<{ n: number }>()
  return row?.n ?? 0
}

async function override(db: D1Database, id: string, status: 'draft' | 'published') {
  return db.prepare(`SELECT op, distance, noTap, notes, editedBy, updatedAt FROM transfer_overrides WHERE id = ? AND status = ?`)
    .bind(id, status).first<OverrideRow>()
}

async function baseRow(db: D1Database, id: string) {
  return db.prepare('SELECT fromStationId, toStationId, distance, noTap, notes FROM transfers WHERE id = ? AND dataType = \'INTERNAL\'')
    .bind(id).first<{ fromStationId: string, toStationId: string, distance: number, noTap: number, notes: string | null }>()
}

export async function getTransfer(db: D1Database, id: string): Promise<TransferDetail | null> {
  const [base, published, draft] = await Promise.all([baseRow(db, id), override(db, id, 'published'), override(db, id, 'draft')])
  const ends = base ?? await db.prepare('SELECT fromStationId, toStationId FROM transfer_overrides WHERE id = ? LIMIT 1')
    .bind(id).first<{ fromStationId: string, toStationId: string }>()
  if (!ends) return null
  const names = await db.prepare('SELECT f.name AS fromName, t.name AS toName FROM stations f, stations t WHERE f.id = ? AND t.id = ?')
    .bind(ends.fromStationId, ends.toStationId).first<{ fromName: string, toName: string }>()
  return {
    id,
    fromStationId: ends.fromStationId, fromName: names?.fromName ?? ends.fromStationId,
    toStationId: ends.toStationId, toName: names?.toName ?? ends.toStationId,
    base: base ? { distance: base.distance, noTap: base.noTap, notes: base.notes } : null,
    published,
    draft
  }
}

export async function listStations(db: D1Database) {
  const { results } = await db.prepare('SELECT id, name, operator FROM stations ORDER BY name').all<{ id: string, name: string, operator: string }>()
  return results
}

const UPSERT_DRAFT = `
  INSERT INTO transfer_overrides (id, status, op, fromStationId, toStationId, distance, noTap, notes, editedBy, updatedAt)
  VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT (id, status) DO UPDATE SET
    op = excluded.op, distance = excluded.distance, noTap = excluded.noTap,
    notes = excluded.notes, editedBy = excluded.editedBy, updatedAt = CURRENT_TIMESTAMP`

function draftStatement(db: D1Database, op: Op, from: string, to: string, input: Pick<DraftInput, 'distance' | 'noTap' | 'notes'>, user: string) {
  return db.prepare(UPSERT_DRAFT).bind(transferId(from, to), op, from, to, input.distance, input.noTap ? 1 : 0, input.notes, user)
}

export async function saveDraft(db: D1Database, input: DraftInput, user: string): Promise<{ ok: true } | { ok: false, error: string }> {
  const { fromStationId: from, toStationId: to, distance } = input
  if (from === to) return { ok: false, error: 'From and to must be different stations' }
  if (distance !== null && (!Number.isInteger(distance) || distance < 0)) return { ok: false, error: 'Distance must be a whole number of metres' }
  if (distance === 0) return { ok: false, error: 'Distance 0 means unmeasured. Leave it empty to keep the imported value' }

  const found = await db.prepare('SELECT COUNT(*) AS n FROM stations WHERE id IN (?, ?)').bind(from, to).first<{ n: number }>()
  if ((found?.n ?? 0) < 2) return { ok: false, error: 'Both stations must exist' }

  const pairs: [string, string][] = input.applyReverse ? [[from, to], [to, from]] : [[from, to]]
  for (const [a, b] of pairs) {
    if (distance === null && !(await baseRow(db, transferId(a, b)))) {
      return { ok: false, error: `${transferId(a, b)} is a new transfer, so it needs a distance` }
    }
  }

  await db.batch(pairs.map(([a, b]) => draftStatement(db, 'upsert', a, b, input, user)))
  return { ok: true }
}

async function endsOf(db: D1Database, id: string) {
  const detail = await getTransfer(db, id)
  if (!detail) throw new Error(`Unknown transfer ${id}`)
  return [detail.fromStationId, detail.toStationId] as const
}

async function writeOpDraft(db: D1Database, op: Op, id: string, applyReverse: boolean, user: string) {
  const [from, to] = await endsOf(db, id)
  const pairs: [string, string][] = applyReverse ? [[from, to], [to, from]] : [[from, to]]
  const statements = []
  for (const [a, b] of pairs) {
    const pairId = transferId(a, b)
    // Reverting something that was never published is just dropping the draft.
    if (op === 'revert' && !(await override(db, pairId, 'published'))) {
      statements.push(db.prepare('DELETE FROM transfer_overrides WHERE id = ? AND status = \'draft\'').bind(pairId))
    } else if (op === 'delete' || (await getTransfer(db, pairId))) {
      statements.push(draftStatement(db, op, a, b, { distance: null, noTap: false, notes: null }, user))
    }
  }
  if (statements.length) await db.batch(statements)
}

export const markDelete = (db: D1Database, id: string, applyReverse: boolean, user: string) =>
  writeOpDraft(db, 'delete', id, applyReverse, user)

export const revertToImported = (db: D1Database, id: string, applyReverse: boolean, user: string) =>
  writeOpDraft(db, 'revert', id, applyReverse, user)

export async function discardDraft(db: D1Database, id: string) {
  await db.prepare('DELETE FROM transfer_overrides WHERE id = ? AND status = \'draft\'').bind(id).run()
}

function publishIdFor(now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) // 20261001T161500
  return `${stamp}-${crypto.randomUUID().slice(0, 4)}`
}

export async function publish(db: D1Database, kv: KVNamespace, user: string, now = new Date()) {
  const { results: drafts } = await db.prepare('SELECT id, op, distance FROM transfer_overrides WHERE status = \'draft\' ORDER BY id')
    .all<{ id: string, op: Op, distance: number | null }>()
  if (drafts.length === 0) return null

  const publishId = publishIdFor(now)
  const summary = drafts.map(d => d.op === 'upsert' && d.distance !== null ? `${d.id} ${d.distance}m` : `${d.op} ${d.id}`).join('; ')

  // One batch is one transaction: the live set never shows half a publish.
  await db.batch([
    db.prepare('INSERT INTO publishes (id, publishedBy, changeCount, summary) VALUES (?, ?, ?, ?)').bind(publishId, user, drafts.length, summary),
    db.prepare(`DELETE FROM transfer_overrides WHERE status = 'published'
      AND id IN (SELECT id FROM transfer_overrides WHERE status = 'draft')`),
    db.prepare('DELETE FROM transfer_overrides WHERE status = \'draft\' AND op = \'revert\''),
    db.prepare('UPDATE transfer_overrides SET status = \'published\', publishId = ?, updatedAt = CURRENT_TIMESTAMP WHERE status = \'draft\'').bind(publishId)
  ])

  // After D1, never before: a bump without the data would cache the old rows
  // under the new version for the full KV TTL.
  let versionBumped = true
  try {
    await kv.put(DATA_VERSION_KV_KEY, publishId)
  } catch {
    versionBumped = false
  }
  return { publishId, changeCount: drafts.length, versionBumped }
}

export async function versionStatus(db: D1Database, kv: KVNamespace) {
  const latest = await db.prepare('SELECT id FROM publishes ORDER BY publishedAt DESC, id DESC LIMIT 1').first<{ id: string }>()
  return { latestPublishId: latest?.id ?? null, liveVersion: await kv.get(DATA_VERSION_KV_KEY) }
}

export async function bumpVersion(db: D1Database, kv: KVNamespace) {
  const { latestPublishId } = await versionStatus(db, kv)
  if (latestPublishId) await kv.put(DATA_VERSION_KV_KEY, latestPublishId)
}
