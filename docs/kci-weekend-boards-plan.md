# KCI Weekend Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store KCI's weekday and weekend boards separately (`dayMask` 4 and 3, not one board at 7), so every consumer (planner, departure boards, headways, density) sees the trains that actually run at weekends.

**Architecture:** The KCI dump generator gains a `--day WD|WE` flag. A weekday dump writes the existing row ids at mask `0b100`. A weekend dump writes ids suffixed `-WE` at mask `0b011`, the same "day in the id" convention LRT Jabodebek's generator uses (`LRTJBDB-BEK-BK-WE-1-DKA`). Each block deletes only its own mask (plus the legacy `7` on a weekday run), so applying one dump never wipes the other.

**Tech Stack:** TypeScript, vitest, wrangler D1, the existing browser-dump workflow (memory: `kci-browser-dump.md`).

**Spec:** `docs/station-density.md` → "Verified along the way" (KCI runs 1,065 weekday / 1,030 Sunday trips; every KCI row in D1 is `dayMask = 7`). Background: `apps/api/src/operators/kci/generateTimetableFromDumpSQL.ts` header.

## Global Constraints

- **No bot evasion.** Dumps are taken by the user in a real browser, at a person's pace, exactly as the generator header describes. Never script kci.id from here.
- **Line A (Basoetta) is untouched.** It comes from `generateBasoettaTimetableSQL` at mask 7, and every DELETE keeps `AND lineCode <> 'A'`. Its 70 weekday / 64 weekend split is out of scope.
- **Apply per station block with `--yes`;** the whole file fails as one statement (memory: `kci-browser-dump.md`). Remote applies are run by the user.
- **Never commit** unless asked in the moment. **Never `wrangler deploy`.** Shipping needs an `API_VERSION` bump (KV).

## Review Focus

1. **A weekend dump applied before any weekday one.** The legacy mask-7 rows must stay until a weekday dump replaces them. Otherwise weekdays lose every KCI departure. Pinned in Task 2 (`a weekend run leaves mask 7 alone`).
2. **The same train on both boards** gives two rows with distinct ids (`…-WE`), never a primary-key collision. Pinned in Task 2.
3. **A dump taken on the wrong day.** If kci.id serves today's board, a Saturday dump labelled `WD` would write weekend trains as weekday ones. The generator should warn when `fetchedAt`'s weekday contradicts `--day`. Pinned in Task 2.
4. **Holidays.** A dump taken on a public holiday is a holiday board, not a weekday one. The same warning catches this through `HOLIDAYS`.
5. **Downstream consumers:** `generate:trips`, `generate:headways`, `generate:service-hours`, `generate:density` must all be re-run. MRTJ and LRT Jabodebek already have split masks, so each consumer already handles them. Re-running is part of Task 3.

---

### Task 1: Confirm kci.id serves a weekend board (manual, user)

The schedules API takes no date parameter, so whether it answers with the board for *the day it's asked* has to be checked before any code changes.

- [ ] **Step 1:** On a Saturday or Sunday, the user takes a dump with the console snippet from the generator header, saved as `kci-dump-YYYY-MM-DD.json`.
- [ ] **Step 2:** Count trips in both dumps:

```bash
python3 - <<'EOF'
import json, sys
for f in sys.argv[1:]:
    d = json.load(open(f))
    trains = {r['train_id'] for b in d['schedules'].values() for r in (b.get('data') or [])}
    print(f, d['fetchedAt'], len(trains), 'distinct train_id')
EOF
/mnt/c/Users/deka_/Downloads/kci-dump-2026-10-06.json /mnt/c/Users/deka_/Downloads/kci-dump-<weekend-date>.json
```

Expected: the weekend dump has fewer distinct trains than the weekday one, in the ratio KCI publishes (1,030 vs 1,065, plus the Basoetta difference, which isn't in the dump). **If the counts are equal, stop:** kci.id serves one board regardless of the day, and this plan is moot. Record that finding in `docs/station-density.md` "Verified along the way" instead.

- [ ] **Step 3: Checkpoint.** Report both counts to the user.

---

### Task 2: Day-aware generator

**Files:**
- Modify: `apps/api/src/operators/kci/generateTimetableFromDumpSQL.ts` (`buildTimetableSQL` ~line 124, `main` ~line 166)
- Test: `apps/api/src/operators/kci/generateTimetableFromDumpSQL.test.ts` (extend the `describe('buildTimetableSQL')` block ~line 91)

**Interfaces:**
- Consumes: `DumpBoard` (`{ stationCode, rows: NewSchedule[] }`) as the file already defines it; `DAY_MASK` from `db/schemas/schedules` (`{ WD: 0b100, SAT: 0b010, SUN: 0b001 }`); `HOLIDAYS` from `@commute/constants`.
- Produces: `export type DumpDay = 'WD' | 'WE'`; `buildTimetableSQL(boards: DumpBoard[], fetchedAt: string, day: DumpDay): string`; `dayMismatch(fetchedAt: string, day: DumpDay): string | null`.

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe('buildTimetableSQL', …)`, reusing whatever board fixture that block already builds; call it `boards` here)

```ts
  it('writes a weekday dump at mask 4 and clears the legacy mask 7 with it', () => {
    const sql = buildTimetableSQL(boards, '2026-10-06T08:00:00Z', 'WD')
    expect(sql).toContain('dayMask IN (7, 4) AND lineCode <> \'A\'')
    expect(sql).toMatch(/, 4, CURRENT_TIMESTAMP/)
    expect(sql).not.toMatch(/-WE'/)
  })

  it('writes a weekend dump at mask 3 with -WE ids, and leaves mask 7 alone', () => {
    const sql = buildTimetableSQL(boards, '2026-10-10T08:00:00Z', 'WE')
    expect(sql).toContain('dayMask = 3 AND lineCode <> \'A\'')
    expect(sql).not.toContain('IN (7')
    expect(sql).toMatch(/-WE', /)
    expect(sql).toMatch(/, 3, CURRENT_TIMESTAMP/)
  })
```

And a new block:

```ts
describe('dayMismatch', () => {
  it('flags a weekday label on a Saturday dump and the reverse', () => {
    expect(dayMismatch('2026-10-10T01:00:00Z', 'WD')).toMatch(/Saturday/) // 08:00 WIB Sat
    expect(dayMismatch('2026-10-06T01:00:00Z', 'WE')).toMatch(/weekday/)
  })

  it('flags a holiday labelled WD', () => {
    expect(dayMismatch('2026-03-20T01:00:00Z', 'WD')).toMatch(/holiday/) // Lebaran 2026
  })

  it('accepts a matching day', () => {
    expect(dayMismatch('2026-10-06T01:00:00Z', 'WD')).toBeNull()
    expect(dayMismatch('2026-10-11T01:00:00Z', 'WE')).toBeNull()
  })
})
```

Update every existing `buildTimetableSQL(boards, fetchedAt)` call in the test file to pass `'WD'`. If 2026-03-20 isn't in `HOLIDAYS`, pick any date that is (`grep -n 2026 packages/constants` or wherever `HOLIDAYS` is defined) and say so in the test comment.

- [ ] **Step 2: Run and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/operators/kci/generateTimetableFromDumpSQL.test.ts`
Expected: FAIL (`dayMismatch` not exported, and mask/DELETE assertions fail).

- [ ] **Step 3: Implement**

In `generateTimetableFromDumpSQL.ts`:

```ts
import { HOLIDAYS } from '@commute/constants'
import { DAY_MASK, type NewSchedule } from 'db/schemas/schedules'

/*
 * Which board a dump holds. kci.id answers with the board for the day it is
 * asked (verified in docs/kci-weekend-boards-plan.md Task 1), so the day is a
 * fact about WHEN the dump was taken, passed explicitly and checked against
 * fetchedAt rather than inferred, so a wrong label is loud instead of silent.
 */
export type DumpDay = 'WD' | 'WE'

const DUMP_MASK: Record<DumpDay, number> = { WD: DAY_MASK.WD, WE: DAY_MASK.SAT | DAY_MASK.SUN }

/** Why `day` contradicts when the dump was taken (WIB), or null when it fits. */
export function dayMismatch(fetchedAt: string, day: DumpDay): string | null {
  const wib = new Date(new Date(fetchedAt).getTime() + 7 * 3600_000)
  const iso = wib.toISOString().slice(0, 10)
  const weekday = wib.getUTCDay()
  const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday]
  if (day === 'WD' && HOLIDAYS.has(iso)) return `${iso} is a public holiday: its board is a holiday one, not WD`
  if (day === 'WD' && (weekday === 0 || weekday === 6)) return `${iso} is a ${name}: a WD dump must be taken Monday-Friday`
  if (day === 'WE' && weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(iso)) return `${iso} is a weekday: a WE dump must be taken on a Saturday or Sunday`
  return null
}
```

In `buildTimetableSQL`, add the `day: DumpDay` parameter and change the row literal and the DELETE:

```ts
    const mask = DUMP_MASK[day]
    const idOf = (id: string) => day === 'WE' ? `${id}-WE` : id
    const values = rows.map(row =>
      `  (${literal(idOf(String(row.id)))}, ${literal(row.stationId)}, ${literal(row.tripNumber)}, ${literal(row.estimatedDeparture)},`
      + ` ${literal(row.estimatedArrival)}, ${literal(row.boundFor)}, ${literal(row.lineCode)}, ${mask}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
```

```ts
      /*
       * A weekday run also clears the legacy every-day rows (mask 7) it replaces.
       * A weekend run touches only mask 3, so applying it first, or alone, never
       * strips the weekday board. Line A is spared either way (see below).
       */
      + (day === 'WD'
        ? `DELETE FROM schedules WHERE stationId = '${esc(stationId)}' AND dayMask IN (7, 4) AND lineCode <> 'A';\n`
        : `DELETE FROM schedules WHERE stationId = '${esc(stationId)}' AND dayMask = 3 AND lineCode <> 'A';\n`)
```

In `main`, read the flag and warn:

```ts
  const day = (process.argv.find(a => a.startsWith('--day='))?.slice(6) ?? 'WD') as DumpDay
  if (day !== 'WD' && day !== 'WE') throw new Error(`--day must be WD or WE, got ${day}`)
  const mismatch = dayMismatch(dump.fetchedAt, day)
  if (mismatch && !process.argv.includes('--force')) {
    console.error(`Refusing: ${mismatch}. Pass --force if this is deliberate.`)
    process.exit(1)
  }
```

Pass `day` to `buildTimetableSQL`. Write weekend output to `kci_timetable_we.sql`, next to `kci_timetable.sql`, so the two never overwrite each other. Update the usage line in the header comment:

```
 *   pnpm --filter api generate:kci-timetable <dump.json> --day=WD   # Monday-Friday dump
 *   pnpm --filter api generate:kci-timetable <dump.json> --day=WE   # Saturday/Sunday dump
```

- [ ] **Step 4: Run and verify they pass**

Run: `pnpm --filter @commute/api exec vitest run src/operators/kci/generateTimetableFromDumpSQL.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint.** Do not commit.

---

### Task 3: Apply locally and regenerate everything downstream

- [ ] **Step 1:** Generate both files from the user's dumps:

```bash
pnpm --filter @commute/api generate:kci-timetable /mnt/c/Users/deka_/Downloads/kci-dump-2026-10-06.json --day=WD
pnpm --filter @commute/api generate:kci-timetable /mnt/c/Users/deka_/Downloads/kci-dump-<weekend>.json --day=WE
```

- [ ] **Step 2:** Apply both to **local** D1, station block by station block, as memory `kci-browser-dump.md` describes. Then verify:

```bash
DB=$(ls apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v metadata)
sqlite3 $DB "SELECT dayMask, COUNT(*), COUNT(DISTINCT tripNumber) FROM schedules WHERE stationId LIKE 'KCI-%' AND lineCode NOT IN ('A','NUL') GROUP BY dayMask"
```

Expected: rows at masks 4 and 3, **none at 7** except line A (excluded from this query). Weekend distinct trips < weekday.

- [ ] **Step 3:** Regenerate consumers and run the full suite:

```bash
pnpm --filter @commute/api generate:trips
pnpm --filter @commute/api generate:headways
pnpm --filter @commute/api generate:service-hours
pnpm --filter @commute/api test
```

Expected: all tests pass. If `auditRouter --baseline` exists in the workflow (memory: `mcraptor-groundwork.md`), run it, and expect weekday routes unchanged.

- [ ] **Step 4:** In the web app, open `/stations/KCI/MRI` with `?day=SUN` (or on a Sunday) and confirm the board shows weekend trains.

- [ ] **Step 5: Checkpoint.** Report counts and the remote apply order: WD file first, then WE, both per station block, then regenerated data files, then an `API_VERSION` bump. The user runs the remote steps. Do not commit.
