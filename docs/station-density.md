# Station density (design note)

**Status:** design note — not yet built. The temporal companion to
`station-score.md`: that column says how busy a station is *in general*; this says
how busy it is *right now*. Renders as a crowding badge on the station page and on
the live board (`apps/android/feature/trip/.../PidsBoard.kt`). KCI's C-Access app
shows a crowding badge like this; the data behind ours is our own.

## Why

Riders decide between "leave now" and "wait one" partly on how packed the platform
is. We already rank stations by a static busyness score; what we don't show is the
*time-of-day shape* of that busyness — Manggarai at 08:00 vs. 14:00 is the same
score but a completely different platform. A simple three-level badge ("Lengang /
Padat / Sangat Padat") next to a departure is a cheap, legible way to carry that.

## Prior art — what C-Access does

KCI's C-Access app already shows station crowding, and the *shape* is worth
copying:

- A **three-level** badge — not crowded / crowded / very crowded.
- Shown in two places: on the station itself, and against a specific train in the
  schedule.

What we take: the **three-level badge and where it sits** (on the station, and per
upcoming train). What we do **not** take: their numbers. Theirs almost certainly
come from live fare-gate counts that only KCI holds, served from their own private
backend — not a feed we have or should try to reach. Ours is modelled from data we
already own (below).

## The data problem

We have no live crowding feed and — per `station-score.md` — **no usage telemetry
at all**: no analytics SDK, no ingestion endpoint, recents/favourites never leave
the device. Trip-mode's per-stop GPS and boarding logs are recorded locally and
exported by hand for research (`android-trip-mode.md`); they are not aggregated
server-side and can't be, without building the ingestion pipeline we've
deliberately declined.

So, exactly like station-score, density is honestly an **estimate**, and the UI
must never dress it up as a live measurement. No "live" label, no pretending it's
sensed. A plain badge that reads as a typical-for-this-time hint, not a readout.

## The model — density as modulated station-score

Density is the existing `stations.score` (0–100) bent by *when* you're looking:

```
density(station, t) = score(station)                       # static baseline (0–100)
                     × dayTypeProfile[dayType(t)][bin(t)]   # WD/SAT/SUN × time-of-day curve
                     × headwayFactor(station, line, t)      # fewer trains ⇒ fuller platform
```

- `dayType(t)` and the service-hours windows come from `service-hours-day-types.md`
  (`WD` / `SAT` / `SUN`); `bin(t)` is a coarse slot (e.g. 30-min).
- The time-of-day curve is a **hand-authored profile**, not learned — a double-peak
  commuter shape (AM/PM rush) for weekdays, flatter for weekends. One shared curve
  to start; per-station overrides only where we have a published reason.
- `headwayFactor` reuses `getHeadway` (`CommuteService`) — when trains are sparse,
  waiting crowds build, so a longer gap nudges the level up. This is also what lets
  TJ haltes (frequency-only, no timetable) get a density at all.
- Output is bucketed to three levels by threshold (below), never shown as a number.

Everything on the right-hand side already exists in D1 or the API. No new data
source, no new permission, no backend telemetry.

## Levels & thresholds

| Level | Label (id) | Colour | Rough band |
|---|---|---|---|
| 1 | Lengang | green | low |
| 2 | Padat | amber | mid |
| 3 | Sangat Padat | red | high |

Thresholds are tuned against the 16 **measured** stations in `ridership.ts` so the
busiest-hour buckets land where a rider would expect, then applied uniformly.
Colours follow the existing status palette (green / amber / red), not line colours,
so the badge never collides with a `LineRoundel`.

## Where it renders

- **Station page** — one station-level badge for the current time, near the header
  or the frequency/timetable section (`StationSections.kt` / `FrequencyList.kt`).
- **Live board** (`PidsBoard.kt`) — per upcoming departure row, the predicted level
  at that train's time, matching how C-Access ties crowding to a specific train.
- Web: station page only, same baseline; the live board is android-only today.

## Open / deferred

1. **Where the curve lives.** Ship it as app/backend data first (like the authored
   `ridership.ts`). A dedicated density endpoint is only worth it once the shape
   stabilises; until then it's a pure client/edge computation off score + headway.
2. **Per-line vs. per-station.** C-Access reports it per-station. Per-line density
   on an interchange (Manggarai KC vs. local) is richer but needs per-line splits we
   don't model yet — keep it per-station for v1.
3. **If we ever ingest telemetry.** A real crowd signal would need the ingestion
   pipeline station-score calls out as absent. That's a privacy decision, not a
   feature decision — gate it there, not here.
4. **Don't over-promise.** Keep copy in the "typically" register. The failure mode
   to avoid is a rider trusting a green badge onto a packed platform; an estimate
   that's honestly labelled survives being wrong, a fake "live" one doesn't.
