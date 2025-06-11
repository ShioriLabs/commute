import { Hono } from 'hono'
import { cors } from 'hono/cors'

import kciRoutes from './operators/kci/routes'
import mrtjRoutes from './operators/mrtj/routes'
import lrtjRoutes from './operators/lrtj/routes'
import { StationRepository } from 'db/repositories/stations'
import { Ok } from 'utils/response'

export interface Bindings {
  DB: D1Database
  KCI_API_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())
app.route('KCI', kciRoutes)
app.route('MRTJ', mrtjRoutes)
app.route('LRTJ', lrtjRoutes)
app.get('/stations', async (c) => {
  const stations = await new StationRepository(c.env.DB).getAll()
  return c.json(
    Ok(
      stations
    ),
    200
  )
})

export default app
