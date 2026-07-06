# TransJakarta GTFS import

**Status:** recon notes — feed verified, import not yet designed. Companion to
`transit-hubs.md` (TJ haltes will join hubs) and the fare work on
`dhika/fare-calc`.

## Goal

Import TransJakarta's static GTFS into our data for **trip planning and fare
calculation only** — no schedules. TJ has no real timetable and publishes no
GTFS-Realtime, so stop patterns, distances, transfer links, and fare rules are
the only parts we want.

**Scope (decided):** BRT + integrated non-BRT (Angkutan Umum Integrasi) first.
No Mikrotrans, Royaltrans, Rusun, Shuttle, or Bus Wisata in v1.

## The feed

- **Official URL:** <https://gtfs.transjakarta.co.id/files/file_gtfs.zip>
  (verified 2026-07-06, dataset dated 2026-06-29 — actively maintained).
  Mirror: Mobility Database feed `mdb-1909`.
- Agency id `Tije`, single agency, WGS84, `Asia/Jakarta`.
- Ships fares-v1 (`fare_attributes` + `fare_rules`), `transfers.txt`,
  `frequencies.txt`, full `shapes.txt`.

### It is pattern-based, not timetabled

Only **730 trips** exist — one per route variant — with `frequencies.txt`
(783 rows) giving service span + headway per trip. `stop_times.txt` is just
~27k rows of synthetic times. So "skip the schedules" is the feed's native
shape: parse `stop_times` once for the ordered stop sequence per trip, discard
the times.

### `route_desc` is a clean category label

All 256 routes are categorised — scope filtering needs no heuristics:

| route_desc | routes | fare |
|---|---|---|
| BRT | 35 | FP |
| Angkutan Umum Integrasi | 65 | FP (52) / FP2 (13) |
| Mikrotrans | 99 | GR |
| Transjabodetabek | 18 | FP (17) / FP2 (1) |
| Rusun | 17 | FP |
| Royaltrans | 10 | PP (9) / PP3 (1) |
| Shuttle | 9 | — (no fare rule) |
| Bus Wisata | 3 | GR |

Scope = `route_desc IN ('BRT', 'Angkutan Umum Integrasi')` → **100 routes,
331 trip patterns**. Feed provides `route_color`/`route_text_color` per route.

### Stop hierarchy: ID prefixes encode structure

- `H…` — **median halte** (`location_type=1` station; 291 in feed). Suffix
  variants exist (`H00047P`, `H00209S`, `H00027C`).
- `G…` / `P…` — **platform children** of an `H` station (`parent_station` set,
  `platform_code` like `A-B-C`). BRT trips reference these, not the parent.
- `B…P` — **roadside/curbside stop**, flat (no parent). What Integrasi routes
  mostly serve.

Normalising every stop_times reference to `parent_station ?? stop_id` yields
halte-level patterns. The roadside-vs-median distinction we care about for
transfers is therefore **structural** (prefix + `location_type`), not
name-parsing.

**Scope volume, parent-collapsed:** 2,209 stops = **263 median haltes +
~1,945 roadside stops** (+1 temp-stop cruft). BRT alone: 245 haltes + 4
roadside. The Integrasi routes bring nearly all the roadside volume.

### Fares-v1 answers the transfer question

`fare_attributes` (IDR, pay-on-board):

| fare_id | price | transfer_duration | used by |
|---|---|---|---|
| FP | 3,500 | 10,800 s (3 h) | BRT + most Integrasi |
| FP2 | 3,500, `transfers=1` | 10,800 s | 13 Integrasi routes |
| GR | 0 | 10,800 s | Mikrotrans, Bus Wisata |
| PP / PP2 / PP3 | 20k / 25k / 35k | 10,800 s | Royaltrans |

So TJ fare calc is **Rp 3,500 per journey-chain within a 3-hour window**, and
the route→fare mapping is explicit in `fare_rules` (route-based, no zones).
The pre-07:00 Rp 2,000 tariff is *not* representable in fares-v1 and is absent
— if we ever show it, it lives beside our other time-dependent tariff
constants (cf. the LRT Jabodebek cap).

### Distances come free

`shape_dist_traveled` is populated on effectively every `stop_times` row
(cumulative metres). Consecutive diffs are exactly our `edges.distance` — the
same semantics as the `track` source in `generateEdgesSQL.ts`. No haversine
fallback needed.

### Name-suffix grouping is weaker than it looks

The "roadside stops share the halte's base name + number" convention
(*Dukuh Atas 4* → *Dukuh Atas*) only holds for **56 of 378** numbered roadside
base-names in scope. Transfer links between roadside stops and haltes must be
**proximity-based**, with name matching as corroboration only.

### Cruft to filter

- Stops named `… (Archived)` (present but unreferenced by any trip).
- `TEMP501` (*Term. Kampung Melayu 4*) — temp stop, no prefix convention.
- `transfers.txt` is only 14 rows of paired `H`↔`H` haltes (skybridge/opposite
  pairs) — useful, tiny.
- `route_list.txt` — non-standard extension file, ignorable.

## Mapping to our schema

| GTFS | Ours | Notes |
|---|---|---|
| `H…` haltes | `stations` | operator `TJ` (new in `OPERATORS`), region `CGK` |
| routes | lines / `stationLines` | `lineCode` = `route_short_name`; colors from feed |
| stop sequences | `edges` | directed pairs, distance from `shape_dist_traveled` diffs |
| roadside↔halte links | `transfers` (INTERNAL) | proximity-derived, not name-derived |
| interchange complexes | `hubs` | e.g. Dukuh Atas halte joins the existing hub |
| `fare_rules` | `operators/tj/fares.ts` | flat 3,500; chain-collapse in fare-summary |

The importer follows the `db/scripts/generate*SQL.ts` pattern: a re-runnable
script that downloads the zip, filters to scope, normalises, and emits SQL
seeds. TJ routes churn often enough that one-off hand-massaging would rot.

## Open decisions

1. **Roadside stops as full `stations` rows?** ~1,945 rows with no
   codes/amenities would swamp station search. Options: full rows + a
   type flag; a lighter separate table; or haltes-only in v1 (capping
   Integrasi trip planning at halte-to-halte).
2. **Line granularity.** 100 TJ `lineCode`s dwarfs the current rail-line
   count. Fine for the router; the lines page likely wants corridor grouping
   or a TJ-specific presentation.
3. **Fare source of truth.** Trust the feed's fares-v1 (route→fare_id, data-
   driven) vs hardcoding like other operators. Feed data is fresh and correct
   today; constants are simpler and match the existing pattern.
4. **Pattern variants.** Routes carry AMARI (night) and express variants as
   separate trips. Keep as distinct patterns, or merge per route+direction?
5. **JakLingko integration cap** (Rp 10k / 3 h across TJ+MRT+LRT) — belongs in
   fare-summary once multi-operator TJ journeys exist; out of scope for the
   importer itself.
