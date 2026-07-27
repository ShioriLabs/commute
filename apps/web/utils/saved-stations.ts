export const SAVED_STATIONS_KEY = 'saved-stations'

/**
 * Saved station IDs, in display order.
 *
 * Self-heals: a missing key, invalid JSON, or a non-array value all reset the
 * store to `[]` rather than throwing, because a corrupt value would otherwise
 * break every surface that reads it. Array order is the display order — there
 * is no separate sort.
 */
export function readSavedStations(): string[] {
  const raw = localStorage.getItem(SAVED_STATIONS_KEY)
  if (!raw) {
    localStorage.setItem(SAVED_STATIONS_KEY, '[]')
    return []
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!(parsed instanceof Array)) {
      localStorage.setItem(SAVED_STATIONS_KEY, '[]')
      return []
    }
    return parsed as string[]
  } catch (e) {
    // Only a parse failure is worth healing; anything else (a storage quota or
    // security error) should surface rather than silently wipe saved stations.
    if (e instanceof SyntaxError) {
      localStorage.setItem(SAVED_STATIONS_KEY, '[]')
      return []
    }
    throw e
  }
}

export function writeSavedStations(ids: string[]): void {
  localStorage.setItem(SAVED_STATIONS_KEY, JSON.stringify(ids))
}

/**
 * Split a saved station ID into its operator and station code.
 *
 * Splits on the *first* hyphen only: operator codes never contain one but
 * station codes do (`TJ-H00037C-b`), so a naive `split('-')` loses part of the
 * code.
 */
export function parseStationId(id: string): { operator: string, code: string } | null {
  const dash = id.indexOf('-')
  if (dash <= 0 || dash === id.length - 1) return null
  return { operator: id.slice(0, dash), code: id.slice(dash + 1) }
}
