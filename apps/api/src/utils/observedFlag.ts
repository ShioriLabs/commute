/*
 * Kill switch for the observed headways.
 *
 *   wrangler kv key put --binding KV config:observed-headways off --remote
 *   wrangler kv key delete --binding KV config:observed-headways --remote
 *
 * Anything other than the value `off` (including no key at all) leaves them on,
 * so a lost key fails towards the shipped behaviour rather than silently
 * reverting. Read with a 60 s edge cache, the same pattern as the upload flag in
 * routes/uploads.ts, so a flip reaches every colo within about a minute.
 *
 * Held per isolate, because the planner's headway map and the journey cache
 * scope are built synchronously. It is refreshed at the start of each request
 * by middleware/observed-flag.ts. The value is a single boolean that only ever
 * changes to the answer KV just gave, so interleaved requests cannot corrupt it;
 * the worst case is one request using the previous value, which is the same
 * staleness the edge cache already allows.
 */
export const OBSERVED_HEADWAYS_FLAG_KEY = 'config:observed-headways'
export const OBSERVED_FLAG_CACHE_TTL = 60

let enabled = true

export function observedHeadwaysEnabled(): boolean {
  return enabled
}

export async function refreshObservedHeadwaysFlag(kv: KVNamespace | undefined): Promise<void> {
  // No binding (local dev, tests): keep whatever was last set.
  if (!kv) return
  try {
    enabled = (await kv.get(OBSERVED_HEADWAYS_FLAG_KEY, { cacheTtl: OBSERVED_FLAG_CACHE_TTL })) !== 'off'
  } catch {
    // A KV hiccup must not flip planner behaviour; keep the last value.
  }
}

/** Test seam: set the held value directly. */
export function setObservedHeadwaysEnabled(value: boolean): void {
  enabled = value
}
