import { writeFileSync } from 'node:fs'
import { getPlatformProxy } from 'wrangler'
import { EdgeRepository } from 'db/repositories/edges'
import { HubRepository } from 'db/repositories/hubs'
import { StationRepository } from 'db/repositories/stations'
import { buildPlaceIndex, type PlaceIndex } from 'utils/places'
import { directionalGroupKey } from 'utils/searchables'

/*
 * Freeze the routing network for the route regression suite
 * (routes/trips.regression.test.ts).
 *
 * The suite has to run in `pnpm test` and in CI, where there is no D1, so it
 * reads this snapshot instead. Read through the same repositories the API uses
 * (via wrangler's local D1 binding) rather than raw SQL, so the snapshot holds
 * exactly what getRouter and getPlaceIndex would load and cannot drift into a
 * second definition of "the graph".
 *
 * Local D1 must match prod first, or this freezes a network nobody rides — it
 * has been stale before (2026-10-18: 652 edges behind). Refresh it from a
 * `wrangler d1 export commute --remote` dump, then:
 *
 *   pnpm --filter api generate:route-snapshot
 *
 * Cases that change after a refresh are the point: read each one and decide
 * whether the data or the expectation is wrong.
 */
const OUTPUT_PATH = `${__dirname}/../data/network.snapshot.json`

/*
 * Routing reads directional halte pairs from `directional` hub rows only;
 * search still folds them by their "Arah …" names. A feed refresh that adds or renames a pair without
 * re-running generate:tj-directional-hubs would silently route from one side
 * again, so refuse to freeze a network where the two disagree.
 */
function assertDirectionalPairsArePlaces(index: PlaceIndex, stations: readonly { id: string, operator: string, officialName: string }[]) {
  const groups = new Map<string, string[]>()
  for (const station of stations) {
    const key = directionalGroupKey(station)
    if (key.startsWith('id:')) continue
    groups.set(key, [...groups.get(key) ?? [], station.id])
  }
  const missing = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1 && !ids.every(id => index.get(ids[0]!)?.has(id)))
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`Directional halte pairs not in one place (run generate:tj-directional-hubs and apply it): ${missing.join(', ')}`)
  }
}

async function main() {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({ persist: true })
  try {
    const [{ edges, transfers }, hubs, stations] = await Promise.all([
      new EdgeRepository(env.DB).getGraphInputs(),
      new HubRepository(env.DB).getPlaceMemberIds(),
      new StationRepository(env.DB).getAll()
    ])

    // Only the fields the graph reads, sorted, one row per line: a refresh then
    // diffs as the rows that actually changed, not as one rewritten blob.
    const edgeRows = edges
      .map(e => ({ lineCode: e.lineCode, fromStationId: e.fromStationId, toStationId: e.toStationId, distance: e.distance }))
      .sort((a, b) => `${a.lineCode}|${a.fromStationId}|${a.toStationId}`.localeCompare(`${b.lineCode}|${b.fromStationId}|${b.toStationId}`))
    const transferRows = transfers
      .map(t => ({ fromStationId: t.fromStationId, toStationId: t.toStationId, distance: t.distance, noTap: Number(t.noTap ?? 0) }))
      .sort((a, b) => `${a.fromStationId}|${a.toStationId}`.localeCompare(`${b.fromStationId}|${b.toStationId}`))

    // Stored as the resolved groups, not the hub and station rows they come
    // from: the suite needs which stations are one place, not why.
    const placeIndex = buildPlaceIndex(hubs)
    assertDirectionalPairsArePlaces(placeIndex, stations)
    const places = [...new Set(placeIndex.values())]
      .map(group => [...group].sort())
      .sort((a, b) => a[0]!.localeCompare(b[0]!))

    const lines = [
      '{',
      `  "generatedAt": ${JSON.stringify(new Date().toISOString())},`,
      '  "edges": [',
      edgeRows.map(r => `    ${JSON.stringify(r)}`).join(',\n'),
      '  ],',
      '  "transfers": [',
      transferRows.map(r => `    ${JSON.stringify(r)}`).join(',\n'),
      '  ],',
      '  "places": [',
      places.map(r => `    ${JSON.stringify(r)}`).join(',\n'),
      '  ]',
      '}'
    ]
    writeFileSync(OUTPUT_PATH, `${lines.join('\n')}\n`)
    console.log(`Wrote ${edgeRows.length} edges, ${transferRows.length} transfers, ${places.length} places to ${OUTPUT_PATH}`)
  } finally {
    await dispose()
  }
}

void main()
