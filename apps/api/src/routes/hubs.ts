import { Hono } from 'hono'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { KVRepository } from 'db/repositories/kv'
import { NotFound, Ok } from 'utils/response'
import * as v from 'valibot'
import { doc, pathParam } from 'schemas/describe'
import { HubSchema } from '@commute/schemas'

const app = new Hono<{ Bindings: Bindings }>()

/*
 * `score` is our search ranking, not a fact about the hub: the searchables index
 * reads it off the repository, consumers never see it.
 */
type RepositoryHub = Awaited<ReturnType<HubRepository['getBySlug']>>
function toPublicHub(hub: NonNullable<RepositoryHub>) {
  return {
    id: hub.id,
    slug: hub.slug,
    name: hub.name,
    kind: hub.kind,
    heroImage: hub.heroImage,
    lines: hub.lines,
    members: hub.members
  }
}

app.get(
  '/',
  doc({
    summary: 'Daftar pumpunan moda',
    description: 'Kompleks interchange yang menggabungkan beberapa stasiun dalam satu nama. Dukuh Atas, misalnya, mencakup Sudirman, BNI City, plus stasiun MRT dan LRT. Diurutkan dari yang paling ramai.',
    tag: 'Pumpunan Moda',
    data: v.array(HubSchema)
  }),
  async (c) => {
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

    const hubs = (await hubRepository.getAll()).map(toPublicHub)

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
  }
)

app.get(
  '/:slug',
  doc({
    summary: 'Detail pumpunan moda',
    description: 'Satu kompleks interchange beserta stasiun anggotanya.',
    tag: 'Pumpunan Moda',
    data: HubSchema,
    parameters: [pathParam('slug', 'Kunci URL pumpunan moda, seperti yang dikembalikan `/hubs`.', 'dukuh-atas')],
    errors: { 404: 'Nggak ada pumpunan moda dengan slug itu.' }
  }),
  async (c) => {
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

    const found = await hubRepository.getBySlug(slug)
    if (!found) {
      return c.json(NotFound(`Unknown Hub: ${slug}`), 404)
    }
    const hub = toPublicHub(found)

    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, hub)
    )

    return c.json(
      Ok(
        hub
      ),
      200
    )
  }
)

export default app
