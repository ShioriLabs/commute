# TransJakarta timings from ward + GTFS fusion

Status: **measured, not built** (noted 2026-10-19; measurement pass the same day,
see "Measurement pass" below). Feeds `router-time-objective.md`
and the TJ side of `schedules-as-stop-times` (zero TJ rows today).

## Why

The planner is certain about rail legs (real timetables, `mcraptor.md`) and vague
about TJ legs: no timetable, a run time guessed from distance, and a wait taken as
half of the promised GTFS headway. TJ publishes no schedule and no realtime feed,
and the broker closed to anonymous clients on 2026-10-13 (`tj-mqtt-banned`), so
the ward dataset is a closed sample. The aim is to make TJ legs more certain with
what that sample can support, without pretending to a timetable.

## What this is not

Not a timetable and not clock-time RAPTOR. TJ buses bunch and run irregularly, so
a pinned "departs 07:12" would be false precision. The output is **estimated
quantities per line**: service windows, headways and run times. The UI language
stays "every ~N min", never a clock time, and `mcraptor.md`'s "search never reads
a timetable at query time" still holds. Baked in at graph load, time-of-day
stable, cacheable.

## The two sources

| Source | Gives | Lacks |
|---|---|---|
| GTFS (`frequencies.txt`, trip patterns) | Stop sequence, service window, promised headway | Real departures. 782 of 783 rows are `exact_times=0`, so it is an SLA |
| Ward (`apps/ward`, R2 `commute-ward`) | Position, `route_code`, next stop, heading, ~30 s snapshots | ETAs and arrival events. `updMs` is when the relay last heard from the bus, not GPS time |

## Method

1. **Arrival events.** When a bus's next stop changes from A to B, it passed A
   inside that snapshot window. Interpolating along the topology path gives a
   per-stop passing time, about plus or minus 15 s (half the ~30 s cadence),
   small against 5 to 20 minute headways. Judge snapshot freshness the way `analyze:headways` does (how many
   buses' `updMs` moved), not by arrival time of the snapshot.
2. **Trips.** Group by `bus_body_no` and line, split at the terminus turnaround.
   Direction comes from topology `path` / `pathReverse`, never GTFS `direction_id`
   (broken, see `directional-headway`).
3. **Aggregate** per line, direction, hour block and day type: median headway,
   median end-to-end and per-segment run time, dwell, first and last bus seen.
4. **Publish as data**, not trips: a table of observed headway and run time per
   line and hour block, next to the GTFS values it refines.

## What the planner gets

- **Service windows** from the first and last bus seen, replacing
  `frequencies.txt` where they disagree. Fixes the 3am 13E/9C case outright
  (`time-aware-routing`).
- **Expected wait**: already done. The S1 headway overlay
  (`headways.observed.ts`, `utils/observedHeadways.ts`, ADR `ward-collector`)
  feeds the planner and `/headway` since 2026-10-12. This work adds run times,
  service windows and confidence, not headways.
- **Run times** per hop for the time objective, replacing the speed classes on
  distance. The observed per-segment median is the better of the two inputs the
  router rework lists for TJ.
- **Confidence per line.** Lines with too few observed trips keep the GTFS values
  and are marked as such. Never fill gaps by extrapolating.

## Limits to check before building

- **Window size.** Ward ends 2026-10-13 17:51 WIB. Count the days collected and
  whether they cover weekdays, Saturday and Sunday. Weekend and holiday coverage
  is probably thin, and low-frequency lines may have too few trips for a stable
  median.
- **Staleness.** The sample ages and cannot be refreshed unless collection
  reopens. Reopening or authenticating against the broker is the user's call, not
  a default (`tj-mqtt-banned`).
- **Mikrotrans** (`JAK.xx`) is out of scope, as in `tj-gtfs-import.md`.
- **Headways are medians.** Report them as typical, not guaranteed. Consider an
  upper percentile for the transfer-robustness penalty rather than the median.

## Measurement pass (2026-10-19)

`pnpm --filter api analyze:tj-trips --dir <archives>` (`db/scripts/analyzeTjTrips.ts`,
trip splitting in `observedHeadways/trips.ts`). Nothing generated.

**Sample.** 15 days, 2026-09-29 12:00 to 2026-10-13 ~17:00 WIB (the collector is
stopped): 11 weekdays, 2 Saturdays, 2 Sundays, no holidays. Healthy hours summed
over days:

| | 00-05 | 05-07 | 07-10 | 10-16 | 16-20 | 20-24 |
|---|---|---|---|---|---|---|
| WD | 49.9 | 14.2 | **7.6** | 32.2 | **9.9** | 33.6 |
| WE | 20.0 | 8.0 | 10.1 | 21.3 | 8.5 | 13.0 |

**Terminus hops can't be measured.** The last hop is never seen, because at the
terminus `next_stops` jumps to the other direction rather than moving on. The
first hop carries the layover (9C@F hop 0 runs at 3 km/h). So trips are timed from
stop 1 to the second-to-last stop, and the two terminus hops need a distance-based
fill.

**Per-hop run times are viable off-peak, thin at the weekday peaks.** These are
line-directions where at least 80% of interior hops have 30 or more directly
observed passings (out of 60):

| | 00-05 | 05-07 | 07-10 | 10-16 | 16-20 | 20-24 |
|---|---|---|---|---|---|---|
| WD | 20 | 39 | **19** | 43 | **26** | 42 |
| WE | 16 | 26 | 35 | 43 | 33 | 24 |

The 00-05 counts are low because most lines don't run then; the 24 h corridors
pass. Corridor 1 passes in every block (`1@F` has 38 to 215 full trips per weekday
block). Corridors 6, 9 and 9C fall to 17-52% in weekday 07-10.

**End-to-end, full trips, median minutes (stop 1 to second-to-last stop):**

| | WD 05-07 | WD 07-10 | WD 10-16 | WD 16-20 | WD 20-24 | WE 10-16 |
|---|---|---|---|---|---|---|
| 1@F | 43 | 64 | 64 | 61 | 48 | 64 |
| 9C@F | 39 | 49 | 46 | 41 | 36 | 40 |
| 9C@R | 31 | 39 | 41 | 56 | 39 | 33 |
| 13E@F (WE) | 37 | 40 | 44 | 44 | 39 | - |

**Service windows seen at stop 1:**
- 13E runs weekends only, about 05:03 to 22:00 (F) and 05:44 to 22:50 (R). That
  matches `service-hours.ts` (SAT/SUN 05:00 to 22:00) apart from the last R bus.
  There were two stray weekday sightings (10-07, 10-12).
- 9C runs weekdays from 05:01 to about 22:00 (F) and 23:00 (R). That is later
  than the GTFS close of 22:00 in R. **On Sundays it starts about 10:00, not
  05:00**, on both Sundays, both directions. That is probably car-free day; it
  is not in GTFS.
- Many weekday firsts land at exactly 05:01 to 05:03. That could be buses logging
  on rather than first departures. Check this before treating 05:0x as a real
  start.

**Topology mismatches found by the way.** Some line-directions never see certain
hops in any block, so their share is stuck: 1@R 94% (it never passes H00068P,
so it has no full trips; probably the 2026-10 poster override, see
`tj-corridor-1-poster-override`), 4@F 63%, 4@R 57%, 10@R 95%, 12 about 40-55%.
Check these against the feed before trusting their hop tables.

**Gate decision.** Build per-hop run times by (line, dir, hop) × WD/WE × block.
Where a block is thin, which mostly means the weekday peaks, scale the line-dir's
own off-peak hops by the end-to-end ratio for that block (full trips are still
plentiful there: 1@F has 49 at WD 07-10). Fill terminus hops from distance at the
line's median speed. Service windows: emit only where 3 or more days agree, and
keep the 05:0x artefact and the topology-mismatched lines out until they are
checked.
