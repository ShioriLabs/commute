import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createApp } from '../app'
import { fakeKV, migratedD1, seedStations, seedTransfer } from '../../test/sqlite-d1'

const A = 'KCI-AAA', B = 'TJ-BBB'
const AB = `${A}->${B}`
let db: DatabaseSync
let env: { DB: D1Database, KV: KVNamespace, ACCESS_TEAM_DOMAIN: string, ACCESS_AUD: string, ACCESS_DEV_USER: string }

beforeEach(() => {
  const m = migratedD1()
  db = m.db
  seedStations(db, [A, B])
  seedTransfer(db, A, B, 0)
  seedTransfer(db, B, A, 0, 'blocked: flyover demolition')
  env = { DB: m.d1, KV: fakeKV().kv, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_DEV_USER: 'dev@local' }
})

const app = () => createApp()
const get = (path: string) => app().request(`http://localhost${path}`, {}, env)
const post = (path: string, form: Record<string, string>) =>
  app().request(`http://localhost${path}`, { method: 'POST', body: new URLSearchParams(form) }, env)
const drafts = () => db.prepare('SELECT id, distance FROM transfer_overrides WHERE status = \'draft\' ORDER BY id').all()

describe('transfers pages', () => {
  it('renders the unmeasured queue with links and a blocked marker', async () => {
    const html = await (await get('/transfers')).text()
    expect(html).toContain(`/transfers/${encodeURIComponent(AB)}`)
    expect(html).toContain('Station AAA')
    expect(html).toMatch(/blocked/i)
  })

  it('saves a draft for both directions from the edit form and redirects', async () => {
    const res = await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '300', notes: '', applyReverse: 'on' })
    expect(res.status).toBe(303)
    expect(drafts()).toEqual([{ id: AB, distance: 300 }, { id: `${B}->${A}`, distance: 300 }])
  })

  it('re-renders the form with an error on distance 0', async () => {
    const res = await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '0', applyReverse: 'on' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('Distance 0 means unmeasured')
    expect(drafts()).toEqual([])
  })

  it('labels a queued row that has a pending draft', async () => {
    await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '300' })
    expect(await (await get('/transfers')).text()).toContain('draft: upsert')
  })

  it('shows the publish bar once a draft exists', async () => {
    await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '300' })
    expect(await (await get('/transfers')).text()).toContain('1 draft change')
  })

  it('creates a new transfer from /transfers/new', async () => {
    seedStations(db, ['MRTJ-CCC'])
    const res = await post('/transfers/new', { from: A, to: 'MRTJ-CCC', distance: '210', applyReverse: 'on' })
    expect(res.status).toBe(303)
    expect(drafts()).toHaveLength(2)
  })

  it('404s an unknown transfer', async () => {
    expect((await get(`/transfers/${encodeURIComponent('KCI-X->KCI-Y')}`)).status).toBe(404)
  })
})
