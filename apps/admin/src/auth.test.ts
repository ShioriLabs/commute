import { beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { accessAuth } from './auth'
import type { AdminEnv } from './env'

const TEAM = 'https://commute.cloudflareaccess.com'
const AUD = 'aud-123'
let privateKey: CryptoKey
let jwk: JWK

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
})

const sign = (claims: { aud?: string, iss?: string, exp?: string, email?: string } = {}) =>
  new SignJWT(claims.email === undefined ? { email: 'me@example.com' } : { email: claims.email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(claims.iss ?? TEAM)
    .setAudience(claims.aud ?? AUD)
    .setExpirationTime(claims.exp ?? '1h')
    .sign(privateKey)

function app() {
  const a = new Hono<AdminEnv>()
  a.use('*', accessAuth(() => createLocalJWKSet({ keys: [jwk] })))
  a.get('/who', c => c.text(c.var.user))
  return a
}
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as AdminEnv['Bindings']
const call = (token?: string, host = 'https://admin.commute.shiorilabs.id') =>
  app().request(`${host}/who`, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env)

describe('accessAuth', () => {
  it('accepts a valid Access token and exposes the email', async () => {
    const res = await call(await sign())
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('me@example.com')
  })

  it('rejects a missing header on the real host', async () => {
    expect((await call()).status).toBe(403)
  })

  it('rejects the wrong audience', async () => {
    expect((await call(await sign({ aud: 'other' }))).status).toBe(403)
  })

  it('rejects the wrong issuer', async () => {
    expect((await call(await sign({ iss: 'https://evil.cloudflareaccess.com' }))).status).toBe(403)
  })

  it('rejects an expired token', async () => {
    expect((await call(await sign({ exp: '-1m' }))).status).toBe(403)
  })

  it('fails closed when the Access vars are unset', async () => {
    const res = await app().request('https://admin.commute.shiorilabs.id/who',
      { headers: { 'Cf-Access-Jwt-Assertion': await sign() } },
      { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as AdminEnv['Bindings'])
    expect(res.status).toBe(403)
  })

  it('uses ACCESS_DEV_USER without a token (set only in .dev.vars for wrangler dev)', async () => {
    const res = await app().request('https://admin.commute.shiorilabs.id/who', {},
      { ...env, ACCESS_DEV_USER: 'dev@local' } as AdminEnv['Bindings'])
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('dev@local')
  })

  it('does not trust a localhost URL on its own', async () => {
    expect((await call(undefined, 'http://localhost:3002')).status).toBe(403)
  })
})
