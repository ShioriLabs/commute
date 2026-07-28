import { Hono } from 'hono'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { Ok } from 'utils/response'
import { buildSearchableIndex } from 'utils/searchables'

/*
 * Endpoints shaped for commute.shiorilabs.id specifically.
 *
 * `_internal` is a deliberate label, not access control: everything here is as
 * reachable as the rest of the API. It means "this response is shaped around one
 * consumer's screen and carries no compatibility promise" — it may change shape
 * whenever the web app's needs change. Anything you'd want to build against
 * belongs on a public route instead.
 */
const app = new Hono<{ Bindings: Bindings }>()

/** KV key for the prebuilt search index. Shared with cache.ts and sync.ts. */
export const searchablesKVKey = (apiVersion: string) => `searchables:${apiVersion}`

/*
 * The search sheet's entire index in one response: stations (directional halte
 * pairs pre-folded), hubs, and rail lines, already in the client's `Searchable`
 * shape. Replaces a /stations + /hubs + /operators fan-out that shipped ~257 KB
 * of mostly-unused station columns and re-derived this index on every mount.
 */
app.get('/searchables', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = searchablesKVKey(c.env.API_VERSION)

  const cachedIndex = await kvRepository.get(kvKey)
  if (cachedIndex) {
    return c.json(
      Ok(cachedIndex),
      200
    )
  }

  const stationRepository = new StationRepository(c.env.DB)
  const hubRepository = new HubRepository(c.env.DB)

  const [stations, hubs] = await Promise.all([
    stationRepository.getAll(),
    hubRepository.getAll()
  ])

  const index = buildSearchableIndex(stations, hubs)

  if (index.items.length > 0) {
    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, index)
    )
  }

  return c.json(
    Ok(index),
    200
  )
})

export default app
