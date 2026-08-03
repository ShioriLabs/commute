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
- Destination codes: `JTM` (Jatimulya), `HAR` (Harjamukti), `DKA` (Dukuh Atas BSI).

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
| All 26 `*_BK_*` files | https://www.instagram.com/lrt_jabodebek/p/DZ-eJKrDzME/ (weekday tables; carousel of 12 slides) | effective 15 Juni 2026 |
| All 22 `*_CB_*` files | https://www.instagram.com/lrt_jabodebek/p/DZ-eIyAj2MY/ (weekday tables; carousel of 12 slides) | effective 15 Juni 2026 |

## Transcription checklist

48 combos. Termini (JTM, HAR, DKA) only depart in one direction; DKA appears on
both lines.

### Lin Bekasi (BK) — arah Jatimulya (JTM)

- [x] DKA_BK_JTM
- [x] BEK_BK_JTM
- [x] CIL_BK_JTM
- [x] CK1_BK_JTM
- [x] CK2_BK_JTM
- [x] CKK_BK_JTM
- [x] CWG_BK_JTM
- [x] HAL_BK_JTM
- [x] JBU_BK_JTM
- [x] KUA_BK_JTM
- [x] PAN_BK_JTM
- [x] RAS_BK_JTM
- [x] SET_BK_JTM

### Lin Bekasi (BK) — arah Dukuh Atas BSI (DKA)

- [x] JTM_BK_DKA
- [x] BEK_BK_DKA
- [x] CIL_BK_DKA
- [x] CK1_BK_DKA
- [x] CK2_BK_DKA
- [x] CKK_BK_DKA
- [x] CWG_BK_DKA
- [x] HAL_BK_DKA
- [x] JBU_BK_DKA
- [x] KUA_BK_DKA
- [x] PAN_BK_DKA
- [x] RAS_BK_DKA
- [x] SET_BK_DKA

### Lin Cibubur (CB) — arah Harjamukti (HAR)

- [x] DKA_CB_HAR
- [x] CIL_CB_HAR
- [x] CKK_CB_HAR
- [x] CRC_CB_HAR
- [x] CWG_CB_HAR
- [x] KAM_CB_HAR
- [x] KUA_CB_HAR
- [x] PAN_CB_HAR
- [x] RAS_CB_HAR
- [x] SET_CB_HAR
- [x] TMI_CB_HAR

### Lin Cibubur (CB) — arah Dukuh Atas BSI (DKA)

- [x] HAR_CB_DKA
- [x] CIL_CB_DKA
- [x] CKK_CB_DKA
- [x] CRC_CB_DKA
- [x] CWG_CB_DKA
- [x] KAM_CB_DKA
- [x] KUA_CB_DKA
- [x] PAN_CB_DKA
- [x] RAS_CB_DKA
- [x] SET_CB_DKA
- [x] TMI_CB_DKA
