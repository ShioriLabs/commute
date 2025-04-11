import { Hono } from 'hono'
import { sync } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NewStation, Station } from 'db/schemas/stations'
import { NotFound, Ok } from 'utils/response'
import { OPERATORS } from 'constant'
import { LineGroupedTimetable, Schedule, ScheduleWithLineInfo } from 'db/schemas/schedules'

const app = new Hono()

app.get('/stations', async (c) => {
  let stations: Station[] | NewStation[] = await StationRepository.getAllByOperator("MRTJ")
  if (stations.length === 0 || c.req.query("sync") === "true") {
    stations = await sync()
  }

  return c.json(Ok(stations), 200)
})

app.get('/stations/:code', async (c) => {
  const stationCode = c.req.param('code')
  const station = await StationRepository.getById(`${OPERATORS.MRTJ.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  return c.json(Ok(station), 200)
})

app.get('/stations/:code/timetable', async (c) => {
  const stationCode = c.req.param('code')
  const station = await StationRepository.getById(`${OPERATORS.MRTJ.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  let timetable: (Schedule | ScheduleWithLineInfo)[] = []
  if (station.timetableSynced === 0 || c.req.query("sync") === "true") {
    await sync()
  }

  timetable = await StationRepository.getTimetableFromStationId(station.id)
  timetable = timetable.map(schedule => ({
    ...schedule,
    line: {
      lineCode: schedule.lineCode,
      name: 'Lin Utara Selatan',
      colorCode: '#ca2a51'
    }
  }))

  return c.json(Ok(timetable), 200)
})

app.get('/stations/:code/timetable/grouped', async (c) => {
  const stationCode = c.req.param('code')
  const station = await StationRepository.getById(`${OPERATORS.MRTJ.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  let timetable: LineGroupedTimetable = []
  if (station.timetableSynced === 0 || c.req.query("sync") === "true") {
    await sync()
  }

  const schedules = await StationRepository.getTimetableFromStationId(station.id)
  const groupedByBoundFor: Record<string, Schedule[]> = { }

  for (const schedule of schedules) {
    if (groupedByBoundFor[schedule.boundFor]) {
      groupedByBoundFor[schedule.boundFor]!.push(schedule)
    } else {
      groupedByBoundFor[schedule.boundFor] = [schedule]
    }
  }

  timetable.push({
    name: 'Lin Utara Selatan',
    colorCode: '#ca2a51',
    lineCode: 'M',
    timetable: Object.entries(groupedByBoundFor).map(([boundFor, schedules]) => ({ boundFor, schedules }))
  })

  return c.json(Ok(timetable), 200)
})

export default app
