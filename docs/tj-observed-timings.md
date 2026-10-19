# TransJakarta timings from ward + GTFS fusion

Status: **built as data, not read by anything yet** (noted 2026-10-19; measured
and fitted the same day, see "Measurement pass" and "Fitted estimates" below). Feeds `router-time-objective.md`
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
- Many weekday firsts land at exactly 05:01 to 05:03. These are real departures,
  not buses logging on: on 10-07, 9C bus TJ-473 starts moving at 05:00 and
  passes stop 1 at 05:01. That matches GTFS's 05:00 start.

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

## Fitted estimates (2026-10-19)

```
pnpm --filter api fit:tj-runtimes --dir <archives> [--cache <dir>] [--no-write]
```

This writes `apps/api/src/db/data/runtimes.observed.ts`. The code is in
`db/scripts/fitTjRuntimes.ts`, `observedHeadways/dayTrips.ts` (a per-day cache,
shared with `analyze:tj-trips`) and `observedHeadways/runtimes.ts`. The first run
reads the snapshots (~1.5 min for 15 days). After that it is ~8 s, and the output
is deterministic. Nothing at runtime imports the file. It is 588 KB, so a consumer
should take only what it needs.

**Hop cells.** Each cell is (line, dir, hop) × WD/WE × block, with these bases:
- **OBSERVED**: the median of 30 or more directly seen hop times.
- **SCALED**: the hop's time in the line-direction's best-covered block × the ratio
  of full-trip medians between the blocks.
- **DISTANCE**: terminus hops and never-reported hops, priced at the bucket's pace.

Strata that don't win the backtest are dropped. 8,801 cells in all, against 877
interior hops per (day type, block):

| | 00-05 | 05-07 | 07-10 | 10-16 | 16-20 | 20-24 |
|---|---|---|---|---|---|---|
| WD obs/scaled/dist | 373/0/67 | 705/0/141 | 438/150/101 | 746/0/151 | 580/84/121 | 743/0/151 |
| WE obs/scaled/dist | 291/47/57 | 511/0/89 | 631/45/124 | 751/0/152 | 637/56/124 | 533/91/111 |

**Backtest** (leave one day out, median |log error| per held-out hop bucket with
5 or more hops). The baseline is one constant pace per line-direction, roughly
what a speed class per line could do at best:
- OBSERVED: 0.024-0.070 against a baseline of 0.18-0.25, in every block.
- SCALED: ships at WD 07-10 (0.111 vs 0.203) and WD 16-20 (0.131 vs 0.255),
  and at WE 00-05, 07-10, 16-20 and 20-24. It is dropped at WD 00-05, 05-07 and
  20-24 (too few buckets) and at WE 05-07 (0.154 vs 0.145, it loses).
- Whole trips (stop 1 to second-to-last as the sum of predicted hops): 0.037-0.072,
  against a baseline of 0.06-0.22.

Hop times are quantised by the ~30 s cadence. That flatters the OBSERVED numbers
a little, because many held-out medians equal the prediction exactly.

**Summing hops runs short.** The sum of hop medians is 3-5% under the full-trip
median, for example 1@F WD 10-16: 62.1 min of interior hops vs a 64.5 min trip.
Hop times skew right, so a sum of medians is below the median of the sum. A
consumer that sums hops should either use `OBSERVED_TRIP_S` for whole runs or
take that bias into account.

**Hops that are just slow.** A hop includes the dwell at its next stop, so a halte
where buses are held reads slow. Hops into or out of H00071P on 9 run at 3.1 to
3.7 km/h in both directions and in every block. The guard test allows down to
3 km/h.

**Service windows** (`OBSERVED_SERVICE_WINDOWS`; the fit prints a diff against
`service-hours.ts`). They count only days with 10 or more stop-1 passings. A line
is allDay when buses pass stop 1 between 01:00 and 04:00 on enough days. The
patterns:
- **Sunday car-free day:** 4D, 6A, 6B, 6V and 9C start at about 09:20 to 10:15
  on both Sundays. GTFS says 05:00.
- **Later than GTFS:** 2A, 4D, 5C, 6A, 6B, 6V, 9C, 10H and 13B keep passing stop 1
  until about 22:30 to 23:40, on 8 to 10 weekdays, where GTFS ends at 22:00. 7F
  runs until about 22:00 (GTFS 20:30).
- 9A@F ends around 21:00, earlier than GTFS.
- **Not yet verified:** whether the buses after 22:00 are in service or running
  back to the depot with a route code. Check that before any of this reaches
  `service-hours.ts`. Merging it there is a separate, reviewed step.

**Hops never reported** (listed in `OBSERVED_RUNTIMES_META.mismatchedHops`, 26
line-directions): 1@R H00133P>H00068P (so 1@R has no full trips), the 4 / 4D
pairs around B08301P/B08302P, several 6A/6B pairs around H00207P and H00044P, and
others. These are most likely places where TOPOLOGY disagrees with the route the
buses report. Each one gets a DISTANCE cell, and each is worth checking against
the feed.

**Still open:**
- The planner reading this (`router-time-objective.md`).
- The sum-of-medians bias above.
- The weekend has only 2 Saturdays and 2 Sundays, so weekend windows rest on 2
  days each.
- The sample is closed (2026-09-29 to 10-13).
