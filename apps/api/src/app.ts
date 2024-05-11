import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import kciRoutes from './operators/kci/routes'

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT) : 3000
const app = new Hono()

app.route('kci', kciRoutes)

serve({
  fetch: app.fetch,
  port: PORT,
})

console.log(`Server running at ${PORT}`)
