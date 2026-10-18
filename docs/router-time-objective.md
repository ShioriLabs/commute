# Router rework: score journeys in time, not metres

Status: **proposed, not started** (noted 2026-10-18). Companion to `mcraptor.md`.
The route regression suite (`apps/api/src/routes/trips.regression.*`) is the
prerequisite and already exists.

## Why

The planner compares journeys in **metres**, but riders judge them in time and
hassle. A metre walked, a metre on a mixed-traffic bus and a metre on the MRT
cost a rider very different amounts of time. So every routing fix so far has
been a hand-set exchange rate between metres and time:

| Constant | Where | What it stands in for |
|---|---|---|
| `WALK_DISTANCE_COST = 2` | `libs/tsundere/src/planner/criteria.ts` | walking is slower than riding |
| `DEFAULT_RANK_WEIGHTS` (walk 2, wait 10/s, boarding 600) | same | time and hassle, in metres |
| `WALK_LEG_COST_M = 400` (2026-10-18) | same | getting off to walk at all |
| `GATED_` / `PAID_ZONE_TRANSFER_WALK_M` | `planner/plan.ts` | in-station walking the survey left out |
| `TRANSFER_PENALTY_M`, `LINE_CHANGE_PENALTY_M` | `libs/tsundere/src/router.ts` (`/fares` only) | changing vehicle |

Each one was tuned against the journey that prompted it, and the next data
change broke a journey nobody re-checked. Kuningan Madya was broken twice this
way (2026-07-22), and the new measured transfers did it again (2026-10-18,
`WALK_LEG_COST_M`). Adding transfers or re-pricing a corridor changes which
exchange rate matters, so the tuning never ends.

There is also a ranking gap: the engine can't rank on time, so
`utils/journey-times.ts` re-sorts timed journeys by arrival after the search.
`mcraptor.md` measured the top journey not arriving first on 10.6% of
fully timed rail pairs, by a mean of 7 minutes. TJ journeys are never fully
timed, so they never get that re-sort.

## The idea

Turn every criterion into **estimated seconds**, using physical quantities that
can be measured, so the only preferences left are a couple of standard ones.

- **Riding:** run time per hop.
  - Rail: median stop-to-stop times from the trip patterns already loaded
    (`db/data/trips.ts`; KCI, MRTJ, LRTJ and LRTJBDB chain). The same
    median-hop approach is already used by `db/scripts/density/ride-time.ts`.
  - TJ: no timetable (`schedules-as-stop-times`, zero TJ rows), so use speed
    classes on distance: busway BRT, mixed traffic, and so on. These are
    physical speeds you can measure, for example from trip logs. You don't tune
    them against each other.
  - Where neither exists, fall back to distance at a conservative speed.
- **Walking:** distance at the rider's pace (`WALK_PACE_MS` in
  `planner/departures.ts`, 1.2 m/s average), plus the existing concourse
  allowance and the `MIN_CHANGE_S` floor. That one setting then drives both
  ranking and timing, instead of `WALKING_WEIGHTS` and `WALK_PACE_MS` as two
  separate tables.
- **Waiting:** already in seconds (`waitS`, half the headway).
- **What stays a preference:** two numbers, ideally from standard
  transit-planning values rather than local tuning:
  - how much a minute walking or waiting weighs against a minute riding
    (commonly about 2x);
  - a per-transfer penalty in minutes (commonly 5 to 10;
    `density/ride-time.ts` already uses 5).

This replaces `rideDistanceM` / `walkDistanceM` / `concourseWalkM` / `walks` in
dominance and ranking with one estimated-time axis. Boardings and fare keep
their own axes, and walking keeps its own so "least walking" can still be
offered. Distances stay in the criteria for **reporting only**.

### What this is not

It is **not** clock-time RAPTOR. The search still never reads a timetable at
query time. Run times are medians baked in at graph load, so the result stays
time-of-day stable and cacheable, which keeps the reasoning in
`mcraptor.md` ("Why 2 and 3 are the right call here") intact. Full RAPTOR
stays a separate, later decision.

## Expected effects

- Fixes like `WALK_LEG_COST_M` become unnecessary: a 400 m walk (about 6 minutes)
  loses to two busway stops (about 2-3 minutes) without any special rule.
- TJ journeys get a time-based order, closing most of the gap the arrival re-sort
  covers today.
- The constants left are physical (speeds, run times, pace) and can be checked
  against data, not tuned per complaint.

## Open questions

- Where TJ speeds come from: GTFS shapes plus observed trip logs, or the
  (now banned, `tj-mqtt-banned`) live feed's history. How many classes are
  enough?
- Whether `findRoute` / `/fares` (OG cards, embed, shared URLs) moves too, or
  stays frozen as it is now.
- Whether the arrival-time re-sort in `journey-times.ts` is still needed for
  fully timed journeys afterwards, or becomes a tie-breaker.
- Dominance tolerances (`DISTANCE_BUCKET_M = 100`) need a time equivalent;
  about one minute is the natural candidate (`WAIT_BUCKET_S` already uses 60 s).

## How to do it safely

1. Grow the regression suite first: add every route someone has checked, each
   with its `why`.
2. Build the time estimates as data (run-time and speed tables) and measure them
   before the search uses them.
3. Switch the objective behind the same A/B used for `WALK_LEG_COST_M`: a
   top-journey comparison over 2,000 seeded pairs on a prod-synced local D1,
   plus the regression suite, plus `auditRouter --baseline` for timeouts.
4. Remove the metre-based constants this replaces in the same change, so the
   two models never run side by side.
