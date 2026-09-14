# McRAPTOR: what the planner actually is

**Status:** *shipped and serving every journey* (`/_internal/trips`, sole router
since 2026-09-06). Implements **Tier 1** of `go-mode.md` and most of its
**Tier 2**. Companion to `service-hours-day-types.md` (the time layer this
search consults) and `tj-gtfs-import.md` (where trips come from).

**This document exists because the engine's name oversells it.** `plan()` is
described in code as "RAPTOR's round structure with a Pareto bag per (stop,
round)", and that is accurate — but it is *not* RAPTOR in the sense of
Delling/Pajor/Werneck, *Round-Based Public Transit Routing* (ALENEX 2012). It
borrows the round structure and the multi-criteria bags of **McRAPTOR** (§4.1)
while keeping a Dijkstra-shaped inner loop, and it optimises a criteria vector
that **contains no arrival time at all**.

Every divergence below is deliberate and measured. The point of writing them
down is so the next person asking "are we RAPTOR yet?" does not re-derive the
answer from scratch — and so that anyone who *does* want real RAPTOR knows
exactly which four things have to change.

## Goal

Return several genuinely different journeys for one origin/destination pair,
each best at something a rider would name out loud, fast enough to serve
interactively from a Worker.

## What we have, against the paper

Read against Algorithm 1 (§3) and the McRAPTOR extension (§4.1).

| RAPTOR property | `plan()` | |
| --- | --- | --- |
| Rounds = vehicle boardings | `for (let round = 0; ...)`, `plan.ts` | yes |
| No priority queue | worklist array + cursor | yes |
| Pareto bags per (stop, round) | `Bag`, `bag.ts` | yes, McRAPTOR-shaped |
| Target pruning | `destinationBag.isDominated(...)` | yes |
| Criterion: number of transfers | `boardings`, equals the round index | yes |
| Local pruning (`τ*`) | absent — dominance is per-bag, no global `τ*(p)` | partial |
| Provably sound pruning | the boardings-slack bound is a heuristic | **no** |
| **Route scan** — mark stops, collect routes, traverse each once | **relaxes `adjacency.get(stop)` edge by edge** | **no** |
| **`et(r, pᵢ)` earliest-trip lookup** | **never called during search** | **no** |
| **Criterion: arrival time** | **`Criteria` has no time axis** | **no** |
| Footpaths as a separate stage | relaxed inline, same loop as rides | different |

### 1. It scans edges, not routes

RAPTOR's performance argument is that round *k* touches each route at most
once, walking its stops in order behind an `et(r, ·)` cursor that only ever
decreases. `plan()` instead expands per-label over `adjacency` — label-correcting
relaxation, the very thing the paper positions itself against.

That is why it needs a re-queue worklist and `MAX_SAME_ROUND_REVISITS`: relaxing
a stop can improve another stop *in the same round*. Real RAPTOR has no re-queue,
because a route is never scanned twice in a round.

**The machinery for a real route scan already exists and the search does not use
it.** `planner/trips.ts` builds `TripIndex`: `byStop` is precisely RAPTOR's
stop→routes index, `IndexedPattern` its route→stops array, and `nextTrip()` is
`et(r, pᵢ)` under another name (binary search over departure-sorted trips).
`trips.ts` says so in its own header — *"NOTHING IN THE SEARCH READS THIS YET,
and that is deliberate."*

`byStop` is in fact **dead code**: nothing in the repo reads it. Only `byLine` is
consumed, and only by `departures.ts`, after the search has finished.

### 2. There is no time in the search

The criteria vector is `boardings`, `rideDistanceM`, `walkDistanceM`,
`concourseWalkM`, `waitS`, `fare`. Wait is modelled as **half the headway**
(`expectedWaitS`) — an expected value under uniform arrival, explicitly not a
timetable. RAPTOR minimises `τ_k(p)`, an actual clock time.

These are different objective functions, so the two algorithms can legitimately
disagree about the best journey **given identical data**.

### 3. Times are resolved after the fact

`planner/departures.ts` runs *after* `plan()`, over materialised legs, pinning
real trips onto a route chosen without them. It is careful (null means unknown,
and the clock stops the moment a leg cannot be timed) — but it is a decoration
pass, not routing.

## Why 2 and 3 are the right call here

A measurement, not a preference. Replanning 200 seeded rail pairs at 06:00,
09:00, 12:00, 15:00, 18:00 and 21:00 returned the **identical route at all six
hours for 162 of the 162 pairs** that route at all six.

Service hours already exclude shut corridors, and nothing else in the criteria
vector moves with the clock. So *which way you go* is stable across the day and
only *which vehicle you catch* varies. Adding an arrival-time axis would widen
the Pareto front, raise bag pressure, and lean harder on the eviction and
termination arguments — to return the same route.

`auditRouter --baseline` reporting **0 changed result sets over 300 pairs** is
the gate that keeps this true. If it ever moves, this section is wrong.

Splitting it this way also pays for itself operationally: the route is cached in
KV for 20 hours while times resolve per request against the rider's own `at`.
The route is the cacheable half; the vehicle is not.

## Where the shortcut already costs us

**The engine cannot rank on arrival, so something else has to.** `byArrival`
(`utils/journey-times.ts`) sorts the expanded set in apps/api. Measured over
**1200 seeded rail pairs, the engine's top-ranked journey is not the
earliest-arriving one on 10.6% of fully-timed multi-journey pairs, by a mean of
7 minutes.**

The clearest case is not a criteria trade-off at all. On `MRTJ-STB → KCI-CSK`
two journeys share their lines *and* their 08.04 departure, but one reaches
Cisauk at 09.00 against 09.10 **and** walks 90m against 200m — better on both
axes, still listed second, because the axis it wins on is one the engine does
not carry.

A post-hoc sort fixes the ordering. It cannot recover a faster journey the search
never kept, and both `maxBagSize` eviction and the boardings-slack bound discard
on criteria that exclude time.

The 162/162 stability result and the 10.6% mis-ranking are **not in conflict**:
*which routes* come back is stable; *which one ranks first* is decided without
reference to when they arrive.

## Known approximations

Worth knowing before trusting a result set completely.

- **Bags are bounded and lossy.** `maxBagSize` (8) evicts the worst-ranked label
  when full, which can discard a genuinely non-dominated journey. Eviction
  protects a line's last label, but a bag whose labels are *all* sole
  representatives has no protected-free victim and the global worst goes. Real
  McRAPTOR bags are unbounded; unbounded here means the search stops finishing,
  because TJ's overlapping corridors grow bags without limit.
- **The boardings-slack bound is unsound.** Pruning at
  `boardings > bestCompletedBoardings + 1` is a heuristic, not a Pareto-valid
  bound — it can cut a non-dominated journey. It exists because dominance alone
  barely prunes partial labels. One boarding of slack was measured as the point
  where runaway searches collapse without stripping the alternatives the engine
  exists to produce.
- **Dominance is quantised** (`DISTANCE_BUCKET_M` 100m, `WAIT_BUCKET_S` 60s) and
  applied pairwise rather than on a grid. Without it, five continuous axes mean
  nothing is ever dominated and every bag grows until the search dies.
- **Fare never prunes.** It is scored once per surviving journey over
  materialised legs, because real tariffs are not additive per edge. `fare: null`
  means *incomparable*, never zero and never infinity.

## If we ever build real RAPTOR

Only worth doing for **arrive-by**, which genuinely needs the search to change —
you cannot run a latest-departure search on an objective with no time in it. It
belongs **beside** `plan()`, not in place of it:

- New `libs/tsundere/src/planner/raptor.ts`, exporting `arriveBy(...)`.
- Consume `TripIndex` directly: `byStop` for marked-stop → route accumulation
  (Algorithm 1 lines 8–13), `IndexedPattern` for in-order traversal, `nextTrip()`
  as `et(r, pᵢ)`.
- Keep it **bicriteria** (arrival time, boardings) as the paper does. Fare and
  walking stay in `plan()`; do not merge the two objective functions.
- Footpaths as a separate third stage over marked stops (lines 24–27). Walk edges
  (`lineCode === null`) are already the footpath set.
- Reuse verbatim: `makeEndpointGuard`, the `serviceBreaks` logic,
  `hopsToLegs`/`traceToHops`, and `changeSecondsAt` as minimum-change-time.
- **Rail only.** TransJakarta has no timetable and never will — 730 trips with
  `frequencies.txt` — so a headway-only line has no `et(r, ·)` to look up. Gate
  it out the way `excludeLines` already does.

### The prerequisite is smaller than it looks

`go-mode.md` explains the 51.5% timing coverage as *"not one KCI stop pattern is
reversible"*. **That statistic is true and the inference from it is wrong.**

Both directions are present. Line B runs `KCI-BOO → KCI-JAY` (113 trips) *and*
`KCI-JAKK → KCI-CLT` (114 trips). They fail an endpoint-equality test only
because short-turns make the two directions terminate at different stations,
which is normal for a commuter railway.

Nor is terminus data missing: **a terminus has no departures in the direction
that ends there**, so a departure-board feed correctly emits no row for it.
Grouping by `boundFor` shows perfect symmetry — `MRTJ-LBB` has 142 trips bound
for Bundaran HI and none bound for Lebak Bulus. Measured at hop level, **every
one-way hop in the feed is a terminal hop**. Lines scoring "worst" (TP 25%,
KLB 33%) are simply the shortest, with more termini per hop.

What a route-scanning RAPTOR actually needs is **pattern bookkeeping, not data
recovery**: tag each pattern's direction and group short-turns under it. Prefer
`boundFor`, which every operator has. KCI trip numbers also encode direction —
45 KCI patterns are parity-pure, all-odd or all-even, with zero exceptions,
because KCI is still KAI and every working must appear in the **Gapeka**. But
that is a *direction tag, not a join key*: a train changes number when it
reverses, and `train_id` is a composite (its letter suffix is line-partitioned,
not directional). MRTJ, LRTJBDB and APCGK answer to no Gapeka and have synthetic
per-station ids, so parity tagging is **KCI-only by construction**.

## Skip-stop hops: why 43 line-C trips are rejected

Worth documenting because it is **not** a data problem, and the fix is not a
re-sync.

Pasar Senen (`KCI-PSE`) on the Cikarang loop is served **northbound only**. The
loop runs `GST → PSE → KMO → … → KPB` inbound; southbound trains pass through
without stopping. The data reflects this exactly — PSE carries 43 rows against
86 at every neighbour (GST, KMO, KMT, RJW), and the split by direction is total:

| Direction | Trips via KMO | Call at PSE |
| --- | --- | --- |
| Kampung Bandan / Jakarta Kota (inbound) | 43 | **43** |
| Bekasi / Cikarang (outbound) | 43 | **0** |

The network already models this — `ENDPOINT_RESTRICTIONS` in `db/data/topology.ts`
carries `{ station: 'PSE', lineCode: 'C', forbiddenNeighbor: 'GST' }`, and its
comment is explicit that *"the through-edges stay bidirectional so a passenger
may still ride PAST the stop"*.

**`generateTrips.ts` does not know that.** Its `hasEdge` check requires a literal
adjacency, so a southbound trip's real `KMO → GST` hop has no edge and the whole
trip is dropped. The skip path exists (`KMO → PSE` and `PSE → GST` are both
edges); nothing consults it.

So these 43 are a **trip-validator limitation**, not missing rows: the feed is
right, the topology is right, and the two disagree about what a legal hop is. A
fix would let `hasEdge` accept a hop that spans exactly one intermediate stop
whose `ENDPOINT_RESTRICTIONS` entry forbids that direction — deliberately narrow,
because a general "allow 2-hop gaps" rule would re-admit the genuine chain gaps
the check exists to catch.

Not every C rejection is like this. The 3 `JAKK → KPB` rejections are **correct**:
Jakarta Kota is deliberately absent from the routable Cikarang line, because only
1–2 late-night *sapu jagat* (sweeper) workings divert there, and trip planning
must never route a passenger onto a once-nightly train. See the comment above
`TOPOLOGY` in `db/data/topology.ts`.

## Verification

```bash
# The search never reads the trip layer — the core of divergences 1 and 2.
grep -rn "nextTrip\|TripIndex\|byStop" libs/tsundere/src/planner/plan.ts   # none
# byStop: only trips.ts builds it, nothing consumes it. The generateHeadways
# hits are an unrelated local variable of the same name.
grep -rn "byStop" libs apps --include="*.ts" | grep -v test | grep -v dist/
grep -n "arrivalS\|departureS" libs/tsundere/src/planner/criteria.ts       # none

# The gate that keeps the no-time-axis decision honest.
pnpm --filter @commute/api exec tsx src/db/scripts/auditRouter.ts --baseline

pnpm --filter tsundere test
```

If either of the first two greps starts matching, this document is stale and the
verdict needs re-deriving.
