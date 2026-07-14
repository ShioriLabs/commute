import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { Internal, NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'
import { Line } from 'models/line'
import { CompactLineGroupedTimetable, GroupingSchedule, LineGroupedTimetable, Schedule } from 'db/schemas/schedules'
import { getLineByOperator } from 'utils/line'
import { CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES, OPERATORS, Operator, PLATFORM_CODES } from '@commute/constants'
import { mapSchedule } from 'utils/schedules'
import { findTopology } from 'utils/topology'
import {
  BoundForEntry,
  buildLineMembershipCount,
  buildStationNameIndex,
  groupDirections,
  syntheticGroup,
  StationNameIndex
} from 'utils/directions'

const app = new Hono<{ Bindings: Bindings }>()

// Direction derivation inputs are stable per isolate (fares.ts cachedGraph
// pattern): membership counts are pure TOPOLOGY, the name index needs one D1
// query per operator per isolate.
const membershipCountCache = new Map<Operator, Map<string, number>>()
const nameIndexCache = new Map<Operator, StationNameIndex>()

function getMembershipCount(operator: Operator) {
  let counts = membershipCountCache.get(operator)
  if (!counts) {
    counts = buildLineMembershipCount(operator)
    membershipCountCache.set(operator, counts)
  }
  return counts
}

async function getNameIndex(operator: Operator, stationRepository: StationRepository) {
  let index = nameIndexCache.get(operator)
  if (!index) {
    index = buildStationNameIndex(await stationRepository.getNameIndexRowsByOperator(operator))
    nameIndexCache.set(operator, index)
  }
  return index
}

app.get('/', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `stations:${c.env.API_VERSION}`

  const cachedStations = await kvRepository.get(kvKey)
  if (cachedStations) {
    return c.json(
      Ok(cachedStations),
      200
    )
  }

  const stations = await stationRepository.getAll()

  if (stations.length > 0) {
    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, stations)
    )
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

  const kvKey = `stations:${operator.code}:${c.env.API_VERSION}`

  const cachedStations = await kvRepository.get(kvKey)
  if (cachedStations) {
    return c.json(
      Ok(cachedStations),
      200
    )
  }

  const stations = await stationRepository.getAllByOperator(operator.code)

  if (stations.length > 0) {
    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, stations)
    )
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

  const kvKey = `stations:${operator.code}-${stationCode}:${c.env.API_VERSION}`

  const cachedStations = await kvRepository.get(kvKey)
  if (cachedStations) {
    return c.json(
      Ok(cachedStations),
      200
    )
  }

  const station = await stationRepository.getById(`${operator.code}-${stationCode}`)

  if (!station) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, station)
  )

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

  const kvKey = `timetable:${operator.code}-${stationCode}:${c.env.API_VERSION}`

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

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, timetable)
  )

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
  const compactMode = c.req.query('compact') === '1'
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `timetable:${operator.code}-${stationCode}:grouped:${compactMode ? 'compact' : 'full'}:${c.env.API_VERSION}`

  const cachedTimetable = await kvRepository.get(kvKey)
  if (cachedTimetable) {
    return c.json(
      Ok(cachedTimetable),
      200
    )
  }

  // optimistic check, fails slower but faster happy path
  const stationID = `${operator.code}-${stationCode}`
  const [
    checkStationResult,
    schedules
  ] = await Promise.allSettled([
    stationRepository.checkIfExists(stationID),
    // Compact mode only needs the grouping/compact columns; full mode embeds
    // whole Schedule rows in the response, so keep selectAll there.
    compactMode
      ? stationRepository.getGroupingTimetableFromStationId(stationID)
      : stationRepository.getTimetableFromStationId(stationID)
  ])

  if (checkStationResult.status === 'rejected' || schedules.status === 'rejected') return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'))

  if (!checkStationResult.value.exists || checkStationResult.value.station === null) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

  if (checkStationResult.value.station.timetableSynced === 0) {
    return c.json(
      NotFound(`Timetable for Station ${stationCode} in Operator ${operator.code} is not available yet. Please try again later.`),
      404
    )
  }

  if (schedules.value.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  const isBekasiInterliningStation = operator.code === OPERATORS.KCI.code && CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES.has(stationCode)
  const lineGroups: Map<string, { line: Line, boundForGroups: Map<string, GroupingSchedule[]> }> = new Map()

  for (const schedule of schedules.value) {
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

  // Direction derivation is KCI-only (per-line topology walks). Other
  // operators keep one group per boundFor — same shape, unchanged rendering.
  const isKCI = operator.code === OPERATORS.KCI.code
  const nameIndex = isKCI ? await getNameIndex(operator.code, stationRepository) : null
  const membershipCount = isKCI ? getMembershipCount(operator.code) : new Map<string, number>()

  const timetable = compactMode ? ([] as CompactLineGroupedTimetable) : ([] as LineGroupedTimetable)
  for (const { line, boundForGroups } of lineGroups.values()) {
    const entries: BoundForEntry[] = Array.from(boundForGroups.entries()).map(([key, schedules]) => {
      const [boundFor, via] = key.split(':')
      return { boundFor: boundFor!, via: via || null, schedules }
    })

    const groups = isKCI
      ? groupDirections({
          operator: operator.code,
          lineCode: line.lineCode,
          stationCode,
          topology: findTopology(operator.code, line.lineCode),
          entries,
          nameIndex,
          lineMembershipCount: membershipCount
        })
      : entries.map(syntheticGroup)

    timetable.push({
      name: line.name,
      colorCode: line.colorCode,
      lineCode: line.lineCode,
      timetable: groups.map(group => ({
        key: group.key,
        label: group.label,
        platformCode: group.nextHopCode
          ? PLATFORM_CODES[`${stationID}:${line.lineCode}:${group.nextHopCode}`] ?? null
          : null,
        destinations: group.destinations.map(destination => ({
          boundFor: destination.boundFor,
          via: destination.via,
          schedules: compactMode
            ? mapSchedule(destination.schedules, true)
            : mapSchedule(destination.schedules as Schedule[], false)
        }))
      }))
    })
  }

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, timetable)
  )

  return c.json(
    Ok(timetable),
    200
  )
})

app.get('/:operator/:stationCode/timetable/:line', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const lineCode = c.req.param('line')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `timetable:${operator.code}-${stationCode}:${lineCode}:${c.env.API_VERSION}`

  const cachedTimetable = await kvRepository.get(kvKey)
  if (cachedTimetable) {
    return c.json(
      Ok(cachedTimetable),
      200
    )
  }

  const checkIfLineExists = await stationRepository.checkIfLineExists(`${operator.code}-${stationCode}`, lineCode)
  if (!checkIfLineExists.exists || checkIfLineExists.line === null) return c.json(NotFound(`Unknown Line Code ${lineCode} in Station ID ${operator.code}-${stationCode}`), 404)

  const timetable = await stationRepository.getTimetableFromStationId(checkIfLineExists.line!.stationId, checkIfLineExists.line!.lineCode)
  if (timetable.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, timetable)
  )

  return c.json(
    Ok(
      timetable
    ),
    200
  )
})

app.get('/:operator/:stationCode/transfers', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound('UNKNOWN_OPERATOR', `Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const stationRepository = new StationRepository(c.env.DB)

  const kvKey = `transfers:${operator.code}-${stationCode}:${c.env.API_VERSION}`

  const cachedTimetable = await kvRepository.get(kvKey)
  if (cachedTimetable) {
    return c.json(
      Ok(cachedTimetable),
      200
    )
  }

  // optimistic check, fails slower but faster happy path
  const stationID = `${operator.code}-${stationCode}`
  const [
    checkStationResult,
    transfers
  ] = await Promise.allSettled([
    stationRepository.checkIfExists(stationID),
    stationRepository.getTransfersFromStationId(stationID)
  ])

  if (checkStationResult.status === 'rejected' || transfers.status === 'rejected') return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'))

  if (!checkStationResult.value.exists || checkStationResult.value.station === null) return c.json(NotFound('UNKNOWN_STATION', `Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

  if (transfers.value.length === 0) {
    return c.json(
      Ok([]),
      200
    )
  }

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, transfers.value)
  )

  return c.json(
    Ok(transfers.value),
    200
  )
})

export default app
