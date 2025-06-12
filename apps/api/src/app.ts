import { Hono } from 'hono'
import { cors } from 'hono/cors'

import kciRoutes from './operators/kci/routes'
import mrtjRoutes from './operators/mrtj/routes'
import lrtjRoutes from './operators/lrtj/routes'
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

app.use('*', cors())
app.route('KCI', kciRoutes)
app.route('MRTJ', mrtjRoutes)
app.route('LRTJ', lrtjRoutes)
app.route('stations', stations)
app.route('sync/stations', syncRoutes)
app.route('cache', cacheRoutes)
app.route('operators', operatorRoutes)

export default app
