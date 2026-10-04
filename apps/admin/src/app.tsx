import { Hono } from 'hono'
import type { JWTVerifyGetKey } from 'jose'
import { accessAuth } from './auth'
import type { AdminEnv } from './env'
import { publishRoutes } from './publish/routes'
import { transferRoutes } from './transfers/routes'

export function createApp(options: { getKey?: (teamDomain: string) => JWTVerifyGetKey } = {}) {
  const app = new Hono<AdminEnv>()
  app.use('*', accessAuth(options.getKey))
  app.get('/', c => c.redirect('/transfers'))
  app.route('/transfers', transferRoutes)
  app.route('/publish', publishRoutes)
  return app
}

export default createApp()
