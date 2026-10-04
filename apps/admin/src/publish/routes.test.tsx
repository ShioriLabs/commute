import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { DATA_VERSION_KV_KEY } from '@commute/constants'
import { createApp } from '../app'
import { fakeKV, migratedD1, seedStations, seedTransfer } from '../../test/sqlite-d1'

const A = 'KCI-AAA', B = 'TJ-BBB'
let db: DatabaseSync
let kv: ReturnType<typeof fakeKV>
let env: { DB: D1Database, KV: KVNamespace, ACCESS_TEAM_DOMAIN: string, ACCESS_AUD: string, ACCESS_DEV_USER: string }

beforeEach(() => {
  const m = migratedD1()
  db = m.db
  kv = fakeKV()
  seedStations(db, [A, B])
  seedTransfer(db, A, B, 0)
  seedTransfer(db, B, A, 0)
  env = { DB: m.d1, KV: kv.kv, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_DEV_USER: 'dev@local' }
})

const req = (path: string, init: RequestInit = {}) => createApp().request(`http://localhost${path}`, init, env)
const saveDraft = () => req(`/transfers/${encodeURIComponent(`${A}->${B}`)}`, { method: 'POST', body: new URLSearchParams({ distance: '300', applyReverse: 'on' }) })

describe('publish page', () => {
  it('shows imported vs draft for each pending row', async () => {
    await saveDraft()
    const html = await (await req('/publish')).text()
    expect(html).toContain('unmeasured')
    expect(html).toContain('300 m')
    expect(html).toContain('Publish 2 changes')
  })

  it('publishes and bumps the live version', async () => {
    await saveDraft()
    const res = await req('/publish', { method: 'POST' })
    expect(res.status).toBe(303)
    expect(kv.store.get(DATA_VERSION_KV_KEY)).toMatch(/^\d{8}T\d{6}-[0-9a-f]{4}$/)
  })

  it('offers a retry when the version bump failed, and the retry fixes it', async () => {
    await saveDraft()
    kv.failNextPuts()
    await req('/publish', { method: 'POST' })
    expect(await (await req('/publish')).text()).toContain('Retry version bump')
    kv.failNextPuts(false)
    await req('/publish/bump', { method: 'POST' })
    expect(kv.store.has(DATA_VERSION_KV_KEY)).toBe(true)
    expect(await (await req('/publish')).text()).not.toContain('Retry version bump')
  })
})
