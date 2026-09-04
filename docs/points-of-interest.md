# Points of interest (POIs) in fares

**Status:** design note — not yet implemented. Companion to `transit-hubs.md`.

## Goal

Let people check a fare to a **landmark** they know by name — GBK, Ancol, Monas,
Blok M — instead of the station code they'd have to know maps to it. The casual
user checking "berapa ke Ancol?" is exactly the person who *doesn't* think in
station codes, so POIs lower the barrier for the fare tool's least-expert audience.
Scope: **fare polish, not the trip planner.** No schedule, no route alternatives —
a POI just prepends/appends a curated access walk to an otherwise normal fare route.

## The core idea: a POI is a transfer-shaped node

A POI has no ride edges of its own. Its only connections are **walks to nearby
stations** — which is *exactly* the shape of a `transfers` row (`fromStationId`,
`toStationId`, `distance`). So a POI is a **virtual graph node whose only edges are
walk transfers**, and the router already knows what to do with those.

`findRoute` (`@commute/tsundere`, a method on the `Tsundere` handle returned by
`loadGraph`) is plain Dijkstra over "ride edges + walk transfers" and does **not**
care whether a node is a real station. So `router.findRoute('POI-GBK', dest)`
yields `walk → ride → … → dest` with **zero router changes**. And fares are
computed only on **RIDE** runs
(`summarizeFares`, `apps/api/src/utils/fare-summary.ts`), so a leading/trailing
access walk adds no fare — a POI origin cannot distort the tariff.

### Multi-entrance falls out for free (the elegant part)

A big POI (GBK, Ancol) doesn't have one "nearest station" — it has several
entrances near different stations. **Don't pick one.** Give the POI *several* walk
edges (GBK → Istora, Senayan, Palmerah) and `TRANSFER_PENALTY_M` (800 m, a routing
weight that is **excluded from reported distance**) makes Dijkstra choose the best
entrance **per destination** automatically, with an honest walk distance shown. You
curate candidate walk edges; the router curates the answer.

### One station, many POIs — and nobody types the real name

The mirror image of multi-entrance: a single station is the access point for *several*
POIs. Istora Mandiri alone anchors GBK, JCC, the Istora arena, SCBD, Senayan Park.
`poiStations` is already many-to-many, so this direction needs **no schema change** —
it's the same table read the other way. Note too that the station's own name is often a
POI brand (the station is *named after* the Istora venue), so the landmark is frequently
more recognisable than the station.

The catch this exposes: **people search by nickname, not by proper name.** "Senop" for
Senopati, "JCC" not "Jakarta Convention Center", "SCBD" not "Sudirman Central Business
District". The picker's levenshtein search over name/formattedName/code would miss all
of those. So POIs carry a curated **`keywords`** field (aliases + nicknames), fed into
picker search — the same device the hub design used for `keywords`. Without it, the
feature misses precisely the terms users actually type.

### District POIs (nightlife especially) are a distinct archetype

Some of the most-searched names aren't point landmarks at all — they're **districts**:
Senopati, Kemang, Blok M, SCBD-after-dark. These behave differently from a Monas-style
pin and want `category = 'DISTRICT'`:

- **Fuzzy footprint** — no single door, so "nearest station" is a curation judgment, not
  a coordinate. Pick the station(s) people actually alight at for that scene.
- **Often far from rail** — Kemang's nearest station (Cipete Raya / Fatmawati) is a
  2–3 km walk. That stress-tests the walking threshold: either accept a long, *honest*
  access-walk leg, or rule that a district beyond some radius is **out of scope for a
  rail fare tool** (an ojek/last-mile problem, not ours). Decide per district.
- **Nickname-only** — nobody types "Senopati" in full; they type "Senop". This is the
  clearest justification for `keywords`.

## POI vs hub vs station (the discriminator)

- **Station** — a real `stations` row with ride edges. Not a POI.
- **Hub** (`transit-hubs.md`) — a named grouping of *physically-distinct stations
  that form one interchange complex*, linked by walking. Members **are** stations.
- **POI** — a named *place* that is **not** a station and not an interchange, linked
  to one or more stations by an **access walk**. It never carries ride edges.

A POI is the closest cousin to a hub — both are named places with coords, a score,
and a slug — but the hub docstring is explicit that hubs are interchange complexes.
Overloading landmarks into `hubs` would leak POIs into hub views/pages and muddy that
semantic, the same way hubs deliberately weren't overloaded onto `stations`.

**Decision:** POIs are their own entity (`pois` + `poiStations`), mirroring the
**shape** of `hubs`/`hubStations` for identity and the **shape** of a `transfers`
row for adjacency — but reusing neither table directly.

## Identity: `id` + `slug` (mirrors hubs)

Same rationale as `transit-hubs.md`:

- **`id`** — opaque, stable PK, `POI-…` prefix (e.g. `POI-GBK`, `POI-ANCOL`).
  All relations point here; the prefix is also the runtime discriminator (below).
- **`slug`** — human-facing URL key (`/places/gbk`), mutable/cosmetic.

The `POI-` prefix is load-bearing at runtime — it's how the fare endpoint, the graph
injector, and the access-leg detector tell a POI id from an `OPERATOR-CODE` station
id **without a schema lookup**. Keep it.

## Storage: `pois` + `poiStations` (database)

Same reasoning as hubs — must surface in the picker alongside DB stations, wants real
editorial columns and edit-without-redeploy, membership is a natural relation.

### Schema — `NNNN_add_pois_tables.sql` (use the next migration number)

```sql
CREATE TABLE pois (
  id          VARCHAR(48) PRIMARY KEY NOT NULL UNIQUE,  -- stable, e.g. 'POI-GBK'
  slug        VARCHAR(64) NOT NULL UNIQUE,              -- URL key, mutable
  name        VARCHAR(128) NOT NULL,
  keywords    TEXT,           -- curated aliases/nicknames for search: 'Senop' (Senopati), 'JCC' — nullable
  category    VARCHAR(32),    -- from the Jak Lingko set, see "Categories" below; nullable
  description TEXT,           -- editorial (someday), nullable
  heroImage   VARCHAR(255),   -- path or R2 URL, nullable
  latitude    REAL,           -- POI centroid (you already have coords), nullable
  longitude   REAL,
  score       INTEGER NOT NULL DEFAULT 0,  -- picker ranking, like stations.score
  createdAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pois_slug ON pois (slug);

CREATE TABLE poiStations (           -- access walks: a POI ⇄ a nearby station
  id         VARCHAR(96) PRIMARY KEY NOT NULL UNIQUE,  -- `${poiId}:${stationId}`
  poiId      VARCHAR(48) NOT NULL,   -- FK -> pois.id (stable)
  stationId  VARCHAR(48) NOT NULL,   -- FK -> stations.id
  distance   INTEGER NOT NULL,       -- walk metres (the honest, reported distance)
  notes      VARCHAR(255),           -- e.g. 'via Gerbang Utama', nullable
  createdAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_poiStations_poiId ON poiStations (poiId);
CREATE INDEX idx_poiStations_stationId ON poiStations (stationId);
```

`poiStations` is deliberately a **transfer-shaped** table (a from/to/distance walk
link) rather than more rows in `transfers` — so POI access walks never bleed into the
station↔station transfer graph, and their semantics stay separable (see fare-summary
below). Kysely: `PoiSchema` + `PoiStationSchema` in
`apps/api/src/db/schemas/pois.ts`, registered in `schemas/index.ts`. Seed via a
generated `pois.sql` (same pattern as `hubs.sql` / `edges.sql`).

### Categories — take Jak Lingko's, don't invent one

`category` uses the POI vocabulary from the official DKI wayfinding standard rather than
a set coined here (see `jaklingko-wayfinding.md`). The rider has already met these
categories on station totems and locality maps, and each one has a drawn pictogram
waiting if we ever render category icons:

> Pasar, Masjid, Gereja, Pura, Klenteng, Vihara, Monumen, Museum, Kantor Polisi, Pemadam
> Kebakaran, Rumah Sakit, Sarana Olahraga, Penginapan, Pusat Perbelanjaan, Kantor
> Pemerintahan, Sekolah/Universitas, Apartemen/Perkantoran, Perumahan, SPBU, Pusat Wisata,
> Perpustakaan, Taman/RPTRA, Restoran, Kafe, Kantor Pos, Kedutaan Besar, Teater, Galeri
> Seni, Pantai, Bank.

Two additions of our own, both justified by things the standard handles differently:

- **`DISTRICT`** — the standard has no district category because a totem stands *inside*
  the district and never needs to point at it as a destination. We do (see the nightlife
  archetype above), so this one is ours.
- **`LANDMARK`** — the standard's answer for famous places is a *bespoke glyph per place*
  (Monas, Istiqlal, Kota Tua, GBK, Ancol…), which is an artwork commitment we aren't
  making. `LANDMARK` is the honest stand-in for "famous enough to deserve its own mark".

### What earns POI status — the two-tier test

The standard's curation criteria, worth following because they select for **navigational**
value rather than importance:

- **Primary** — a public attraction with heavy visitation; the nearest transit or
  bike-share access point; a distinctly local place; internationally recognised.
- **Secondary** — memorable and easily identified along a walking route; heritage or
  architecturally unusual; a place that *defines* an area; an important or well-known
  building; sited at a major junction.

The secondary tier is the useful one and the easy one to get wrong. A strange-looking
building on a corner is a better POI than a nationally significant one set back behind a
wall, because the test is "can the walker confirm they're on track", not "does this
matter". Curate `pois` rows against these, not against a mental list of famous places.

### Seeding — coords make this semi-automatic

You already have station coords. For each curated POI (coords in hand), compute the
*k* nearest stations by great-circle distance under a walking threshold (~1.2 km),
eyeball the candidates, keep the sensible entrances, hand-tune `distance` to the real
walking metres (not crow-flies). The nearest-station computation is the discovery aid;
the curated `poiStations` rows are the source of truth — same philosophy as the hub
connected-components seeder.

## Routing integration — inject at the endpoints, keep POIs out of the base graph

`fares.ts` caches one station-only `RouteGraph` per isolate (`cachedGraph`, built from
`EdgeRepository.getGraphInputs()`). **Keep POIs out of that cached graph.** When an
endpoint is a POI, build a **per-request overlay**: shallow-clone the adjacency and add
the POI node plus its symmetric walk edges (mirror `buildGraph`'s transfer handling).
Cloning a ~180-node `Map` is cheap, and it happens only on POI requests — station↔station
fares keep using the untouched singleton.

**Why inject instead of baking POIs into the base graph:** it's a *hard* guarantee that
a POI is never used as a **mid-route walking shortcut** between two stations (A → walk →
POI → walk → B). The double transfer penalty (1600 m) already makes that nearly
impossible, but "nearly" isn't "never" — injecting only the queried endpoint's POI
removes the possibility entirely.

> **Corrected 2026-08-02.** This section previously cited `TRANSFER_PENALTY_M` as
> 2500 m (double: 5000 m). The real value is **800 m** (`router.ts`), so the
> penalty is roughly a third of what was assumed here. The conclusion still
> holds — injection is a hard guarantee and the penalty was only ever a soft one
> — but the "nearly impossible" fallback is meaningfully weaker than written, and
> anyone reconsidering the rejected `transfers`-row alternative should re-derive
> it against 800 rather than trusting the old figure. (Rejected alternative: store access walks as
`transfers` rows and lean on the penalty. Cleaner storage, weaker guarantee, and it
muddies fare-summary semantics below.)

Sketch:

```ts
// fares.ts — endpoints may now be POIs
const router = await getRouter(c.env.DB)          // station-only, cached Tsundere handle
const withPoi = injectPoiEndpoints(router, [fromId, toId], poiAdjacency)  // per-request clone
const legs = withPoi.findRoute(fromId, toId)
```

## Fare-summary semantics — the one real gotcha

Fares stay **correct**: a POI access walk is only ever the **first or last** leg (a POI
is always an endpoint, never intermediate), so it never splits a paid RIDE run in the
middle. `calculateSegmentFare` only ever sees station codes. Good.

But `summarizeFares` increments `transferCount` for **every** TRANSFER leg, and the UI
renders that as "Nx transit". An access walk from GBK to Istora is **not** an
interchange — counting it as "1x transit" is wrong, and the generic walk card
("Jalan kaki ± N m ke Istora") doesn't say you're walking *from GBK*.

**Fix — tag access legs distinctly.** In `fares.ts`, a TRANSFER leg whose `from` or
`to` id is `POI-…` is an **access** leg, not an interchange. So:

1. Add an `ACCESS` leg type to `FareResultLeg` (or a `access: true` flag on the transfer
   leg), set when an endpoint is a POI.
2. **Exclude access legs from `transferCount`** (subtract them, or filter before the
   count) so "Nx transit" reflects real interchanges only.
3. Frontend `JourneyTimeline` renders an `ACCESS` leg naming the POI —
   *"Jalan kaki dari GBK ± 300 m ke Istora"* for a leading walk, *"… ke Ancol"* for a
   trailing one — distinct from a mid-route interchange walk.

`totalDistanceM` **should** keep including the access walk (it's real distance the user
covers); only the transfer *count* and the leg *label* need the POI-awareness.

## Endpoint + name resolution (`fares.ts`)

- **`getByIds([fromId, toId])`** currently requires both to be `stations` rows, so a
  `POI-…` id 404s as `UNKNOWN_STATION`. Resolve POI ids too: fetch via a `PoiRepository`
  and accept an endpoint that is *either* a station or a POI.
- **`name(id)`** resolves leg-endpoint display names from the fetched `stations`; it must
  also know POI names so a POI endpoint's `stationRef` shows "GBK", not the raw id.
- **KV key** `fares:${fromId}:${toId}:${API_VERSION}` works unchanged (more entries, all
  bounded and lazily filled).
- **`SAME_STATION`** (`fromId === toId`) is unaffected — two distinct POIs never collide.

## Frontend (fare-sheet picker + timeline)

- **Picker inclusion.** `StationPickerDialog` builds `pickableStations` from
  `station.regionCode === 'CGK'` — that filter excludes POIs. Feed POIs in through a
  separate path (a `/pois` route fetched alongside `/stations`, or folded into the
  stations payload with a type tag). The levenshtein search already keys off name/code,
  so POI names are searchable as-is — **but also match against `pois.keywords`** so
  nicknames ("Senop", "JCC", "SCBD") resolve, not just proper names.
- **Picker rendering.** A POI row has no lines — render a **landmark icon** and a small
  "Tempat" tag instead of `LineRoundel` badges, so it reads as a place, not a station.
- **Quick-picks.** Iconic POIs are natural quick-pick chips ("Sering dipilih") and an
  engagement hook — GBK on match/concert nights, Ancol/Dufan on weekends.
- **Origin naming.** The `StationField` "Dari" already shows the selected origin (GBK),
  so even before the `ACCESS`-leg label lands, the user isn't fully lost — but ship the
  labelled access leg for clarity.

## Edge cases

- **POI adjacent to the exact destination station** (origin GBK, destination Istora):
  route is walk-only, no RIDE run → `totalFare` reduces to 0. Show *"Cukup jalan kaki,
  tanpa tarif"* rather than "Rp 0".
- **Both endpoints POIs** (GBK → Ancol): two access legs, `walk → ride → … → walk`.
  Works; both are excluded from `transferCount` by the rule above.
- **Unreachable POI** (all its stations off the routable graph): `findRoute` returns
  null → existing `NO_ROUTE` path. Fine.

## Reuse / future

For the eventual trip planner, a POI is already a first-class origin/destination node —
the access-walk injection and `ACCESS` leg are exactly what a door-to-door plan needs;
the planner just adds the time layer on top. Same graph machinery as `transit-hubs.md`
and `platform-codes.md`.

## Bonus: reverse-read → "what's nearby" on station/hub pages

`poiStations` is many-to-many, so reading it **by `stationId`** — the reverse of the fare
lookup — hands you every POI near a station, from data you're curating for fares anyway.
`SELECT … FROM poiStations WHERE stationId = ? ORDER BY distance`, joined to `pois`,
capped to a few and ranked by walk distance (with `score` to break ties, so a dense node
like Istora doesn't dump eight POIs). On the **station page** it's a "Tempat terdekat"
section in `StationContent`; on the **hub page**, union across `hubStations` members and
keep each POI's *minimum* walk distance.

**Scope flag:** this is a *third* surface — discovery on station/hub pages, not fare and
not planner. Genuinely additive. Ship it **after** the fare POI picker so it doesn't
balloon the fare workstream; it's downstream of the same data.

**The fork it forces — what a `poiStations` row means:**

- *Best-entrance only* (minimal) — each POI links to the station(s) giving the cheapest
  route onto the network. Routing-optimal, but "what's nearby" **under-shows**: a POI near
  station X whose curated edge points at station Y won't appear on X.
- *All-nearby* (richer) — every walkable station near the POI gets a row. Routing still
  picks the best entrance (the transfer penalty sorts it out), **and** the reverse read
  becomes a complete "what's nearby". Costs a little more curation and a few more graph
  edges (negligible at ~180 nodes).

**Recommendation: all-nearby**, so one curated table does double duty (fares + discovery).
If you'd rather keep fare edges minimal, compute "what's nearby" from raw coords
(Haversine — you have coords on both sides) instead, trading hand-tuned walking metres for
crow-flies distance.

## Build order

1. Migration + `schemas/pois.ts` (`PoiSchema`, `PoiStationSchema`) + register in
   `schemas/index.ts`.
2. `PoiRepository` — POIs with their `poiStations` adjacency; a `getPoiAdjacency()`
   returning walk edges for the graph injector.
3. `fares.ts`: resolve POI endpoints, per-request `injectPoiEndpoints`, `ACCESS` leg
   tagging, `transferCount` exclusion, POI-aware `name()`.
4. `ACCESS` leg type in `models/fare.ts` (api) + `apps/web/models/fare.ts`, rendered in
   `JourneyTimeline`.
5. Web: `/pois` fetch, merge into the picker candidate list, landmark icon + "Tempat"
   tag, POI quick-picks.
6. Seed script (nearest-stations-by-coords → curated `pois.sql`).

## Open / to decide later

- Final POI roster + slugs + walking thresholds per POI.
- Max access-walk radius before a district is "out of scope for rail" (the Kemang line).
- Walk-distance source: hand-tuned metres vs a routing/maps estimate.
- Whether POIs get their own `/places/:slug` page (like hubs) or live only inside fares.
- Whether to surface POIs on the map as tap targets (defer — reuse the hub tap-target
  work in `transit-hubs.md` if so).
- `ACCESS` as a new leg type vs a boolean flag on the transfer leg. (lean: new type)
