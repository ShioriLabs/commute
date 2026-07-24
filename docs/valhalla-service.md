# Valhalla routing service (design note)

**Status:** design note — not yet built. Companion to `points-of-interest.md`.
Captures a decision made during brainstorming so context isn't lost before
implementation starts.

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
