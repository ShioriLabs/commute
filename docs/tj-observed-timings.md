# TransJakarta timings from ward + GTFS fusion

Status: **wired into the planner after the search, as an API-only estimate**
(noted, measured, fitted and wired 2026-10-19; see "Measurement pass", "Fitted
estimates" and "Planner estimates" below). The arrival sort that uses them is
built but switched off (`config:observed-runtimes` = `fields`). Feeds `router-time-objective.md`
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

## Planner estimates (2026-10-19)

Wired after the search only. The search, its criteria, its cache keys and route
stability (`mcraptor.md`) are untouched; seconds inside the search stay
`router-time-objective.md`'s step.

**What a rider's client gets.** `/_internal/trips` journeys with a TransJakarta
ride and no `arrivalAt` carry `estimate: { durationS, rideS }`:
- `durationS` runs from the request's `at` to the estimated arrival, including
  walks and expected waits;
- `fromS` is the seconds from `at` to the first boarding when a timed ride
  opens the journey, and 0 otherwise. Clients show `durationS - fromS`, so a
  train-then-bus card measures boarding to arrival like a fully timed one. The
  client cannot recover `at` itself through the edge cache;
- `rideS` is aligned with `legs` and is set on TJ legs only.

Legs still carry no TJ `departureAt`/`arrivalAt`/`stopTimes`, because every
client reads those as timetable facts. The public `/fares` is unchanged.

**Web UI.** Estimates print as `±45 mnt` (`formatEstimate`) and are never shown
as a clock:
- the journey card's headline slot (fare list and map rail), where the fare
  drops back to the meta row as it does on timed cards;
- the detail's closing recap;
- each TJ leg's summary (`18 stasiun • 14,3 km • ±42 mnt`, from `rideS`);
- home's saved-route rows.

`estimatedDurationOf` in `fare-sheet/journeys.ts` is the single reader.

**How a journey is estimated:**
- `Tsundere.estimateJourney` reuses `resolveDepartures` with an `estimateUntimed`
  hook. `timeJourney` ignores the hook, so the timed fields cannot change.
- The hook is `utils/observedRuntimes.ts` `estimateTjLeg`:
  - the wait is half the same headway the search charged, times the
    line-direction's bunching `1 + CV²` (`bunchingFactor`, from
    `OBSERVED_CV_PROFILE`, using the neighbouring hour where the cell is
    missing). CV is capped at 1, so a wait averages at most one headway: the
    profile's p90 is 0.99, and the tail past it (max 4.78) is the
    topology-mismatch lines and the 05:00 ramp-ups. Ranking still charges h/2.
    For 6 to Ragunan at Galunggung this is 8.1 min at WD 12:00 (h 9.7 min,
    CV 0.82), against 4.8 min before;
  - the ride is a sum of hop medians in the block the running clock is in;
  - a hop with no cell is priced at the leg's own pace if at least 50% of the
    leg's metres are measured;
  - the trip-sum bias is applied where the backtest vouched for it (not WE 10-24).
- Rail after a bus catches the next real train from the estimated clock.
- There is no estimate when the line is closed at boarding, when the estimated
  clock misses the last train, or when the hook can't price a leg.
- Data comes from the compact `db/data/runtimes.planner.ts`, which adds 143 KB
  raw / 39 KB gzip to the worker (1,872 KB / 403 KB → 2,016 KB / 442 KB).
- The estimate pass costs 0.1 ms p50 and 0.3 ms p95 per OD.

**Switch** `config:observed-runtimes` (see `utils/observedFlag.ts`):
- `off`: no estimates;
- `fields`: estimates, unchanged order. This is the default and what an absent
  or unknown value means.
- `sort`: estimated arrivals also join `byArrival`, rounded to 5-minute bands so
  that close estimates keep the engine's order.

Estimates are applied after the journey cache, so a flip needs no purge or
API_VERSION bump. It takes effect within ~11 min (60 s KV cache plus the
10-minute edge cache).

**A/B** (`pnpm --filter api ab:estimated-order`; 2,000 seeded pairs on the network
snapshot; share of multi-journey pairs whose top journey changes against today's
order):

| Moment | Estimated | sort / median | sort / p75 | sort / 5-min band |
|---|---|---|---|---|
| WD 07:30 | 62% | 18.6% (gain 5.8 min) | 20.1% | 16.8% (7.1 min) |
| WD 12:00 | 90% | 24.1% (4.6) | 26.1% | 18.7% (6.1) |
| WD 17:30 | 76% | 26.9% (5.4) | 29.6% | 23.1% (7.4) |
| WD 21:00 | 84% | 21.4% (2.9) | 22.2% | 15.5% (5.0) |
| WE 12:00 | 79% | 25.7% (3.6) | 29.0% | 21.3% (5.5) |

"Estimated" is the share of TJ rows without a timetable arrival that got an
estimate. The gain is the median estimated gain of the changed pairs.

- **Most changes are one estimated journey overtaking another.** Today every TJ
  journey sits in the untimed tail in the engine's order. Only about 1-2% of
  pairs swap a timetabled top journey for an estimated one, or the other way
  round.
- **Without a band, most swaps were on 1-3 minutes,** inside the estimate's own
  error. That is why the band ships as the sort behaviour.
- **p75 churns more and helps nothing,** so it is not used.
- **No leg ever failed because a station pair was missing from the table**
  (diagnostic at WD 07:30 and 12:00), so the join between the graph and the table
  is complete.
- **All misses are "too little measured".** At WD 07:30, mostly 12, 9, 6A, 6B and
  7F, which have no observed or scaled cell at the morning peak; at midday, the
  topology-mismatch lines 4 and 3F.

**Open before switching to `sort`:**
- **Coverage bias.** At peak, a journey on a well-measured line can move up while
  an unmeasured one stays in the untimed tail, whatever the real speeds.
- **Partly visible reason.** Cards now print each estimate, so a reordered list
  shows the figures it was sorted on. Nothing says the order itself changed, and
  an unestimated journey still shows no duration at all.
- **Descriptions.** The `FareJourneySchema` description still says ranking ignores
  travel time. It changes when sort ships.
- **Waits are bunched and shared in the search too** (2026-10-19,
  docs/adr/tj-shared-waits.md). A/B on 2,000 pairs × 5 moments: the top route
  (ignoring which line of a shared stretch is named) changes on 10-15% of
  pairs, about 1% rail over TJ. Search cost is about +5-14% p50. The
  merged-stream CV is p50 1.37: lines on one road arrive together.
- **Ranking now trades walking for wait without counting either as time.**
  Sudirman → Karet Kuningan at WD 12:00 ranks walk 560 m + 13E/L13E (±22)
  over walk 310 m + 6 from Galunggung (±18), because the pooled 13E/L13E wait
  edges out 6's bunched one. The estimate disagrees. Sort mode or
  router-time-objective would fix it.
- **WD 17-18 headways are interpolated.** The evening peak starts in the
  observed 16:00 cell (network median 0.9× the mean of 15:00 and 17:00; 6@R 263 s
  against 514 s at 15:00, as buses are added toward the suburbs). 17:00 and 18:00
  are guessed between 16:00 and 19:00, and their CV is borrowed from 16:00.
- **`moreDepartures` rows get no estimates.**
