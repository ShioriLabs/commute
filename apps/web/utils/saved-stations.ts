const STORAGE_KEY = 'saved-stations'

/*
 * One ordered list holds both things a rider can pin: a station, stored as its
 * bare id string, and a Dari→Ke pair, stored as an object. Mixed rather than two
 * keys because home renders them as one list in the rider's own order, and a
 * pair is directional, so the morning and evening trips are two entries.
 *
 * The key keeps its old name on purpose. Every list written before pairs
 * existed is already a valid list of this shape, so there is no migration, and
 * renaming it would need a read-the-old-key shim that could never be deleted.
 */
export interface SavedRoute {
  type: 'ROUTE'
  from: string
  to: string
}

export type SavedEntry = string | SavedRoute

export function isSavedRoute(entry: SavedEntry): entry is SavedRoute {
  return typeof entry !== 'string'
}

// Identity for React keys and equality: a station is its id, a pair its ends.
export function entryKey(entry: SavedEntry): string {
  return isSavedRoute(entry) ? `ROUTE:${entry.from}>${entry.to}` : entry
}

function isEntry(value: unknown): value is SavedEntry {
  if (typeof value === 'string') return true
  if (typeof value !== 'object' || value === null) return false
  const route = value as Partial<SavedRoute>
  return route.type === 'ROUTE' && typeof route.from === 'string' && typeof route.to === 'string'
}

// Unreadable or non-array values read as empty; unknown entries are dropped
// rather than failing the whole list.
export function readSavedEntries(): SavedEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

export function writeSavedEntries(entries: readonly SavedEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

// The station ids alone, for the station page's save button and the search
// sheet's stars.
export function readSavedStations(): string[] {
  return readSavedEntries().filter((entry): entry is string => !isSavedRoute(entry))
}

// Returns the station ids as written, so callers can set state from it
// directly. Toggles against the full list: rewriting from the station-only view
// would silently drop every saved pair.
export function toggleSavedStation(id: string): string[] {
  const saved = readSavedEntries()
  const next = saved.includes(id) ? saved.filter(entry => entry !== id) : [...saved, id]
  writeSavedEntries(next)
  return next.filter((entry): entry is string => !isSavedRoute(entry))
}

export function isRouteSaved(from: string, to: string): boolean {
  const key = entryKey({ type: 'ROUTE', from, to })
  return readSavedEntries().some(entry => entryKey(entry) === key)
}

// Returns whether the pair is saved afterwards.
export function toggleSavedRoute(from: string, to: string): boolean {
  const route: SavedRoute = { type: 'ROUTE', from, to }
  const key = entryKey(route)
  const saved = readSavedEntries()
  const wasSaved = saved.some(entry => entryKey(entry) === key)
  writeSavedEntries(wasSaved ? saved.filter(entry => entryKey(entry) !== key) : [...saved, route])
  return !wasSaved
}

// A copy of `list` with the entry at `from` moved to `to`. Out-of-range targets
// return the list unchanged, so the ends never wrap around.
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list]
  const next = [...list]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry as T)
  return next
}
