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
  the analysis discards stale stretches (fewer than `HEALTHY_MIN` buses updating
  per snapshot) and uses a rate estimator (arrivals ÷ healthy time) that isn't
  biased by short healthy windows.
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
