# LRT Jabodebek timetable transcriptions

LRT Jabodebek has no public schedule API; timetables are transcribed by hand
from the official schedule posters on Instagram ([@lrt_jabodebek](https://www.instagram.com/lrt_jabodebek/)).
This directory holds the transcriptions as CSVs — one file per
station × line × direction — which the batch generator converts into the
committed SQL under `src/db/scripts/`.

## File format

- Name: `<STATION>_<LINE>_<DEST>_<DAY>.csv`, e.g. `SET_BK_JTM_WD.csv`
  (Setiabudi, Lin Bekasi, towards Jatimulya, weekday board).
- Content: one departure per line, 24-hour `H:MM` or `HH:MM`, in poster order
  (ascending). Blank lines are ignored.
- Line codes: `BK` (Lin Bekasi), `CB` (Lin Cibubur).
- Day codes: `WD` (Senin-Jumat), `WE` (Sabtu-Minggu). LRT Jabodebek publishes one
  weekend board rather than separate Saturday and Sunday ones.

  The day is **required**. A weekend file that lost its suffix would load as
  weekday data and its `DELETE` would wipe the real weekday board, so the
  generator refuses to parse a filename without one rather than guessing.
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
   station + line + direction + day — so re-applying over an already-loaded
   station is safe, and loading one day never disturbs the other):

   ```sh
   wrangler d1 execute commute --local --file=src/db/scripts/lrtjbdb_<...>_<DAY>_timetable.sql
   wrangler d1 execute commute --remote --file=src/db/scripts/lrtjbdb_<...>_<DAY>_timetable.sql
   ```

## Sources

| Batch | IG post | Poster date |
| ----- | ------- | ----------- |
| All 26 `*_BK_*_WD` files | https://www.instagram.com/lrt_jabodebek/p/DZ-eJKrDzME/ (weekday tables; carousel of 12 slides) | effective 15 Juni 2026 |
| All 22 `*_CB_*_WD` files | https://www.instagram.com/lrt_jabodebek/p/DZ-eIyAj2MY/ (weekday tables; carousel of 12 slides) | effective 15 Juni 2026 |
| All 26 `*_BK_*_WE` files | @lrt_jabodebek weekend carousel, transcribed from screenshots 2026-09-06 | same edition as the weekday board |
| All 22 `*_CB_*_WE` files | @lrt_jabodebek weekend carousel, transcribed from screenshots 2026-09-06 | same edition as the weekday board |

The weekend board was transcribed from the operator's weekend carousel on
2026-09-06. Its edition was checked against the weekday board before loading:
the weekday poster's Jati Mulya column still reads 05:12 / 05:20 / 05:29 /
05:37, matching the committed `JTM_BK_DKA_WD.csv` exactly, so both day types
describe the same service period. **Re-check that pairing whenever either board
is re-transcribed** — two editions side by side in `schedules` would be
invisible in the data and wrong on the platform.

## Transcription checklist

48 combos **per day type**, so 96 in total. Both are complete as of
2026-09-06 — the generator prints the per-day counts on every run
(`WD: 48, WE: 48`), which is the check to trust rather than the boxes below.

The list is per combo, not per day: a ticked box means both `_WD.csv` and
`_WE.csv` exist for it. Termini (JTM, HAR, DKA) only depart in one direction;
DKA appears on both lines.

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
