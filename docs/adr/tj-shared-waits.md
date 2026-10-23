# Bunched, shared waits for TransJakarta boardings

**Status:** *accepted* (2026-10-19). Implemented in `apps/api/src/utils/tjWaits.ts`
(the model), `libs/tsundere/src/planner/plan.ts` (`PlanOptions.waitS`, the sets),
and `apps/api/src/db/scripts/fitTjSharedWaits.ts` (the data).

## Context

The planner charged every boarding half the boarded line's headway. Two things
about TransJakarta made that wrong in opposite directions:

- **Buses bunch.** Held up by the same traffic, a bus is caught by the one
  behind and the pair arrives with a long gap after it. A rider turning up at
  random is more likely to land in that gap, so the expected wait is
  `h(1 + CV²)/2`, not `h/2`. The observed per-line CV is about 0.6 to 1
  (`OBSERVED_CV_PROFILE`). On 6 toward Ragunan at Galunggung that is 8 minutes
  at weekday midday, not 5. Riders report about 10 if they just miss one.
- **Stretches are shared.** Between Karet Kuningan and Setiabudi Integritas,
  6, 6A, 13E and L13E all stop, and a rider takes whichever comes first. The
  search charged the one line it happened to board.

Adding the lines' frequencies together assumes their buses come independently.
Lines on one road are held up by the same traffic and can arrive together, so
whether four lines mean four times the service is a question for the data.

## Decision

One wait model for the search and for the journey estimate.

**Single line:** `W = h(1 + min(CV, 1)²)/2`, with the line-direction's observed CV
for the hour (`bunchingFactor`). The cap keeps a wait at most one headway. The
profile's p90 sits at 1, and the tail past it is the topology-mismatch lines
and the 05:00 ramp-ups.

**A set of lines on a shared stretch:** merging streams adds rates exactly, so
the merged headway is `h_S = 1 / Σ(1 / h_i)` from the per-line model, with
nothing to fit. Arriving together does not change the rate. It changes the
gaps: two buses a few seconds apart and then a long wait. So the clustering
lives entirely in the **merged stream's CV**, which is measured directly:
`fit:tj-shared-waits` merges the member lines' observed arrivals at the stop
and takes the CV of the gaps, per day type and runtime block. Then
`W_S = min(h_S(1 + CV_S²)/2, min_i W_i)`. Waiting for any of the lines is never
worse than waiting for the best one.

Without a fitted cell, `CV_S = 1`, the Poisson limit that superposed independent
streams tend to, and a little above the fitted daytime median. The cap above
still applies. Cells are per day type and block only: pooling a day's blocks
together would mix headway regimes into unevenness that no hour has.

**Which lines form the set** is the engine's call, from its own edges: boarding
at a stop toward the next, every boardable line with that hop. Riding on, the
set narrows at each hop to the lines that run it too. The fit enumerates sets
by the same rule over the same hops (`utils/tjHops.ts` builds them with
`chainHops`, like `generateEdgesSQL`), keyed by stop, next stop (direction)
and lines.

**Charging in the search:** the set's wait is charged at boarding, and each
time the set narrows, the difference is charged on top. `waitS` therefore never
decreases along a journey, which the target pruning relies on.

## Consequences

- The fit (15 days, 2026-09-29 to 10-13) has a cell for 365-376 of 395 sets in
  each weekday daytime block. Merged CVs there run p10 0.72-0.80, p50
  0.87-0.95, p90 1.05-1.15: slightly more regular than independent streams
  (CV 1), so pooling the lines does help, by a little less than a perfectly
  even timetable would. The 05-07 block reads p50 1.40 because service starts
  inside it, the same artefact as below.
- **Corrected 2026-10-23.** The first version of this ADR quoted p10 1.08, p50
  1.37, p90 1.75 and said shared lines arrive together *more* than random. Those
  were all-day cells pooled across blocks: mixing 10- and 25-minute hours
  reads as unevenness no hour has. The fit no longer pools across blocks, so a
  missing block now falls back to `CV_S = 1` rather than an inflated figure.
- Single-line TJ waits rise by 1.3-2x in ranking. Rail gains ground against
  TJ on the margin. A/B and timing are in `docs/tj-observed-timings.md`.
- **Known approximation:** within one (stop, line) state, the search's bag
  compares labels on the wait charged so far, while a label on a wider set may
  still be topped up later. It can be topped up at most to the boarded line's
  own wait.
- With observed headways switched off (`config:observed-headways`), every wait
  is plain `h/2` again, exactly the previous search.
- Non-TJ operators keep `h/2` of the boarded line. The LRT Jabodebek trunk is
  timetabled, and no CV has been observed for it.
- `headways.shared.ts` adds about 195 KB raw to the worker. A topology change
  that drops a set fails its guard test until the fit is re-run.
