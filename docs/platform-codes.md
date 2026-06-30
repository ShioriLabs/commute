# Platform codes on departure groups

**Status:** design note — decision made, *not yet implemented*. Held because the
station/direction count to curate is large; revisit before building.

## Goal

Show which platform/track a departure uses, e.g. "Peron 3", on a **departure
group** — one `{ boundFor, via, schedules }` entry of a line in the grouped
timetable.

## What a "departure group" actually is

It is **not a stored row**. The grouped timetable is computed at request time in
`apps/api/src/routes/stations.ts` (~L220–272): flat `schedules` rows are bucketed
into a `Map` keyed by `(lineCode, boundFor, via)`, then each bucket is emitted as
`{ boundFor, via, schedules }`. The only stored table is `schedules`
(`apps/api/src/db/schemas/schedules.ts`); directions/groups are derived.

## Why not store it on the schedule

No operator (KCI/MRTJ/LRTJ/LRTJBDB) publishes per-train platform. So:

- **Per-train, on `schedules`** (add a column, populate in sync) — rejected. The
  data to fill it doesn't exist, it would be duplicated across ~28k rows, and it
  gets clobbered on every timetable resync.
- **Curated platform-per-direction** — chosen. Platform is stable station
  infrastructure (a property of station + line + direction), not train data.

## How GTFS models it (reference)

GTFS does **not** put platform on the schedule. It makes the platform a *place*:

- `stops.txt` `location_type`: `1` = station, `0` = platform, with `parent_station`
  linking platform → station (`2` entrance, `3` node, `4` boarding area).
- `platform_code` on the platform row holds the **bare** identifier ("3", "G") —
  the spec says do *not* include the word "Platform"/"Track"; that's the UI's job.
- `stop_times.stop_id` references the *platform-level* stop, so "which platform
  does this trip use" is encoded by the reference, not a field on the trip.

The catch: that mechanism needs **per-trip platform data** to populate the
`stop_times` reference. We don't have it, and core GTFS has *no* "this direction
always uses platform 3" concept. So a faithful GTFS port (child platform rows in
`stations` + `schedules.stationId` → platform id) buys nothing until a feed gives
per-train platforms. We borrow only the **convention**: field named
`platformCode`, value is the bare identifier.

## Decision: curated map, in code (not DB)

Lives in `@commute/constants` (`apps/constants/src/index.ts`) — the existing home
for curated static reference data (`MRTJ_STATION_CODES`,
`CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES`, …), already imported by the
grouping route.

| Factor | Why code wins |
| --- | --- |
| Changes rarely, dev-curated by hand | Version-controlled, lands in a PR diff, no migration |
| Keyed on free-text `boundFor`/`via` | Those strings are generated in `stations.ts`; co-locating means a wording change and its key change typecheck together instead of silently drifting |
| Consumed in one hot path, already KV-cached | In-memory lookup; a table would add a query/join for no benefit |
| No admin UI, no sync source | DB only wins for non-dev editing or synced/independently-queried data — none apply |

## Shape

Mirror the grouping key exactly. In `stations.ts:245` the key is
`boundForKey = via ? `${boundFor}:${via}` : boundFor`.

```ts
// apps/constants/src/index.ts
// GTFS convention: bare identifier only ("3", not "Peron 3").
// Key: `${stationId}:${lineCode}:${boundForKey}`
export const PLATFORM_CODES: Record<string, string> = {
  'KCI-MRI:C:Jakarta Kota': '5',
  'KCI-MRI:C:Bogor': '6',
  // … unmapped → undefined → null
}
```

Integration in the emit (`stations.ts` ~L256–264, where `key` *is* the boundForKey):

```ts
platformCode: PLATFORM_CODES[`${station.id}:${line.lineCode}:${key}`] ?? null,
```

Add `platformCode: string | null` to the `timetable[]` entry type in **both**
`apps/api/src/db/schemas/schedules.ts` and `apps/web/models/schedules.ts`
(`LineTimetable` + `CompactLineTimetable`). Then `timetable-content` / `LineCard`
can render "Peron {platformCode}".

## Caveats / open questions

- **KV cache:** the grouped output is cached under `API_VERSION`. Platform values
  are baked into that payload, so adding/editing the map **won't surface until
  `API_VERSION` is bumped** (same gotcha as the passage-time filter).
- **Scale (the reason this is parked):** the key space is
  `station × line × direction`. Hand-filling all of Jabodetabek is a lot. Options
  to consider before committing:
  - Start with a few high-traffic interchanges (Manggarai, Tanah Abang,
    Jatinegara, Duri) and let everything else fall through to `null`.
  - Whether the free-text `boundFor` key is stable enough, or if a sturdier key
    (destination station code) is worth the extra mapping step.
  - Whether some platforms are better expressed per *station+line* (terminus,
    single-island stations) vs full per-direction granularity.

## Likely-better alternative: derive direction, not platform

Observation: Google Maps uses KRL's real internal GTFS and **still doesn't show
platform numbers** — it shows *"Follow signs for Manggarai, Sudirman, Tanah Abang,
Duri, Kampung Bandan, Jatinegara"*. That confirms KAI's GTFS carries no
`platform_code`; if it did, Maps would render it. What Maps shows is **wayfinding
by direction**, sourced in GTFS from either:

- `pathways.txt` `signposted_as` (authored sign text), or
- more likely, **synthesized from the trip's downstream `stop_times`** — the next
  stations the train passes. The example string is exactly the Cikarang-loop
  downstream stop sequence, i.e. direction-as-stations, not a platform.

**Implication:** the scalable signal is the **downstream station list**, and we can
*derive* it from the topology graph already built (`edges` + per-line station codes
+ the group's `boundFor`/`via`):

1. For a group `(stationId, lineCode, boundFor)`, walk `edges` from the station in
   the `boundFor` direction (station codes encode the Cikarang lollipop, Bogor/Nambo
   fork, etc.).
2. Emit the next *N* stops as `downstreamStations: string[]` on the departure group.

Why this likely beats `PLATFORM_CODES`:

- **No per-station curation** — kills the "stations is many" blocker; covers the
  whole network automatically and stays correct as it changes.
- **Reuses the routing work** (`edges`) instead of being throwaway curation.
- Matches what users actually see on Google/station signage.

Cost: a graph walk per group (cache in KV like the rest, or precompute), heavier
than a static string lookup. Edge cases to handle: loops (don't walk past the
origin), branches (pick the fork matching `boundFor`), and where to truncate *N*.

## Chosen direction: progressive enhancement (derived base + sparse overlay)

Two layers, so the feature is useful immediately and improves as platforms get
backfilled by hand "when the mood strikes":

- **Base layer — derived direction (automatic, network-wide):** the
  `downstreamStations` walk above. Always present, zero curation.
- **Overlay layer — curated `platformCode` (sparse, incremental):** added by hand
  for directions we actually know. Missing → no badge, direction still renders.
  Never an empty state, never blocks shipping.

### Key the overlay on the NEXT HOP, not `boundFor`

Platform is a property of *which way the train physically leaves the station* (the
edge taken out), **not** the final terminus. Example: "all trains leaving Cakung
*away from Bekasi* use 3/4" is **one** physical direction (westbound → Klender Baru)
but **many** `boundFor`s (Kampung Bandan, Jakarta Kota, Angke, …).

So the overlay map is keyed `(stationId, lineCode, nextHopStationId)`:

```ts
// apps/constants/src/index.ts  — supersedes the boundFor-keyed shape above.
// GTFS convention: bare identifier only.
export const PLATFORM_CODES: Record<string, string> = {
  'KCI-CUK:C:KLB': '3/4', // Cakung, Cikarang line, departing toward Klender Baru
}
```

One entry covers **every** train going that direction, regardless of terminus —
maximum coverage per keystroke, which is what makes armchair curation viable (no
field trips). `boundFor`-keying was rejected: it forces a near-duplicate row per
terminus sharing a direction — exactly the friction that kills the mood.

### Shared machinery

Resolving a group's `nextHopStationId` = walk `edges` from the station toward
`boundFor`, take the first edge. That's the *same* computation `downstreamStations`
needs (it just keeps walking N stops). Build "which way does this group go?" once →
get both the direction list (base) and the overlay lookup key. Existing `via`
disambiguation handles the Bekasi interlining fork, so junctions resolve correctly.

### Output on the departure group

```ts
{
  boundFor, via, schedules,
  downstreamStations: string[],     // base, always
  platformCode: string | null,      // overlay, when curated
}
```

UI: always show the direction; if `platformCode` present, add a "Peron {code}"
badge. Still bump `API_VERSION` on overlay edits (values are baked into the KV
cache).
