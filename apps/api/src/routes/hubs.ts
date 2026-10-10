import { Hono } from 'hono'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { NotFound } from 'utils/response'
import { readThrough } from 'utils/read-through'
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
    description: 'Beberapa stasiun yang dianggap satu tempat karena saling terhubung. Dukuh Atas, misalnya, mencakup Sudirman, BNI City, plus stasiun MRT dan LRT-nya. Diurutkan dari yang paling ramai.',
    tag: 'Pumpunan Moda',
    data: v.array(HubSchema)
  }),
  async (c) => {
    const hubRepository = new HubRepository(c.env.DB)

    return readThrough(
      c,
      `hubs:${c.env.API_VERSION}`,
      async () => (await hubRepository.getAll()).map(toPublicHub),
      hubs => hubs.length > 0
    )
  }
)

app.get(
  '/:slug',
  doc({
    summary: 'Detail pumpunan moda',
    description: 'Satu pumpunan moda lengkap dengan stasiun-stasiun di dalamnya.',
    tag: 'Pumpunan Moda',
    data: HubSchema,
    parameters: [pathParam('slug', 'Kunci URL pumpunan moda, bisa diambil dari `/hubs`.', 'dukuh-atas')],
    errors: { 404: 'Tidak ada pumpunan moda dengan slug tersebut.' }
  }),
  async (c) => {
    const slug = c.req.param('slug')

    const hubRepository = new HubRepository(c.env.DB)

    return readThrough(c, `hubs:${slug}:${c.env.API_VERSION}`, async () => {
      const found = await hubRepository.getBySlug(slug)
      if (!found) {
        return c.json(NotFound('UNKNOWN_HUB', `Unknown Hub: ${slug}`), 404)
      }
      return toPublicHub(found)
    })
  }
)

export default app
