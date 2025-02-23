import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import kciRoutes from './operators/kci/routes'
import mrtjRoutes from './operators/mrtj/routes'
import { StationRepository } from 'db/repositories/stations'
import { Ok } from 'utils/response'

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT) : 3000
const app = new Hono()

app.use('*', cors())
app.route('kci', kciRoutes)
app.route('mrtj', mrtjRoutes)
app.get('/stations', async (c) => {
  const stations = await StationRepository.getAll()
  return c.json(Ok(stations), 200)
})

serve({
  fetch: app.fetch,
  port: PORT,
})

console.log(`Server running at ${PORT}`)
