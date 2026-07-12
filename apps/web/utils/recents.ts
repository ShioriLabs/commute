const STORAGE_KEY = 'recently-searched'
const MAX_ENTRIES = 3

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
