import { Hono } from 'hono'
import { syncStations } from './sync'
import { StationRepository } from 'db/repositories/stations'

const app = new Hono()

app.get('/stations', async (c) => {
  let stations = (await StationRepository.getAll()).map(station => StationRepository.toStation(station))
  if (stations.length === 0) {
    stations = await syncStations()
  }

  return c.json(stations)
})

export default app
