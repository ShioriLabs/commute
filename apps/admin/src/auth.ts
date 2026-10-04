import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { AdminEnv } from './env'

/*
 * Cloudflare Access already stands in front of the hostname. This checks its
 * signed assertion anyway, so a misconfigured Access policy or a second route
 * to the Worker fails closed instead of open. workers_dev is off for the same
 * reason (wrangler.toml).
 *
 * Local dev opts out explicitly with ACCESS_DEV_USER, set in .dev.vars, which
 * only `wrangler dev` reads and which never deploys. Not a hostname check:
 * wrangler dev rewrites the request URL to the `routes` host, so the Worker
 * never sees "localhost" there anyway.
 */
const remoteKeySets = new Map<string, JWTVerifyGetKey>()
function remoteKeySet(teamDomain: string) {
  let keySet = remoteKeySets.get(teamDomain)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    remoteKeySets.set(teamDomain, keySet)
  }
  return keySet
}

export function accessAuth(getKey: (teamDomain: string) => JWTVerifyGetKey = remoteKeySet) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    if (c.env.ACCESS_DEV_USER) {
      c.set('user', c.env.ACCESS_DEV_USER)
      return next()
    }

    const team = c.env.ACCESS_TEAM_DOMAIN
    const aud = c.env.ACCESS_AUD
    const token = c.req.header('Cf-Access-Jwt-Assertion')
    if (!team || !aud || !token) return c.text('Forbidden', 403)

    try {
      const { payload } = await jwtVerify(token, getKey(team), { issuer: team, audience: aud })
      if (typeof payload.email !== 'string') return c.text('Forbidden', 403)
      c.set('user', payload.email)
    } catch {
      return c.text('Forbidden', 403)
    }
    return next()
  })
}
