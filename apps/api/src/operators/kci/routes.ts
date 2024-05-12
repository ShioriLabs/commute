import { Hono } from 'hono'
import { syncStations, syncTimetable } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NewStation, Station } from 'db/schemas/stations'
import { NotFound, Ok } from 'utils/response'
import { OPERATORS } from 'constant'
import { Schedule } from 'db/schemas/schedules'

const app = new Hono()

app.get('/stations', async (c) => {
  let stations: Station[] | NewStation[] = await StationRepository.getAllByOperator("KCI")
  if (stations.length === 0) {
    stations = await syncStations()
  }

  return c.json(Ok(stations), 200)
})

app.get('/stations/:code', async (c) => {
  const stationCode = c.req.param('code')
  const station = await StationRepository.getById(`${OPERATORS.KCI.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  return c.json(Ok(station), 200)
})

app.get('/stations/:code/timetable', async (c) => {
  const stationCode = c.req.param('code')
  const station = await StationRepository.getById(`${OPERATORS.KCI.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  let timetable: Schedule[] = []
  if (station.timetableSynced === 0) {
    await syncTimetable(stationCode)
  }

  timetable = await StationRepository.getTimetableFromStationId(station.id)

  return c.json(Ok(timetable), 200)
})

export default app
