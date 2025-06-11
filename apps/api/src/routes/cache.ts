import { Hono } from 'hono'
import { NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'

const app = new Hono<{ Bindings: Bindings }>()

app.delete('/stations/bust', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `stations_${c.env.API_VERSION}`
  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/stations/:operator/bust', async (c) => {
  const operatorCode = c.req.param('operator')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `stations_${operator.code}_${c.env.API_VERSION}`
  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/stations/:operator/:stationCode/bust', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `stations_${operator.code}_${stationCode}_${c.env.API_VERSION}`

  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/stations/:operator/:stationCode/timetable/bust', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `stations_${operator.code}_${stationCode}_timetable_${c.env.API_VERSION}`

  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/:operator/:stationCode/timetable/grouped', async (c) => {
  const operatorCode = c.req.param('operator')
  const stationCode = c.req.param('stationCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `stations_${operator.code}_${stationCode}_timetable_grouped_${c.env.API_VERSION}`

  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

export default app
