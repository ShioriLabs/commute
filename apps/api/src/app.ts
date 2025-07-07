import { Hono } from 'hono'
import { cors } from 'hono/cors'

import stations from './routes/stations'
import syncRoutes from './routes/sync'
import cacheRoutes from './routes/cache'
import operatorRoutes from './routes/operators'

export interface Bindings {
  DB: D1Database
  KV: KVNamespace
  API_VERSION: string
  KCI_API_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin(origin) {
    if (
      origin === 'http://localhost:3000'
      || origin === 'http://localhost:5173'
      || origin === 'https://commute.shiorilabs.id') {
      return origin
    }

    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS']
}))

app.route('stations', stations)
app.route('sync/stations', syncRoutes)
app.route('cache', cacheRoutes)
app.route('operators', operatorRoutes)

export default app
