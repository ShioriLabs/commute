export function mapify<K, T>(items: T[], keyFn: (item: T) => K): Map<K, T> {
  return new Map(items.map(item => [keyFn(item), item]))
}
