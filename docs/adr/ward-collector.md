# ward: an unattended collector for observed TJ headways

**Status:** *accepted* (2026-09-29). Implemented in `apps/ward`; the analysis side
is `apps/api/src/db/scripts/analyzeObservedHeadways.ts`.

## Context

TransJakarta publishes no timetable and no public realtime feed. Our TJ
headways (`apps/api/src/db/data/headways.ts`) come from GTFS `frequencies.txt`:
one nominal headway per route variant for the whole service span, combined per
stop and clamped to 120s. The planner charges half a headway per boarding.

A one-day spike (2026-09-29) logged live TJ vehicle positions from a
third-party SSE relay and derived arrivals from each bus's `next_stops` changing
between snapshots. Over the healthy parts of that day:

- Observed headways ran **≈2.2× the GTFS value** (median across 155
  line/stop/direction keys; p10 1.2×, p90 3.1×). On Koridor 1 at midday, buses came
  every 3–5 min where GTFS says 2.
- Buses bunch (headway CV ≈0.7), so the wait a rider actually experiences,
  `E[h²]/(2·E[h])`, was **≈3.3× what the planner charges**.
- The relay is **often stale**: snapshots keep arriving every ~30s, but the
  positions inside them stop updating. Only ~20% of the day was usable. Every
  bus operator went stale at the same moments while TJ's own app kept updating
  every 7–10s, so the bottleneck is in the relay, not in TJ's system.

One day can't separate time-of-day effects from noise. With ~20% healthy
coverage, a 30-day window holds roughly 6 usable days, so collection has to run
unattended for weeks. The spike ran on a laptop that slept, hibernated, changed
networks and crashed during that one day.

## Decision

Build `apps/ward`, a small Node service on a 1 vCPU / 1GB VPS:

1. **Collect from the relay only.** Ward reads the relay's SSE feed and never
   TJ's own API or broker. That keeps the project one step removed from TJ's
   private services, on purpose. The feed URL is deployment configuration
   (`/etc/ward.env`) and is never committed.
2. **Store raw snapshots, decide later.** Hourly gz files keep every snapshot
   as received, plus `gap` and `start` records. Staleness and arrival detection
   happen at analysis time, so the method can change without losing data.
3. **Checkpoint nightly to R2.** Each finished WIB day is recompressed with
   `zstd -19 --long=27` (measured ≈10× smaller than the per-line gzip: ~35MB a
   day instead of ~350MB), uploaded, and verified by size and sha256. Local files
   are deleted only after verification; completion is an explicit `.uploaded`
   marker, never the mere existence of an archive.
4. **Analyse on the laptop.** `pull.ts` fetches archives; the analysis lives
   in `apps/api` next to the topology and headway data it compares against.
   Ward sees; `apps/api` decides what the data means.

## Consequences

- R2 costs nothing for ~10 months (~1GB/month against the 10GB free tier), then
  ~$0.015/GB-month. Egress to the laptop is free.
- Collection quality depends on the relay. Ward can't fix upstream staleness;
  the analysis discards stale stretches (fewer than half of the in-scope buses
  that are running updating per snapshot) and uses a rate estimator (arrivals ÷
  healthy time) that isn't biased by short healthy windows. The first version
  gated on a fixed count of fresh buses (400), which undercounted healthy time
  2-4× at night and on weekends; the share gate replaced it on 2026-10-12.
- Nothing is served to users from ward. What eventually ships is aggregates
  (headways baked into `headways.ts`), not live positions.
- Feeding observed headways into `generateHeadways.ts`, including per-hour
  buckets and a bunching-adjusted wait, is a separate decision, to be made once
  there's enough healthy data.

## Alternatives considered

- **Keep collecting on the laptop.** Rejected: sleep, hibernation, network
  changes and a desktop OOM all hit it within one day.
- **Cloudflare Worker on a 1-minute cron.** Workable (the decode needs Workers
  Paid for its ~60ms CPU), but it halves the sampling rate and adds a storage
  pipeline. A VPS holding one long-lived connection is simpler.
- **Store only daily rollups** (`n`, `Σh`, `Σh²` per key). Smaller, but it freezes
  today's analysis method into the data. The spike changed that method three
  times in one day (observation-gap cutoff, skipped-stop interpolation, and
  staleness filtering), so raw it is.
- **Read the operator's feed directly.** It's fresher and richer (it carries
  direction), but it means depending on TJ's private services from this
  project. Rejected in favour of staying one step removed.

## Stage 1: per-hour observed headways (2026-10-12)

`pnpm --filter api fit:headways --dir <archives>` aggregates each WIB day once
(cached, n / Σh / Σh² per line-stop-direction-hour plus healthy seconds per
hour), fits smoothed estimators, backtests them, and writes
`apps/api/src/db/data/headways.observed.ts`. Nothing at runtime reads that file
yet; wiring it into `fares.ts` (`headwaysFor(day, departureS)`) and the station
headway endpoint is a separate, reviewed change.

- **Quantity:** the rate headway (healthy time ÷ arrivals), what "every N
  minutes" means. Bunching is kept as a pooled CV per line-direction-hour, not
  folded in, so the wait-versus-headway decision can be made with data.
- **Model:** profile(line-direction, day type, hour) × factor(stop), fitted by
  iterative proportional fitting. Day types are weekday and weekend (Sat+Sun
  pooled until there are enough weekends to split). Chosen over per-key-hour
  shrinkage because it is ~14× smaller; per-key-hour pooling or shrinkage is
  ~2 points more accurate (median |log error| 0.175 vs 0.191, leave-one-day-out)
  and could be emitted instead at ~33k cells if that ever matters.
- **Backtest gate:** a (day type, hour) column ships only if the held-out
  backtest has at least 100 buckets for it and beats GTFS scaled by a per-hour
  factor there. Weekday 07, 09, 11, 17 and 18 and the overnight hours therefore
  fall back to GTFS.
- **Dropped stops:** a stop seen under 0.3× as often as its line-direction's
  average is treated as a detection artefact (an origin terminal, a halte the
  sampling keeps skipping) and gets no factor.
- **Not verified:** day-to-day consistency is measured; absolute level is not.
  Arrivals the method misses would make every value read long. Public holidays
  are not recognised.

## Wiring observed headways into the API (2026-10-12)

The overlay from stage 1 is read by the planner and the station headway endpoint.
The runtime (`apps/api/src/utils/observedHeadways.ts`) reads four generated
exports and knows nothing about how they were made, so refitting is
**regenerate and deploy**:

```
pnpm --filter @commute/ward pull --out <archives>      # new days
pnpm --filter api fit:headways --dir <archives>        # ~15s with the cache; prints the backtest
git diff apps/api/src/db/data/headways.observed.ts     # review: vouched cells, scale, range
pnpm --filter api test                                 # includes a guard on the generated file
# deploy (API_VERSION bump busts every cached body)
```

**Lookup order for a row**, and the `basis` the endpoint reports for it:

| Basis | Source |
|---|---|
| `OBSERVED` | the line-direction's profile for that day type and hour, divided by the stop's factor |
| `INTERPOLATED` | the same line-direction's profile interpolated between its nearest measured hours (≤ 8h apart; held ≤ 2h past the ends) |
| `SCALED` | the schedule value times a per-column scale, capped at that column's 90th-percentile measured line headway and never below the schedule value (the last resort: no profile of either kind; also what TJ lines that never route get, since they have no profile at all) |
| absent | the schedule value as it was (rail, a line that does not run, the kill switch off) |

Why interpolation sits above the scale: schedule headways are clamped at 120s, so
a global ratio varies by stop, and a stop with measured neighbours zig-zagged
between measured and scaled values across the day. Held out against measured
cells, interpolating a line-direction's own profile had median |log error| 0.12
against 0.22 for schedule x scale at 2-6h gaps, and stayed ahead to 12h.

**Why the scale is capped.** Observed line-level headways saturate: at midday a
schedule value of 120s or less reads ~3.5x longer in the data, 450-900s reads
~1.1x. A flat multiplier therefore overshoots for lines nobody observed (an
integration line at a 514s schedule came out at 28 minutes where comparable lines
ran ~16). Held out line by line, capping at the column's p90 beat the plain
scalar on the tails (p90 |log error| 0.58 vs 0.71) and a fitted power law (0.64)
with the median unchanged.

**Planner.** `fares.ts headwaysFor(day, hour)` hands the unchanged planner a flat
map. At a stop the observed value is the mean of the stop's directions: the
planner cannot know the rider's direction, and the schedule's per-stop figure
pools both directions, which reads optimistic. Rail keys are never touched.

**Station endpoint.** `?hour=` (default: now, Jakarta). `headwayS` is that hour's
value, `scheduledS` the schedule number, `basis` as above. The KV entry stays
one per (station, day) and holds the schedule numbers; the hour is applied per
request. Edge cache for the path is 10 minutes (it went stale on hour
boundaries, not on data changes).

**Kill switch.** `config:observed-headways` = `off` reverts both surfaces to the
schedule within about a minute; any other value, or none, leaves them on. The
journey cache scope gets an `obs-off` suffix so a flip never serves 20 hours of
the other regime.

**Measured effect (2026-10-12, 300 seeded ODs, `findRoutes`, local D1):** the
primary route changed for 31-39% of ODs; median planned wait went from ~250s to
420-560s (p90 570s to 780-980s); query time rose 5-18%. Worker bundle
1,725 KiB to 1,809 KiB (368 to 387 KiB gzip).

**Open:** the absolute level is verified only for day-to-day consistency, not
against ground truth: spot-check a few stops before relying on it. Public
holidays ride the weekend model (`serviceDay` already maps them to SUN). The
Android client needs its generated API classes refreshed for `basis` and
`scheduledS` (additive; old builds are unaffected), and the web card does not
yet label the basis.

### Review fixes (2026-10-12)

An independent review of the wiring found problems in the fallback and selection
paths. What changed, and why it is the way it is:

- **Interpolation no longer overrides observed hours.** Hours 01-04 are not blind:
  the relay was healthy on every day, they just have too few arrivals per stop to
  validate. A straight line from the 00:00 to the 05:00 value ramped through
  03:00 as if buses ran every 13 minutes where the data says ~30. Each
  interpolated column is now compared with the model's own (unvouched) value for
  the same cells; where the median disagreement exceeds 1.3x the column is left
  to the scaled fallback (`OBSERVED_META.interpolationRejected`). Columns with no
  model value at all (the weekday rush hours) have nothing to contradict them and
  are kept. Measured gap: daytime agrees to <= 0.23 in log terms, night starts at
  0.28. That gap is narrow, so the hours between two measured hours are judged
  together (one conflicting hour rejects the whole span, so the weakest cannot
  ship a ramp alone between a measured hour and a rejected one), a single cell
  more than 2x from the model's own value is dropped on its own, and the fit
  prints every column's margin with the borderline ones flagged.
- **The scale is measured wherever the model has data**, vouched or not, not only
  on vouched columns. A median over ~900 stops averages out the per-stop noise
  that keeps thin hours from validating. It is the same quantity the backtest's
  `gtfsScaled` baseline estimates (a per-column median ratio to the schedule),
  computed here from the shipped model against the planner's base values. Only
  columns with no data are interpolated. Caps are the exception: a p90 over
  8-15 lines is noisy, so they are measured only on vouched columns and
  interpolated across the rest (measured on unvouched ones they stepped by 2x
  between neighbouring weekend hours).
- **A directional scale** (`OBSERVED_GTFS_SCALE_DIR`) for directional schedule
  values, measured against those: they run ~1.17x the pooled per-stop values the
  pooled scale was measured on, and scaling them with it double-counted the gap.
- **A stop with no factor takes its line's observed level** (factor 1) before the
  scaled schedule, but only when the schedule does not call the stop rarer than
  that. The fit drops origin terminals and barely-seen haltes as detection
  artefacts; the scaled schedule had made them the most pessimistic rows on the
  card (`1@TJ-H00170P`: 793 s against a line level of 253 s). It also drops
  genuinely rare branch haltes, and the first version of this fallback priced
  those as the trunk (`12@TJ-H00261S`: 3600 s in the schedule, 982 s). A stop
  with a factor but no profile at an hour keeps its scaled value on both the
  planner and the endpoint; a property test compares the two for every
  corridor stop at five hours.
- **Vouching scores what ships.** Per-column stats are computed over every bucket
  the shipped model and its baseline both predicted, not the all-model
  intersection (which scored it only on stops a pooled model could also cover).
  The chooser now weighs M2 against the best of M0 and M1.
- **One kill-switch value per request.** The journey cache scope and the search
  used to read a shared per-isolate boolean at different points separated by
  awaits, so a concurrent flip could key a body under one regime and compute it
  under the other for 20 hours. The value is captured once per request
  (`observedHeadwaysEnabledFor(request)`) and both read that.
- **A stricter guard test** on the generated file: scales >= 1, caps in bounds,
  stop factors averaging ~1 per line-direction (catches an inversion), no
  interpolated cell in a rejected column, and none outside twice its measured
  neighbours.

Deliberately not changed: pricing a whole journey at the departure hour, `basis:
SCALED` carrying an unchanged value when the schedule is already past the cap,
hours outside a line's service window still returning a value on the card, and
the manual `API_VERSION` bump on a refit.
