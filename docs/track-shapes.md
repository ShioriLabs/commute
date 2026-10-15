# Track shapes for trip mode

**Status:** built 2026-10-09, not deployed. `GET /_internal/track-shapes`, for
the Android app's trip mode (`android-trip-mode.md`). The app side is not
built yet.

## Why

Trip mode places a rider by projecting each location fix onto the straight
line between two consecutive stops (`TripEngine.alongHops`). Track and road
don't run straight, and on some hops the gap is bigger than the engine's
tolerance:

| How far the real route strays from the straight line | Rail hops | What the engine does there |
|---|---|---|
| more than 1,000 m | 3 | counts the rider as off-route, eventually asks "Masih di rute ini?" |
| 400–1,000 m | 15 | can't place the fix, falls back to the clock |
| 150–400 m | 33 | places the fix at the wrong point along the hop |

The worst are Batu Ceper → Bandara Soekarno-Hatta (2.5 km), Kampung Bandan →
Angke (1.1 km), and LRT Kuningan → Pancoran (0.9 km). On TransJakarta, L13E
runs 350 m off its straight hop down Mampang, which once sent "siap-siap" 22
minutes early.

## The file

```ts
{
  version: '1ce9fb7e',            // changes whenever any shape does
  attribution: 'Rail: © OpenStreetMap contributors, ODbL-1.0 …',
  shapes: {
    'KCI-BPR>KCI-BST': '…',       // Google encoded polyline, precision 5
    'TJ-H00131P>TJ-H00278P': '…'
  }
}
```

- **Key: `{from}>{to}` station ids**, the consecutive entries of a ride leg's
  `stops`. There's no line code: track between two stations is the same
  whichever line runs it, and a merged interlined leg can't name one line per
  hop.
- **Direction.** Rail has both directions, each the reverse of the other.
  TransJakarta is directed, since a bus can take a different street each way.
- **A missing key means no shape.** Keep the straight line for that hop. This
  covers the hops TransJakarta's poster overrides add, which aren't in GTFS,
  and any halte the generator couldn't place within 150 m of its trip's shape.
- **Hops past stops without calling are one key.** LRTJ Rawamangun →
  Manggarai (past Pramuka, Matraman, Proklamasi) and KRL Kemayoran → Gang
  Sentiong southbound (past Pasar Senen) are stitched from every segment they
  cover, exactly as `edges` prices them.
- **Size:** about 188 KB raw for the whole network (3,092 shapes: 257 rail,
  2,835 TJ), 84 KB gzipped in transit.

**Coverage** of the hops the router can ride: rail 271 of 271, TransJakarta 948
of 997. All but one of the TJ gaps are poster-override corridors (3F, 4, 4D,
6A, 6B, 7F, 12, 14).

## Fetching and caching

The file is compiled into the worker, so it only changes on a deploy. The
endpoint is cached for a day with an ETag. The app should:

1. keep its last copy on disk and use it offline (trip mode must work with no
   network once started);
2. revalidate with `If-None-Match` now and then, e.g. on launch. An unchanged
   file comes back as a bodyless 304;
3. join a leg's hops to shapes locally, by consecutive `stops` ids.

The `attribution` string has to reach the app's own data-attribution screen.
The rail shapes are derived from OpenStreetMap under ODbL.

## Regenerating

```
pnpm --filter api generate:track-shapes
```

Re-run after `generate:track-geometry` or a TJ GTFS import, and commit
`apps/api/src/db/data/trackShapes.generated.ts`. Then re-run
`generate:edges`, which prices the poster-override corridors from these
shapes (see below). TJ
needs the feed extracted under `apps/api/src/db/scripts/file_gtfs/`, as
`generateTJSQL` does. The run prints coverage against the topology's hops; rail
below 100% means a hop's segment is missing from `data/geometry`.

## Sources

- **Rail:** `apps/api/src/db/data/geometry/*.geojson`, traced along
  OpenStreetMap rails by `generateTrackGeometry.ts`.
- **TransJakarta:** GTFS `shapes.txt`, cut at each halte. Where trip variants
  disagree on a pair, the shortest cut wins, the same rule that picks the edge
  distance.
  - The cut points come from `shape_dist_traveled` when the feed fills it on
    both the shape and every stop of the trip.
  - Otherwise, the generator measures the shape and places each halte on it
    itself, searching forward only so a loop route's second pass lands on the
    second visit.
  - The 2026-07-24 export, the current one, leaves the column empty in both
    files, so every TJ shape today comes from that fallback. Ends land a median
    10 m (p95 31 m, max 100 m) from the haltes in the database.

  The shapes also price `edges` on the poster-override corridors
  (`topology.tj.overrides.ts`). Their `cumM` is cumulative haversine, so
  `generateEdgesSQL` skips it there and takes the directed shape length,
  falling back to haversine for the hops no shape covers. Before this, 55
  edges were priced at the straight line while the shape ran more than 25%
  longer, the worst being corridor 6 Flyover Kuningan → Galunggung (512 m
  straight, 2,750 m along the road). Now none are, and shape length matches
  the priced distance at a median ratio of 1.000.

  Caveat: the posters (17 Sep 2026) are newer than the GTFS export
  (2026-07-24). If an override corridor has been rerouted since, its shape is
  the old route and so is its price. The biggest detours worth checking
  against the real route: 6 Flyover Kuningan → Galunggung (5.4× the straight
  line), 14 `H00090P` → `H00108P` (3.6×), 4D `H00114P` → `H00073P` (2.6×).
