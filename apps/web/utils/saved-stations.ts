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
