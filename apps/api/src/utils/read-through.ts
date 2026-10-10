import type { Context } from 'hono'
import type { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { Ok } from 'utils/response'

/*
 * KV read-through for a JSON endpoint: serve the cached value if there is one,
 * otherwise run `load` and cache what it returns off the request path.
 *
 * `load` may return a Response (a 404, say) to short-circuit; that is sent
 * as-is and never cached. `shouldCache` lets an empty result skip the write so
 * a transient miss isn't pinned for the TTL.
 */
export async function readThrough<T>(
  c: Context<{ Bindings: Bindings }>,
  key: string,
  load: () => Promise<T>,
  shouldCache: (value: Exclude<T, Response>) => boolean = () => true
): Promise<Response> {
  const kv = new KVRepository(c.env.KV)

  const cached = await kv.get(key)
  if (cached) return c.json(Ok(cached), 200)

  const loaded = await load()
  if (loaded instanceof Response) return loaded

  const value = loaded as Exclude<T, Response>
  if (shouldCache(value)) {
    c.executionCtx.waitUntil(kv.set(key, value))
  }

  return c.json(Ok(loaded), 200)
}
