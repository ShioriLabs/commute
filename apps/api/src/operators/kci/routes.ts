import { Hono } from 'hono'
import { syncStations } from './sync'

const app = new Hono()

app.get('/stations', async (c) => {
  const stations = await syncStations()
  return c.json(stations)
})

export default app
