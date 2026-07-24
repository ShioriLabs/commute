# TransJakarta live bus board (design note)

**Status:** design note — not yet built. Companion to `tj-gtfs-import.md` (the
`edges`/`stationLines`/topology data this depends on) and directly replaces the
`NO_SCHEDULE` empty state TJ station pages show today, since TJ publishes no
real timetable.

## Why

TJ has no GTFS-Realtime feed and no real per-station schedule — station pages
for the `TJ` operator always fall into `EmptyState mode="NO_SCHEDULE"`
(`apps/web/app/components/station-content.tsx`), which just tells riders to
check the physical board or ask an officer. A third-party SSE feed
(`https://api-opentransum.randspace0.com/sse`, owned by a friend, ~15s push
interval) exposes live TJ vehicle positions. This is enough to build a real
live arrivals board — "which buses are inbound to this halte, and roughly how
many minutes out" — replacing the dead-end state with actual data.

## The feed

Each SSE event is `{"type":"vehicles-gz","data":"<base64 gzip>"}`. Decoded,
it's `{ vehicles: [...] }` where each vehicle looks like:

```json
{
  "source": "transjakarta",
  "latitude": -6.140891, "longitude": 106.833356,
  "route_code": "10H",
  "route_color": "9B1F21", "route_text_color": "FFFFFF",
  "bus_body_no": "SAF-040",
  "next_stops": "H00088P-Jembatan Merah",
  "heading": 163,
  "last_update_at": 1784865012940
}
```

Findings from a captured real sample:

- **No ETA or speed field** — only position, heading, and a single **immediate
  next stop** as a GTFS stop id (matches our imported TJ stop id scheme
  exactly — `H…`/`B…` prefixes per `tj-gtfs-import.md`). ETA must be derived.
- `route_code` matches our `lineCode` exactly for BRT corridors (`11`, `10H`,
  `7C`). Mikrotrans comes through as `JAK.xx` and isn't in our scope (per
  `tj-gtfs-import.md`, Mikrotrans is excluded from v1 entirely) — these
  vehicles simply never match any station's known lines and are naturally
  dropped, no special-casing needed.
- **The stream bundles multiple cities in one payload**: a captured sample had
  4221 vehicles total — 3632 `transjakarta`, 248 `transsemarang`, 341
  `metrojabartrans`. Filter to `source === 'transjakarta'` immediately after
  parsing.
- **Decoding is not cheap.** Benchmarked the same captured sample
  (~230KB gzip → ~1MB JSON): gunzip **21.3ms** + `JSON.parse` **37.5ms** ≈
  **58.8ms total**. This is the load-bearing fact behind the infra decision
  below.
- `next_stops` can be `""` (vehicle has no known upcoming stop) — excluded
  from all boards.

## Scope

Per-halte board: viewing a TJ station shows every inbound bus across all
lines serving it, each with a derived ETA in minutes. Not a live map, not
per-route — the board is anchored to "what's coming to the halte I'm looking
at," matching what a physical departure board would show.

**Replaces**, not supplements, the existing timetable UI for TJ: both
`station-content.tsx`'s compact preview and the full `/timetable` page render
the live board instead of `TimetableContent` when `operator === 'TJ'`. No new
route. When the feed is down or returns nothing, reuse the existing
`EmptyState` (`OFFLINE`/`ERROR`/`NO_DATA`) — no fallback to a synthetic
schedule, since TJ has never had a real one to fall back to.

## Architecture

A new standalone service, `apps/realtime` ("`commute-rt`"), deployed to
`rt.commute.shiorilabs.id` — same pattern as `apps/opengraph` ("`commute-og`"):
a small Hono Worker that calls `api.commute.shiorilabs.id` over HTTP rather
than binding to D1 directly. **The core API needs zero changes**: it already
exposes everything the live board needs.

```
apps/realtime  (new, Workers Paid — see below)
  │
  ├─ own KV: vehicle snapshot (current + prev, ~30s freshness window),
  │          fetched/decoded from the friend's SSE feed
  ├─ own KV: long-TTL cache of responses from api.commute.shiorilabs.id
  │          (line topology + station coordinates barely ever change)
  │
  └─ GET /stations/:code/live
       1. GET /stations/TJ/:code           → this halte's lat/lng + serving lines
       2. GET /lines/TJ/:lineCode (each)   → ordered stations + distanceFromOriginM
       3. filter current snapshot to matching route_codes
       4. per vehicle: resolve anchor stop from next_stops, project distance,
          derive ETA (see below)
       5. return sorted, grouped arrivals

apps/api      → UNCHANGED
apps/web      → new VITE_REALTIME_API_BASE_URL; TJ station pages call it
```

### Why Workers Paid, not free

Free plan CPU-time limit is **10ms per invocation** (not wall-clock — actual
compute time; `await fetch()`/KV reads don't count). The 58.8ms decode
benchmark above is ~6x over that, and this doesn't improve by decoding less
often (e.g. a 1-minute Cron Trigger instead of on-demand): the same ~59ms of
work would still need to fit in a single invocation whenever it *does* run,
so a coarser interval fails the same way, just less frequently. This is a
hard technical wall, not a design preference. Workers Paid's 30s budget fits
it with enormous margin, so the simplest option — decode inline, gated behind
a KV freshness check, no Cron Trigger, no new event-handler type — is safe
and preferred over introducing scheduled Workers as a wholly new primitive
this repo has no precedent for.

### Refresh cadence

KV snapshot freshness window: **~30 seconds**. The feed itself pushes every
~15s and physical TJ boards update far less often than that, so 30s is a
reasonable middle ground — noticeably fresher than a physical board, but half
the decode operations (and load on a friend's server) versus matching the
feed 1:1. The client SWR poll interval matches this (~30s).

## API contract

```ts
interface LiveRow {
  busBodyNo: string        // "MYS-17109"
  etaMinutes: number
  speedSource: 'derived' | 'fallback'
}

interface LiveDirectionGroup {
  lineCode: string
  lineName: string
  lineColor: `#${string}`
  boundFor: string         // corridor terminus name in the direction of travel
  rows: LiveRow[]          // sorted by etaMinutes ascending
}

// GET /stations/:code/live  →  StandardResponse<LiveDirectionGroup[]>
```

No `platformCode` — that comes from raw GTFS platform metadata the existing
(TJ-unused) timetable pipeline has, which this service deliberately doesn't
touch. Left out rather than adding a fetch just for it.

## ETA algorithm

Per candidate vehicle (already filtered to `source === 'transjakarta'` and
`route_code` matching one of the viewed halte's lines):

1. Parse `next_stops` (split on first `-`) → anchor stop id. Empty or
   unparseable → exclude.
2. Look up anchor's `distanceFromOriginM` (`anchorDist`) in the same
   `LineDetail` fetched for this `lineCode`; look up the viewed halte's own
   `distanceFromOriginM` (`targetDist`) the same way. Anchor not present in
   the line's `TRUNK` segment (topology drift, archived/temp stop per
   `tj-gtfs-import.md`'s cruft notes) → exclude, `console.warn`, don't fail
   the request.
3. Fetch the anchor station's lat/lng (`GET /stations/TJ/:anchorCode`,
   long-cached).
4. Remaining distance:
   - `anchorDist === targetDist` → `haversine(vehicle, anchor)` only.
   - `anchorDist < targetDist` (forward) → haversine leg +
     `(targetDist - anchorDist)`; `boundFor` = trunk's last station.
   - `anchorDist > targetDist` (reverse) → haversine leg +
     `(anchorDist - targetDist)`; `boundFor` = trunk's first station.
     Assumes symmetric inter-stop distances — a known small approximation for
     the handful of asymmetric-only stops noted in `topology.ts` (e.g. TJ
     Koridor 1's Kejagung). Acceptable for a "~5 mnt" estimate.
5. **Speed**: keep `current` + `prev` full vehicle snapshots in KV. If the
   same `bus_body_no` appears in both with an unchanged `next_stops` (hasn't
   crossed a stop boundary between polls), derive
   `speed = haversine(prev pos, curr pos) / Δt`, clamped to ~5–60 km/h.
   Otherwise fall back to one tunable constant (default ~18 km/h),
   `speedSource: 'fallback'`.
6. `etaMinutes = round(remaining_m / speed_mps / 60)`, clamped to a minimum
   of 0–1 (never negative, even if the vehicle crossed the target between
   polls). Vehicles beyond ~45–60 minutes out are dropped — past that range a
   fallback-speed estimate isn't meaningfully useful.

## Frontend integration

New `apps/web/app/components/live-board-content/index.tsx`, structurally
mirroring `timetable-content/index.tsx` (same section/row visual language,
`LineRoundel`, nearest-row pulse for imminent arrivals) but sourced from
`useSWR` against `${VITE_REALTIME_API_BASE_URL}/stations/{code}/live` with a
~30s `refreshInterval`, rendering `"{busBodyNo}   {etaMinutes} mnt"` rows
grouped by `(lineCode, boundFor)`.

Two call sites swap on `operator === 'TJ'`:

- `station-content.tsx`: the `NO_SCHEDULE` branch becomes
  `<LiveBoardContent code={code} />`.
- `timetable.tsx` (full page): renders `<LiveBoardContent code={params.code} />`
  instead of `<TimetableContent />` for TJ.

Empty/error states reuse `EmptyState` as-is, no new modes: `OFFLINE`
(network), `ERROR` (live endpoint unreachable), `NO_DATA` (empty `arrivals` —
no buses currently inbound).

## Error handling

- **Upstream feed down/malformed**: keep serving the last good `current`
  snapshot past its ~30s freshness window (stale-while-error) up to an outer
  bound (~5 min); beyond that, or with nothing in KV at all, return a
  structured error.
- **Stale vehicle** (`last_update_at` far older than the feed's cadence
  implies, e.g. >90s): exclude — the GPS unit likely stopped reporting.
- **Duplicate `bus_body_no` in one snapshot** (shouldn't happen per the
  feed's semantics, but defensively): de-dupe, keep the latest
  `last_update_at`.

## Testing

- `apps/realtime` gets Vitest unit tests (matching `apps/api`'s convention):
  decode step against a captured sample fixture, the ETA algorithm as a pure
  function (forward/reverse/same-anchor/anchor-not-found/negative-distance
  cases), `next_stops` parsing, speed derivation (clamped/fallback cases).
- Request-handler tests with the upstream fetch mocked: happy path,
  stale-cache-fallback path, total-failure path.
- Frontend: `apps/web` has no component tests today; scoped to manual
  verification via the dev server (drive a real TJ station page, confirm
  rows/ETAs update across a couple of poll cycles) rather than introducing
  new test infra for this feature alone.

## Open / deferred

1. **Branches/segments beyond `TRUNK`.** The ETA algorithm only looks at a
   line's trunk segment; a TJ corridor with a branch (rare, but the topology
   model supports it) would silently exclude vehicles on that branch. Revisit
   if any in-scope TJ corridor turns out to need it.
2. **Upstream feed stability.** Owned by a friend, not an official TJ
   endpoint — worth a quick check on whether the URL/shape is expected to
   stay stable, but not building heavy defensive fallback around it given the
   relationship.
3. **Free-tier path**, if ever needed later: a Cron Trigger (1-minute
   minimum granularity) moves the decode out of the request path entirely,
   but doesn't fit under the 10ms free-plan CPU cap either per the benchmark
   above — would need to shrink the decode cost itself (e.g. asking the
   upstream to offer a TJ-only stream) before free tier becomes viable at
   all.
4. **Client-side countdown smoothing.** Rows could locally decrement
   `etaMinutes` between polls (same idea as `TimetableContent`'s existing
   clock-tick pattern) for perceived responsiveness without extra requests —
   nice-to-have, not required for v1.
