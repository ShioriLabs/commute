import { Hono } from 'hono'
import { syncStations, syncTimetable } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NotFound, Ok } from 'utils/response'
import { OPERATORS } from '@commute/constants'
import { LineGroupedTimetable, Schedule, ScheduleWithLineInfo } from 'db/schemas/schedules'
import { Bindings } from 'app'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/stations', async (c) => {
  let stations = await new StationRepository(c.env.DB).getAllByOperator('LRTJ')
  if (stations.length === 0 || c.req.query('sync') === 'true') {
    await syncStations(c.env.DB)
    stations = await new StationRepository(c.env.DB).getAllByOperator('LRTJ')
  }

  return c.json(
    Ok(
      stations
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
      station
    ),
    200
  )
})

app.get('/stations/:code/timetable', async (c) => {
  const stationCode = c.req.param('code')
  const station = await new StationRepository(c.env.DB).getById(`${OPERATORS.LRTJ.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  let timetable: (Schedule | ScheduleWithLineInfo)[] = []
  if (station.timetableSynced === 0 || c.req.query('sync') === 'true') {
    await syncTimetable(c.env.DB, station.code)
  }

  timetable = await new StationRepository(c.env.DB).getTimetableFromStationId(station.id)
  timetable = timetable.map(schedule => ({
    ...schedule,
    line: {
      lineCode: schedule.lineCode,
      name: 'Lin Selatan',
      colorCode: '#F26324'
    }
  }))

  return c.json(Ok(timetable), 200)
})

app.get('/stations/:code/timetable/grouped', async (c) => {
  const stationCode = c.req.param('code')
  const station = await new StationRepository(c.env.DB).getById(`${OPERATORS.LRTJ.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  const timetable: LineGroupedTimetable = []
  if (station.timetableSynced === 0 || c.req.query('sync') === 'true') {
    await syncTimetable(c.env.DB, station.code)
  }

  const schedules = await new StationRepository(c.env.DB).getTimetableFromStationId(station.id)
  const groupedByBoundFor: Record<string, Schedule[]> = { }

  for (const schedule of schedules) {
    if (groupedByBoundFor[schedule.boundFor]) {
      groupedByBoundFor[schedule.boundFor]!.push(schedule)
    } else {
      groupedByBoundFor[schedule.boundFor] = [schedule]
    }
  }

  timetable.push({
    name: 'Lin Selatan',
    colorCode: '#F26324',
    lineCode: 'S',
    timetable: Object.entries(groupedByBoundFor).map(([boundFor, schedules]) => ({ boundFor, schedules }))
  })

  return c.json(Ok(timetable), 200)
})

export default app
