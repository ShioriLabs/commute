import type { Line, OperatorCode, Searchable } from '@commute/schemas'

/*
 * A station as the fare picker needs it, derived from the prebuilt search index.
 *
 * The picker used to take a full `Station` from GET /stations. It never needed
 * one: after a pick, the fare flow reads only `id` and `name`, and the three
 * extra fields it did touch — `officialName`, `code`, `regionCode` — were not
 * data but *matching inputs*. `regionCode`/`searchable` filtered the list, which
 * the server now does; `officialName`/`code` were lowercased into per-keystroke
 * match targets, which the server now ships pre-lowercased in `keywords`.
 *
 * Deliberately NOT a `Station`. That type requires `amenities`, `latitude` and
 * `longitude`, which this index does not carry and the picker never reads —
 * synthesising them would make the type lie about what was fetched.
 */
export interface PickableStation {
  /** `OPERATOR-CODE`, the id the fare endpoint is keyed on. */
  id: string
  name: string
  operator: OperatorCode
  /** Lines serving the stop, already resolved against the index dictionary. */
  lines: Line[]
  /** Crowding, for ordering the no-query list. Absent means 0. */
  score?: number
  /**
   * The other boarding points folded into this entry, for the 15 directional
   * halte pairs. Absent for every ordinary station. Only used to resolve deep
   * links that name the folded-away side — see `resolveStationId`.
   */
  siblingIds?: string[]
  /**
   * Server-built, already lowercased: display name, the operator's own
   * spelling, and the station code — plus, for a folded directional pair, both
   * members' names and codes. Replaces the client-side index the picker used to
   * rebuild on every list change.
   */
  keywords: string[]
}

/**
 * The other half of a folded directional pair, when there is one.
 *
 * The index folds the 15 "Arah …" halte pairs into a single entry, because one
 * physical stop should be one search result. A fare is priced between specific
 * boarding points though, so `station-ids` carries every member (primary first)
 * and this reads the rest back out.
 */
export function foldedSiblingIds(item: Searchable<Line[]>): string[] {
  const all = item.data?.['station-ids']
  if (!all) return []
  return all.split(',').slice(1).filter(Boolean)
}

/**
 * Station entries only — the index also carries hubs and lines, and neither can
 * be an endpoint of a fare.
 */
export function toPickableStations(items: Searchable<Line[]>[]): PickableStation[] {
  const stations: PickableStation[] = []
  for (const item of items) {
    if (item.type !== 'STATION') continue
    const id = item.data?.['station-id']
    if (!id) continue
    const siblings = foldedSiblingIds(item)
    stations.push({
      id,
      name: item.title,
      // Station entries always carry an operator; the field is optional on the
      // schema only because hubs span several and omit it.
      operator: item.operator as OperatorCode,
      lines: item.body ?? [],
      ...(item.score !== undefined ? { score: item.score } : {}),
      ...(siblings.length > 0 ? { siblingIds: siblings } : {}),
      keywords: item.keywords
    })
  }
  return stations
}

/**
 * Display order for a station's already-resolved lines.
 *
 * `sortLineKeysForDisplay` works on operator-qualified keys, which is what the
 * picker used to hold; the index resolves `body` into `Line[]` before the
 * picker ever sees it. This keeps the same TJ rules — hidden codes dropped,
 * corridor order applied — by rebuilding the key for each line rather than
 * duplicating the comparison.
 */
export function sortLinesForDisplay(
  lines: Line[],
  operator: OperatorCode,
  sortKeys: (keys: readonly string[], operator?: string) => string[]
): Line[] {
  const byKey = new Map(lines.map(line => [`${operator}:${line.lineCode}`, line]))
  return sortKeys([...byKey.keys()], operator)
    .map(key => byKey.get(key))
    .filter((line): line is Line => line !== undefined)
}

/**
 * Find the entry a station id refers to, including one folded behind a pair's
 * primary.
 *
 * A shared `/fare?from=&to=` link, or an OG card, can name either direction of
 * an "Arah …" halte. Matching only on the primary id would leave those links
 * silently unresolved — the picker would open empty with no indication why.
 *
 * The returned station keeps the id that was ASKED FOR, not the primary's. The
 * two directions of a pair are different boarding points on opposite sides of a
 * road, and 6 of the 15 pairs price differently because of it — Ciliwung to
 * Ancol is Rp 6.500 eastbound and Rp 11.500 westbound. Returning the primary
 * would answer a different question than the link asked, and do it silently.
 * The folded entry supplies the display name and lines; the id stays the user's.
 */
export function resolveStationId(
  stations: PickableStation[],
  id: string
): PickableStation | null {
  for (const station of stations) {
    if (station.id === id) return station
    if (station.siblingIds?.includes(id)) return { ...station, id }
  }
  return null
}
