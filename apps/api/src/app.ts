import { Hono } from 'hono'
import { cors } from 'hono/cors'

import stations from './routes/stations'
import hubs from './routes/hubs'
import lines from './routes/lines'
import fares from './routes/fares'
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

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://commute.shiorilabs.id',
  'https://dev.commute.shiorilabs.id',
  'https://data.commute.shiorilabs.id',
  'https://transportforjakarta.or.id'
])

app.use('*', cors({
  origin(origin) {
    return ALLOWED_ORIGINS.has(origin) ? origin : null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS']
}))

app.route('stations', stations)
app.route('hubs', hubs)
app.route('lines', lines)
app.route('fares', fares)
app.route('sync/stations', syncRoutes)
app.route('cache', cacheRoutes)
app.route('operators', operatorRoutes)

export default app
