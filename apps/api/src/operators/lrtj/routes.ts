import { Hono } from 'hono'
import { syncStations } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NewStation, Station } from 'db/schemas/stations'
import { NotFound, Ok } from 'utils/response'
import { OPERATORS } from '@commute/constants'
// import { LineGroupedTimetable, Schedule, ScheduleWithLineInfo } from 'db/schemas/schedules'
import { Bindings } from 'app'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/stations', async (c) => {
  let stations: Station[] | NewStation[] = await new StationRepository(c.env.DB).getAllByOperator('LRTJ')
    if (stations.length === 0 || c.req.query('sync') === 'true') {
      stations = await syncStations(c.env.DB)
    }

    return c.json(
      Ok(
        stations.map(station => ({ ...station, operator: OPERATORS.MRTJ }))
      ),
      200
    )
})

app.get('/stations/:code', async (c) => {
  const stationCode = c.req.param('code')
  const station = await new StationRepository(c.env.DB).getById(`${OPERATORS.LRTJ.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  return c.json(
    Ok(
      { ...station, operator: OPERATORS.LRTJ }
    ),
    200
  )
})

// app.get('/stations/:code/timetable', async (c) => {

// })

// app.get('/stations/:code/timetable/grouped', async (c) => {

// })

export default app
