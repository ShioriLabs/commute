# Transit hub modelling

**Status:** design note — not yet implemented. Companion to `platform-codes.md`.

## Goal

Model interchange **complexes** (multiple physically-distinct stations under one
name) so one tap opens all members. Example: **Dukuh Atas** = Sudirman (KRL) +
Dukuh Atas BNI (MRT) + Dukuh Atas (LRT) + BNI City (Airport rail).

## Hub vs multi-line station (the discriminator)

- **Multi-line, one station** — Manggarai serves 3 lines but is a single `stations`
  row. **Not a hub.** Already handled by `stationLines`.
- **Multi-station complex** — Dukuh Atas is 4 separate `stations` rows across
  operators, linked by **walking**. **This is a hub.**

What already links the members is the **`transfers`** table (bidirectional walking
links). A hub is therefore a *named grouping layered on the transfer graph* — not a
new kind of station.

## Identity: `id` + `slug` (decided)

Two separate fields, by preference:

- **`id`** — opaque, **stable primary key** (e.g. `HUB-DKA`, mirroring the station
  id style; assigned once, never changes). All relations (`hubStations.hubId`) point
  here, so renaming a hub or changing its slug never breaks FKs.
- **`slug`** — unique, **human-facing URL key** (`/hubs/dukuh-atas`), decoupled from
  any one operator. Mutable/cosmetic — can change without touching membership.

Editorial fields live on the row (addressed by `id`); the `slug` is what the public
URL and "recently viewed" reference. Neither is a member station, so the complex
survives a member being renamed or a new operator joining.

## Storage: database (decided)

Earlier draft put the structural definition in `@commute/constants`. **Revised to a
DB table** because:

- It must surface in **search** (see Searchable below), alongside DB-sourced stations.
- The **editorial content (text, pics)** wants real columns and **edit-without-
  redeploy** — a `TEXT description` + image reference, not a string baked into a TS
  constant.
- Membership is a natural **relation**, consistent with `transfers` / `stationLines`
  / `edges`.

### Schema — `0010_add_hubs_table.sql`

```sql
CREATE TABLE hubs (
  id          VARCHAR(48) PRIMARY KEY NOT NULL UNIQUE,  -- stable, e.g. 'HUB-DKA'
  slug        VARCHAR(64) NOT NULL UNIQUE,              -- URL key, mutable
  name        VARCHAR(128) NOT NULL,
  description TEXT,            -- editorial (someday), nullable
  heroImage   VARCHAR(255),   -- path or R2 URL, nullable
  latitude    REAL,           -- centroid for one map pin, nullable
  longitude   REAL,
  score       INTEGER NOT NULL DEFAULT 0,  -- search ranking, like stations.score
  createdAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hubs_slug ON hubs (slug);  -- lookups by URL slug

CREATE TABLE hubStations (        -- membership (a station ∈ a hub)
  id        VARCHAR(80) PRIMARY KEY NOT NULL UNIQUE,  -- `${hubId}:${stationId}`
  hubId     VARCHAR(48) NOT NULL,   -- FK -> hubs.id (NOT slug — stable)
  stationId VARCHAR(48) NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,  -- member ordering in the hub view
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hubStations_hubId ON hubStations (hubId);
CREATE INDEX idx_hubStations_stationId ON hubStations (stationId);
```

Kysely: `HubSchema` (`id`, `slug`, …) + `HubStationSchema` (`id`, `hubId`,
`stationId`, …) in `apps/api/src/db/schemas/hubs.ts`, registered in
`schemas/index.ts` (`hubs`, `hubStations`). `score` mirrors `stations.score` so hubs
rank in search the same way. Membership FK is `hubId` → `hubs.id` (stable), while
URLs resolve by `slug` (an indexed lookup).

### Seeding

Discover candidates with a one-off script computing **connected components of the
`transfers` graph** within a walking threshold → eyeball, name, assign slugs, insert.
Derivation is the discovery aid; the curated rows are the source of truth (pure
components over-merge — a stray Sudirman↔Karet transfer would wrongly swallow Karet).
Seed via a generated `hubs.sql` (same pattern as `station-codes.sql` / `edges.sql`).

## Searchable compatibility

`Searchable` (`apps/web/models/searchable.ts`) **already reserves `type: 'HUB'`**.
There is **no server-side search** — the web builds `Searchable[]` client-side from
`/stations` (`search.tsx`, `search-sheet`). So:

1. New `/hubs` route (KV-cached like `/stations`), returns each hub with its members
   and aggregated lines.
2. Web fetches `/hubs` and maps each to `Searchable<Line[]>`:

| `Searchable` field | from hub |
| --- | --- |
| `type` | `'HUB'` |
| `title` | `hub.name` |
| `subtitle` | `'Stasiun Terintegrasi'` (or member count) |
| `to` | `/hubs/${hub.slug}` (URL by slug) |
| `keywords` | hub name + **every member's name & code** (so "sudirman" finds the hub) |
| `body` | deduped `Line[]` across members → same line badges as a station |
| `score` | `hub.score` |
| `data` | `{ 'hub-id': id }` (stable; for "recently viewed", like station-id) |

3. `SearchableItem` currently renders `body` badges only for `type === 'STATION'` —
   widen the condition to include `'HUB'`.
4. Merge hubs into the `useMemo` searchable builders. Optionally suppress member
   stations that belong to a hub (or just let `hub.score` rank it above them) to
   declutter.

## Editorial layer (someday)

Now columns on `hubs`, filled when the mood strikes; hub works fully without them.

- `description TEXT` — prose/markdown blurb.
- `heroImage` — path. **Images**: `public/img/hubs/<slug>/…` is simplest and gets
  cached by the **PWA service worker** (works offline); switch to **R2** if you want
  to add images without redeploying. A gallery later = a small `hubImages` table or a
  JSON column.

## Surfacing the "1 tap"

- **Search:** one "Dukuh Atas" searchable. Members stay individually findable but
  annotated and deprioritised. (See Searchable compatibility above.)
- **Hub view** `/hubs/:slug`: header = hub name (+ description/hero someday), then one
  section per member reusing `StationContent` (`Sudirman · KRL`, `Dukuh Atas BNI ·
  MRT`, …), ordered by `hubStations.position`. That *is* "1 tap → all stations".
  **Required** so a hub search result resolves instead of 404ing.
- **Stretch:** single merged departure board across members (reuse grouping /
  `buildRows`).

## Map tap targets (the wrinkle search doesn't have)

The map is **not** an abstract-pin layer — it renders one **capsule `Point`** per
station pill (`map-renderer.ts`: `{ id: 'KCI-MRI', ax/ay…bx/by, r }`). A tap
hit-tests against capsules (`hitTestPoints` → point-to-capsule distance + touch slop)
and the winner resolves `id` → `{ operator, code }` → `<StationSheet>` for **that one
station** (`map.tsx` `tryHitTest`). A hub's members are physically-distinct capsules at
real locations — we keep them that way (you *want* to see that Sudirman and BNI City
sit a block apart), and add the hub as **its own authored tap target** layered around
them rather than collapsing the members into one pin. The `hubs.lat/lng` centroid is
for non-map uses (search result, future list); the on-map hit-region is authored
separately.

Decision: **hubs get their own authored tap targets** — a hub is a **single `Point`**
(capsule) drawn with the author tool, same as a station pill, shipped in the points
manifest. One capsule per hub (multi-capsule-per-hub parked for later if a complex's
shape needs it). The complex becomes directly tappable as a region; member pills stay
tappable inside it. The hit-test resolves a tap to **either a station or a hub**, with
**stations always winning** when both are hit.

The map geometry and the DB hub row are linked **only by the `HUB-…` id** — the hub's
shape/position lives in the points manifest (client-side), like station pills; the DB
`hubs` row carries no map geometry. (`hubs.lat/lng` is a centroid for math — search/
list — **not** the map hit-region.)

### Refactor: tagged, two-tier hit-test

Today `Point` is implicitly "a station" — `id` is `KCI-MRI`, and `tryHitTest` parses
`operator-code` to open a `StationSheet`. To carry hubs, tag the kind:

- **Discriminate by id prefix (no schema change).** Hub points use the `HUB-…` id
  style already decided for `hubs.id` (e.g. `HUB-DKA`); station points keep
  `OPERATOR-CODE`. The renderer ignores the difference (still just capsules); only the
  hit-test + tap router branch on it. (Alternative: add `kind?: 'station' | 'hub'` to
  `Point` — more explicit but touches the manifest schema and the author exporter.
  Prefer the prefix unless we want the field for rendering, e.g. styling hub targets
  differently.)

- **Station-wins precedence.** `hitTestPoints` currently returns the single nearest
  hit across all points. Split the candidate set: hit-test **stations first**; if any
  station is hit, return it. Only if **no** station is hit do we consider hub points.
  This is the "station always wins vs hub" rule — a tap on Sudirman's pill opens
  Sudirman; a tap in the gap between members (inside the authored hub region, outside
  every pill) opens the hub. Implementation: either two passes over filtered arrays, or
  one pass that prefers any station hit over the best hub hit regardless of distance.

  ```ts
  // sketch — station hit beats any hub hit, even a closer one
  export function hitTest(x, y, points, slop): { kind: 'station' | 'hub', point: Point } | null {
    let bestStation = null, bestStationD = Infinity
    let bestHub = null, bestHubD = Infinity
    for (const p of points) {
      const d = pointToCapsuleDistance(x, y, p.ax, p.ay, p.bx, p.by) - (p.r + slop)
      if (d > 0) continue
      const isHub = p.id.startsWith('HUB-')
      if (isHub) { if (d < bestHubD) { bestHubD = d; bestHub = p } }
      else       { if (d < bestStationD) { bestStationD = d; bestStation = p } }
    }
    if (bestStation) return { kind: 'station', point: bestStation }  // station wins
    if (bestHub)     return { kind: 'hub', point: bestHub }
    return null
  }
  ```

- **Tap router** (`map.tsx` `tryHitTest`): switch on `kind`. `station` → existing
  `operator-code` split → `setSelectedStation`. `hub` → resolve the hub (by id) and
  open the hub view / hub sheet, or navigate to `/hubs/:slug`.

### Z-order / draw

Render hub targets **beneath** member pills so the pills stay visually on top (matches
"station wins" for the eye too). If hubs need distinct styling (fill/halo) that's a
renderer change in `map-renderer-{webgl,canvas2d}.ts`; if they're invisible hit-regions
to start, no render change at all — they only exist in the hit-test.

### Author tool

`map-author.tsx` already places/edits capsules by id. It works for hubs as-is — author
a hub target by giving it a `HUB-…` id. `handleAuthorTap` uses `hitTestPoints` for
selection; once that's generalized, keep author-mode selection **kind-agnostic** (you
must be able to grab and edit a hub region even where it overlaps a pill — e.g.
shift-tap to target the hub, or cycle hits). Note this so the author UX doesn't inherit
the runtime's station-always-wins rule and make hub regions unselectable.

### Open (map)
- Hub target shape: invisible hit target (same as station)
- Author selection when hub region overlaps a pill —
  z-cycle taps
- Where the `HUB-…` id resolves to hub data on the client (reuse the `/hubs` payload
  the search builder fetches; build a `hubId → hub` index once in a `useMemo`/context).

## Reuse (not throwaway)

A hub is a **transfer super-node**: for the future trip planner, collapse member
stations into one routing node joined by intra-hub transfer edges (walking penalty
from `transfers`). Same graph machinery as `platform-codes.md`.

## Build order
1. Migration + `schemas/hubs.ts` + register in `schemas/index.ts`.
2. `HubRepository` — join hubs→hubStations→stations→stationLines to assemble
   members + their lines.
3. `/hubs` route (list, KV-cached), mounted in `app.ts`; `/hubs/:slug` next.
4. Web: `Hub` model, fetch `/hubs`, `hubToSearchable()`, merge into both search
   builders, widen `SearchableItem`.
5. `/hubs/:slug` view (`StationContent` × members).
6. Seed script (transfers connected-components → curated `hubs.sql`).

## Open / to decide later
- Final hub roster + slugs (run the discovery script first).
- Member ordering convention (`position`: by operator? by prominence?). (prominence)
- Centroid by hand vs computed mean of member lat/lng. (calc)
- Whether to hide member stations from search when they belong to a hub. (no)
