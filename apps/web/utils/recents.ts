const STORAGE_KEY = 'recently-searched'
const MAX_ENTRIES = 8

export interface RecentEntry {
  type: 'STATION' | 'HUB'
  id: string // station.id, or hub.slug for hubs
}

// Legacy entries are plain station-ID strings; read them as stations. No
// migration write — the next recordRecent rewrites in the new shape.
export function readRecents(): RecentEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY) ?? '[]'
  try {
    const parsed = JSON.parse(raw) as Array<string | RecentEntry>
    return parsed
      .map(entry => typeof entry === 'string' ? { type: 'STATION' as const, id: entry } : entry)
      .filter(entry => entry && typeof entry.id === 'string')
  } catch {
    return []
  }
}

export function recordRecent(entry: RecentEntry): void {
  const recents = [
    entry,
    ...readRecents().filter(item => !(item.type === entry.type && item.id === entry.id))
  ].slice(0, MAX_ENTRIES)

  localStorage.setItem(STORAGE_KEY, JSON.stringify(recents))
}

export function clearRecents(): void {
  localStorage.setItem(STORAGE_KEY, '[]')
}

/*
 * Pairs checked on a fare surface, kept apart from the station list above so a
 * week of fare lookups cannot push a rider's stations out of it. Directional,
 * like saved pairs: A→B and B→A are two entries.
 */
const ROUTES_STORAGE_KEY = 'recent-routes'
const MAX_ROUTE_ENTRIES = 5

export interface RecentRoute {
  from: string
  to: string
}

export function readRecentRoutes(): RecentRoute[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROUTES_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is RecentRoute =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as RecentRoute).from === 'string'
      && typeof (entry as RecentRoute).to === 'string')
  } catch {
    return []
  }
}

export function recordRecentRoute(route: RecentRoute): void {
  try {
    const routes = [
      { from: route.from, to: route.to },
      ...readRecentRoutes().filter(item => !(item.from === route.from && item.to === route.to))
    ].slice(0, MAX_ROUTE_ENTRIES)
    localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(routes))
  } catch {
    // Storage unwritable; a recent is a convenience, not worth surfacing.
  }
}

export function clearRecentRoutes(): void {
  localStorage.setItem(ROUTES_STORAGE_KEY, '[]')
}
