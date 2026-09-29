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
