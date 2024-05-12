import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import kciRoutes from './operators/kci/routes'
import mrtjRoutes from './operators/mrtj/routes'

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT) : 3000
const app = new Hono()

app.route('kci', kciRoutes)
app.route('mrtj', mrtjRoutes)

serve({
  fetch: app.fetch,
  port: PORT,
})

console.log(`Server running at ${PORT}`)
