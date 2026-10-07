# Station Density: Calendar Day Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the density badge right on the days the plain WD/SAT/SUN buckets get wrong: Fridays (WFH), public holidays and cuti bersama (late-running, role-dependent), Ramadan weekdays (earlier mornings, two-part evenings), and Car Free Day Sunday mornings on Sudirman–Thamrin.

**Architecture:** The density generator emits three more **variants** beside `WD/SAT/SUN`: `FRI`, `HOL`, `RAM`. Each variant borrows a base timetable (FRI and RAM use WD departures, HOL uses SUN's) and applies its own curve and level rules in the pure model. Car Free Day is a per-station SUN adjustment inside the model. A new server util `densityVariant(date)` picks the variant from a service date using `HOLIDAYS`, a new `CUTI_BERSAMA` set and `RAMADAN_RANGES` in `@commute/constants`. The endpoint accepts `?date=YYYY-MM-DD` (the web sends the service date), and `?day=` keeps working.

**Tech Stack:** As Phase 1 (TypeScript, Hono + valibot, vitest, React Router + SWR).

**Spec:** `docs/station-density.md` → "Day types", "Ramadan (separate day type, deferred)", "Crowdsourced checks" (Car Free Day). **Requires Phase 1** (`docs/station-density-plan.md`) to be implemented first: this plan modifies its files.

## Global Constraints

- Everything in Phase 1's Global Constraints applies (rail only, "biasanya" copy, no em dashes or trailing periods in UI copy, Indonesian API prose, no crowdsourced data as input, never commit unless asked, never `wrangler deploy`).
- **Ramadan figures never touch the WD/SAT/SUN calibration** (spec rule). They only feed the `RAM` variant.
- **Calendar lists are hand-maintained, like `HOLIDAYS`,** and need a yearly update. A missing date degrades to the ordinary day bucket, which is exactly Phase 1 behaviour.
- **Car Free Day constants are uncalibrated** (crowdsourced checks show a bump but give no size). Name them as such in their comment.
- Schema changes keep `v.title` + `v.metadata({ ref })` so generated clients get named types.

## Review Focus

1. **A date that is both Ramadan and a weekend.** Saturday in Ramadan stays `SAT` (no Ramadan weekend data). Pinned in Task 1.
2. **A public holiday inside Ramadan** (e.g. Nyepi, 19 Mar 2026) resolves to `HOL`, not `RAM`: holidays win. Pinned in Task 1.
3. **Service date vs clock date:** at 00:30 on a Saturday after a Friday holiday, the web asks for Friday's date, so `HOL`. Pinned in Task 4.
4. **An old client sending only `?day=SUN`** still gets `SUN` (no variant): back-compatible. Pinned in Task 3.
5. **A station with a WD board but no SUN board** asked for `HOL`: all-null hours, not WD levels. Pinned in Task 2.

---

### Task 1: Calendar constants and variant resolution

**Files:**
- Modify: `apps/constants/src/index.ts` (after `HOLIDAYS`, ~line 326)
- Create: `apps/api/src/utils/density-day.ts`
- Test: `apps/api/src/utils/density-day.test.ts`

**Interfaces:**
- Produces: `CUTI_BERSAMA: ReadonlySet<string>`, `RAMADAN_RANGES: readonly (readonly [string, string])[]` (inclusive `YYYY-MM-DD` pairs) in `@commute/constants`; `type DensityVariant = 'WD' | 'FRI' | 'SAT' | 'SUN' | 'HOL' | 'RAM'`; `densityVariant(isoDate: string): DensityVariant`.

- [ ] **Step 1: Add the constants**

```ts
// apps/constants/src/index.ts, after HOLIDAYS
/*
 * Cuti bersama: collective leave days. Operators run a normal timetable on them
 * (which is why HOLIDAYS excludes them), but riders don't commute: KCI moved only
 * ~27% of the first workday back's boardings by 13:00 (25 Mar 2026), the same late
 * shape as a holiday. Used by the density model only, never by serviceDay.
 * NEEDS A YEARLY UPDATE from the SKB, like HOLIDAYS. The 2026 entries below are the
 * Lebaran ones the spec has evidence for; add the rest from the 2026 SKB.
 */
export const CUTI_BERSAMA: ReadonlySet<string> = new Set([
  '2026-03-18', '2026-03-23', '2026-03-24' // Idulfitri
])

/*
 * Ramadan, as inclusive local dates (1 Ramadan .. the day before Idulfitri).
 * NEEDS A YEARLY UPDATE when the government announces the dates (sidang isbat).
 * Density only: KCI's Ramadan 2026 release shows mornings starting ~1h earlier and
 * an evening split around iftar. See docs/station-density.md "Ramadan".
 */
export const RAMADAN_RANGES: readonly (readonly [string, string])[] = [
  ['2026-02-18', '2026-03-19']
]
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/api/src/utils/density-day.test.ts
import { describe, expect, it } from 'vitest'
import { densityVariant } from './density-day'

describe('densityVariant', () => {
  it('keeps ordinary days in their bucket', () => {
    expect(densityVariant('2026-10-07')).toBe('WD') // Wednesday
    expect(densityVariant('2026-10-10')).toBe('SAT')
    expect(densityVariant('2026-10-11')).toBe('SUN')
  })

  it('splits Friday out of WD', () => {
    expect(densityVariant('2026-10-09')).toBe('FRI')
  })

  it('treats holidays and cuti bersama as HOL, and holidays win over Ramadan', () => {
    expect(densityVariant('2026-08-17')).toBe('HOL')
    expect(densityVariant('2026-03-23')).toBe('HOL') // cuti bersama, a Monday
    expect(densityVariant('2026-03-19')).toBe('HOL') // Nyepi, inside Ramadan
  })

  it('uses RAM for Ramadan weekdays, Fridays included, but not Ramadan weekends', () => {
    expect(densityVariant('2026-02-25')).toBe('RAM') // Wednesday
    expect(densityVariant('2026-02-27')).toBe('RAM') // Friday
    expect(densityVariant('2026-02-28')).toBe('SAT')
  })
})
```

- [ ] **Step 3: Run and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/utils/density-day.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// apps/api/src/utils/density-day.ts
import { CUTI_BERSAMA, HOLIDAYS, RAMADAN_RANGES } from '@commute/constants'

/*
 * Which density variant a SERVICE date runs. A superset of serviceDay's
 * WD/SAT/SUN: FRI (WFH Fridays, ~5–9% lighter), HOL (holidays and cuti bersama,
 * late-running), RAM (Ramadan weekdays). Order matters: a holiday beats Ramadan,
 * Ramadan beats Friday, and weekends stay weekends (no Ramadan weekend data).
 */
export type DensityVariant = 'WD' | 'FRI' | 'SAT' | 'SUN' | 'HOL' | 'RAM'

export function densityVariant(isoDate: string): DensityVariant {
  if (HOLIDAYS.has(isoDate) || CUTI_BERSAMA.has(isoDate)) return 'HOL'
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  if (weekday === 6) return 'SAT'
  if (weekday === 0) return 'SUN'
  if (RAMADAN_RANGES.some(([from, to]) => isoDate >= from && isoDate <= to)) return 'RAM'
  return weekday === 5 ? 'FRI' : 'WD'
}
```

- [ ] **Step 5: Run and verify they pass**, then **Checkpoint** (no commit).

Run: `pnpm --filter @commute/api exec vitest run src/utils/density-day.test.ts`
Expected: PASS (4 tests).

---

### Task 2: Variant-aware model and generator

**Files:**
- Modify: `apps/api/src/db/scripts/density/roles.ts`, `apps/api/src/db/scripts/density/model.ts`, `apps/api/src/db/scripts/generateDensity.ts`
- Test: `apps/api/src/db/scripts/density/variants.test.ts`
- Modify: `apps/api/src/db/data/density.calibration.test.ts` (new expectations)

**Interfaces:**
- Consumes: Phase 1 `stationCurve`, `hourlyLevels`, `StationInput`, `amShareFor`, `dayLevel`, `roleWeight`; `DensityVariant` (Task 1).
- Produces: `VARIANT_BASE: Record<DensityVariant, DayBucket>`; `hourlyLevels(input, variant: DensityVariant)` (the signature widens from `DayBucket`); `CFD_STATIONS: readonly string[]`; generated `DENSITY_LEVELS` keyed by all six variants.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/db/scripts/density/variants.test.ts
import { describe, expect, it } from 'vitest'
import { hourlyLevels, stationCurve, type StationInput } from './model'

const flat = (n: number) => Array.from({ length: 24 }, (_, h) => h >= 5 && h < 23 ? n : 0)
const input = (over: Partial<StationInput> = {}): StationInput => ({
  stationId: 'KCI-XXX', operator: 'KCI', score: 70, rideMin: 40,
  departures: { WD: flat(20), SAT: flat(18), SUN: flat(18) }, ...over
})
const shareBefore = (c: number[], h: number) => c.slice(0, h).reduce((a, b) => a + b, 0)

describe('variants', () => {
  it('FRI is never busier than WD', () => {
    const wd = hourlyLevels(input(), 'WD'), fri = hourlyLevels(input(), 'FRI')
    fri.forEach((l, h) => expect(l).toBeLessThanOrEqual(wd[h]))
  })

  it('HOL runs late: ~27% of boardings before 13:00 (KCI, 23 and 25 Mar 2026)', () => {
    expect(shareBefore(stationCurve(input(), 'HOL'), 13)).toBeCloseTo(0.27, 2)
  })

  it('HOL uses the SUN board: no SUN board means no levels', () => {
    const noSun = input({ departures: { WD: flat(20), SAT: flat(18), SUN: new Array(24).fill(0) } })
    expect(hourlyLevels(noSun, 'HOL').every(l => l === 0)).toBe(true)
  })

  it('RAM starts earlier and dips at iftar (KCI Ramadan 2026 release)', () => {
    const wd = stationCurve(input(), 'WD'), ram = stationCurve(input(), 'RAM')
    expect(ram[5]).toBeGreaterThan(wd[5])
    expect(ram[18]).toBeLessThan(ram[17])
    expect(ram[19]).toBeGreaterThan(ram[18])
  })

  it('Car Free Day lifts Sudirman on Sunday 09–10h only', () => {
    const sud = input({ stationId: 'KCI-SUD', rideMin: 0 })
    const plain = input({ stationId: 'KCI-XXX', rideMin: 0 })
    expect(stationCurve(sud, 'SUN')[9]).toBeGreaterThan(stationCurve(plain, 'SUN')[9])
    expect(stationCurve(sud, 'SAT')[9]).toBeCloseTo(stationCurve(plain, 'SAT')[9], 6)
  })
})
```

- [ ] **Step 2: Run and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/variants.test.ts`
Expected: FAIL (type errors / wrong values: `'FRI'` isn't a `DayBucket`).

- [ ] **Step 3: Implement in roles.ts** (append)

```ts
import type { DensityVariant } from '../../../utils/density-day'

/** The timetable each variant runs on: operators don't publish Friday, Ramadan or holiday boards. */
export const VARIANT_BASE: Record<DensityVariant, DayBucket> = {
  WD: 'WD', FRI: 'WD', RAM: 'WD', SAT: 'SAT', SUN: 'SUN', HOL: 'SUN'
}

/** WFH Fridays: PDF Fridays run 5–9% under the rest of the week since May 2026. */
const FRIDAY_LEVEL = 0.93

/*
 * Holidays and cuti bersama: KRL moved 25.7% (23 Mar) and 27.3% (25 Mar) of the
 * day by 13:00. Interchange/leisure stations get BUSIER, not quieter (Manggarai's
 * transit record of 201,617 was a Lebaran Sunday, ~1.2x its weekday), via
 * HOLIDAY_LEVEL_OVERRIDES; everyone else takes the SUN level.
 */
const HOLIDAY_AM_SHARE = 0.27
export const HOLIDAY_LEVEL_OVERRIDES: Record<string, number> = {
  'KCI-MRI': 1.2, 'KCI-BOO': 1.0, 'KCI-JAKK': 1.0, 'KCI-THB': 0.9
}

export function variantLevel(stationId: string, b: number, variant: DensityVariant): number {
  if (variant === 'FRI') return FRIDAY_LEVEL
  if (variant === 'RAM') return 1 // "relatif stabil, 1 juta lebih" (KCI Ramadan 2026)
  if (variant === 'HOL') return HOLIDAY_LEVEL_OVERRIDES[stationId] ?? dayLevel(b, 'SUN')
  return dayLevel(b, VARIANT_BASE[variant])
}

export function variantAmShare(b: number, variant: DensityVariant): number {
  if (variant === 'HOL') return HOLIDAY_AM_SHARE
  return amShareFor(b, VARIANT_BASE[variant])
}
```

- [ ] **Step 4: Implement in model.ts**

Change `stationCurve` and `hourlyLevels` to take `variant: DensityVariant`:

```ts
import type { DensityVariant } from '../../../utils/density-day'
import { amShiftHours, roleWeight, VARIANT_BASE, variantAmShare, variantLevel } from './roles'

/*
 * Car Free Day: Jl. Sudirman–Thamrin closes to cars every Sunday morning. Riders
 * arrive ~06–08 and board home ~09–11; the crowdsourced Sudirman chart shows a
 * distinct Sunday-morning bump no other station has. UNCALIBRATED: the bump's
 * size is a guess (1.6x on 09–10h) pending a measured figure.
 */
export const CFD_STATIONS = ['KCI-SUD', 'KCI-SUDB', 'MRTJ-DKA', 'MRTJ-BHI', 'MRTJ-STB', 'MRTJ-BNH', 'MRTJ-IST'] as const
const CFD_HOURS = [9, 10]
const CFD_FACTOR = 1.6

/*
 * Ramadan weekday (KCI Ramadan 2026 release): mornings rise from 05:00 and peak
 * 06–07 instead of 06–08, so ~0.75h earlier; the evening runs 15–18, dips at
 * iftar (18h) and rises again from 19:00.
 */
const RAMADAN_EXTRA_AM_SHIFT_H = 0.75
const RAMADAN_EVENING: Record<number, number> = { 15: 1.15, 16: 1.15, 17: 1.1, 18: 0.5, 19: 1.25, 20: 1.2 }

export function stationCurve(input: StationInput, variant: DensityVariant): Curve {
  const base = VARIANT_BASE[variant]
  const b = roleWeight(input.stationId, base, input.rideMin)
  const extraShift = variant === 'RAM' ? RAMADAN_EXTRA_AM_SHIFT_H : 0
  let curve = base === 'WD'
    ? shiftAm(baseCurve(input.operator), amShiftHours(input.rideMin) + extraShift)
    : baseCurve(input.operator)
  if (variant === 'RAM') curve = normalize(curve.map((x, h) => x * (RAMADAN_EVENING[h] ?? 1)))
  curve = withAmShare(curve, variantAmShare(b, variant))
  if (variant === 'SUN' && (CFD_STATIONS as readonly string[]).includes(input.stationId)) {
    curve = normalize(curve.map((x, h) => CFD_HOURS.includes(h) ? x * CFD_FACTOR : x))
  }
  return curve
}
```

Add `normalize` to the `./curves` import. In `hourlyLevels(input, variant)`, read `deps = input.departures[VARIANT_BASE[variant]]`, compute `b = roleWeight(input.stationId, VARIANT_BASE[variant], input.rideMin)`, and replace `dayLevel(b, day)` with `variantLevel(input.stationId, b, variant)`. Keep the rest. Phase 1's `model.test.ts` and `roles.test.ts` keep passing unchanged, because `'WD' | 'SAT' | 'SUN'` are valid variants.

- [ ] **Step 5: Implement in generateDensity.ts**

Change `DAYS` to the six variants and type the output as `Record<string, Partial<Record<DensityVariant, string>>>`:

```ts
import type { DensityVariant } from '../../utils/density-day'
const VARIANTS: DensityVariant[] = ['WD', 'FRI', 'SAT', 'SUN', 'HOL', 'RAM']
```

Use `VARIANTS` in the per-station map (departures stay keyed by `DayBucket`; `hourlyLevels` maps them).

- [ ] **Step 6: Run the variant tests, regenerate, and extend the calibration**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/`, then `pnpm --filter @commute/api generate:density`.
Append to `density.calibration.test.ts` (widen its `level` helper's `day` type to `DensityVariant`):

```ts
  it('Manggarai on a holiday is at least as busy as on a Sunday (Lebaran transit record)', () => {
    expect(level('KCI-MRI', 'HOL', 17)).toBeGreaterThanOrEqual(level('KCI-MRI', 'SUN', 17))
  })

  it('a Ramadan weekday morning at a far origin is busy by 05h', () => {
    expect(level('KCI-BOO', 'RAM', 5)).toBeGreaterThanOrEqual(level('KCI-BOO', 'WD', 5))
  })
```

Run: `pnpm --filter @commute/api exec vitest run src/db/data/density.calibration.test.ts`
Expected: PASS. Tune only the named constants above, with a why-comment, never the expectations.

- [ ] **Step 7: Checkpoint.** Report the size change of `density.ts` (6 variants instead of 3). Do not commit.

---

### Task 3: Endpoint accepts a service date

**Files:**
- Modify: `apps/schemas/src/station.ts` (`StationDensitySchema.day`)
- Modify: `apps/api/src/routes/stations.ts` (the density route from Phase 1)
- Test: `apps/api/src/routes/stations.density.test.ts` (extend)

**Interfaces:**
- Consumes: `densityVariant` (Task 1).
- Produces: `GET /stations/:op/:code/density?date=YYYY-MM-DD`; `StationDensity.day` widens to `'WD' | 'FRI' | 'SAT' | 'SUN' | 'HOL' | 'RAM'`.

- [ ] **Step 1: Write the failing tests** (extend the Phase 1 mock so `DENSITY_LEVELS['KCI-MRI']` also has `HOL: '000001111111111111111000'`)

```ts
  it('resolves ?date= to its variant, holidays included', async () => {
    const res = await get('/stations/KCI/MRI/density?date=2026-08-17', STATION)
    const body = await res.json() as { data: { day: string, hours: { level: string | null }[] } }
    expect(body.data.day).toBe('HOL')
    expect(body.data.hours[10].level).toBe('LENGANG')
  })

  it('still honours a bare ?day= for old clients', async () => {
    const res = await get('/stations/KCI/MRI/density?day=WD', STATION)
    expect((await res.json() as { data: { day: string } }).data.day).toBe('WD')
  })

  it('400s a malformed date', async () => {
    expect((await get('/stations/KCI/MRI/density?date=17-08-2026', STATION)).status).toBe(400)
  })
```

- [ ] **Step 2: Run and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/routes/stations.density.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Schema: change the `day` picklist to `['WD', 'FRI', 'SAT', 'SUN', 'HOL', 'RAM']`, with this description: `'Jenis hari yang dipakai. Selain WD/SAT/SUN: FRI (Jumat, banyak yang WFH), HOL (libur nasional atau cuti bersama), RAM (hari kerja di bulan Ramadan).'`

Route: add a `dateParam` beside `dayParam` (`queryParam('date', 'Tanggal layanan (YYYY-MM-DD, waktu Jakarta). Kalau diisi, jenis harinya ditentukan dari kalender: Jumat, libur, cuti bersama, atau Ramadan. Lebih akurat daripada `day`.', '2026-08-17')`) and resolve:

```ts
    const date = c.req.query('date')
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json(BadRequest('INVALID_DATE', `Invalid date: ${date}`), 400)
    }
    const variant: DensityVariant = date ? densityVariant(date) : requestedDay(c.req.query('day'))
    const digits = DENSITY_LEVELS[stationID]?.[variant] ?? '0'.repeat(24)
```

Use `variant` as the response `day`. Check `BadRequest`'s exact signature in `utils/response` before using it (it's already imported in `stations.ts`).

- [ ] **Step 4: Run and verify they pass** (plus `openapi.test.ts`), then **Checkpoint** (no commit).

Run: `pnpm --filter @commute/api exec vitest run src/routes/stations.density.test.ts src/routes/openapi.test.ts`
Expected: PASS.

---

### Task 4: Web sends the service date

**Files:**
- Modify: `apps/web/utils/service-day.ts` (add `serviceDateOf`)
- Modify: `apps/web/app/components/station-content.tsx` (the `densityUrl` from Phase 1)
- Test: `apps/web/utils/service-day.test.ts` (create or extend)

**Interfaces:**
- Produces: `serviceDateOf(now: Date): string` (`YYYY-MM-DD` of the service day, with the same 03:00 rollover as `serviceDayOf`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { serviceDateOf } from './service-day'

describe('serviceDateOf', () => {
  it('is the calendar date in the day and the previous date before 03:00', () => {
    expect(serviceDateOf(new Date(2026, 7, 17, 14, 0))).toBe('2026-08-17')
    expect(serviceDateOf(new Date(2026, 7, 18, 0, 30))).toBe('2026-08-17') // still the holiday's night
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter @commute/web exec vitest run utils/service-day.test.ts`
Expected: FAIL, `serviceDateOf` not exported.

- [ ] **Step 3: Implement** in `service-day.ts`, reusing `ROLLOVER_HOUR`:

```ts
/** The service day's date, `YYYY-MM-DD`: before 03:00 the night still belongs to yesterday. */
export function serviceDateOf(now: Date): string {
  const day = new Date(now.getTime() - ROLLOVER_HOUR * 3600_000)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}
```

Refactor `serviceDayOf` to call it for its `iso` (same behaviour). In `station-content.tsx`, change the density URL to `?date=${serviceDateOf(new Date())}` in place of `?day=${day}`, and memoise on the date string.

- [ ] **Step 4: Run the web tests and typecheck, verify in the app**

Run: `pnpm --filter @commute/web exec vitest run && pnpm --filter @commute/web exec tsc --noEmit`
Then open a rail station in the dev app and confirm the `/density` request carries `?date=` and the response `day` is `FRI` on a Friday (or check by temporarily faking `Date` in the console).

- [ ] **Step 5: Checkpoint.** Remind the user: `generate:density -- --remote`, `API_VERSION` bump, and the yearly `CUTI_BERSAMA` / `RAMADAN_RANGES` updates (add both to whatever reminds them about `HOLIDAYS`). Do not commit.
