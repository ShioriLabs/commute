# "Go mode" — from fare calc to trip planner (roadmap)

**Status:** sequencing note, rewritten 2026-09-06 to describe what exists. Umbrella over
`points-of-interest.md` and `transit-hubs.md`. The original discipline — *fares first,
then stop* — has served its purpose: fares are solid, and Tier 1 shipped without a
rewrite. What follows records where the tiers actually stand, not where they were
planned to stand.

## Thesis: the fare tool *is* the planner's spine

The reason to build fares first wasn't just focus — it's that **nothing built for fares
got thrown away**. That claim has now been tested rather than asserted. The multi-criteria
planner was added *beside* the fare pipeline, not in place of it: both endpoints render
through the same `utils/fare-journey.ts`, so they cannot drift in how a leg looks, only in
how many journeys come back.

```
Tier 0  static route + per-segment fare                    ← DONE (POIs still unbuilt)
Tier 1  + route preferences, several journeys, labels      ← DONE, now the only router
Tier 2  + time                                             ← MOSTLY DONE
        service hours + day-awareness + headway waits        DONE
        timetable-driven departures ("next train")           DONE, rail only
        arrive-by                                            NOT STARTED
        = go mode
```

Each tier is independently shippable and useful on its own. That held.

## Tier 0 — done, minus POIs

- **Fare** (`apps/api/src/utils/fare-summary.ts` + `fare.ts`): per ride-segment, priced by
  operator tariff. Time-aware since the fare criteria bar shipped.
- **POIs** (`points-of-interest.md`): **still unbuilt.** No `poiStations`, no access walks,
  nothing in the codebase. Door-to-door endpoints remain the one Tier 0 item outstanding,
  and it is now the *only* thing on this roadmap that is purely additive — it needs no
  engine work, just data and a virtual-node injection per request.

## Tier 1 — done, and built better than this doc predicted

See **`mcraptor.md`** for what the engine is and is not — it is McRAPTOR-shaped, not
RAPTOR, and the four divergences are deliberate.

The router moved out of `apps/api/src/utils/router.ts` into **`libs/tsundere`**, a
dependency-free routing engine package with its own tests, benchmarks and public surface
(`loadGraph` → `findRoute` / `findRoutes`). Read its README before touching it; the
boundary it keeps (no operators, no rupiah, no database types) is deliberate and
load-bearing.

What shipped is not the "crank `TRANSFER_PENALTY_M`" generalisation this doc originally
sketched. It is the better version:

- **Five criteria, not one weighted scalar** (`planner/criteria.ts`): boardings,
  `rideDistanceM`, `walkDistanceM`, `concourseWalkM`, `waitS`, `fare`. Per-(stop, round)
  Pareto bags replaced the scalar Dijkstra.
- **"Cheapest" resolved exactly as this doc warned it must be.** Fare is not a fourth edge
  weight; it rides along as an axis scored over materialised legs via a `scoreFare`
  closure, so the engine prices a journey without knowing what money is. `fare: null`
  means *incomparable* — never zero (which would make an unpriceable journey spuriously
  dominant) and never infinity (which would silently delete it).
- **Dominance tolerances are not a nicety.** `DISTANCE_BUCKET_M` (100m) and
  `WAIT_BUCKET_S` (60s) exist because five continuous axes means two journeys differing by
  one metre are mutually non-dominated, and every bag grows until the search dies. Applied
  as a pairwise tolerance rather than a grid, because a grid separates 5049 from 5051 at
  the boundary.
- **Labels ship in Indonesian**, four of them, as a total `Record` so a fifth engine label
  breaks the build rather than rendering `SHORTEST_WAIT` at a rider: *Termurah*, *Paling
  santai*, *Minim jalan*, *Sering lewat*. `SHORTEST_WAIT` is worded as "the vehicle comes
  often" and never as "you will arrive sooner" — it comes from headways, and the app has
  no arrival time to promise.

### How it reaches riders

`/fares/:from/:to` **still calls `findRoute`, singular, on purpose.** It is the shared URL,
the OG card and the TransportForJakarta embed, so its answer must not move for anyone who
did not ask. `findRoutes` picks a different primary on some pairs — Bogor → Lebak Bulus
becomes a one-transfer Rp 20.000 route where `/fares` returns the three-transfer
Rp 17.500 one. Neither is wrong.

The multi-journey answer lives at **`/_internal/trips/:from/:to`**, rendered as cards plus
a criteria bar (`fare-sheet/criteria/`). **Since 2026-09-06 it is the only answer the app
shows** — the standard/beta toggle it shipped behind was deleted, not flipped, along with
`utils/fare-router.ts`, `hooks/use-fare-router.ts` and `fare-sheet/router-toggle.tsx`.

The split still survives, for the reason it always had: two endpoints that each answer
honestly, where a mode flag on `/fares` would have made one URL mean two things. `/fares`
is now purely a public contract — the OG worker (`apps/opengraph`), shared links and the
embed — and `findRoute` stays as the oracle `compareRouters.ts` diffs against.

What promotion cost, measured over 300 seeded pairs before the switch: the **primary route
changes on 42%** of them, but the **fare is identical on 70%**, and where it moves it is
79 pairs cheaper against 8 dearer (mean **−Rp 1.484**). Coverage is unchanged — there is no
pair one router can route and the other cannot. Of the 8 dearer, 5 still show a cheaper
option on screen wearing *Termurah*; only 3 genuinely trade money for a saved boarding.

Two consequences worth remembering:

- **Deleting the toggle deleted a fetch gate.** `routerReady` existed only so a beta
  rider's first paint would not query `/fares` and then immediately `/_internal/trips`.
  With one endpoint that race cannot happen, so the query now fires on first paint.
- **The embed changed behaviour.** `readFareRouter` fell back to `standard` when storage
  throws, which is exactly what happens in the partitioned TransportForJakarta iframe — so
  the embed had been silently riding the old router. It now gets the multi-journey answer
  like everything else. `useIsEmbed` (`?embed=true`) is there if it ever needs its own
  treatment.

There is still no URL form of *which router*, and there is nothing left to put in one. Do
not reintroduce a `?router=` param; it was tried and removed. `?modes=rail` is different
and does round-trip — it names what the rider excluded, not which engine answered.

**A `/fares`-shaped body still reaches the card**, from the API's 20-hour KV, from SWR's
IndexedDB, and from the service worker. `journeysOf` (`fare-sheet/journeys.ts`) promotes it
to a single unbadged journey. That branch is cache compatibility, not dead standard-router
code — deleting it strands every rider holding a warm body.

## Tier 2 — half done, and the half nobody expected came first

This doc assumed "time" meant timetables, and that the tier was one algorithm-class jump.
It wasn't. Time arrived by the cheaper road, and the expensive road is still unbuilt.

### Done: the network knows when it is shut

- **Service windows** (`planner/service-hours.ts`) as `[startS, endS]` seconds since local
  midnight, with the engine staying timezone-free — apps/api converts a `Date` and passes
  a number, the same way it passes distances rather than coordinates. `endS < startS`
  means the window crosses midnight, which is the *normal* case for a rail line.
- **Windows are derived, not declared**: the complement of the largest circular gap
  between departures. `MIN`/`MAX` cannot work (KCI lines B, C and R all have departures at
  both 00:00 and 23:59, so extremes report 24-hour service and filter nothing), and
  percentiles cannot either (a wrapping window has its ends at opposite ends of a linear
  sort). `minGapS` guards genuinely round-the-clock service — TJ's AMARI night corridors
  have no break worth calling one.
- **Day-awareness** merged 2026-09-05 (PR #126): TJ day-aware headways, LRT Jabodebek
  weekend schedules, and no-service date/time handling end to end through API and UI.
- **Wait modelling from headways**, per-stop and directional where the data supports it.
- **Closed ≠ disconnected.** An empty Pareto front has two causes and riders need them
  told apart, so `/trips` probes `nextServiceAt` and answers `outcome: 'CLOSED'` with a
  reopening time — behind both conditions, off the hot path.

This is the *realistic ceiling* identified earlier: service-hours plus frequency filtering,
not RAPTOR. The late-night problem this doc flagged as the time dimension biting early —
"the best route at 02:00 ≠ the best route at 14:00" — is answered.

### Done: departures, and not the way this doc expected

Shipped 2026-09-07. Each ride leg carries `departureAt` / `arrivalAt` where a real trip
covers it, and a journey carries `arrivalAt` only when every ride leg is timed.

**This was not the Connection-Scan / RAPTOR step the section above predicted**, because
a measurement removed the need for one. Replanning 200 seeded rail pairs at 06:00,
09:00, 12:00, 15:00, 18:00 and 21:00 returned the **identical route at all six hours for
162 of the 162 pairs** that route at all six. Service hours already exclude the shut
corridors and nothing else in the criteria vector moves with the clock, so *which way you
go* is stable and only *which vehicle you catch* varies. No time axis was added to
`Criteria`, `dominates` or the search — `auditRouter --baseline` still reports 0 changed
result sets over 300 pairs, which is the gate that keeps it true.

Instead `planner/departures.ts` resolves times **after** the search, and the API applies
them in a `retime` hook that runs on the cache-hit path as well as the miss. So KV keeps
storing the untimed journey for its full 20 hours while every reader gets times against
their own `at` — the route is the cacheable half, the vehicle is the per-request half.

**Each route is offered at its next three boardings** (`journey-times.ts`), merged across
routes and sorted by arrival. A route is a way of getting there; a boarding is a train,
and they are different choices: from Cakung the 08.11 and the 08.22 both reach Rasuna
Said at 08.56, so the later one is strictly better and the old one-card-per-route view
could not say so. Untimed routes contribute exactly one row, because there are no
departures to enumerate.

Two consequences worth knowing. **Labels are recomputed in apps/api over the expanded
set**, compared per ROUTE rather than per row — three boardings of one route share its
fare, so comparing rows would tie every axis against itself and award nothing. And the
card face shows the boarding even when the arrival is unknown: on a rail-into-TJ journey
the departure is a fact and the arrival is not, and without it several rows of one route
are indistinguishable plates.

**Coverage is 51.5% of rail-only journeys fully timed**, and the shortfall is directional
data rather than engine capability: not one KCI stop pattern is reversible (line C has 23
patterns and 0 reversible endpoint pairs; R 15/0; B 13/0), and 0 of 142 southbound MRTJ
trips include Lebak Bulus against 142 of 142 northbound. Both directions' trips exist —
their per-trip stop lists are what have gaps.

> **Correction (2026-09-15).** The statistics above are true; the inference from them
> is not. Both directions ARE present — they fail an endpoint-equality test only
> because short-turns make them terminate at different stations — and the MRTJ
> "missing" terminus is correct data: a terminus has no departures in the direction
> that ends there. Measured at hop level, every one-way hop in the feed is a terminal
> hop. See `mcraptor.md` for the measurements and for what a route-scanning search
> would actually need (pattern bookkeeping, not data recovery).
>
> The real cause of a large slice of the shortfall was line **T (Tangerang)**, whose
> stored board split every train across two tripNumbers (`1903` + `1903A`) and so
> failed hop validation entirely — 242 of 289 chain-gap rejections, zero patterns for
> the line. The live feed no longer does this; refreshing the board took KCI from 960
> to 1080 trips and 65 to 67 patterns. KCI had also renamed two station codes
> upstream (`TTI`→`THI`, `GGL`→`GRG`), which is why those stations had silently
> stopped syncing — see `toFeedStationCode` in `operators/kci/formatters.ts`.

Still unanswerable, and each for its own reason:

- **Arrive-by** planning. A different query, and this one genuinely does need the search
  to change.
- **The last-train question** in its precise form (service *windows* answer the coarse
  version already).
- Exact departures on **TransJakarta**, ever: the feed is 730 trips with `frequencies.txt`
  and no timetable at all. That is why leg times are per-leg and absent rather than
  journey-wide — a mixed journey shows the clock on its rail legs and the headway wording
  on its TJ ones, which is the UX answer to the question this section used to pose.

## UX layer (go mode proper)

- ~~Alternatives as cards: *fastest* · *fewest transfers* · *cheapest*~~ — **shipped**,
  with four labels rather than three, and since 2026-09-06 the only answer the app shows.
- "Leave now / depart at HH:MM / arrive by HH:MM." — needs the departures work above.
  Departure *time* is already a rider input (it drives the fare bucket and service hours);
  what is missing is arrive-by and next-departure.
- Next departures inline on the itinerary legs — same blocker.
- Reframe the entry point: it is still "Cek Tarif" gated behind the fare button rather
  than a plan-a-journey surface. This is now the largest purely-presentational gap, and it
  no longer depends on any engine work.

## The spine — what carried over (nothing thrown away)

| Piece | Built for | Reused in go mode as |
| --- | --- | --- |
| Route graph + `loadGraph` | fares | the planning graph, now with a time layer |
| `TRANSFER_PENALTY_M` | fares | superseded by the five-axis criteria model |
| `summarizeFares` / `calculateSegmentFare` | fares | the `scoreFare` closure + per-plan fare |
| `JourneyTimeline` renderer | fares | the itinerary view, shared by both endpoints |
| `utils/fare-journey.ts` | fares | the one renderer both routers go through |
| Hubs as transfer super-nodes | hubs | interchange modelling for preferences |
| POI access walks (`poiStations`) | — | **still unbuilt** |
| `schedules` stop-times | timetable | **still display-only**; Tier 2's remaining input |

## Sequencing / discipline

The original rule was "fares first, then stop." That expired: the engine work went well
past it, deliberately and without rework, which is the outcome this doc predicted.

The live question is no longer *what to build next* but **what to promote**. Three
independent moves, in rough order of leverage:

1. ~~**Decide the beta toggle's fate.**~~ **Settled 2026-09-06: the multi-journey answer
   is the default and the toggle is gone.** See the section below.
2. ~~**Departures.**~~ **Shipped 2026-09-07**, and not as a different algorithm class —
   the route turned out to be stable across the day, so times resolve onto it after the
   search. See above.
3. **POIs.** Now the last item on this list: the final Tier 0 gap, additive, and blocked
   on nothing.

## Open questions

- ~~Does the beta router become the default, and if so what happens to the toggle?~~ —
  settled: yes, and the toggle was deleted rather than flipped.
- ~~Whether exact departures are worth shipping rail-only, given TJ can never have
  them.~~ — settled: yes, per LEG rather than per journey. A mixed journey shows the
  clock on its rail legs and the headway wording on its TJ ones, so nothing has to be
  withheld from rail riders to stay honest about buses.
- Scheduled-only vs realtime: live vehicle positions remain a separate, later question.
- Schedule coverage is now correctness-critical, and the binding gap is **directional**:
  no KCI pattern is reversible and no southbound MRTJ trip reaches Lebak Bulus, which is
  most of why only 51.5% of rail journeys are fully timed. Holiday variants and sync
  freshness matter for the same reason now.
- ~~Whether a time-expanded structure reuses the per-isolate `cachedGraph` pattern.~~ —
  moot: there is no time-expanded structure. The trip index rides along on `cachedGraph`
  and the times are resolved per request.
- ~~k-shortest-paths vs repeated Dijkstra~~ — settled: neither. Pareto bags per (stop,
  round), with `maxBagSize` trading width for cost.
- ~~How many alternatives to surface~~ — settled: `maxResults`, labelled, ties unlabelled.
