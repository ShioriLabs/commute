import { HubRepository } from 'db/repositories/hubs'
import { StationRepository } from 'db/repositories/stations'
import { directionalGroupKey } from 'utils/searchables'

/*
 * Which stations are one PLACE to a rider, for the planner's set-valued
 * endpoints (PlanOptions.originIds / targetIds).
 *
 * Two sources, both curated rather than inferred:
 *  - `integrated` hubs: stops split across operators only in the data, e.g. LRT
 *    and TransJakarta Rasuna Said stacked on one another. A rider who asks for
 *    either has arrived at both, so a journey ending at the TJ halte must not
 *    add a walk into the LRT station they did not need.
 *  - "Arah" halte pairs, folded exactly as search folds them: two platforms of
 *    one halte, and riders do not care which side they end up on. Routing from
 *    only the picked side silently dropped lines that call at the other one
 *    (7R stops at Kali Grogol northbound only).
 *
 * `hub`-kind complexes (Dukuh Atas, Manggarai, CSW) are NOT places: their
 * members are distinct stations a rider picks on purpose.
 *
 * Stations in both kinds of group get the union. A station in no group is
 * absent from the index, and `placeOf` answers with just itself.
 */
export type PlaceIndex = ReadonlyMap<string, ReadonlySet<string>>

export function buildPlaceIndex(
  integratedHubs: readonly (readonly string[])[],
  stations: readonly { id: string, operator: string, officialName: string }[]
): PlaceIndex {
  const groups: string[][] = integratedHubs.filter(members => members.length > 1).map(members => [...members])

  const directional = new Map<string, string[]>()
  for (const station of stations) {
    const key = directionalGroupKey(station)
    if (key.startsWith('id:')) continue
    const members = directional.get(key)
    if (members) members.push(station.id)
    else directional.set(key, [station.id])
  }
  for (const members of directional.values()) if (members.length > 1) groups.push(members)

  // Union groups that share a member, so a halte pair inside an integrated hub
  // becomes one place with the hub's other stops.
  const index = new Map<string, Set<string>>()
  for (const members of groups) {
    const merged = new Set(members)
    for (const id of members) for (const other of index.get(id) ?? []) merged.add(other)
    for (const id of merged) index.set(id, merged)
  }
  return index
}

export function placeOf(index: PlaceIndex, stationId: string): ReadonlySet<string> {
  return index.get(stationId) ?? new Set([stationId])
}

/*
 * Per isolate, like the graph in routes/fares.ts getRouter: places change only
 * with a reseed, and a reseed ships with an API_VERSION bump. Held as a promise
 * so concurrent first requests share one load.
 */
let cachedIndex: Promise<PlaceIndex> | null = null
export function getPlaceIndex(d1: D1Database): Promise<PlaceIndex> {
  cachedIndex ??= Promise.all([
    new HubRepository(d1).getIntegratedMemberIds(),
    new StationRepository(d1).getAll()
  ]).then(([hubs, stations]) => buildPlaceIndex(hubs, stations)).catch((error: unknown) => {
    cachedIndex = null // a failed load must not be memoised
    throw error
  })
  return cachedIndex
}

/*
 * The planner endpoints for a request: each side's place, unless the two
 * places overlap. Asking to go from LRT Rasuna Said to TJ Rasuna Said is asking
 * for that walk, so an overlap falls back to the exact stations named.
 */
export function endpointsFor(index: PlaceIndex, fromId: string, toId: string): { originIds: ReadonlySet<string>, targetIds: ReadonlySet<string> } {
  const originIds = placeOf(index, fromId)
  const targetIds = placeOf(index, toId)
  if ([...originIds].some(id => targetIds.has(id))) {
    return { originIds: new Set([fromId]), targetIds: new Set([toId]) }
  }
  return { originIds, targetIds }
}
