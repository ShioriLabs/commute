export function mapify<K, T>(items: T[], keyFn: (item: T) => K) {
  const map = new Map<K, T>()
  for (const item of items) {
    const key = keyFn(item)
    map.set(key, item)
  }

  return map
}
