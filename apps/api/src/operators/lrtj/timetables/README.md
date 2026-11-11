# LRT Jakarta Lin Selatan timetable

## Source (since 2026-11-11): the website API

`pnpm --filter @commute/api fetch:lrtj-timetable` queries the lrtjakarta.co.id
schedule API and rewrites `S_MGI.csv` / `S_PGD.csv`;
`pnpm --filter @commute/api generate:lrtj-timetable` turns them into
`src/db/scripts/lrtj_S_timetable.sql`, which replaces every LRTJ schedule row.
Review the CSV and SQL diffs, then apply with `wrangler d1 execute`.

The query is `POST https://www.lrtjakarta.co.id/api/schedules/get` with
`{"src_station_id", "dst_station_id"}` (no cookies; the old
`staging2...:8004` host is gone; a default Python user agent gets a 403, curl
and Node fetch do not). Kelapa Gading -> Manggarai (and back) returns every
train's full run as `stop_detail`, with `start_at` (departure) and `arrival_at`
per stop. `fetchTimetable.ts` writes departures, so Velodrome's 1 min dwell shows.

- **No train numbers.** Each trip gets a synthetic KA: 2000 + 2n (+1 for Kelapa
  Gading-bound), n = order in the day. Stable only within one fetch, so
  `tripNumber` changes on every refetch (fine: the SQL deletes all LRTJ rows).
  Synthetic BY DECISION until a legible photo of the 11 Nov 2026 poster turns up.
  That poster prints real KAs (1002, 1004, 1006... at 05:30, 05:42, 05:54...
  southbound; the last southbound row reads like 1164), which fit 1002 + 2n
  southbound and presumably 1003 + 2n northbound. Verify against the poster's
  rows, then swap `SYNTHETIC_KA_BASE` in `fetchTimetable.ts` for the real scheme.
- **Checked against a station board (2026-11-11):** the Pramuka timetable at the
  station matches our Pramuka rows minute for minute, both directions, including
  the 15 min evening stretch and the last trains (22:19 to Manggarai, 21:46...
  22:46 to Kelapa Gading). Intermediate stations are unchecked.
- **Pramuka calls** (opened 2026-11-11). **Matraman (KYM) and Proklamasi (MAT)
  do not**, though the API lists them: the entrance stairs are unfinished.
  `fetchTimetable.ts` writes `Ls` for them (`NOT_CALLING`); drop them from it,
  and `passThrough` in `db/data/topology.ts`, when each opens.
- Snapshot 2026-11-11: every train is a full 27 min run, 05:30-22:00 from Kelapa
  Gading (arrives Manggarai 22:27) and 05:32-22:38 from Manggarai (arrives 23:05),
  every 12 min until about 20:30, then every 15. No evening shuttle.
- Applying Pramuka's opening: `edges.sql` (regenerated), `lrtj_pramuka_open.sql`,
  `lrtj_S_timetable.sql`, then deploy with an API_VERSION bump.

# The 17 Sep 2026 poster (superseded, kept for history)

Transcribed from the printed poster "Jadwal Perjalanan LRT Jakarta, Lin Selatan
(Southern Line), Berlaku Mulai 17 September 2026". The CSVs in git history
before 2026-11-11 are that transcription.

## File format

- `S_MGI.csv`: Kelapa Gading - Velodrome - Manggarai (even KAs).
- `S_PGD.csv`: Manggarai - Velodrome - Kelapa Gading (odd KAs).
- One row per poster row, in poster order: `ka,loop,<one column per station>`,
  stations in travel order. The generator checks the header against the topology.
- Cells: `H:MM`, `Ls` (the poster's "Ls.", run through without calling), or `-`
  (not on this working).

## Station codes

The poster's initials are not ours. Headers use OUR codes:

| Pos | Poster | Ours | Name |
| --- | --- | --- | --- |
| S-01 | KPG | PGD | Kelapa Gading |
| S-06 | VLD | VEL | Velodrome |
| S-08 | PRM | PKA | Pramuka |
| S-09 | MAT | KYM | Matraman |
| S-10 | PKM | MAT | Proklamasi |

The rest (BVU, BVS, PUM, EQS, RWM, MGI) match.

## What the poster says

- S-08 to S-10 are "melintas langsung": no train calls there. They are
  `passThrough` in `db/data/topology.ts` and unsearchable in D1.
- 05:30 to 19:40, Kelapa Gading to Manggarai every 15 min (KA 1002-1110 and
  1003-1111).
- From 19:15, only a Kelapa Gading to Velodrome shuttle runs, every 10 min after
  19:50 (KA 1112-1146 and 1113-1147). Its Manggarai-bound rows stop at
  Equestrian and leave the Velodrome turnback arrival blank, so the generator
  reads the first blank after the last time as the terminus.
- The shuttle's Kelapa Gading-bound run is 2 min BVS-BVU and 5 min BVU-KPG, against
  3 and 4 by day. It's consistent on every row, so it's real and not a misread.
- No weekday/weekend distinction, so every row runs every day.
- No poster errors found (`POSTER_ERRATA` is empty).

## Workflow

1. Edit the CSVs.
2. Run the generator. It refuses on any off-pattern run time, wrong KA parity,
   `Ls` outside the pass-through stations, or a gap inside a working.
3. Review the SQL diff, then apply it with `wrangler d1 execute`.

## Station ids (for the API)

| id | Ours | id | Ours |
| --- | --- | --- | --- |
| `O6PpoaxXR8` | PGD | `lZQpDA9kyK` | PKA |
| `63zpjAqWLe` | BVU | `zXl98Mx2Mk` | KYM |
| `Kre96Z9B5D` | BVS | `Jj59kaqwnO` | MAT |
| `oJQxvy93rY` | PUM | `DBN9nAp5nJ` | MGI |
| `KAVp3P97ry` | EQS | `LPDxKkxBor` | RWM |
| `RnAx41q5G1` | VEL | | |
