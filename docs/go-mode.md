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
Tier 1  + route preferences, several journeys, labels      ← DONE, shipped behind a toggle
Tier 2  + time                                             ← HALF DONE
        service hours + day-awareness + headway waits        DONE
        timetable-driven departures ("next train", arrive-by) NOT STARTED
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

The multi-journey answer lives at **`/_internal/trips/:from/:to`**, and asking for it is a
rider-facing choice: the **beta router toggle** on `/fare` (`fare-sheet/router-toggle.tsx`,
`hooks/use-fare-router.ts`), with the alternatives rendered as cards plus a criteria bar
(`fare-sheet/criteria/`). The split survives *because* a switch picks between two endpoints
that each answer honestly — a mode flag on `/fares` would have made one URL mean two things.

The toggle persists in **localStorage only**. There is no URL form, so a link cannot put a
rider on a router they did not choose. Do not reintroduce a `?router=` param; it was tried
and removed.

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

### Not started: departures

The engine models **how often** a vehicle comes, never **when the next one is**. The
`schedules` table still only feeds timetable display; nothing in `libs/tsundere` reads it.
So these remain unanswerable:

- "Leave now" with real next-departure times on each leg.
- **Arrive-by** planning.
- The **last-train** question in its precise form (service *windows* answer the coarse
  version already).

That is the genuine Connection-Scan / RAPTOR step. Note the constraint discovered since
this doc was written: **TJ has no timetable at all**, only frequencies, so timetable-driven
routing is structurally a rail-only capability. A planner that offers exact departures for
KCI and LRT but not for TJ is a UX problem before it is an algorithms problem, and that
question should be settled before any of it is built.

## UX layer (go mode proper)

- ~~Alternatives as cards: *fastest* · *fewest transfers* · *cheapest*~~ — **shipped**
  behind the beta toggle, with four labels rather than three.
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

1. **Decide the beta toggle's fate.** The alternatives UI is built, tested and in riders'
   hands behind a switch. Either it becomes the default (and `/fares` keeps its singular
   answer for embeds, which it can do indefinitely) or it stays opt-in on purpose. Leaving
   it undecided is the one option that costs something.
2. **POIs.** The last Tier 0 item, additive, and blocked on nothing.
3. **Departures.** Real Tier 2, a different algorithm class, and gated on the TJ
   no-timetable question above.

## Open questions

- Does the beta router become the default, and if so what happens to the toggle?
- Whether exact departures are worth shipping rail-only, given TJ can never have them.
- Scheduled-only vs realtime: live vehicle positions remain a separate, later question.
- Schedule coverage — full operating day, holiday variants, and sync freshness — becomes
  correctness-critical only if departures are built; service *windows* already tolerate
  gaps.
- Whether a time-expanded structure reuses the per-isolate `cachedGraph` pattern.
- ~~k-shortest-paths vs repeated Dijkstra~~ — settled: neither. Pareto bags per (stop,
  round), with `maxBagSize` trading width for cost.
- ~~How many alternatives to surface~~ — settled: `maxResults`, labelled, ties unlabelled.
