import { Hono } from 'hono'
import { cors } from 'hono/cors'

import kciRoutes from './operators/kci/routes'
import mrtjRoutes from './operators/mrtj/routes'
import lrtjRoutes from './operators/lrtj/routes'
import { StationRepository } from 'db/repositories/stations'
import { Ok } from 'utils/response'
import { KVRepository } from 'db/repositories/kv'

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
app.get('/stations', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${c.env.API_VERSION}`
  const stations = await kvRepository.get(kvKey)
  if (stations) {
    return c.json(
      Ok(stations),
      200
    )
  }

  const freshStations = await stationRepository.getAll()
  if (!freshStations || freshStations.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  await kvRepository.set(kvKey, JSON.stringify(freshStations))

  return c.json(
    Ok(
      freshStations
    ),
    200
  )
})

export default app
