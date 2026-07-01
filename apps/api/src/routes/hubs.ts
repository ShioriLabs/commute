import { Hono } from 'hono'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { KVRepository } from 'db/repositories/kv'
import { NotFound, Ok } from 'utils/response'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)
  const hubRepository = new HubRepository(c.env.DB)

  const kvKey = `hubs:${c.env.API_VERSION}`

  const cachedHubs = await kvRepository.get(kvKey)
  if (cachedHubs) {
    return c.json(
      Ok(cachedHubs),
      200
    )
  }

  const hubs = await hubRepository.getAll()

  if (hubs.length > 0) {
    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, hubs)
    )
  }

  return c.json(
    Ok(
      hubs
    ),
    200
  )
})

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')

  const kvRepository = new KVRepository(c.env.KV)
  const hubRepository = new HubRepository(c.env.DB)

  const kvKey = `hubs:${slug}:${c.env.API_VERSION}`

  const cachedHub = await kvRepository.get(kvKey)
  if (cachedHub) {
    return c.json(
      Ok(cachedHub),
      200
    )
  }

  const hub = await hubRepository.getBySlug(slug)
  if (!hub) {
    return c.json(NotFound(`Unknown Hub: ${slug}`), 404)
  }

  c.executionCtx.waitUntil(
    kvRepository.set(kvKey, hub)
  )

  return c.json(
    Ok(
      hub
    ),
    200
  )
})

export default app
