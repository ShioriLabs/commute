import { Hono } from 'hono'
import { syncStations, syncTimetable } from './sync'
import { StationRepository } from 'db/repositories/stations'
import { NotFound, Ok } from 'utils/response'
import { OPERATORS } from '@commute/constants'
import { LineGroupedTimetable, Schedule, ScheduleWithLineInfo } from 'db/schemas/schedules'
import { getLineInfoByLineCode } from './formatters'
import { Line } from 'models/line'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/stations', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${OPERATORS.KCI.code}_${c.env.API_VERSION}`

  if (!c.req.query('sync')) {
    const cachedStations = await kvRepository.get(kvKey)
    if (cachedStations) {
      return c.json(
        Ok(cachedStations),
        200
      )
    }
  }

  let stations = await stationRepository.getAllByOperator('KCI')
  if (stations.length === 0 || c.req.query('sync') === 'true') {
    await syncStations(c.env.DB, c.env.KCI_API_TOKEN)
    stations = await stationRepository.getAllByOperator('KCI')
  }

  if (stations.length > 0) {
    await kvRepository.set(kvKey, stations)
  }

  return c.json(
    Ok(
      stations
    ),
    200
  )
})

app.get('/stations/:code', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const stationCode = c.req.param('code')
  const kvKey = `station_${OPERATORS.KCI.code}_${stationCode}_${c.env.API_VERSION}`
  const cachedStation = await kvRepository.get(kvKey)
  if (cachedStation) {
    return c.json(
      Ok(cachedStation),
      200
    )
  }

  const station = await stationRepository.getById(`${OPERATORS.KCI.code}-${stationCode}`)
  if (!station) return c.json(NotFound(), 404)

  await kvRepository.set(kvKey, station)

  return c.json(
    Ok(
      station
    ),
    200
  )
})

app.get('/stations/:code/timetable', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const stationCode = c.req.param('code')
  const kvKey = `station_timetable_${OPERATORS.KCI.code}_${stationCode}_${c.env.API_VERSION}`
  const station = await stationRepository.checkIfExists(`${OPERATORS.KCI.code}-${stationCode}`, OPERATORS.KCI.code)
  if (!station.exists || station.station === null) return c.json(NotFound(), 404)

  let timetable: (Schedule | ScheduleWithLineInfo)[] = []
  if (station.station!.timetableSynced === 0 || c.req.query('sync') === 'true') {
    await syncTimetable(c.env.DB, stationCode, c.env.KCI_API_TOKEN)
    timetable = await stationRepository.getTimetableFromStationId(station.station!.id)
    if (timetable.length > 0) {
      await kvRepository.set(kvKey, timetable)
    }
  } else {
    const kvTimetable = await kvRepository.get(kvKey)
    if (kvTimetable) {
      timetable = kvTimetable as (Schedule | ScheduleWithLineInfo)[]
    }
  }

  timetable = timetable.map(schedule => ({
    ...schedule,
    line: getLineInfoByLineCode(schedule.lineCode)
  }))
  return c.json(Ok(timetable), 200)
})

app.get('/stations/:code/timetable/grouped', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const stationCode = c.req.param('code')
  const kvKey = `station_timetable_grouped_${OPERATORS.KCI.code}_${stationCode}_${c.env.API_VERSION}`
  const station = await stationRepository.checkIfExists(`${OPERATORS.KCI.code}-${stationCode}`, OPERATORS.KCI.code)
  if (!station.exists || station.station === null) return c.json(NotFound(), 404)

  const cachedGroupedTimetable = await kvRepository.get(kvKey)
  if (cachedGroupedTimetable && c.req.query('sync') !== 'true') {
    return c.json(
      Ok(cachedGroupedTimetable),
      200
    )
  }

  const timetable: LineGroupedTimetable = []
  if (station.station!.timetableSynced === 0 || c.req.query('sync') === 'true') {
    await syncTimetable(c.env.DB, stationCode, c.env.KCI_API_TOKEN)
  }

  const schedules = await stationRepository.getTimetableFromStationId(station.station!.id)
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
      timetable: Object.entries(groupedByBoundFor).map(([boundFor, schedules]) => ({ boundFor, schedules })).sort((a, b) => a.boundFor.localeCompare(b.boundFor))
    })
  }

  await kvRepository.set(kvKey, timetable)

  return c.json(Ok(timetable), 200)
})

export default app
