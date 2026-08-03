# LRT Jabodebek timetable transcriptions

LRT Jabodebek has no public schedule API; timetables are transcribed by hand
from the official schedule posters on Instagram ([@lrt_jabodebek](https://www.instagram.com/lrt_jabodebek/)).
This directory holds the transcriptions as CSVs — one file per
station × line × direction — which the batch generator converts into the
committed SQL under `src/db/scripts/`.

## File format

- Name: `<STATION>_<LINE>_<DEST>.csv`, e.g. `SET_BK_JTM.csv`
  (Setiabudi, Lin Bekasi, towards Jatimulya).
- Content: one departure per line, 24-hour `H:MM` or `HH:MM`, in poster order
  (ascending). Blank lines are ignored.
- Line codes: `BK` (Lin Bekasi), `CB` (Lin Cibubur).
- Destination codes: `JTM` (Jatimulya), `HAR` (Harjamukti), `DKA` (Dukuh Atas BNI).

## Workflow

1. Transcribe a poster into the matching CSV here. Record the source post URL
   and poster date in the table below.
2. Generate SQL (overwrites `src/db/scripts/lrtjbdb_*_timetable.sql`; the git
   diff is the transcription review):

   ```sh
   pnpm generate:lrtjbdbtimetable
   ```

3. Apply (from `apps/api`; each file first deletes the rows it owns —
   station + line + direction — so re-applying over an already-loaded station
   is safe):

   ```sh
   wrangler d1 execute commute --local --file=src/db/scripts/lrtjbdb_<...>_timetable.sql
   wrangler d1 execute commute --remote --file=src/db/scripts/lrtjbdb_<...>_timetable.sql
   ```

## Sources

| Batch | IG post | Poster date |
| ----- | ------- | ----------- |
| (seed) `SET_BK_JTM.csv` | reconstructed from previously committed SQL, not a poster | — |

## Transcription checklist

48 combos. Termini (JTM, HAR, DKA) only depart in one direction; DKA appears on
both lines.

### Lin Bekasi (BK) — arah Jatimulya (JTM)

- [ ] DKA_BK_JTM
- [ ] BEK_BK_JTM
- [ ] CIL_BK_JTM
- [ ] CK1_BK_JTM
- [ ] CK2_BK_JTM
- [ ] CKK_BK_JTM
- [ ] CWG_BK_JTM
- [ ] HAL_BK_JTM
- [ ] JBU_BK_JTM
- [ ] KUA_BK_JTM
- [ ] PAN_BK_JTM
- [ ] RAS_BK_JTM
- [ ] SET_BK_JTM

### Lin Bekasi (BK) — arah Dukuh Atas BNI (DKA)

- [ ] JTM_BK_DKA
- [ ] BEK_BK_DKA
- [ ] CIL_BK_DKA
- [ ] CK1_BK_DKA
- [ ] CK2_BK_DKA
- [ ] CKK_BK_DKA
- [ ] CWG_BK_DKA
- [ ] HAL_BK_DKA
- [ ] JBU_BK_DKA
- [ ] KUA_BK_DKA
- [ ] PAN_BK_DKA
- [ ] RAS_BK_DKA
- [ ] SET_BK_DKA

### Lin Cibubur (CB) — arah Harjamukti (HAR)

- [ ] DKA_CB_HAR
- [ ] CIL_CB_HAR
- [ ] CKK_CB_HAR
- [ ] CRC_CB_HAR
- [ ] CWG_CB_HAR
- [ ] KAM_CB_HAR
- [ ] KUA_CB_HAR
- [ ] PAN_CB_HAR
- [ ] RAS_CB_HAR
- [ ] SET_CB_HAR
- [ ] TMI_CB_HAR

### Lin Cibubur (CB) — arah Dukuh Atas BNI (DKA)

- [ ] HAR_CB_DKA
- [ ] CIL_CB_DKA
- [ ] CKK_CB_DKA
- [ ] CRC_CB_DKA
- [ ] CWG_CB_DKA
- [ ] KAM_CB_DKA
- [ ] KUA_CB_DKA
- [ ] PAN_CB_DKA
- [ ] RAS_CB_DKA
- [ ] SET_CB_DKA
- [ ] TMI_CB_DKA
