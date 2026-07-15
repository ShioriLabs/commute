# "Go mode" — from fare calc to trip planner (roadmap)

**Status:** vision / sequencing note — nothing here is committed. Umbrella over
`points-of-interest.md` and `transit-hubs.md`. **Fares ship first**; this exists so the
order is written down, not to authorise building any of it yet.

## Thesis: the fare tool *is* the planner's spine

The reason to build fares first isn't just focus — it's that **nothing built for fares
gets thrown away**. The fare experience quietly assembles every load-bearing piece of a
trip planner; "go mode" is what you get by adding two layers on top, not by rewriting.
So we ship the fare slice of a planner, and the planner is mostly already there when we
decide to turn it on.

```
Tier 0  static route + per-segment fare + POIs   ← here (once POIs land)
Tier 1  + route preferences (least walk / fewest transfers / cheapest)
Tier 2  + schedule-aware routing (next-train, last-train, arrive-by)
        = go mode
```

Each tier is independently shippable and useful on its own. You are never mid-rewrite.

## Tier 0 — where we are

- **Router** (`apps/api/src/utils/router.ts`): Dijkstra over ride edges + walk transfers,
  returns **one** shortest weighted route; `TRANSFER_PENALTY_M` biases against needless
  network hops.
- **Fare** (`apps/api/src/utils/fare-summary.ts` + `fare.ts`): per ride-segment, priced
  by operator tariff.
- **POIs** (`points-of-interest.md`): landmark origins/destinations as curated access
  walks — transfer-shaped virtual nodes.

Static and **time-agnostic**. That last word is the whole story of the tiers above.

## Tier 1 — route preferences (the "1 step")

Offer *least walk* / *fewest transfers* / *cheapest*, and show them as alternatives
instead of a single answer. Mostly a generalisation of the router that exists:

- **Parametrise the cost model.** *Fewest transfers* → crank `TRANSFER_PENALTY_M` or make
  transfer count a lexicographic tiebreaker; *least walk* → weight walk edges harder.
  Same Dijkstra, different weights.
- **k-shortest-paths** so you can *present* alternatives, not just return the argmin.
- **"Cheapest" is not a fourth edge weight — this is the subtle one.** Fares aren't
  per-edge additive: `calculateSegmentFare` is progressive (KCI), flat (LRTJ), capped
  (LRTJBDB), or an OD matrix (MRTJ), and the total depends on **where the tap-outs land**
  (segment boundaries), which depends on the whole path. So cheapest ≠ minimise a weight;
  it's **generate candidate routes → score each with `summarizeFares` → pick the min**.
  Doable, but "generate + evaluate," not "one clever weight."
- **Payoff concentrates at the hub complexes** (Manggarai, Dukuh Atas) — that's where a
  transfer trades against a longer ride, or a one-stop ride against a walk. So this tier
  leans on the hub work in `transit-hubs.md` (a hub as a transfer super-node).

## Tier 2 — schedule-aware routing (the half-step that makes it a planner)

The real gap nobody notices until here: **time**. Everything in Tiers 0–1 is a static
graph; a planner answers "how do I get there *now*, and when do I arrive?" That needs
next-train, service frequencies, the **last-train** problem, and a "best route" that
changes with the clock.

- **The data already supports it.** `schedules` (`db/schemas/schedules.ts`) is a
  per-station stop-time table — `stationId`, `estimatedDeparture`/`estimatedArrival`,
  `boundFor`, `lineCode`, keyed by `tripNumber`. Group by `tripNumber`, order by time, and
  you have **trips → a connection list** — exactly the input for a Connection-Scan /
  RAPTOR-style time-dependent router. Today those rows only feed the timetable display;
  Tier 2 promotes them to routing input.
- **The late-night edge case is the time dimension biting early.** The rare
  Cikarang↔Jakarta Kota late-night ops (and the KCI-JAKK-C grouping) are exactly the
  "the best route at 02:00 ≠ the best route at 14:00 / does the last train still run?"
  problem. A static router can't express it; a time-dependent one must.
- **Bonus: fares get *more accurate*, not just routes.** `fare.ts` already notes the
  LRTJBDB cap is time-dependent (peak 20000 / off-peak & weekend 10000) and is currently
  **flattened to the peak cap "because fares here are time-agnostic."** Once Tier 2 knows
  the departure time, that flattening lifts — the fare number sharpens as a side effect of
  routing over time. The time layer pays back into the fare slice you shipped first.

This tier is a **different algorithm class** (time-expanded graph / CSA / RAPTOR), which
is why it's the "half-step" rather than another weight tweak — and it's the interesting
half.

## UX layer (go mode proper)

- "Leave now / depart at HH:MM / arrive by HH:MM."
- Next departures inline on the itinerary legs (you already render legs).
- Alternatives as cards: *fastest* · *fewest transfers* · *cheapest* (Tier 1 output).
- Reframe the entry point — it stops being "Cek Tarif" gated behind the fare button and
  becomes a plan-a-journey surface. (Fare stays a first-class answer *within* a plan.)

## The spine — what carries over (nothing thrown away)

| Piece | Built for | Reused in go mode as |
| --- | --- | --- |
| Route graph + `buildGraph` | fares | the planning graph (add a time layer) |
| `TRANSFER_PENALTY_M` | fares | one of Tier 1's tunable weights |
| `summarizeFares` / `calculateSegmentFare` | fares | the "cheapest" scorer + per-plan fare |
| POI access walks (`poiStations`) | fares | door-to-door plan endpoints + `ACCESS` legs |
| `JourneyTimeline` renderer | fares | the itinerary view (add times to legs) |
| Hubs as transfer super-nodes | hubs | interchange modelling for preferences |
| `schedules` stop-times | timetable | Tier 2 connection list |

## Sequencing / discipline

**Fares first, then stop.** Do not start Tier 1/2 until the fare experience is solid —
the point of this doc is to prove that waiting costs nothing (no rework), not to green-light
building ahead. Ship in tier order; each tier is a real, standalone improvement.

## Open questions

- k-shortest-paths vs repeated single-objective Dijkstra runs for alternatives.
- Scheduled-only vs realtime: we route on `schedules` (planned times); live train
  positions are a separate, later question.
- Schedule coverage — full operating day, weekend/holiday service variants, and freshness
  (the sync path) all become correctness-critical once schedules drive routing.
- How many alternatives to surface (fastest/fewest/cheapest — 3? collapse when identical?).
- Whether Tier 2 reuses the per-isolate `cachedGraph` pattern or needs a different
  cache/shape for the time-expanded structure.
