# Service hours and day types

**Status:** *design* — nothing built. Implements the service-hours half of
`go-mode.md`'s **Tier 2** (schedule-aware routing). Companion to
`tj-gtfs-import.md` (where the TJ calendar comes from).

## Goal

Stop the router from planning trips onto corridors that are not running.

Today the router is **time-blind**: `@commute/tsundere` takes `edges`,
`transfers`, `restrictions`, and `headwaysS`, and nothing in that input says
*when* a line runs. A 3am Kuningan→JKT48 query returns the daytime answer
(13E + 9C) even though neither corridor is in service; the honest answer is
Koridor 1 AMARI, which runs all night.

Two layers get us there, and they are worth naming separately because they have
very different data quality:

1. **Service hours** — the daily window a line runs. Solid across every
   operator; this is where the value is.
2. **Day types** — whether that window differs by weekday / weekend / holiday.
   Real for TransJakarta, derivable for MRT, **absent** for the rest.

## What the data actually supports

Measured against the production D1 snapshot of 2026-08-03 and the TJ GTFS feed
in `apps/api/src/db/scripts/file_gtfs/`.

| Operator | Service hours | Day types | Source |
| --- | --- | --- | --- |
| **TransJakarta** | ✅ explicit spans | ✅ real calendar | GTFS `frequencies.txt` + `calendar.txt` |
| **MRT Jakarta** | ✅ derivable | ✅ **in the feed, currently discarded** | datum feed `weekdays*` / `weekends*` |
| **LRT Jabodebek** | ✅ derivable | ⚠️ **exists, not yet transcribed** | Instagram posters, same as weekday |
| **KCI** | ✅ derivable | ❓ unconfirmed — needs a GAPEKA check | `schedules` table only |
| **LRT Jakarta** | ✅ derivable | ❌ none known | `schedules` table only |

Three specifics that constrain the design:

**TJ spans are explicit and already correct.** 548 of 730 trips carry
`05:00:00–22:00:00`; 88 carry `00:00:00–23:59:59` — the genuine 24-hour AMARI
night corridors. No derivation needed, just import.

**MRT already fetches weekend data and throws it away.** `MRTJDatumSchedule`
declares `weekendsStart` / `weekendsEnd` (`datum.ts:20-21`), but
`buildStationTimetable` reads only the `weekdays*` fields. There is a standing
`TODO` at `datum.ts:216` saying exactly this. The gap is the `schedules` table
having nowhere to put a second day's timetable — not the feed.

**Holidays cannot be derived at all.** `calendar_dates.txt` is **empty** (header
row only), so the feed declares zero exceptions. A holiday list has to be
hand-maintained. Two `calendar.txt` service IDs are also stale and must be
ignored on import: `HJ` (ended 2025-12-31) and `X` (two days in 2005).

**LRT Jabodebek publishes a weekend timetable — we just have not transcribed
it.** Its schedules are already hand-transcribed from the official
[@lrt_jabodebek](https://www.instagram.com/lrt_jabodebek/) Instagram posters
into 48 CSVs under `operators/lrtjbdb/timetables/`, with a documented
review workflow in that directory's `README.md`. A weekend variant needs no new
machinery — it is more transcription through the pipeline that exists, plus a
day-type field in the `<STATION>_<LINE>_<DEST>.csv` filename convention. The
cost is human, not technical: up to 48 more posters to transcribe and review.

**KCI weekend service is unconfirmed.** KCI schedules once carried a weekend
marker, but current data shows none; whether Commuter Line still runs a distinct
weekend timetable needs checking against **GAPEKA** (the official published
travel chart) rather than inferring from what we have already imported. Until
that check happens, KCI is treated as having no day-type data — which, under the
fallback rule below, means its weekday window applies every day.

## Deriving rail service hours: percentiles, not min/max (decided)

The obvious implementation — `MIN(estimatedDeparture)` and
`MAX(estimatedDeparture)` per line — **silently disables the feature**. KCI
lines B and R both report a `00:00:00–23:59:00` span, which reads as "runs 24
hours" and filters nothing.

The hourly histogram for line B shows why that reading is wrong:

```
00:00  63     04:00 147     08:00 439     …     22:00 252
01:00   2     05:00 357     09:00 437           23:00 160
03:00   2     06:00 450     10:00 376
```

The real window is about **04:00–00:59**, with a dead zone from 01:00 to 03:59.
The four departures at 01:00 and 03:00 are outliers, but `MIN`/`MAX` weight them
equally with the 450-departure morning peak.

So: take the **1st and 99th percentile** of departures per line, rounded outward
to the minute, rather than the extremes. This is the same failure mode
`generateHeadways.ts` already documents and solves — it uses the *median* gap
between departures because the overnight gap "is not a wait anyone experiences,
and it would drag a mean to nonsense." Same trap, same shape of answer.

**Windows may cross midnight.** A line running 04:00–00:59 has `startS >
endS`, so every comparison must be modular: `inService(t) = start <= end ? (t >=
start && t <= end) : (t >= start || t <= end)`. This is the single easiest thing
in the design to get wrong.

## Day-type resolution differs per operator (decided)

There is no single day-type model, because the operators do not carry the same
information. Resolution is therefore **per operator**, from a single resolved
calendar day:

**TransJakarta — three-way, from the feed.** `calendar.txt` distinguishes
`HK` (Mon–Fri), `HL` (Sat–Sun), `HM` (Sunday only), `HR` (Mon–Sat), and `SH`
(daily). TJ genuinely runs a Sunday-specific service, so its day types are
`WEEKDAY | SATURDAY | SUNDAY`.

Those five service IDs do not map one-to-one onto three day types, so the
import resolves them **per weekday bit** rather than by name: a service is in
force on a given day type if its column for that day is `1`. `HR` (Mon–Sat)
therefore contributes to both `WEEKDAY` and `SATURDAY` but not `SUNDAY`, and
`SH` contributes to all three. Reading the bits rather than special-casing the
IDs means a feed refresh that adds a sixth service needs no code change.

**Rail — two-way, and holidays resolve to weekend.** MRT's feed has exactly two
variants, `weekdays*` and `weekends*`. There is no Sunday-specific rail data to
model, so rail day types are `WEEKDAY | WEEKEND`, and **a national holiday
resolves to `WEEKEND`**.

That last point is a decision, not a measurement. It is backed by real data for
MRT (whose feed has exactly two variants) and for LRT Jabodebek (which publishes
a weekend timetable, pending transcription). For **KCI** — unconfirmed until
someone checks GAPEKA — and **LRT Jakarta** — no known weekend data — it is an
**assumption**, and the doc says so plainly so nobody later mistakes it for
imported data. Rejected alternatives:

- *Fall back to weekday on holidays* — never under-reports service, but happily
  routes onto a corridor that is shut. That is the bug we are fixing.
- *Mark unknown and skip filtering* — degrades to today's time-blind behaviour
  on exactly the days people most need to check. Never wrong, never useful.

**Holidays are a hand-maintained list**, since the feed carries none: a
`HOLIDAYS` set of `YYYY-MM-DD` strings for Indonesian *hari libur nasional*, in
`@commute/constants` beside the other authored data. It needs a yearly update,
and a stale list degrades safely — an unlisted holiday is treated as whatever
weekday it falls on, i.e. today's behaviour.

## Storage: generated module, not a DB table (decided)

Service hours become a **build-time generated file**,
`apps/api/src/db/data/service-hours.ts`, emitted by a new
`generateServiceHours.ts` script and imported by `routes/fares.ts`.

This deliberately mirrors `generateHeadways.ts` → `db/data/headways.ts` →
`fares.ts`, which is the established pattern for *derived, slow-moving,
per-line* routing inputs. The properties that make it right there make it right
here: no query cost on the hot path, reviewable in a diff when a window shifts,
and no migration needed to change a number.

Rejected: **a `serviceHours` table**. Service hours are derived data, not
editorial — nobody hand-edits them the way they hand-edit a hub description, so
the edit-without-redeploy benefit that justified a table in `transit-hubs.md`
does not apply. It would also add a query to router construction, which is
already the costliest cold path.

Shape, keyed by line code and day type:

```ts
export const SERVICE_HOURS: Record<string, Partial<Record<DayType, Window>>> = {
  '1':  { WEEKDAY: [0, 86399], SATURDAY: [0, 86399], SUNDAY: [0, 86399] },
  'B':  { WEEKDAY: [14400, 3599], WEEKEND: [16200, 3599] },
  // …
}
```

`Window` is `[startS, endS]`, seconds since local midnight, `endS < startS`
meaning the window crosses midnight. A **missing day type falls back to the
line's most permissive window** rather than to "closed" — a line we lack
weekend data for keeps its weekday hours, so absent data degrades to today's
behaviour instead of falsely closing a running line.

## The MRT weekend timetable needs a schema change

Day types for MRT require the `schedules` table to hold two timetables per
station. It currently cannot: the schema is `id, stationId, tripNumber,
estimatedDeparture, estimatedArrival, boundFor, lineCode`, with no day column,
and the primary key `${stationId}-${time}-${direction}` would **collide** between
a weekday and weekend departure at the same minute.

Migration `0015_add_schedule_day_type.sql`:

- add `dayType VARCHAR(8) NOT NULL DEFAULT 'WEEKDAY'` — the default backfills
  every existing row correctly, since everything currently stored *is* the
  weekday timetable;
- extend the synthetic id and `tripNumber` to include the day type, so weekend
  rows cannot collide with weekday ones;
- index `(stationId, dayType, estimatedDeparture)`, replacing
  `idx_station_departure`, since every departure-board query will now filter on
  day type.

Then `buildStationTimetable` emits both variants, and `synthesizeTripNumbers`
runs per day type — its `MRTJ-{even/odd}` numbering restarts within each,
keeping weekday numbers unchanged from today.

**This is the only part of the design that touches the trip synthesizer**, and
only to run it twice. Its per-snapshot positional numbering (documented at
`datum.ts:180-184`) is unaffected: numbers stay stable for identical feed
content within a day type.

## Router interface: a new tsundere input

`loadGraph` gains an optional `serviceHours` input alongside `headwaysS`, and
`plan()` gains a departure time. Both optional, so omitting them preserves
exactly today's behaviour — every existing test stays valid, and the change is
additive.

```ts
loadGraph({ edges, transfers, restrictions, headwaysS, serviceHours })
plan(from, to, { departureAt, dayType })
```

Filtering happens at **edge relaxation**: an edge whose `lineCode` is out of
service at `departureAt` is skipped, exactly where `expectedWaitS` already
charges the boarding wait (`plan.ts:223`). That keeps the whole feature inside
the existing per-edge cost path rather than adding a graph-rebuild step.

Walk transfers are **never filtered** — pavement has no service hours.

## Closed-service responses tell you when to come back

A trip that is unroutable *only* because of service hours must be
distinguishable from one that is impossible, and must carry **the next time it
becomes possible** — "closed" alone is not actionable.

The route response gains an outcome discriminant:

- `OK` — journeys found, as today.
- `CLOSED` — a path exists in the graph but not at this time. Carries
  `nextServiceAt` (local ISO time) and the blocking line codes.
- `NO_ROUTE` — no path exists at any time. Today's empty result.

`nextServiceAt` is computed by re-running the search against each candidate day
type's windows and taking the earliest opening that yields a path — bounded to
the next 24 hours, so a genuinely-dead corridor returns `NO_ROUTE` rather than
pointing at a reopening that never comes.

This is what lets the UI say *bisnya baru ada jam 05:00* instead of showing a
blank result. Copy follows the house style in `no-em-dashes` — casual Indonesian,
no trailing period.

Rejected: **soft penalty** (closed lines cost extra but stay routable). It
always returns something, but presents an unrunnable trip as merely expensive,
which is the original bug wearing a disguise.

## Caching

`fareCacheKey` already folds in a time bucket for peak/off-peak fares, so keys
do not collide across times of day. Day type must join it — otherwise a Saturday
result gets served from a Tuesday key. The bucket granularity also has to be no
coarser than the service-hour boundaries it now affects, or a cached 04:30
"closed" answer outlives the 05:00 opening.

`API_VERSION` gets bumped on ship to flush KV, per the deploy pattern in
`tj-deploy-apply-order.md`.

## Testing

- **Percentile derivation** — line B's histogram is the fixture: assert the
  derived window is ~04:00–00:59, *not* 00:00–23:59. This is the test that would
  have caught the min/max mistake.
- **Midnight-crossing windows** — `inService` across `startS > endS`, at both
  edges and inside the dead zone.
- **The 3am case** — Kuningan→JKT48 at 03:00 returns AMARI, not 13E+9C. The
  documented bug, as a regression test.
- **Holiday resolution** — a holiday resolves rail to `WEEKEND` and TJ to its
  own calendar; an *unlisted* holiday degrades to its weekday.
- **Absent day-type data** — a KCI line with no weekend window keeps its weekday
  window rather than closing.
- **`CLOSED` vs `NO_ROUTE`** — a real corridor out of hours gives `CLOSED` with a
  `nextServiceAt`; two disconnected stations give `NO_ROUTE`.
- **Backwards compatibility** — `plan()` with no `departureAt` behaves exactly as
  today. The existing tsundere suite passing unchanged is the proof.

## Sequencing

Each step is independently shippable and useful on its own:

1. **Service hours, TJ + rail** — generator, `service-hours.ts`, tsundere input,
   `CLOSED` outcome. Fixes the 3am bug. No schema change, no re-sync.
2. **Day types for TJ** — import `calendar.txt`, ignoring the stale `HJ` and `X`
   services. Still no schema change: TJ service hours come from GTFS, not from
   `schedules`.
3. **Day types for rail** — migration `0015`, MRT syncer emits `weekends*`,
   re-sync. The only step with a migration, and it is what unlocks 3b and 3c.
   - **3b. LRT Jabodebek weekend transcription** — up to 48 more poster CSVs
     through the existing `timetables/` workflow. Pure data entry once the
     schema lands; can trail the rest without blocking anything.
   - **3c. KCI GAPEKA check** — confirm whether Commuter Line still runs a
     distinct weekend timetable. Investigation, not implementation; the outcome
     decides whether KCI needs weekend data at all.
4. **Holidays** — the `HOLIDAYS` list plus the resolve-to-weekend rule.

Step 1 carries most of the value; steps 3b and 4 are the ones with ongoing
human maintenance cost.

## Known limits

- **Rail holiday service is assumed, not known.** Weekend-on-holidays is a
  reasonable default that will be wrong when an operator runs something special.
  It rests on real data only for MRT and (once transcribed) LRT Jabodebek; for
  KCI and LRT Jakarta it is a guess.
- **KCI weekend service is an open question**, not a settled "no". It needs a
  GAPEKA check (step 3c); until then KCI runs its weekday window every day.
- **Headways stay time-invariant.** A line is either in service or not; peak and
  off-peak still share one `headwaysS` value. Time-bucketed headways are a
  separate piece of work.
- **No per-station granularity.** Windows are per *line*, so a line whose outer
  stations close earlier than its trunk is modelled by the line-wide window.
- **The holiday list needs a yearly update**, and nothing enforces that. It
  degrades safely — a stale list means holidays are treated as ordinary days.
