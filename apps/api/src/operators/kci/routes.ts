import { Hono } from 'hono'
import { syncStations, syncTimetable } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NewStation, Station } from 'db/schemas/stations'
import { NotFound, Ok } from 'utils/response'
import { OPERATORS } from 'constant'
import { LineGroupedTimetable, Schedule, ScheduleWithLineInfo } from 'db/schemas/schedules'
import { getLineInfoByLineCode } from './formatters'
import { Line } from 'models/line'

const app = new Hono()

app.get('/stations', async (c) => {
  let stations: Station[] | NewStation[] = await StationRepository.getAllByOperator("KCI")
  if (stations.length === 0 || c.req.query("sync") === "true") {
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

  let timetable: (Schedule | ScheduleWithLineInfo)[] = []
  if (station.timetableSynced === 0 || c.req.query("sync") === "true") {
    await syncTimetable(stationCode)
  }

  timetable = await StationRepository.getTimetableFromStationId(station.id)
  timetable = timetable.map(schedule => ({
    ...schedule,
    line: getLineInfoByLineCode(schedule.lineCode)
  }))
  return c.json(Ok(timetable), 200)
})

app.get('/stations/:code/timetable/grouped', async (c) => {
  const stationCode = c.req.param('code')
  const station = await StationRepository.getById(`${OPERATORS.KCI.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  let timetable: LineGroupedTimetable = []
  if (station.timetableSynced === 0 || c.req.query("sync") === "true") {
    await syncTimetable(stationCode)
  }

  const schedules = await StationRepository.getTimetableFromStationId(station.id)
  const groupedByLineSchedules: Record<string, Line & { schedules: Schedule[] }> = { }

  for (const schedule of schedules) {
    const line = getLineInfoByLineCode(schedule.lineCode)
    if (!line) continue

    if (groupedByLineSchedules[line.lineCode]) {
      groupedByLineSchedules[line.lineCode]!.schedules.push(schedule)
    } else {
      groupedByLineSchedules[line.lineCode] = {
        ...line,
        schedules: [schedule]
      }
    }
  }

  for (const line of Object.values(groupedByLineSchedules)) {
    const groupedByBoundFor: Record<string, Schedule[]> = { }
    for (const schedule of line.schedules) {
      if (groupedByBoundFor[schedule.boundFor]) {
        groupedByBoundFor[schedule.boundFor]!.push(schedule)
      } else {
        groupedByBoundFor[schedule.boundFor] = [schedule]
      }
    }

    timetable.push({
      name: line.name,
      colorCode: line.colorCode,
      lineCode: line.lineCode,
      timetable: Object.entries(groupedByBoundFor).map(([boundFor, schedules]) => ({ boundFor, schedules }))
    })
  }

  return c.json(Ok(timetable), 200)
})

export default app
