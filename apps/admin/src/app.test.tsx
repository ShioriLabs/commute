import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { fakeKV, migratedD1 } from '../test/sqlite-d1'

const env = () => ({ DB: migratedD1().d1, KV: fakeKV().kv, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_DEV_USER: 'dev@local' })

describe('admin shell', () => {
  it('redirects / to the transfers queue', async () => {
    const res = await createApp().request('http://localhost/', {}, env())
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/transfers')
  })
})
