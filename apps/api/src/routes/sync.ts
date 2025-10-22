import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { Internal, NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'
import { syncStations as syncStationsKCI, syncTimetable as syncTimetableKCI } from 'operators/kci/sync'
import { syncStations as syncStationsMRTJ, syncTimetable as syncTimetableMRTJ } from 'operators/mrtj/sync'
import { syncStations as syncStationsLRTJ, syncTimetable as syncTimetableLRTJ } from 'operators/lrtj/sync'

const app = new Hono<{ Bindings: Bindings }>()

app.post('/:operator', async (c) => {
  const operatorCode = c.req.param('operator')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const allKVKey = `stations__${c.env.API_VERSION}`
  const kvKey = `stations_${operator.code}_${c.env.API_VERSION}`
  try {
    const kvRepository = new KVRepository(c.env.KV)

    switch (operator.code) {
      case 'KCI':
        await syncStationsKCI(c.env.DB, c.env.KCI_API_TOKEN)
        break
      case 'MRTJ':
        await syncStationsMRTJ(c.env.DB)
        break
      case 'LRTJ':
        await syncStationsLRTJ(c.env.DB)
        break
    }

    await kvRepository.del(allKVKey)
    await kvRepository.del(kvKey)

    return c.json(
      Ok(
        {
          success: true,
          message: `Stations in Operator ${operator.code} have been synced successfully.`
        }
      ),
      200
    )
  } catch {
    return c.json(
      Internal('SYNC_FAILED', 'Failed to sync stations. Please try again later.'),
      500
    )
  }
})

app.post('/:operator/:stationCode/timetable', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  try {
    const kvRepository = new KVRepository(c.env.KV)
    const stationRepository = new StationRepository(c.env.DB)

    const stationKVKey = `stations_${operator.code}_${stationCode}_${c.env.API_VERSION}`
    const timetableKVKey = `stations_${operator.code}_${stationCode}_timetable_${c.env.API_VERSION}`
    const groupedTimetableKVKey = `stations_${operator.code}_${stationCode}_timetable_grouped_${c.env.API_VERSION}`

    const checkStationResult = await stationRepository.checkIfExists(`${operator.code}-${stationCode}`)
    if (!checkStationResult.exists || checkStationResult.station === null) return c.json(NotFound(`Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)

    switch (operator.code) {
      case 'KCI':
        await syncTimetableKCI(c.env.DB, stationCode, c.env.KCI_API_TOKEN)
        break
      case 'MRTJ':
        await syncTimetableMRTJ(c.env.DB, stationCode)
        break
      case 'LRTJ':
        await syncTimetableLRTJ(c.env.DB, stationCode)
        break
    }

    await kvRepository.del(stationKVKey)
    await kvRepository.del(timetableKVKey)
    await kvRepository.del(groupedTimetableKVKey)

    return c.json(
      Ok(
        {
          success: true,
          message: `Timetable for Station ${stationCode} in Operator ${operator.code} have been synced successfully.`
        }
      ),
      200
    )
  } catch {
    return c.json(
      Internal('SYNC_FAILED', 'Failed to sync timetable. Please try again later.'),
      500
    )
  }
})

export default app
