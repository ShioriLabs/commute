# TransJakarta timings from ward + GTFS fusion

Status: **idea, not started** (noted 2026-10-19). Feeds `router-time-objective.md`
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
| Ward (`apps/ward`, R2 `commute-ward`) | Position, `route_code`, next stop, heading, ~15 s snapshots | ETAs and arrival events. `updMs` is when the relay last heard from the bus, not GPS time |

## Method

1. **Arrival events.** When a bus's next stop changes from A to B, it passed A
   inside that snapshot window. Interpolating along the topology path gives a
   per-stop passing time, about plus or minus 15 s, small against 5 to 20 minute
   headways. Judge snapshot freshness the way `analyze:headways` does (how many
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
- **Expected wait** from the observed hourly headway instead of the SLA. Rush
  hour is often about 2x the promise, so waits stop being optimistic.
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

## First step

A measurement pass over the R2 archives, nothing built: days available, and for
reference lines 1, 13E and 9C how many full trips reconstruct from next-stop
transitions. That decides whether per-segment run times are viable or only
headways are.
