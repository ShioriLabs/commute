import { Hono } from 'hono'
import { cors } from 'hono/cors'

import kciRoutes from './operators/kci/routes'
import mrtjRoutes from './operators/mrtj/routes'
import { StationRepository } from 'db/repositories/stations'
import { Ok } from 'utils/response'
import { OPERATORS } from '@commute/constants'

export interface Bindings {
  DB: D1Database
  KCI_API_TOKEN: string
}

export interface Variables {

}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

app.use('*', cors())
app.route('KCI', kciRoutes)
app.route('MRTJ', mrtjRoutes)
app.get('/stations', async (c) => {
  const stations = await new StationRepository(c.env.DB).getAll()
  return c.json(
    Ok(
      stations.map(station => ({ ...station, operator: OPERATORS[station.operator] }))
    ),
    200
  )
})

export default app
