import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'
import { Line } from 'models/line'
import { CompactLineGroupedTimetable, LineGroupedTimetable, Schedule } from 'db/schemas/schedules'
import { getLineByOperator } from 'utils/line'
import { OPERATORS } from '@commute/constants'
import { mapSchedule } from 'utils/schedules'

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

const CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES = new Set([
  'CKR',
  'TLM',
  'CIT',
  'TB',
  'BKST',
  'BKS',
  'KRI',
  'CUK',
  'KLDB',
  'BUA',
  'KLD',
  'JNG'
])

app.get('/:operator/:stationCode/timetable/grouped', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const compactMode = c.req.query('compact') === '1'
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations_${operator.code}_${stationCode}_timetable_grouped_${compactMode ? 'compact' : 'full'}_${c.env.API_VERSION}`

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
  const schedules = await stationRepository.getTimetableFromStationId(checkStationResult.station!.id)
  if (schedules.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  const isBekasiInterliningStation = operator.code === OPERATORS.KCI.code && CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES.has(stationCode)
  const lineGroups: Map<string, { line: Line, boundForGroups: Map<string, Schedule[]> }> = new Map()

  for (const schedule of schedules) {
    const line = getLineByOperator(operator.code, schedule.lineCode)
    if (!line) continue

    let lineGroup = lineGroups.get(line.lineCode)
    if (!lineGroup) {
      lineGroup = {
        line,
        boundForGroups: new Map()
      }
      lineGroups.set(line.lineCode, lineGroup)
    }

    let via: string | null = null

    if (isBekasiInterliningStation && schedule.boundFor === 'Kampung Bandan') {
      const trainNo = schedule.tripNumber ?? ''
      if (trainNo !== '') {
        if (trainNo.startsWith('6')) via = 'Pasar Senen'
        else via = 'Manggarai'
      }
    }

    const boundForKey = via ? `${schedule.boundFor}:${via}` : schedule.boundFor
    const boundForSchedules = lineGroup.boundForGroups.get(boundForKey)
    if (boundForSchedules) {
      boundForSchedules.push(schedule)
    } else {
      lineGroup.boundForGroups.set(boundForKey, [schedule])
    }
  }

  const timetable = compactMode ? ([] as CompactLineGroupedTimetable) : ([] as LineGroupedTimetable)
  for (const { line, boundForGroups } of lineGroups.values()) {
    const timetableEntries = Array.from(boundForGroups.entries()).map(([key, schedules]) => {
      const [boundFor, via] = key.split(':')

      return {
        boundFor: boundFor!,
        via: via || null,
        schedules: mapSchedule(schedules, compactMode)
      }
    }).sort((a, b) => a.boundFor.localeCompare(b.boundFor))

    timetable.push({
      name: line.name,
      colorCode: line.colorCode,
      lineCode: line.lineCode,
      timetable: timetableEntries
    })
  }

  await kvRepository.set(kvKey, timetable)

  return c.json(
    Ok(timetable),
    200
  )
})

export default app
