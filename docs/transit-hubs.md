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

- **Search / map:** one "Dukuh Atas" searchable + one map pin (centroid). Members
  stay individually findable but annotated and deprioritised.
- **Hub view** `/hubs/:slug`: header = hub name (+ description/hero someday), then one
  section per member reusing `StationContent` (`Sudirman · KRL`, `Dukuh Atas BNI ·
  MRT`, …), ordered by `hubStations.position`. That *is* "1 tap → all stations".
  **Required** so a hub search result resolves instead of 404ing.
- **Stretch:** single merged departure board across members (reuse grouping /
  `buildRows`).

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
- Member ordering convention (`position`: by operator? by prominence?).
- Centroid by hand vs computed mean of member lat/lng.
- Whether to hide member stations from search when they belong to a hub.
