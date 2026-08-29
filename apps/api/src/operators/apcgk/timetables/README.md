# Kalayang Bandara timetable transcriptions

The Soekarno-Hatta airport people-mover has no public schedule API. These
timetables are transcribed from the artwork FDTJ prepared for InJourney Airports
(`skytrain/` at the repo root, four station posters footed `*Per 19 Feb 25`),
which the batch generator converts into the committed SQL under `src/db/scripts/`.

## File format

- Name: `<STATION>_<LINE>_<DEST>.csv`, e.g. `T1_KLB_T3.csv`
  (Terminal 1, Lin Kalayang Bandara, towards Terminal 3).
- Content: one departure per line, 24-hour `H:MM` or `HH:MM`, ascending. Blank
  lines are ignored.
- Line code: `KLB`.
- Destination codes: `T1` (Terminal 1), `T3` (Terminal 3) — the two termini.

The line runs `T1 — SHIA — T2 — T3`, so every service is bound for one terminus
or the other; intermediate stations each have two CSVs, one per direction.

## Workflow

1. Transcribe the poster into the matching CSV. Record the poster date below.
2. Generate SQL (overwrites `src/db/scripts/apcgk_*_timetable.sql`; the git diff
   is the transcription review):

   ```sh
   pnpm --filter api generate:apcgk-timetable
   ```

3. Apply (from `apps/api`; each file first deletes the rows it owns — station +
   line + direction — so re-applying is safe):

   ```sh
   wrangler d1 execute commute --local  --file=src/db/scripts/apcgk_<...>_timetable.sql
   wrangler d1 execute commute --remote --file=src/db/scripts/apcgk_<...>_timetable.sql
   ```

## Checking a transcription

The service runs a strict **13-minute headway**, 83 departures per table. That
makes the cadence a free proof-reader: compute the gaps between consecutive
departures and anything that isn't 13 is either a real poster quirk or a misread
digit. Every table was checked this way when first transcribed.

## Known poster errors — transcribed AS PRINTED

Two cells in the Stasiun KA Bandara poster break the cadence. Both were
re-examined against the artwork at magnification: the poster really does print
these values, so they are **not** transcription slips and must not be "fixed".

| File | Poster | Strict cadence |
|---|---|---|
| `SHIA_KLB_T1.csv` | `20:39` | 20:38 |
| `SHIA_KLB_T3.csv` | `20:45` | 20:46 |

The data matches the sign the rider is standing in front of. If FDTJ reissues
the posters with these corrected, update the CSVs and delete this section.

## Sources

| Batch | Source | Poster date |
|---|---|---|
| T1, Stasiun KA Bandara, T2, T3 | FDTJ artwork for InJourney Airports (`skytrain/`) | 19 Feb 25 |
