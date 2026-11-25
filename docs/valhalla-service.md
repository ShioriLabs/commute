# Valhalla routing service (design note)

**Status:** design note — not yet built. Companion to `points-of-interest.md`.
Captures a decision made during brainstorming so context isn't lost before
implementation starts.

## When to build it (decided 2026-11-25)

**Not for POIs.** POI access walks are a small, fixed set (batch 1 is about 11 POIs
with 2–3 entrances each, ~30 walks), and they change only when the curation does.
Measure them once and store them in `poiStations.distance`: by hand with osm.org's
walking directions, or with a throwaway offline run (a local Valhalla/OSRM
container, or a script over shirase's `fetch:osm` extract). A live service is far
too much infrastructure for that.

**Walk time doesn't need it either.** Minutes are distance ÷ pace, and the pace
comes from the rider's walking-speed tier (BRISK/AVERAGE/SLOW/SLOWEST, 1.5/1.2/0.9/0.7
m/s in `libs/tsundere/src/planner/departures.ts`). That tracks the rider's own setting, which a fixed
Valhalla duration wouldn't.

**Build it when one end of a walk is an arbitrary point**, not a curated POI:
"from my location", a Sokin recipient entering where they are (`sokin.md`), or
an address search. Those walks can't be measured in advance, so that's when a
live service earns its place.

Whatever computes a distance, Jakarta's footpath data is the weak part
(footbridges, GBK/Monas gates that open only sometimes, unmapped crossings).
A computed walk is a starting number to check on the ground, not the answer.

Door-to-door is a soft target for 2027, limited by what the infrastructure and
OSM data can handle. It comes in two steps: a baked walk grid first (below),
live Valhalla only when the grid stops being enough.

## Step 0: baked walk grid (before any live service)

Precompute walks instead of serving them. The output is static files on
R2/shirase, cached at the edge like tiles. No droplet, no tunnel, nothing that
runs continuously.

**A grid, not isochrone polygons.** Polygons answer "which stations are
within 10 minutes" in coarse bands and need a point-in-polygon test per
station. Flip it around: divide the area into small cells (H3, roughly 25–65 m
across; resolution to be picked by testing). For each cell, store the nearest
few station entrances within ~1.5 km and the **walking metres** to each:

```
cell → [(stationId, exitId?, metres), …]
```

One key lookup gives real distances instead of bands. Store metres, not minutes,
so time still comes from the rider's walking-speed tier. Isochrone shading for
the map can be drawn from the same data if it's ever wanted.

**It reuses the POI mechanism.** A rider's location becomes a virtual node
injected for one request, with walk edges to the cell's candidates. That's the
same per-request injection `points-of-interest.md` designs for POIs (and the same
guarantee: the node never enters the cached graph, so it can't become a
mid-route shortcut). Door-to-door step 1 adds no router changes on top of POIs.

**Privacy by construction** (`commute-network.md` rule zero, never enable
stalking). The client downloads the grid tile and looks up its own cell, then
sends only `[(stationId, exitId, metres)…]`. The server never sees coordinates.
A cell id is itself a location, so the lookup stays on the device and cell ids
are never sent, logged or used in cache keys.

**Building it:**

- **Engine:** a one-off local run of Valhalla (its pedestrian matrix/isochrone API)
  or OSRM in Docker, or our own shortest-path script over the footway graph from
  shirase's `fetch:osm` extract. All throwaway; only the output is kept.
- **Measure from exits**, not station centroids, wherever `stationExits` has
  coordinates. Fall back to the centroid, flagged, so those cells can be redone
  when exits land.
- **Order:** rail stations first (~150), then TJ haltes (~2,200). Rail is the
  smaller set and where exits matter most.
- **Ties to OSM:** bake from the same `fetch:osm` extract shirase uses, and
  refresh them together. The output is derived from OSM, so it carries ODbL
  attribution and stays a separable dataset, same as OSM-sourced exits.

**Checking it:** the curated POI walks (`poiStations.distance`, measured on the
ground) are the test set. For each POI, compare the grid's distance from the
POI's cell to each access station against the curated one. A big gap means a
footpath problem in OSM (a missing footbridge, a gate) for recon to fix.

**What it can't do:**

- **No path to draw.** The grid gives a distance, not a route, so a locality
  map can't trace the walk. Drawing the actual path is what live Valhalla is
  for.
- **OSM's gaps get baked in** until the next refresh. Recon fixes go into OSM
  (or our overrides) and only show up after the next bake.
- **Grid resolution vs size.** Finer cells are more accurate and bigger. The
  first build should measure tile size at two resolutions before picking one.

**When live Valhalla is still needed:** drawing the walk path on a map,
destinations outside the grid's coverage, and any walk longer than the
grid's ~1.5 km cap.

## Why

Every walk distance in this repo today is either hand-curated or a haversine
(crow-flies) fallback (`apps/api/src/utils/geo.ts`). `points-of-interest.md` flags
"walk-distance source: hand-tuned metres vs a routing/maps estimate" as an open
question for the not-yet-built POI feature. Valhalla — a self-hosted pedestrian
routing engine — answers a narrower version of that: real walking **duration**
("≈N min") for first/last-mile legs, computed live.

## Scope (deliberately narrow)

A standalone Valhalla service + a typed client in `apps/api`, callable for
pedestrian distance/duration between two coordinates. **Not in scope:** wiring
into `fares.ts` or POI ACCESS legs — POIs don't exist yet (`pois` table,
`PoiRepository`, ACCESS leg type are all unbuilt per `points-of-interest.md`), and
this spec deliberately does not depend on them. "Done" for this spec means: the
service is deployed and reachable, the client is built and unit-tested, and
nothing in the live app calls it yet.

Explicitly ruled out for this spec (may become their own specs later):
turn-by-turn walking directions in the UI, using Valhalla as the multimodal
trip-planning engine (go-mode.md's Tier 1/2 stays the custom Dijkstra/RAPTOR-style
router), and wiring into POI ACCESS legs.

## The service itself

- Self-hosted via Docker on a DigitalOcean droplet (or comparable Indonesian
  host). New territory for this repo — everything else here is Cloudflare
  Workers, which can't run a long-running stateful C++ service with tile data on
  disk.
- **Pedestrian-only costing.** The only use case is walking distance/duration, so
  tiles are built with `costing=pedestrian` only — no auto/bicycle/transit
  costing. Keeps the tileset small enough for a cheap droplet.
- **Region: Jabodetabek only**, clipped from the Indonesia/Java Geofabrik OSM
  extract via `osmium extract` with a bounding box — not the whole country.
  Smaller extract, faster tile build, less disk.
- Tracked in-repo at `services/valhalla/` (sibling to `apps/`, **not** a pnpm
  workspace member — it's not JS):
  - `docker-compose.yml` — the Valhalla container.
  - `build-tiles.sh` — download extract → clip to bbox → `valhalla_build_config`
    + `valhalla_build_tiles`.
  - `README.md` — manual deploy steps. No CI exists in this repo, so deployment
    stays manual, matching the rest of the project.

## Exposure & security

Valhalla has no built-in auth. Recommended: **Cloudflare Tunnel** (`cloudflared`
on the droplet) exposing a hostname behind Cloudflare's proxy, gated by
**Cloudflare Access with a service token** (Client ID/Secret headers checked at
Cloudflare's edge, before traffic reaches the droplet). Zero open inbound ports
on the droplet, no extra auth component to run, reuses the Cloudflare account
this project already lives in.

Fallback if Zero Trust setup is unwanted: a reverse proxy (Caddy) on the droplet
doing TLS + a shared-secret header check — more standard-VPS, but means an open
port and one more component to keep patched.

## API client

`apps/api/src/utils/valhalla.ts`:

```ts
getWalkingRoute(
  from: LatLng,
  to: LatLng,
  config: { baseUrl: string, /* ...credentials */ }
): Promise<{ distanceM: number, durationMin: number } | null>
```

Calls Valhalla's `/route` endpoint with `costing=pedestrian`. Bounded timeout
(e.g. `AbortSignal.timeout(2000)`). Any failure — timeout, non-200, malformed
body — returns `null` rather than throwing, matching this codebase's existing
haversine-fallback philosophy: degrade gracefully, never break the caller.
Config is passed as explicit params, not a whole `env` object, matching the
style of `getGraph(d1: D1Database)` in `fares.ts`.

## Config

- `VALHALLA_URL` as a `wrangler.toml` var, same pattern as `opengraph`'s
  `API_URL`.
- Cloudflare Access service-token credentials as Worker secrets
  (`wrangler secret put`, not committed).

## Testing

Unit tests for `valhalla.ts` mocking `fetch` (same style as `fare.test.ts`):
success parsing, timeout, non-200, and malformed response — all degrading to
`null`. No new route/endpoint is added, since nothing calls this yet. Verifying
the live deployed service is manual: curl the tunnel hostname with the service
token, documented in `services/valhalla/README.md`.

## Open / deferred

- Wiring into POI ACCESS legs once `points-of-interest.md` ships.
- Whether duration ever gets cached separately, or just rides along in the
  existing `fares:` KV cache once a caller exists (no separate cache layer
  needed today since there's no caller).
- Droplet sizing/provider — "DigitalOcean or comparable Indonesian host" is not
  yet pinned down.
