import { Hono } from 'hono'
import { NotFound, Ok } from 'utils/response'
import { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { getOperatorByCode } from 'utils/operator'
import { searchablesKVKey } from './internal'

const app = new Hono<{ Bindings: Bindings }>()

app.delete('/stations/bust', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `stations:${c.env.API_VERSION}`
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

  const kvKey = `stations:${operator.code}:${c.env.API_VERSION}`
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

  const kvKey = `stations:${operator.code}-${stationCode}:${c.env.API_VERSION}`

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

  const kvKey = `timetable:${operator.code}-${stationCode}:${c.env.API_VERSION}`

  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/lines/:operator/:lineCode/bust', async (c) => {
  const operatorCode = c.req.param('operator')
  const lineCode = c.req.param('lineCode')
  const operator = getOperatorByCode(operatorCode)
  if (!operator) {
    return c.json(NotFound(`Unknown Operator Code: ${operatorCode}`), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `lines:${operator.code}-${lineCode}:${c.env.API_VERSION}`
  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/fares/:from/:to/bust', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `fares:${c.req.param('from')}:${c.req.param('to')}:${c.env.API_VERSION}`
  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/hubs/bust', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `hubs:${c.env.API_VERSION}`
  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

app.delete('/hubs/:slug/bust', async (c) => {
  const slug = c.req.param('slug')

  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = `hubs:${slug}:${c.env.API_VERSION}`
  await kvRepository.del(kvKey)

  return c.json(
    Ok(
      { message: `Cache ${kvKey} has been cleared.` }
    ),
    200
  )
})

/*
 * Registered before the /:operator/… patterns below: Hono matches in
 * registration order, and "_internal" would otherwise be read as an operator
 * code.
 */
app.delete('/_internal/searchables/bust', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = searchablesKVKey(c.env.API_VERSION)
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

  /*
   * The grouped timetable is cached per wire format — `?compact=1` and the full
   * shape have separate entries — so both must go. This previously deleted a key
   * with no format segment, which matched neither and silently busted nothing.
   */
  const kvKeys = (['compact', 'full'] as const).map(
    format => `timetable:${operator.code}-${stationCode}:grouped:${format}:${c.env.API_VERSION}`
  )

  await Promise.all(kvKeys.map(key => kvRepository.del(key)))

  return c.json(
    Ok(
      { message: `Caches ${kvKeys.join(', ')} have been cleared.` }
    ),
    200
  )
})

export default app
