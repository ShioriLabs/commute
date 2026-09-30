# LRT Jakarta Lin Selatan timetable transcription

Transcribed from the printed poster "Jadwal Perjalanan LRT Jakarta, Lin Selatan
(Southern Line), Berlaku Mulai 17 September 2026", photographed at a station.
`pnpm --filter @commute/api generate:lrtj-timetable` turns it into
`src/db/scripts/lrtj_S_timetable.sql`, which replaces every LRTJ schedule row
(the scraped per-station board from `../sync.ts` included).

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

## The website API (not used, on purpose)

The lrtjakarta.co.id `/schedule` page queries
`POST https://staging2.lrtjakarta.co.id:8004/api/schedules/get` with
`{"src_station_id": "<id>", "dst_station_id": "<id>"}`. No cookies needed. It
returns departure times from src towards dst, plus `price` and `stop_station`
(the number of stations between them, NOT stops made). The page's `__NEXT_DATA__`
maps the opaque ids:

| id | Station | Ours |
| --- | --- | --- |
| `O6PpoaxXR8` | Kelapa Gading | PGD |
| `63zpjAqWLe` | Boulevard Utara Summarecon Mall | BVU |
| `Kre96Z9B5D` | Boulevard Selatan | BVS |
| `oJQxvy93rY` | Pulomas | PUM |
| `KAVp3P97ry` | Equestrian | EQS |
| `RnAx41q5G1` | Velodrome | VEL |
| `LPDxKkxBor` | Rawamangun | RWM |
| `lZQpDA9kyK` | Pramuka | PKA |
| `zXl98Mx2Mk` | Matraman | KYM |
| `Jj59kaqwnO` | Proklamasi | MAT |
| `DBN9nAp5nJ` | Manggarai | MGI |

Checked 2026-09-30, it does NOT match this poster. The daytime 15-min core is
identical, but the API serves S08-S10 (Pramuka +3 min after Rawamangun), runs
Manggarai later (05:40-20:10 vs 06:10-19:40), and its evening shuttle has
near-duplicate departures (20:05 and 20:09). Word on the street is trains still
skip S08-S10, so the API is presumably a future timetable or test data.
Revisit it as the source once those stations open.
