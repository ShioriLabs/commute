import { DATA_VERSION_KV_KEY } from '@commute/constants'

/*
 * The runtime half of the cache version. API_VERSION changes with a deploy;
 * this changes with an admin publish (apps/admin), so data edits reach KV-cached
 * responses without one.
 *
 * Memoised per isolate for a minute: every cached route needs it, and a KV read
 * per request would double KV reads. The cost is that isolates can disagree for
 * up to a minute after a publish, which only delays the edit.
 */
const TTL_MS = 60_000

let memo: { value: string, at: number } | null = null

export async function dataVersion(kv: KVNamespace | undefined, now = Date.now()): Promise<string> {
  if (memo && now - memo.at < TTL_MS) return memo.value

  try {
    const raw: unknown = kv ? await kv.get(DATA_VERSION_KV_KEY) : null
    const value = typeof raw === 'string' && raw !== '' ? raw : '0'
    memo = { value, at: now }
    return value
  } catch {
    // Falling back to '0' would rebuild the router and miss every KV key for a
    // transient blip, so keep serving the last version and retry next call.
    return memo?.value ?? '0'
  }
}

export async function cacheVersion(env: { API_VERSION: string, KV?: KVNamespace }): Promise<string> {
  return `${env.API_VERSION}.${await dataVersion(env.KV)}`
}

export function resetDataVersionMemo() {
  memo = null
}
