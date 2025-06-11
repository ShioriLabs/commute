import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'
import { Line } from 'models/line'
import { LineGroupedTimetable, Schedule } from 'db/schemas/schedules'
import { getLineByOperator } from 'utils/line'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${c.env.API_VERSION}`

  const cachedStations = await kvRepository.get(kvKey)
  if (cachedStations) {
    return c.json(
      Ok(cachedStations),
      200
    )
  }

  const stations = await stationRepository.getAll()

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

app.get('/:operator', async (c) => {
  const operatorCode = c.req.param('operator')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${operator.code}_${c.env.API_VERSION}`

  const cachedStations = await kvRepository.get(kvKey)
  if (cachedStations) {
    return c.json(
      Ok(cachedStations),
      200
    )
  }

  const stations = await stationRepository.getAllByOperator(operator.code)

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

app.get('/:operator/:stationCode', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${operator.code}_${stationCode}_${c.env.API_VERSION}`

  const cachedStations = await kvRepository.get(kvKey)
  if (cachedStations) {
    return c.json(
      Ok(cachedStations),
      200
    )
  }

  const station = await stationRepository.getById(`${operator.code}-${stationCode}`)

  if (!station) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

  await kvRepository.set(kvKey, station)

  return c.json(
    Ok(
      station
    ),
    200
  )
})

app.get('/:operator/:stationCode/timetable', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${operator.code}_${stationCode}_timetable_${c.env.API_VERSION}`

  const cachedTimetable = await kvRepository.get(kvKey)
  if (cachedTimetable) {
    return c.json(
      Ok(cachedTimetable),
      200
    )
  }

  const checkStationResult = await stationRepository.checkIfExists(`${operator.code}-${stationCode}`)
  if (!checkStationResult.exists || checkStationResult.station === null) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

  if (checkStationResult.station!.timetableSynced === 0) {
    return c.json(
      NotFound(`Timetable for Station ${stationCode} in Operator ${operator.code} is not available yet. Please try again later.`),
      404
    )
  }

  const timetable = await stationRepository.getTimetableFromStationId(checkStationResult.station!.id)
  if (timetable.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  await kvRepository.set(kvKey, timetable)

  return c.json(
    Ok(
      timetable
    ),
    200
  )
})

app.get('/:operator/:stationCode/timetable/grouped', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${operator.code}_${stationCode}_timetable_grouped_${c.env.API_VERSION}`

  const cachedTimetable = await kvRepository.get(kvKey)
  if (cachedTimetable) {
    return c.json(
      Ok(cachedTimetable),
      200
    )
  }

  const checkStationResult = await stationRepository.checkIfExists(`${operator.code}-${stationCode}`)
  if (!checkStationResult.exists || checkStationResult.station === null) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

  if (checkStationResult.station!.timetableSynced === 0) {
    return c.json(
      NotFound(`Timetable for Station ${stationCode} in Operator ${operator.code} is not available yet. Please try again later.`),
      404
    )
  }

  const timetable: LineGroupedTimetable = []
  const schedules = await stationRepository.getTimetableFromStationId(checkStationResult.station!.id)
  if (schedules.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  const groupedByLineSchedules: Record<string, Line & { schedules: Schedule[] }> = { }

  for (const schedule of schedules) {
    const line = getLineByOperator(operator.code, schedule.lineCode)
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

  return c.json(
    Ok(timetable),
    200
  )
})

export default app
