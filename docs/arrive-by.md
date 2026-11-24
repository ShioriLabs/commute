# Arrive-by

Status: **spec, not started** (written 2026-11-24). The last open Tier 2 item in
`go-mode.md` ("arrive-by NOT STARTED"). Supersedes the "If we ever build real
RAPTOR" section of `mcraptor.md` as the plan of record for this feature.

## The question

"I need to be at Dukuh Atas by 08.30. When do I leave, and which train?"

Today the planner only answers "I leave at T, when do I get there?". `at` is a
departure instant, the cache key quantises it to a 20-minute slot, and
`boardingsOf` (`apps/api/src/utils/journey-times.ts`) offers each route at its
next boardings after `at`.

## Why this is not RAPTOR

`mcraptor.md` says arrive-by "genuinely needs the search to change". That was
written before two measurements:

1. **The route does not move during the day.** 162 of 162 seeded rail pairs
   returned the identical route at 06/09/12/15/18/21 (`departure-times`,
   2026-09-07). Only service hours change the answer, and they already gate the
   search. So the search does not need to know the deadline. It needs to know
   roughly *when* the rider travels, which it already takes as `departureS`.
2. **Timing a route is nearly free.** Re-timing an existing journey costs
   ~0.03 ms. `boardingsOf` already calls `timeOnce` in a loop.

So arrive-by is a **post-search timing problem**, the same layer departure times
were built in. Backward RAPTOR (`raptor.ts`, latest-departure rounds) is only
worth building if a deadline should ever pick a *different route* than a departure
time does. Nothing measured says it does. Out of scope.

## Approach: invert the forward resolver, don't write a backward one

A reverse `resolveDepartures` (latest trip on the last leg, then latest feeder
that makes the change, and so on) would duplicate every subtle rule the forward
one has: crossing gates (`crossing.ts`, Sudirman), gated-line change times, the
`noTap` allowance, `TIMED_CHANGE_WALK_M`, contiguous-pattern coverage, "one
untimed leg stops the clock", `earlier`. Two implementations of those would drift.

Instead, **enumerate first-leg departures and time each one forward**:

```
candidates = departures of the first ride leg from its boarding stop,
             in [deadline - LOOKBACK_CAP, deadline], latest first
for each candidate c:
    timed = timeOnce(route, afterS = c - firstWalkS)
    if timed.arrivalS <= deadline: keep, stop after N kept
```

- Exact, with no monotonicity assumption. FIFO violations (a short-turn overtaken,
  a crossing that shuts) are handled because every candidate is timed for real.
- It scans **backwards and stops at the first hit**, so the cap only bounds the
  scan. It isn't a window that is always walked in full. Measured below.

### Lookback (measured 2026-11-24)

Production router (`routerFromInputs`) over local D1 + `trips.ts`, rail only, 1,500
seeded random rail O-D pairs × WD/SAT/SUN × deadlines every 15 min from 05.30 to
23.45. For every route the planner offered, every boarding of the service day was
listed with no window at all, and for each deadline the latest boarding arriving
by it was picked. 300,149 answers; 5,511 of 6,597 routes timed.

| | p50 | p90 | p99 | p99.9 | max |
|---|---|---|---|---|---|
| Lookback, in service (a later arrival still exists, 96.2%) | 1h08 | 2h05 | 2h50 | 3h28 | **4h40** |
| Lookback, after the route's last arrival of the day (3.8%) | 2h18 | 4h15 | 5h15 | 5h57 | 6h18 |

In-service answers a cap would miss: 3 h 0.49%, 3.5 h 0.089%, 4 h 0.022%,
4.5 h 0.002%, **5 h none**. The tail is long KCI rides with a sparse connection:
Nambo → Rangkasbitung (B > C > R) rides 3h21 and needs 4h40 at 12.30. One
outlier is slack, not ride: Telaga Murni → Kampung Bandan on line C waits 2h59
for a KPB-bound train at 21.30. That's worth checking against the timetable,
since it may be a `trips.ts` chain gap.

**DECIDED 2026-11-24: `LOOKBACK_CAP` = 5 h,** plus an explicit last-service
path. When the route has no arrival after the deadline (`hasLaterTrip` in
departures.ts already answers this), the answer is the route's last boarding of
the day, labelled as the last train ("kereta terakhir nyampe HH.MM"). Don't
stretch the cap to 6.5 h to reach it as an ordinary result: "leave 6 hours early"
is a last-train answer and should read as one.

**Cost:** the backward scan probes p50 6, p90 11, p99 20, max 38 first-leg
departures per route before its first hit. `timeJourney` measured 8.3 µs per
call over 511k calls, so the worst route is ~0.3 ms. A full 5 h scan when nothing
makes it (~60 probes at 5 min headways) is ~0.5 ms. Not worth optimising.

Caveats: KCI trips in `trips.ts` all carry dayMask 7, so weekend KCI isn't
distinguished (only MRTJ and LRT Jabodebek have weekend trips). Uniform random
pairs over-weight far-flung stations against real demand, which is conservative
for a cap. Trips after midnight were out of scope (deadlines stop at 23.45).
Re-measure if the timed coverage grows (e.g. the short-turn grouping), since
newly timed long routes can only lengthen the tail.
- The answer per route is the **latest boarding that still makes it**, plus up to
  N earlier ones as safety margin (mirror of `moreDepartures`).

The first ride leg's departures come from the same `TripIndex` the forward
resolver uses (`byStop` + `catchableFrom`). A small engine export,
`departuresAt(stopId, legRun, fromS, toS, dayMask)`, is the only new engine API.

### What "leads the card" means

Depart-at: the earliest catchable boarding always leads (`first-boarding-leads`,
by decision). Arrive-by mirror: **the latest boarding that arrives by the deadline
leads**, earlier ones follow as "lebih aman". A boarding that leaves earlier and
arrives no earlier than a later one is only a longer wait, so the same filter
applies, just anchored on the leader.

## TransJakarta: the big one

TJ has no timetable and never will (730 trips, `frequencies.txt`, all
`exact_times=0`). Two things make it less hopeless than it looks:

- **`estimateTjLeg` already exists** (`apps/api/src/utils/observedRuntimes.ts`,
  `tj-observed-timings.md`): wait from the bunched-headway model in
  `utils/tjWaits.ts`, ride from per-hop observed medians or p75 by time block,
  bias-corrected. It is wired API-only, and the arrival sort that uses it is built
  but off (`config:observed-runtimes` = `fields`).
- The ward sample is closed (MQTT banned 2026-10-13, ward silent since late Oct),
  so these numbers are as good as they will get without a new source.

A depart-at estimate and an arrive-by estimate are not the same risk. Arriving
late is the failure the rider asked us to prevent, so arrive-by must budget
pessimistically where depart-at budgets the median.

### Tiers

| Tier | Route shape | Answer | Honesty |
|---|---|---|---|
| **A** | All ride legs timetabled (rail) | Exact boarding time, exact arrival | Fact |
| **B** | Contains TJ, estimates available | "Berangkat sekitar HH.MM" from a pessimistic budget | Estimate, labelled |
| **C** | Contains an untimed leg with no estimate (unchained rail, TJ hop the table can't price) | No time. Route shown, "waktu tiba ga bisa dipastikan" | Absent means unknown |

**Tier B budget** (DECIDED 2026-11-24, `arriveByBudgetS` in
`db/scripts/observedHeadways/lateness.ts`; measured, see "Lateness backtest"
below):

- Ride: **p75** per hop, not median. The statistic is already selectable
  (`RuntimeStatistic`).
- Wait: **1.5 × headway** where the planner headway is under 20 min, **1 ×
  headway** at 20 min and over. The expected wait (what `/trips` estimates
  today) is right for "when do I probably arrive" and wrong for "when must I
  leave to be sure": it is late 40% of the time. A single full headway still
  misses 16%, because real waits exceed the planner headway 20-25% of the time
  on frequent lines (bunching). Long-headway lines are more regular, so 1 × h
  already lands near the target there.
- Measured: **late 8.0% per leg** (~1 in 12; 5.7% at WD 07-10, 9.6% at WE
  10-16, worst slice). Riders spend a median ~10.6 min early in exchange.
  Chosen over 2 × headway (3.7% late, ~16 min early): the extra 5 min of standing
  around costs every rider every trip, the lateness only some.
- The search for the latest departure is the same enumerate-and-time loop, except a
  TJ-first route has no departures to enumerate, so step `departureS` back from
  the deadline in 1-minute steps (or binary search: the estimate *is* monotone,
  being sums of block-wise functions of the clock; verify across block boundaries).
- **Budget per TJ leg compounds.** Two TJ legs at 8% each are late up to ~15%
  as a journey (the backtest is per leg; not measured as journeys). Handled by
  ranking, not a tighter budget: see "Ranking" below. Such journeys rank behind
  any rail option and, in all-TJ lists, behind shorter routes.

### Rejected: a phantom TJ timetable

Expanding `frequencies.txt` into fixed departures (`start, start+h, ...`) so TJ
flows through the same timetable path as rail. Rejected 2026-11-24:

- The phase is invented. No real bus is tied to `start + k·h`, and 782 of 783
  rows are `exact_times=0`, which in GTFS means exactly "do not expand this".
- Arrive-by is where it hurts most: the resolver would pick the latest phantom
  bus that makes the deadline, i.e. a zero-minute wait budget. That is the E50
  row below or worse.
- It breaks the standing rule that TJ is never shown as a clock time
  (`tj-observed-timings.md`). Phantom rows in `schedules` would leak into
  boards, "Kereta terakhir" and leg chips.
- It throws away the bunching model in `tjWaits.ts`.

What it gets right (one code path for TJ and rail) comes instead from a
**frequency-based leg adapter**: a TJ leg answers "standing at the stop at t,
when am I on board?" with `t + wait budget`, and the ride from the observed
runtimes. That is `estimateTjLeg` with the arrive-by budget above. Nothing is
written to `schedules`.

The one place a real phase might exist is the first dispatch from a terminus
(`tj-observed-timings.md`: weekday firsts at 05:01-05:03). Only worth modelling
if ward shows it is consistent day to day.
- Rail legs inside a TJ route stay exact. A TJ → rail route is the interesting
  case: the TJ estimate decides which train is plausibly catchable, and the train
  is a fact. Lead with "naik kereta HH.MM dari X", and give the TJ part as
  "berangkat sekitar HH.MM".

**Copy rules** follow the existing honesty rules: a TJ leg never shows a clock
time as if it were a departure. "sekitar" / "paling lambat sekitar" only, per
`tj-observed-timings.md` ("every ~N min, never a clock time").

### Ranking: rail first, then the shortest TJ route (DECIDED 2026-11-24)

TJ answers are estimates we can't stand behind the way we can a timetable, so
they are ranked by how much uncertainty they carry, not by how late they let the
rider leave:

- **If any option is fully timed (Tier A), TJ-containing options (Tier B) go
  behind it,** however late their estimated departure. A rail route that says
  "berangkat paling lambat 07.42" outranks a TJ route that estimates "sekitar
  07.55". The TJ rows stay listed, labelled as estimates. Same rule depart-at
  already follows (untimed rows behind timed ones, `departure-times`).
- **If every option contains TJ, lead with the shortest one:** the lowest
  budgeted door-to-door time (`arriveByBudgetS` per TJ leg + timed rail + walks).
  Less time on the road is less to go wrong. Each extra TJ boarding adds a
  1.5-headway wait to the budget, so this rule also pushes down the two-TJ-leg
  journeys whose lateness compounds. The departure shown is still the one that
  budget gives, so leading with the shortest is not the same as leading with the
  latest departure: a longer route with a later estimate ranks below it.
- Tier C (no time at all) stays last, as today.

"Shortest" means shortest *budgeted time*, not metres (confirmed 2026-11-24): an
arrive-by rider wants to be there on the dot, so time is the measure that
matters.

### Shipping TJ in phases

1. **Phase 1: Tier A only.** Routes with a TJ leg come back without an arrive-by
   time, the way they come back untimed today. Ships the feature for rail, proves
   the API and UI, and settles the loop and its cost.
2. **Phase 2: Tier B.** Turn on the TJ budget. Backtested 2026-11-24 (below):
   `arriveByBudgetS` is late 8.0% of the time per leg. Move it from the script
   module to `utils/observedRuntimes.ts` when the planner starts using it. Before shipping: settle the
   outlier lines, the two-TJ-leg compounding, and a leave-one-day-out rerun.

## Lateness backtest (2026-11-24)

**Method.** Ward's 15 days (2026-09-29 to 10-13: 11 WD, 2 SAT, 2 SUN). For every
TJ line-direction, up to 6 boarding stops × legs of 3, 8 and 15 stops, and a
rider arriving at the boarding stop every 10 min from 04:00 to 23:00: replay the
first real bus that passes the boarding stop and goes on to reach the alighting
stop, and compare the actual wait + ride with each budget, computed by the
planner's own `estimateTjLeg` / `expectedWaitS` / `plannerHeadways` for that
moment. 305,710 samples.

Excluded: collector-unhealthy windows (the gate in `observedHeadways/health.ts`),
moments with no bus at that stop in the hour before (pre-service, dead tracking),
and legs the estimator can't price. Buses that short-turn before the alighting
stop are skipped, as a rider would skip them.

**Tracking holes.** 25% of buses driving through a leg had no recorded passing at
its board or alight stop (`extractPassings` drops >5 min observation gaps).
Interpolating by stop index inside a trip (gaps up to 20 min) cut that to 7.5%,
and **the late rates moved by under half a point**. The lateness is real, not an
artefact. Short legs, where short-turns hardly matter, are the latest of all,
which rules out the short-turn skip as the cause too.

**Where the error comes from:** wait, not ride. At p90 the real wait runs 6.8 min
over the bunched expected wait. The ride runs 3.6 min over the median.

**Late rate per budget** (and the median minutes the rider is early):

| Budget | all | WD 07-10 | WD 16-20 | WE 10-16 | 3 stops | 15 stops | h < 10 | h ≥ 20 |
|---|---|---|---|---|---|---|---|---|
| E50 (today's estimate) | 40.0% 1.5m | 34.3% | 36.8% | 45.2% | 37.5% | 45.2% | 41.5% | 30.6% |
| h + p75 | 16.3% 6.4m | 14.0% | 15.0% | 19.2% | 17.9% | 12.6% | 18.0% | **7.3%** 19.4m |
| **1.5h + p75** | **7.5% 10.9m** | 5.7% | 6.6% | 9.5% | 7.7% | 6.9% | 8.7% | 2.1% 33.4m |
| 2h + p75 | 3.7% 15.5m | 2.3% | 3.0% | 5.1% | 3.6% | 4.2% | 4.3% | 0.7% 47.6m |
| 2h + 1.15×p75 | 2.5% 18.2m | 1.3% | 2.0% | 3.4% | 2.8% | 2.1% | 2.7% | 0.6% 49.9m |
| E50 × 1.39 | 10.1% 9.4m | 5.8% | 6.8% | 10.8% | 13.3% | 4.4% | 9.1% | 9.4% |
| **`arriveByBudgetS` (decided)** | **8.0% 10.6m** | 5.7% | 6.6% | 9.6% | 8.3% | 7.3% | 8.7% | 7.3% 19.4m |

Hence the piecewise rule above: 1.5h + p75 on frequent lines, h + p75 at 20 min
and over (where 1.5h would leave riders half an hour early for 2% late). A plain
multiplier on today's estimate is the wrong shape: it under-protects short legs
(wait-dominated) and over-protects long ones.

**Outlier lines** under the decided budget: 12 (20.3% late), 3F (15.4%), 4D
(14.8%), 13 (13.3%), 3H (12.2%), 1 (11.9%); median line 7.2%. Line 12 is one of the topology-mismatch lines in
`tj-observed-timings.md` (40-55% hop share). Check those against the feed before
phase 2, and consider a per-line wait multiplier or no estimate for them.

**Caveats:**

- **In-sample.** The runtimes and observed headways were fitted on these same 15
  days, so the numbers are mildly optimistic. Ride error is small anyway; the
  wait side matters more, and its headways are partly ward-fitted too. A
  leave-one-day-out rerun would settle it.
- **Weekday peaks are thin:** 2,098 samples at WD 07-10 and 6,862 at 16-20,
  because the collector was unhealthy then. They agree with the other blocks but
  rest on less.
- **Single-line replay.** On shared stretches a rider can board any interlining
  line, so real waits there are shorter. Conservative.
- **Per leg, not per journey** (see "Budget per TJ leg compounds").
- **First bus of the day excluded.** Moments before a line is seen running are
  skipped.
- **Pre-refresh topology.** The sample predates the 2026-11 feed refresh and the
  reroute pruning (`tj-reroute-artifacts`).
- **The sample is closed.** Ward has been silent since late October, so these
  numbers can't be refreshed until a new source exists.

**Re-run** after every `fit:tj-runtimes`, since the budget leans on those run
times:

```
pnpm --filter api analyze:arrive-by --dir <archive dir> [--days N]
```

`db/scripts/analyzeArriveByLateness.ts` reads the raw snapshots (the dayTrips
cache keeps aggregates, not per-trip passings), ~2 min for 15 days. The replay,
hole filling and the decided budget are pure, tested helpers in
`observedHeadways/lateness.ts`. Needs `zstd` on PATH, like every
observedHeadways reader.

## Search time

The search still needs a `departureS`: service hours, the hour's headway bucket
and the fare's peak/off-peak bucket all read it.

1. Plan at `deadline - estimatedDuration`. On a cache hit, the cached route's
   own duration; on a miss, `deadline - 60 min` as a first guess.
2. Time backwards (above). If the resulting departure lands in a **different
   service window or hour bucket** than the one searched, search once more at
   that departure. Expected to be rare, given 162/162. Count it in Server-Timing
   so we can see.
3. **Fare** follows the actual boarding time, not the deadline. Peak ends at a
   fixed time, so "arrive by 10.05" can board in peak and be charged peak. The fare
   is scored after timing, so recompute it on the chosen boarding.

## API

`/fares` and `/_internal/trips` take one of:

- `at=<ISO>` (unchanged, depart at)
- `arriveBy=<ISO>` (new; mutually exclusive with `at`, 400 if both)

Response per journey, additive only:

- `departureAt` / `arrivalAt` as today, now for the chosen boarding
- `arriveBy: true` echo at the top level, so a cached client can tell modes apart
- `moreDepartures` holds the **earlier** safe boardings in arrive-by mode
- New `missedAt` state, mirroring `resumesAt`: nothing in the lookback makes the
  deadline. Carries the last boarding that would have made it, if it is
  earlier than "now", so the UI can say "udah telat, kereta terakhir yang
  nyampe tepat waktu HH.MM". Otherwise the route is offered with its earliest
  arrival after the deadline, marked late.

**Cache:** the KV body stays untimed and is keyed by the *search* time's slot, as
today. Arrive-by never touches the key except through step 1's search time.
`retime` runs per request on hit and miss, so it is the only place that needs to
know the mode. This is the same split that let departure times ship without a
cache change. Bump `API_VERSION` only if the wire shape changes for existing
clients (it doesn't, it's additive), so probably no bump.

## Service day

- Rollover at 03:00 (`service-day.ts`, `NIGHT_END_S`). "Arrive by 01.00" is the
  previous service day's night. Day mask comes from that day, not the calendar.
- A deadline just after the first train (e.g. 05.10) may need the previous
  service day's last trains. Simplest rule: the lookback never crosses the 03:00
  rollover. Before it, answer `missedAt` / "belum ada layanan".
- `?day=` stays WD/SAT/SUN (`mcraptor-release`).

## Web

- Time picker grows a two-way toggle: **Berangkat / Tiba** (plain functional copy,
  `brand-voice`). `FareCriteria` gets `timeMode: 'depart' | 'arrive'` and keeps
  `departureAt`'s `'now' | ISO` shape (rename to `at` in the type, or add
  `arriveBy`; pick one at implementation). "Sekarang" makes no sense in arrive
  mode, so default the picker to the next half hour.
- URL carries the mode (shareable `?j=` keys from `trip-ui-redesign` must
  round-trip it).
- Card copy: lead with **"Berangkat paling lambat HH.MM"** (Tier A) or
  **"Berangkat sekitar HH.MM"** (Tier B), arrival underneath. No em dashes, no
  trailing periods (`no-em-dashes`).
- Late state: a distinct card treatment, not an error page.

## Android

`android-trip-mode.md` consumes `/trips`. Arrive-by is additive on the wire, so
Android keeps working; it only gets the mode when it sends `arriveBy`. No
`API_VERSION` coupling beyond the usual.

## Testing

- Engine: `departuresAt` unit tests next to `departures.test.ts`.
- API: arrive-by cases in `journey-times.test.ts` that mirror the depart-at
  ones: crossing gate at Sudirman, gated-line change, short-turn dedupe, one
  untimed leg, rollover at 03:00, `missedAt`.
- Property test: for a Tier A route, timing forward from the chosen boarding
  arrives `<= deadline`, and from the next later boarding arrives `> deadline`
  (or that boarding doesn't exist). This is the whole contract in one line.
- `trips.regression` (`route-regression-suite`): a handful of arrive-by cases,
  each with a why.
- `auditRouter --baseline`: **0 changed result sets**. Arrive-by must not move
  depart-at answers.

## Open questions

1. ~~**Late-rate target.**~~ DECIDED 2026-11-24: 1.5 × headway (1 × at 20+ min)
   + p75 ride, 8.0% late per leg. Still open: what the outlier lines get.
2. ~~**LOOKBACK.**~~ DECIDED 2026-11-24 ("Lookback" above): cap 5 h (in-service
   max 4h40) + an explicit last-train path for the 3.8% of deadlines after a
   route's last arrival.
3. ~~**Mixed lists.**~~ DECIDED 2026-11-24 ("Ranking" above): rail first; all-TJ
   lists lead with the shortest budgeted route. That also settles the
   two-TJ-leg compounding by ranking rather than by a tighter per-leg budget.
4. **Timing coverage.** Tier A only helps where legs are timed, and the
   short-turn grouping in `mcraptor.md` ("The prerequisite is smaller than it
   looks") raises coverage for both modes. Do it first, or ship on current coverage?
5. **Does `router-time-objective.md` land first?** Not required: arrive-by sits
   after the search either way. But if it lands, Tier B's TJ budget should use the
   same speed/run-time source, not a second one.
