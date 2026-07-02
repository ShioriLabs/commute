import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { KVRepository } from 'db/repositories/kv'
import { NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { getOperatorByCode } from 'utils/operator'
import { getLineByOperator } from 'utils/line'
import { buildLineDetail, collectStationIds, findTopology } from 'utils/topology'
import { mapify } from 'utils/mapify'
import { LineDetail } from 'models/line'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/:operator/:lineCode', async (c) => {
  const operatorCode = c.req.param('operator')
  const lineCode = c.req.param('lineCode')

  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const line = getLineByOperator(operator.code, lineCode)
  if (!line) {
    return c.json(NotFound(`Unknown Line Code: ${operator.code}:${lineCode}`), 404)
  }

  const topology = findTopology(operator.code, lineCode)
  if (!topology) {
    return c.json(NotFound('NO_TOPOLOGY', `No topology data for line ${operator.code}:${lineCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const kvKey = `lines:${operator.code}-${lineCode}:${c.env.API_VERSION}`

  const cachedDetail = await kvRepository.get<LineDetail>(kvKey)
  if (cachedDetail) {
    return c.json(
      Ok(cachedDetail),
      200
    )
  }

  const stationRepository = new StationRepository(c.env.DB)
  const stations = await stationRepository.getByIds(collectStationIds(topology))
  const stationsById = mapify(stations, station => station.id)

  const detail = buildLineDetail(topology, line, operator, stationsById)

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, detail)
  )

  return c.json(
    Ok(detail),
    200
  )
})

export default app
