# Station score

`stations.score` (0–100) is how busy a station is. It orders search results, the fare picker's
idle list and quick-pick chips, and the hub list.

It is **measured** for the 15 stations operators publish figures for, and an **estimate** for
everything else. Those are different claims and the code keeps them apart on purpose.

## Why it exists in this form

We collect no usage telemetry — no analytics SDK, no ingestion endpoint, no Analytics Engine
binding. Recents and favourites never leave `localStorage`. So the score cannot come from our own
users, and the honest alternatives are published operator ridership and the network data already
in D1.

The column shipped in migration `0005` and was never populated: until this pass, 146 of 148 rail
stations were 0, with Manggarai at 100 and Sudirman at 10 set by hand. The fare picker's "most
popular" chips were therefore just the alphabetically-first stations.

## Layer 1 — measured (`db/data/ridership.ts`)

Operators publish top-N lists in press releases; there is no full per-station dataset anywhere
public. Each entry carries its period, the figure as printed, and a source URL, so it can be
re-checked and refreshed without redoing the arithmetic.

Two metrics, and **the second is the one that matters**:

| | |
|---|---|
| `gatePerDay` | taps at the gate, in + out |
| `transitPerDay` | riders changing trains, who never touch a gate |

Manggarai does not appear in KAI Commuter's busiest-by-gate top five, yet it is the most crowded
station on the network: 57.67 million transit passengers in 2024, 166,587 on an average weekday —
roughly five times its own gate traffic. Gate data alone demotes our largest interchange. A
station's demand is the sum of both.

**Pick one series per operator.** KAI Commuter publishes Bogor as both 8,888,669 (Sem I 2025) and
33,081,659 (Jan–Nov 2025). That is not growth, it is boardings versus gate in-out, a factor of ~2.
Everything in the table is gate in-out. KCI's 2024 annual report independently corroborates this:
it names Bogor at 1,566,584 departures per month over Jan–May 2025, which is 52,220/day — within
6% of the boardings series and half the in-out series.

The same report is why in-out is the right metric rather than departures: it lists Sudirman among
the busiest *destinations* but not the busiest *departures*. CBD stations absorb in the morning and
shed in the evening, so departures-only understates exactly the office-district stations riders
search for most.

MRT Jakarta does not state which metric it publishes. Its entries are flagged and may be
understated by up to 2x — about one 19-point step on the log scale.

## Layer 2 — estimated (`db/scripts/generateStationScoresSQL.ts`)

### One unit

```
service(station) = Σ over lines L at station:  tripsPerDay(L) × capacity(L)
```

`tripsPerDay(L)` is the **MAX over stations** of that line's departure count, not the station's
own. A terminus is served in one direction only, so a station-local reading halves it and ranks
every terminus last on its line. `lineCode = 'NUL'` is excluded (509 orphan rows).

`capacity` converts trains into a common unit — five facts about rolling stock rather than 150
opinions about stations, and the honest reason a 12-car KRL line outranks a 2-car one:

| operator | capacity | stock |
|---|---|---|
| KCI | 2000 | 12-car KRL, crush load |
| MRTJ | 1200 | 6-car Nippon Sharyo |
| LRTJBDB | 740 | 6-car |
| LRTJ | 270 | 2-car |

Measured per-line peaks: `B 348, C 320, M 284, CB 216, BK 214, S 204, R 192, T 120, TP 64, A 64`.

### The formula

```
serviceTerm   = clamp01( (ln(1+service) − ln(1+40_000)) / (ln(1+1_500_000) − ln(1+40_000)) )
structureTerm = clamp01( 0.35·min(1,(lineCount−1)/2)
                       + 0.30·min(1, interchangePartners/3)
                       + 0.25·(hubMember ? 1 : 0)
                       + 0.10·(terminus ? 1 : 0) )

estimate = 0.60 × serviceTerm + 0.30 × structureTerm
measured = clamp01( (ln(1+demand) − ln(1+500)) / (ln(1+250_000) − ln(1+500)) )

score = round(100 × clamp01(anchored ? measured : estimate))
```

- **Log, not linear.** Service spans ~5·10⁴ to ~1.5·10⁶; a linear map flattens everything below the
  top interchanges into the bottom third. Log gives a fixed step per doubling.
- **Fixed anchors, not observed min/max.** With min-max, every station's score depends on the
  extremes, so adding one quiet halte re-scores the network and the emitted diff becomes
  unreadable. `generatePruneStationLinesSQL.ts` fixes its own constants for the same reason.
- **`DEMAND_CEIL` = 250,000** sits just above Tanah Abang (244,126 = 89,126 gate + 155,000 transit),
  the largest measured figure on the network.
- **INTERNAL transfers only.** `EXTERNAL` rows point at operators we do not model (KCIC).
- **Structure is capped at 0.30** so it can discriminate within a line without ever lifting a branch
  halte above a trunk station. Terminus is weighted least: it makes a station notable without
  making it busy, and the LRT Jabodebek anchors show termini running from busiest to quietest.
- **Estimates top out at 90** (`ESTIMATE_MAX`), below the measured interchanges. Deliberate
  asymmetry — we should not claim a station is busy on structural grounds alone.
- **The outer clamp** is what makes the tier invariant in `apps/web/utils/fuzzy-match.ts` true by
  construction rather than by convention. `STATION_SCORE_MAX` lives in `@commute/constants` so the
  generator and both clients agree on the bound.

### What the estimate cannot do

**Service is measured per line, not per station.** On MRTJ, LRTJ and LRTJBDB every train stops
everywhere, so every through station on a line shares one departure count. MRT's five anchors all
sit at 340,800 seat-passes yet range from 11,099 to 24,096 riders a day. Nothing in the database
distinguishes Cilebut from Bogor except that Bogor is a terminus.

So the estimate places a station in the right *band* and structure orders it within that band. It
does not claim to know within-line variation. This is why the eight unanchored MRT stations all
score 35 and tie-break alphabetically — that is the honest output, not a bug.

**Anchors always win; they are never blended.** The estimate is wrong in ways the anchors exist to
correct: LRT Jabodebek's Dukuh Atas is the operator's busiest station (7,548,845 gate in-out) and
its *last* by departure count, because it is a terminus.

## Coverage

Rail only — KCI, MRTJ, LRTJ, LRTJBDB. TransJakarta has no timetables (headway-based GTFS) and no
published per-halte ridership, so TJ stays at the `DEFAULT 0` and is not emitted.

The nine Commuter Line Merak stations (Merak, Cilegon, Krenceng, …) are region CGK and searchable
but carry no `stationLines` rows, so they fall back to their own departure count — 7–14 a day.
They land at 0, now because that is what the timetable says rather than for want of a join.

`hubs.score` is the max over member stations. `HubRepository.getAll` orders by it, and the search
sheet already nudges non-station results down, so max keeps "Dukuh Atas" the hub just under its
busiest member station.

## Known artifacts

- **Jakarta Kota estimates to 79**, above measured Citayam and Bekasi. It is a 3-line terminus with
  transfers, so structurally it earns it; whether it is genuinely busier than Bekasi is unmeasured.
- **The eight plain MRT stations tie at 35.** See "what the estimate cannot do".
- **Karet scores 46** on three lines. An earlier service-only draft put it at 88 — a minor halt
  outranking Sudirman — which is what the 0.60 service weight and the structure cap now prevent.

## Runbook

```bash
# 1. regenerate (must be --remote; the local D1 is stale)
pnpm --filter api generate:station-scores -- --remote

# 2. review the diff and the printed summary
git diff apps/api/src/db/scripts/station_scores.sql
grep -cE "score = (1[0-9][0-9]|[2-9][0-9][0-9])" apps/api/src/db/scripts/station_scores.sql  # 0

# 3. apply — AFTER any TJ reseed, see below
wrangler d1 execute commute --local  --file=src/db/scripts/station_scores.sql
wrangler d1 execute commute --remote --file=src/db/scripts/station_scores.sql

# 4. bump API_VERSION in apps/api/wrangler.toml, then deploy
```

**Ordering constraint.** `db/scripts/tj_stations_insert.sql` is an `INSERT OR REPLACE INTO stations`
with no `score` column, so re-running `generate:tj` and applying it resets every TJ score to 0.
Rail is safe — `StationRepository.insertMany` upserts an explicit column list that excludes
`score`. Apply the score seed *after* any TJ reseed.

**Cache.** Score flows into five KV families: `searchables:{V}`, `stations:{V}`,
`stations:{OP}:{V}`, `hubs:{V}`, `hubs:{slug}:{V}`. `routes/cache.ts` is deliberately not mounted
(`app.ts` — the bust routes were unauthenticated mutating endpoints), so `DELETE
/_internal/searchables/bust` is unreachable. Bumping `API_VERSION` busts all five in one edit and
is what the repo already does.

**Refresh cadence.** Half-yearly for KCI, monthly for MRT Jakarta. Stale anchors still beat none:
they move slowly, and this feeds a ranking rather than a readout.
