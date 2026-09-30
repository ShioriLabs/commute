const STORAGE_KEY = 'saved-stations'

// One reader and one toggle for the station ids a rider has starred, shared by
// the station page's save button and the search sheet's stars so the two
// surfaces cannot disagree about the stored shape.
export function readSavedStations(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

// Returns the list as written, so callers can set state from it directly.
export function toggleSavedStation(id: string): string[] {
  const saved = readSavedStations()
  const next = saved.includes(id) ? saved.filter(item => item !== id) : [...saved, id]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
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
