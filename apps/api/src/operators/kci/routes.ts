import { Hono } from 'hono'
import { syncStations } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NewStation, Station } from 'db/schemas/stations'

const app = new Hono()

app.get('/stations', async (c) => {
  let stations: Station[] | NewStation[] = await StationRepository.getAll()
  if (stations.length === 0) {
    stations = await syncStations()
  }

  return c.json(stations)
})

export default app
