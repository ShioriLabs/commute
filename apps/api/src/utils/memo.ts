/*
 * Get-or-compute against a per-isolate Map. `has` rather than a truthiness
 * check so a legitimately empty or falsy computed value is still cached.
 * Synchronous only: an async loader needs its own in-flight handling (see
 * places.ts getPlaceIndex), which a plain Map cannot give.
 */
export function memoize<K, V>(cache: Map<K, V>, key: K, compute: () => V): V {
  if (cache.has(key)) return cache.get(key) as V

  const value = compute()
  cache.set(key, value)
  return value
}
