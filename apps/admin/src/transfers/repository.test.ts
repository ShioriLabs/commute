import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { DATA_VERSION_KV_KEY } from '@commute/constants'
import { fakeKV, migratedD1, seedStations, seedTransfer } from '../../test/sqlite-d1'
import {
  bumpVersion, countDrafts, discardDraft, getTransfer, listQueue, markDelete, publish, revertToImported, saveDraft, versionStatus
} from './repository'

const A = 'KCI-AAA', B = 'TJ-BBB', C = 'MRTJ-CCC'
const AB = `${A}->${B}`, BA = `${B}->${A}`
let db: DatabaseSync
let d1: D1Database

const effective = (id: string) =>
  db.prepare('SELECT distance, notes FROM transfers_effective WHERE id = ?').get(id)

beforeEach(() => {
  ({ db, d1 } = migratedD1())
  seedStations(db, [A, B, C])
  seedTransfer(db, A, B, 0)
  seedTransfer(db, B, A, 0)
})

const draft = (over: Partial<Parameters<typeof saveDraft>[1]> = {}) =>
  saveDraft(d1, { fromStationId: A, toStationId: B, distance: 300, noTap: false, notes: null, applyReverse: true, ...over }, 'me@example.com')

describe('queue', () => {
  it('lists unmeasured transfers and flags ones with a pending draft', async () => {
    expect((await listQueue(d1, 'unmeasured')).map(r => [r.id, r.draftOp])).toEqual([[AB, null], [BA, null]])
    await draft({ applyReverse: false })
    expect((await listQueue(d1, 'unmeasured')).map(r => [r.id, r.draftOp])).toEqual([[AB, 'upsert'], [BA, null]])
  })

  it('lists transfers whose reverse direction is missing', async () => {
    seedTransfer(db, A, C, 150)
    expect((await listQueue(d1, 'missing-reverse')).map(r => r.id)).toEqual([`${A}->${C}`])
  })
})

describe('saveDraft', () => {
  it('writes both directions by default and leaves the live view untouched', async () => {
    expect(await draft()).toEqual({ ok: true })
    expect(await countDrafts(d1)).toBe(2)
    expect(effective(AB)).toEqual({ distance: 0, notes: null })
  })

  it('rejects distance 0, from = to, and unknown stations', async () => {
    expect(await draft({ distance: 0 })).toMatchObject({ ok: false })
    expect(await draft({ toStationId: A })).toMatchObject({ ok: false })
    expect(await draft({ toStationId: 'KCI-NOPE' })).toMatchObject({ ok: false })
    expect(await countDrafts(d1)).toBe(0)
  })

  it('requires a distance for a new transfer, including its reverse, and writes nothing on failure', async () => {
    seedTransfer(db, A, C, 100) // C->A does not exist
    const result = await draft({ toStationId: C, distance: null, notes: 'blocked: flyover' })
    expect(result).toMatchObject({ ok: false })
    expect(await countDrafts(d1)).toBe(0)
  })

  it('keeps the published value live while a newer draft is pending', async () => {
    await draft({ distance: 300 })
    await publish(d1, fakeKV().kv, 'me@example.com')
    await draft({ distance: 450 })
    expect(effective(AB)).toEqual({ distance: 300, notes: null })
    expect((await getTransfer(d1, AB))?.draft?.distance).toBe(450)
    expect((await getTransfer(d1, AB))?.published?.distance).toBe(300)
  })
})

describe('publish', () => {
  it('flips drafts live, logs the publish and bumps the data version once', async () => {
    const { kv, store } = fakeKV()
    await draft()
    const result = await publish(d1, kv, 'me@example.com', new Date('2026-10-01T16:15:00Z'))
    expect(result).toMatchObject({ changeCount: 2, versionBumped: true })
    expect(result!.publishId).toMatch(/^20261001T161500-[0-9a-f]{4}$/)
    expect(store.get(DATA_VERSION_KV_KEY)).toBe(result!.publishId)
    expect(effective(AB)).toEqual({ distance: 300, notes: null })
    expect(await countDrafts(d1)).toBe(0)
  })

  it('is a no-op with no drafts: no publish row, no version bump', async () => {
    const { kv, store } = fakeKV()
    expect(await publish(d1, kv, 'me@example.com')).toBeNull()
    expect(store.has(DATA_VERSION_KV_KEY)).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM publishes').get()).toEqual({ n: 0 })
  })

  it('reports a failed version bump and lets it be retried', async () => {
    const kv = fakeKV()
    kv.failNextPuts()
    await draft()
    const result = await publish(d1, kv.kv, 'me@example.com')
    expect(result).toMatchObject({ versionBumped: false })
    expect(await versionStatus(d1, kv.kv)).toEqual({ latestPublishId: result!.publishId, liveVersion: null })
    kv.failNextPuts(false)
    await bumpVersion(d1, kv.kv)
    expect(await versionStatus(d1, kv.kv)).toEqual({ latestPublishId: result!.publishId, liveVersion: result!.publishId })
  })

  it('applies delete and revert drafts', async () => {
    await draft()
    await publish(d1, fakeKV().kv, 'me@example.com')
    await revertToImported(d1, AB, false, 'me@example.com')
    await markDelete(d1, BA, false, 'me@example.com')
    await publish(d1, fakeKV().kv, 'me@example.com')
    expect(effective(AB)).toEqual({ distance: 0, notes: null })
    expect(effective(BA)).toBeUndefined()
    expect((await listQueue(d1, 'deletes')).map(r => r.id)).toEqual([BA])
  })

  it('discardDraft drops only the pending row', async () => {
    await draft({ applyReverse: false })
    await discardDraft(d1, AB)
    expect(await countDrafts(d1)).toBe(0)
  })
})
