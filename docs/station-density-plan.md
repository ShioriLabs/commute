# Station Density (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a forecast "typically busy" badge (Lengang / Padat / Sangat Padat) on rail station pages, for the current hour, built only from data we already hold.

**Architecture:** A build-time generator (`generate:density`) combines four inputs:
- per-operator hourly rider curves (normalised JakLingko shares)
- a station role derived by **distance decay** from scheduled ride time to the city core
- ridership anchors or station scores
- weekday/weekend departures per hour from D1

It emits a generated module of 24 hourly levels per station per day type. A new `GET /stations/:operator/:code/density` endpoint serves that module, and the web station page renders the current hour as a badge. All model maths lives in pure, tested functions under `apps/api/src/db/scripts/density/`. The generator is only I/O plus formatting.

**Tech Stack:** TypeScript, Hono + valibot (`@commute/schemas`), vitest, wrangler D1 (`--local` / `--remote`), React Router + SWR on web.

**Spec:** `docs/station-density.md`, especially "Measured inputs (2026-10-07)" → "Revised model", "Station roles", "Day types", "Crowdsourced checks". Read it before Task 1.

## Global Constraints

- **Rail only in v1:** operators `KCI`, `MRTJ`, `LRTJ`, `LRTJBDB`. TransJakarta and APCGK are out of scope (TJ has no usable departures-per-hour; see spec "Per-operator load").
- **Never a "live" claim.** Every user-facing string uses the "biasanya" (typically) register. The badge is an estimate, not a measurement.
- **UI copy:** no em dashes, and no trailing period on the last sentence of UI prose (memory: `no-em-dashes.md`). API descriptions and OpenAPI text are **Indonesian**, casual register like the neighbouring `/headway` docs.
- **Crowdsourced (map-app) busyness charts are never an input.** Nothing derived from them goes in code or data. They were used for checking only.
- **JakLingko data:** commit only normalised hourly **shares**, never the raw totals (spec: totals aren't meaningful outside JakLingko's own payers).
- **Never commit** unless the user says so in the moment (memory: `no-autocommit.md`). Every "Checkpoint" step below stops for review instead.
- **Never run `wrangler deploy`** (memory: `never-wrangler-deploy.md`). Local `wrangler d1 execute --local` is fine. `--remote` reads are run **by the user**.
- Level thresholds and decay constants are **named constants with a why-comment**, matching house style (long why-prose is the norm; see `generateStationScoresSQL.ts`).
- Day buckets are `WD | SAT | SUN`. Public holidays already resolve to `SUN` through `serviceDay` (api) and `serviceDayOf` (web, with the 03:00 rollover).

## Review Focus

1. **A station with no service on the requested day, or an hour outside service** (e.g. 03h, or an LRTJ station on a day it doesn't run). Expected: level `null` for that hour and **no badge**. It must never show "Lengang" for a closed station. Pinned in Task 4 (`masks hours without service`) and Task 7 (`renders nothing for a null level`).
2. **00:00–02:59 belongs to the previous service day.** At 00:30 on Saturday the badge must read Friday's (`WD`) hour 0, not Saturday's. Pinned in Task 7 (`uses the service day across midnight`).
3. **Unknown station vs known station without density data.** An unknown code gives 404 (same as `/headway`). A TJ halte or an unscored station gives 200 with all-null hours, not 500. Pinned in Task 6.
4. **Thin service hours.** An hour with under a quarter of the station's peak departures gives `null`, not an inflated level from dividing by 2 trains. Pinned in Task 4.
5. **Stations with no route to the core** (the LRT Jakarta island, anything absent from `TRIP_PATTERNS`). Expected: the default role weight, not a crash or NaN. Pinned in Task 3 (`falls back when ride time is unknown`).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/db/data/rider-curves.ts` (create) | Normalised hourly boarding shares per operator, with source header. Hand-authored data. |
| `apps/api/src/db/scripts/density/curves.ts` (create) | Pure curve maths: `normalize`, `reweightMorning`, `withAmShare`, `shiftAm`. |
| `apps/api/src/db/scripts/density/ride-time.ts` (create) | Pure: scheduled ride minutes from each station to the nearest core station, from `TRIP_PATTERNS`. |
| `apps/api/src/db/scripts/density/roles.ts` (create) | Pure: distance decay `businessWeight`, evidence-cited `ROLE_OVERRIDES`, `dayLevel`, `amShareFor`. |
| `apps/api/src/db/scripts/density/model.ts` (create) | Pure: `boardingsPerDay`, `hourlyLevels` (riders per departure → 0/1/2/3, masking). |
| `apps/api/src/db/scripts/generateDensity.ts` (create) | I/O: reads D1, calls the model, writes `db/data/density.ts`. |
| `apps/api/src/db/data/density.ts` (generated) | `DENSITY_LEVELS`: 24-char level strings per station per day. |
| `apps/api/src/db/data/density.calibration.test.ts` (create) | Acceptance: named expectations from the spec against the generated output. |
| `apps/schemas/src/station.ts` (modify) | `StationDensitySchema`. |
| `apps/api/src/routes/stations.ts` (modify) | `GET /:operator/:stationCode/density`. |
| `apps/web/app/components/density-badge/` (create) | `format.ts` (pure label/level selection) + `index.tsx` (badge). |
| `apps/web/app/components/station-content.tsx` (modify) | Fetch and render the badge on rail stations. |

---

### Task 1: Rider curves and curve maths

**Files:**
- Create: `apps/api/src/db/data/rider-curves.ts`
- Create: `apps/api/src/db/scripts/density/curves.ts`
- Test: `apps/api/src/db/scripts/density/curves.test.ts`

**Interfaces:**
- Produces: `RIDER_CURVES: Record<'MRTJ' | 'KCI' | 'LRTJ' | 'TJ', readonly number[]>` (24 shares, sum ≈ 1); `type Curve = number[]`; `normalize(c: Curve): Curve`; `reweightMorning(c: Curve, beforeHour: number, targetShare: number): Curve`; `withAmShare(c: Curve, amShare: number, splitHour?: number): Curve`; `shiftAm(c: Curve, hoursEarlier: number, splitHour?: number): Curve`.

- [ ] **Step 1: Create the data file**

```ts
// apps/api/src/db/data/rider-curves.ts
/*
 * Hourly boarding shares per operator: what fraction of a day's riders tap in
 * during each clock hour (WIB), index 0 = 00:00–00:59.
 *
 * Source: JakLingko Indonesia "jam_sibuk_per_pto" export, received 2026-10-05.
 * Only the SHAPE is committed. The export states no time window and counts only
 * JakLingko payers (≈ all MRT riders, ≈ 9% of TJ's, ≈ 1% of KCI's relative to
 * MRT), so its totals and cross-operator comparisons mean nothing outside
 * JakLingko and are deliberately not stored here.
 *
 * KCI's curve under-weights the morning: KCI's own releases put ~35% of a
 * normal weekday's boardings before 10:00 against 28.3% here. The correction
 * is applied in density/curves.ts (reweightMorning), not baked in, so this file
 * stays the source as received. See docs/station-density.md "KCI calibration".
 *
 * "LRT" in the export is taken to be LRT Jakarta. LRT Jabodebek has no curve
 * and borrows KCI's in the density generator.
 */
export const RIDER_CURVES = {
  MRTJ: [0.0001, 0.0001, 0.0, 0.0004, 0.0038, 0.0264, 0.0949, 0.1418, 0.0919, 0.0406, 0.0204, 0.0186, 0.0202, 0.0201, 0.0205, 0.032, 0.0756, 0.1357, 0.1046, 0.0621, 0.0402, 0.0297, 0.0171, 0.0029],
  KCI: [0.0005, 0.0, 0.0, 0.0019, 0.009, 0.0312, 0.0651, 0.0708, 0.0562, 0.0484, 0.0456, 0.043, 0.0452, 0.0429, 0.0437, 0.0517, 0.0693, 0.0907, 0.0816, 0.0647, 0.0529, 0.0424, 0.0349, 0.0081],
  LRTJ: [0.0008, 0.0003, 0.0001, 0.0002, 0.0005, 0.0087, 0.03, 0.0425, 0.047, 0.0499, 0.057, 0.0612, 0.0605, 0.0586, 0.0618, 0.074, 0.0839, 0.1148, 0.0856, 0.0613, 0.0494, 0.039, 0.0128, 0.0002],
  TJ: [0.0045, 0.0022, 0.0011, 0.0015, 0.0042, 0.0215, 0.0592, 0.0762, 0.0623, 0.0469, 0.041, 0.0411, 0.044, 0.0435, 0.0465, 0.058, 0.0768, 0.1015, 0.08, 0.0606, 0.0501, 0.0413, 0.0275, 0.0086]
} as const satisfies Record<string, readonly number[]>
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/api/src/db/scripts/density/curves.test.ts
import { describe, expect, it } from 'vitest'
import { RIDER_CURVES } from '../../data/rider-curves'
import { normalize, reweightMorning, shiftAm, withAmShare } from './curves'

const sum = (c: number[]) => c.reduce((a, b) => a + b, 0)
const shareBefore = (c: number[], h: number) => sum(c.slice(0, h)) / sum(c)

describe('RIDER_CURVES', () => {
  it('has 24 hours per operator, summing to ~1', () => {
    for (const curve of Object.values(RIDER_CURVES)) {
      expect(curve).toHaveLength(24)
      expect(sum([...curve])).toBeCloseTo(1, 2)
    }
  })
})

describe('normalize', () => {
  it('scales to sum 1 and leaves an all-zero curve all-zero', () => {
    expect(sum(normalize([1, 1, 2]))).toBeCloseTo(1)
    expect(normalize([0, 0])).toEqual([0, 0])
  })
})

describe('reweightMorning', () => {
  it('hits the target share before the cut-off and keeps the within-half shape', () => {
    const kci = reweightMorning([...RIDER_CURVES.KCI], 10, 0.35)
    expect(shareBefore(kci, 10)).toBeCloseTo(0.35, 3)
    expect(sum(kci)).toBeCloseTo(1, 6)
    // 07h stays the morning maximum: only scaled, never reshaped.
    const morning = kci.slice(0, 10)
    expect(morning.indexOf(Math.max(...morning))).toBe(7)
  })
})

describe('withAmShare', () => {
  it('sets the share of the day before 13:00', () => {
    const c = withAmShare([...RIDER_CURVES.KCI], 0.58)
    expect(shareBefore(c, 13)).toBeCloseTo(0.58, 3)
    expect(sum(c)).toBeCloseTo(1, 6)
  })
})

describe('shiftAm', () => {
  it('moves the morning peak earlier by whole hours and leaves the evening alone', () => {
    const c = shiftAm([...RIDER_CURVES.MRTJ], 1)
    const morning = c.slice(0, 13)
    expect(morning.indexOf(Math.max(...morning))).toBe(6) // MRT peaks at 07h, so 06h after the shift
    expect(c.slice(13)).toEqual([...RIDER_CURVES.MRTJ].slice(13).map(x => x / sum([...RIDER_CURVES.MRTJ])))
  })

  it('interpolates fractional shifts and keeps the total', () => {
    const c = shiftAm([...RIDER_CURVES.KCI], 0.5)
    expect(sum(c)).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/curves.test.ts`
Expected: FAIL, `Cannot find module './curves'`.

- [ ] **Step 4: Implement**

```ts
// apps/api/src/db/scripts/density/curves.ts
/*
 * Pure 24-hour curve maths for the density generator. A Curve is 24 hourly
 * weights, index 0 = 00:00–00:59 WIB. Every function returns a NEW normalised
 * curve (sum 1) and never mutates its input.
 */
export type Curve = number[]

/** Morning/afternoon split for "share of the day before 13:00", the cut-off KCI releases use. */
export const AM_SPLIT_HOUR = 13

const total = (c: Curve) => c.reduce((a, b) => a + b, 0)

export function normalize(c: Curve): Curve {
  const t = total(c)
  return t === 0 ? c.map(() => 0) : c.map(x => x / t)
}

/*
 * Scale everything before `beforeHour` so it carries `targetShare` of the day,
 * and everything after so the rest carries 1 − targetShare. Within each part
 * the shape is preserved: this corrects WEIGHT, not timing. (A 1h time shift
 * was tested against KCI's releases and rejected; see the spec.)
 */
function setShareBefore(c: Curve, beforeHour: number, targetShare: number): Curve {
  const n = normalize(c)
  const head = total(n.slice(0, beforeHour))
  const tail = 1 - head
  if (head === 0 || tail === 0) return n
  return n.map((x, h) => h < beforeHour ? x * targetShare / head : x * (1 - targetShare) / tail)
}

export function reweightMorning(c: Curve, beforeHour: number, targetShare: number): Curve {
  return setShareBefore(c, beforeHour, targetShare)
}

export function withAmShare(c: Curve, amShare: number, splitHour = AM_SPLIT_HOUR): Curve {
  return setShareBefore(c, splitHour, amShare)
}

/*
 * Move the part before `splitHour` earlier by `hoursEarlier` (fractional hours
 * interpolate linearly between neighbouring bins). Mass shifted before 00:00
 * is folded into hour 0, so nothing is lost. Negative values shift later.
 * Only the morning moves: far origins board earlier, but the evening peak is
 * set by when offices empty, which ride time doesn't change.
 */
export function shiftAm(c: Curve, hoursEarlier: number, splitHour = AM_SPLIT_HOUR): Curve {
  const n = normalize(c)
  const out = new Array(24).fill(0) as Curve
  for (let h = 0; h < 24; h++) {
    if (h >= splitHour) { out[h] += n[h]; continue }
    const target = h - hoursEarlier
    const lo = Math.floor(target)
    const frac = target - lo
    const put = (bin: number, w: number) => { out[Math.min(Math.max(bin, 0), splitHour - 1)] += w }
    put(lo, n[h] * (1 - frac))
    if (frac > 0) put(lo + 1, n[h] * frac)
  }
  return normalize(out)
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/curves.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Checkpoint.** Show the diff to the user. Do not commit.

---

### Task 2: Ride time to the core

**Files:**
- Create: `apps/api/src/db/scripts/density/ride-time.ts`
- Test: `apps/api/src/db/scripts/density/ride-time.test.ts`

**Interfaces:**
- Consumes: `TRIP_PATTERNS: TripPattern[]` and `TripPattern` from `apps/api/src/db/data/trips.ts` (`{ line, stations: string[], trips: { s: number[], d: number }[] }`, times in seconds).
- Produces: `CORE_STATIONS: readonly string[]`; `rideMinutesToCore(patterns: TripPattern[], core?: readonly string[]): Map<string, number>` (stations with no path are absent).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/db/scripts/density/ride-time.test.ts
import { describe, expect, it } from 'vitest'
import { TRIP_PATTERNS, type TripPattern } from '../../data/trips'
import { CORE_STATIONS, rideMinutesToCore } from './ride-time'

const pattern = (stations: string[], times: number[]): TripPattern =>
  ({ line: 'X', stations, trips: [{ t: '1', d: 7, f: 'x', s: times }] })

describe('rideMinutesToCore', () => {
  it('is 0 at a core station and the scheduled minutes elsewhere, in either direction of travel', () => {
    const m = rideMinutesToCore([pattern(['A', 'B', 'CORE'], [0, 600, 1500])], ['CORE'])
    expect(m.get('CORE')).toBe(0)
    expect(m.get('B')).toBe(15)
    expect(m.get('A')).toBe(25)
  })

  it('takes the median hop over trips, so one slow train does not move it', () => {
    const p: TripPattern = { line: 'X', stations: ['A', 'CORE'], trips: [
      { t: '1', d: 7, f: 'x', s: [0, 600] }, { t: '2', d: 7, f: 'x', s: [0, 600] }, { t: '3', d: 7, f: 'x', s: [0, 3000] }
    ] }
    expect(rideMinutesToCore([p], ['CORE']).get('A')).toBe(10)
  })

  it('crosses patterns at shared stations with a transfer penalty', () => {
    const m = rideMinutesToCore([
      pattern(['FAR', 'HUB'], [0, 1200]),
      pattern(['HUB', 'CORE'], [0, 300])
    ], ['CORE'])
    expect(m.get('FAR')).toBe(20 + 5 + 5) // ride + TRANSFER_PENALTY_MIN + ride
  })

  it('leaves unreachable stations out', () => {
    expect(rideMinutesToCore([pattern(['ISLAND1', 'ISLAND2'], [0, 120])], ['CORE']).has('ISLAND1')).toBe(false)
  })

  it('orders the real network the way the spec observed it', () => {
    const m = rideMinutesToCore(TRIP_PATTERNS, CORE_STATIONS)
    expect(m.get('KCI-SUD')).toBe(0)
    const tebet = m.get('KCI-TEB')!, kranji = m.get('KCI-KRI')!, bekasi = m.get('KCI-BKS')!, bogor = m.get('KCI-BOO')!
    expect(tebet).toBeLessThan(kranji)
    expect(kranji).toBeLessThan(bekasi)
    expect(bekasi).toBeLessThan(bogor)
    expect(bogor).toBeGreaterThan(45)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/ride-time.test.ts`
Expected: FAIL, `Cannot find module './ride-time'`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/scripts/density/ride-time.ts
import type { TripPattern } from '../../data/trips'

/*
 * Where the commute goes. Distance from these drives the station role: a
 * station far from them is a place people leave in the morning, one near them
 * is a place people arrive. Picked from KCI's own "stasiun tujuan perkantoran"
 * list in its 2026 releases (Sudirman, Juanda, Gondangdia, Palmerah) plus
 * the two integration hubs the commute flows through (Manggarai, Tanah Abang)
 * and their MRT/LRT counterparts at Dukuh Atas.
 */
export const CORE_STATIONS = [
  'KCI-MRI', 'KCI-SUD', 'KCI-SUDB', 'KCI-THB', 'KCI-JUA', 'KCI-GDD', 'KCI-PLM',
  'MRTJ-DKA', 'LRTJBDB-DKA'
] as const

/*
 * Minutes added per change of pattern at a shared station. It stands in for walking
 * and waiting. It's only a ranking input, so the exact value matters little.
 */
export const TRANSFER_PENALTY_MIN = 5

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/*
 * Scheduled ride minutes from every station to its NEAREST core station,
 * Dijkstra over pattern hops weighted by the median hop time across trips.
 * Edges are undirected: a morning ride in and an evening ride out take the same
 * time, and some patterns only exist in one direction in TRIP_PATTERNS.
 * Stations with no path (the LRT Jakarta island) are absent; callers fall back.
 */
export function rideMinutesToCore(patterns: TripPattern[], core: readonly string[] = CORE_STATIONS): Map<string, number> {
  // Each node is (pattern index, station); changing pattern at a station costs the penalty.
  const edges = new Map<string, { to: string, w: number }[]>()
  const link = (a: string, b: string, w: number) => {
    if (!edges.has(a)) edges.set(a, [])
    if (!edges.has(b)) edges.set(b, [])
    edges.get(a)!.push({ to: b, w })
    edges.get(b)!.push({ to: a, w })
  }
  const nodesAt = new Map<string, string[]>()
  patterns.forEach((p, pi) => {
    p.stations.forEach((st, i) => {
      const node = `${pi}|${st}`
      nodesAt.set(st, [...(nodesAt.get(st) ?? []), node])
      if (i === 0) return
      const hops = p.trips.map(t => (t.s[i] - t.s[i - 1]) / 60).filter(x => x >= 0)
      if (hops.length) link(`${pi}|${p.stations[i - 1]}`, node, median(hops))
    })
  })
  for (const nodes of nodesAt.values()) {
    for (let i = 1; i < nodes.length; i++) link(nodes[0], nodes[i], TRANSFER_PENALTY_MIN)
  }

  const dist = new Map<string, number>()
  const queue: [string, number][] = []
  for (const st of core) for (const node of nodesAt.get(st) ?? []) { dist.set(node, 0); queue.push([node, 0]) }
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1])
    const [node, d] = queue.shift()!
    if (d > (dist.get(node) ?? Infinity)) continue
    for (const { to, w } of edges.get(node) ?? []) {
      const nd = d + w
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); queue.push([to, nd]) }
    }
  }

  const out = new Map<string, number>()
  for (const [st, nodes] of nodesAt) {
    const best = Math.min(...nodes.map(n => dist.get(n) ?? Infinity))
    if (Number.isFinite(best)) out.set(st, Math.round(best))
  }
  return out
}
```

Note on the transfer test: the hub change goes through a hub node of each pattern (`link(nodes[0], nodes[i], 5)`). FAR→HUB(p0) is 20, HUB(p0)→HUB(p1) is 5, HUB(p1)→CORE is 5, so 30. If the real-network assertion fails, print the four values and fix `CORE_STATIONS` or the ordering expectation only if the spec supports it. Don't loosen the ordering.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/ride-time.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Checkpoint.** Report the real ride minutes for Tebet, Kranji, Bekasi and Bogor to the user. Do not commit.

---

### Task 3: Roles by distance decay, overrides, day levels

**Files:**
- Create: `apps/api/src/db/scripts/density/roles.ts`
- Test: `apps/api/src/db/scripts/density/roles.test.ts`

**Interfaces:**
- Produces: `type DayBucket = 'WD' | 'SAT' | 'SUN'`; `businessWeight(rideMin: number | undefined): number` in [0,1]; `ROLE_OVERRIDES: Record<string, { WD?: number, WE?: number }>`; `roleWeight(stationId: string, day: DayBucket, rideMin: number | undefined): number`; `dayLevel(b: number, day: DayBucket): number`; `amShareFor(b: number, day: DayBucket): number`; `amShiftHours(rideMin: number | undefined): number`.

- [ ] **Step 1: Write the failing tests** (calibration bands come straight from the spec's tables)

```ts
// apps/api/src/db/scripts/density/roles.test.ts
import { describe, expect, it } from 'vitest'
import { amShareFor, amShiftHours, businessWeight, dayLevel, roleWeight } from './roles'

describe('businessWeight (distance decay)', () => {
  it('is high at the core and decays with ride time', () => {
    expect(businessWeight(0)).toBeGreaterThanOrEqual(0.8)
    expect(businessWeight(20)).toBeLessThan(businessWeight(5))
    expect(businessWeight(75)).toBeLessThanOrEqual(0.1)
  })

  it('falls back when ride time is unknown', () => {
    expect(businessWeight(undefined)).toBe(0.3)
  })
})

describe('roleWeight overrides', () => {
  it('makes Bogor a destination at weekends only', () => {
    expect(roleWeight('KCI-BOO', 'WD', 75)).toBeLessThanOrEqual(0.1)
    expect(roleWeight('KCI-BOO', 'SAT', 75)).toBeGreaterThanOrEqual(0.5)
    expect(roleWeight('KCI-BOO', 'SUN', 75)).toBe(roleWeight('KCI-BOO', 'SAT', 75))
  })

  it('treats Tebet as mixed whatever its ride time says', () => {
    expect(roleWeight('KCI-TEB', 'WD', 5)).toBe(0.5)
  })
})

describe('amShareFor (share of boardings before 13:00)', () => {
  it('matches the spec on weekdays: origins ~55%, business stations mostly evening', () => {
    expect(amShareFor(0.05, 'WD')).toBeGreaterThan(0.53)
    expect(amShareFor(0.05, 'WD')).toBeLessThan(0.62)
    expect(amShareFor(0.85, 'WD')).toBeLessThan(0.3)
  })

  it('runs late at weekends for everyone', () => {
    expect(amShareFor(0.05, 'SUN')).toBeLessThan(0.4)
  })
})

describe('dayLevel (weekend spectrum)', () => {
  it('is 1 on weekdays, ~0.45 at business stations and ~0.78 at far origins at weekends', () => {
    expect(dayLevel(0.5, 'WD')).toBe(1)
    expect(dayLevel(0.85, 'SAT')).toBeCloseTo(0.46, 2)
    expect(dayLevel(0.05, 'SUN')).toBeCloseTo(0.78, 2)
  })
})

describe('amShiftHours', () => {
  it('moves far origins earlier, the core later, and nothing when unknown', () => {
    expect(amShiftHours(75)).toBeCloseTo(0.75, 2)
    expect(amShiftHours(0)).toBeCloseTo(-0.5, 2)
    expect(amShiftHours(500)).toBe(1)
    expect(amShiftHours(undefined)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/roles.test.ts`
Expected: FAIL, `Cannot find module './roles'`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/scripts/density/roles.ts
/*
 * Station role as ONE number: b ∈ [0,1], the "business" weight. 0 is a pure
 * residential origin (people board in the morning, come back in the evening),
 * 1 a pure business destination (people arrive in the morning, board in the
 * evening). See docs/station-density.md "Station roles" and "Crowdsourced checks".
 */
export type DayBucket = 'WD' | 'SAT' | 'SUN'

/*
 * Distance decay: b = B0 · e^(−t/TAU), t = scheduled minutes to the core.
 * B0 0.85 puts Sudirman at ~85% arrivals in the morning (Sudirman Baru: 80–88% of
 * alighting before noon). TAU 25 min puts Kranji (~20 min out) mid-low and Bogor
 * (~75 min) near zero, matching the crowdsourced ordering.
 */
const B0 = 0.85
const TAU_MIN = 25
/** No path to the core (the LRT Jakarta island): treat as mildly residential. */
const UNKNOWN_B = 0.3

export function businessWeight(rideMin: number | undefined): number {
  if (rideMin === undefined) return UNKNOWN_B
  return B0 * Math.exp(-rideMin / TAU_MIN)
}

/*
 * Stations the decay can't explain, each with the evidence that it is different.
 * WE applies to SAT and SUN alike (the crowdsourced checks found them the same).
 */
export const ROLE_OVERRIDES: Record<string, { WD?: number, WE?: number }> = {
  // Weekday origin, weekend leisure destination: no morning peak and a 15–21 plateau at weekends.
  'KCI-BOO': { WE: 0.6 },
  // KCI lists it as an office arrival station, but its evening is as big as its morning.
  'KCI-TEB': { WD: 0.5, WE: 0.5 },
  // Interchange: transfers in both peaks; Lebaran transit record 201,617.
  'KCI-MRI': { WD: 0.5, WE: 0.5 },
  // Shopping district: busy at weekends too (20,504 by 14:00 on Sun 4 Jan 2026).
  'KCI-THB': { WD: 0.6, WE: 0.6 },
  // Terminus + Kota Tua leisure; busiest at weekend evenings.
  'KCI-JAKK': { WD: 0.5, WE: 0.65 }
}

export function roleWeight(stationId: string, day: DayBucket, rideMin: number | undefined): number {
  const o = ROLE_OVERRIDES[stationId]
  const override = day === 'WD' ? o?.WD : o?.WE
  return override ?? businessWeight(rideMin)
}

/*
 * Share of a station's boardings before 13:00.
 * Weekday: Bogor boards ~55% before 13:00 (8 May 2026 release); business
 * stations board mostly in the evening. Linear in b between those ends.
 * Weekend: days run late (holiday KRL ≈ 26% before 13:00); 0.35 leaves room
 * for Bekasi-style morning outings, b nudges business stations later still.
 */
export function amShareFor(b: number, day: DayBucket): number {
  return day === 'WD' ? 0.6 - 0.45 * b : 0.35 - 0.1 * b
}

/*
 * Day volume relative to a weekday. The weekend spectrum: business ~40–45%, far
 * origins ~75–80% (crowdsourced checks, and KCI's own 41% for Sudirman on a
 * holiday Sunday). Holidays reach here as SUN.
 */
export function dayLevel(b: number, day: DayBucket): number {
  return day === 'WD' ? 1 : 0.8 - 0.4 * b
}

/*
 * How much earlier than the network average a station's morning boarding runs.
 * 30 min is roughly the average ride to the core; each hour farther out is an
 * hour earlier. Clamped: the network curve is already an average of real stations.
 */
export function amShiftHours(rideMin: number | undefined): number {
  if (rideMin === undefined) return 0
  return Math.min(1, Math.max(-0.5, (rideMin - 30) / 60))
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/roles.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Checkpoint.** Do not commit.

---

### Task 4: Hourly levels

**Files:**
- Create: `apps/api/src/db/scripts/density/model.ts`
- Test: `apps/api/src/db/scripts/density/model.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3; `RidershipAnchor` from `apps/api/src/db/data/ridership.ts` (`gatePerDay?`, `transitPerDay?`).
- Produces: `type Level = 0 | 1 | 2 | 3` (0 = no estimate); `boardingsPerDay(anchor: RidershipAnchor | undefined, score: number): number`; `CAPACITY: Record<'KCI' | 'MRTJ' | 'LRTJ' | 'LRTJBDB', number>`; `LEVEL_THRESHOLDS: readonly [number, number]`; `interface StationInput { stationId: string, operator: keyof typeof CAPACITY, anchor?: RidershipAnchor, score: number, rideMin?: number, departures: Record<DayBucket, number[]> }`; `stationCurve(input, day): Curve`; `hourlyLevels(input: StationInput, day: DayBucket): Level[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/db/scripts/density/model.test.ts
import { describe, expect, it } from 'vitest'
import { boardingsPerDay, hourlyLevels, type StationInput } from './model'

const flat = (n: number, from = 5, to = 23) => Array.from({ length: 24 }, (_, h) => h >= from && h < to ? n : 0)

const input = (over: Partial<StationInput> = {}): StationInput => ({
  stationId: 'KCI-XXX', operator: 'KCI', score: 60, rideMin: 40,
  departures: { WD: flat(20), SAT: flat(18), SUN: flat(18) },
  ...over
})

describe('boardingsPerDay', () => {
  it('counts half the gate taps plus every transfer for an anchored station', () => {
    expect(boardingsPerDay({ gatePerDay: 30_000, transitPerDay: 150_000 } as never, 0)).toBe(165_000)
  })

  it('inverts the measured score scale when there is no anchor', () => {
    // score 100 sits at DEMAND_CEIL (250,000 in+out) → 125,000 boardings
    expect(boardingsPerDay(undefined, 100)).toBeCloseTo(125_000, -2)
    expect(boardingsPerDay(undefined, 0)).toBeCloseTo(250, -1)
  })
})

describe('hourlyLevels', () => {
  it('returns 24 levels', () => {
    expect(hourlyLevels(input(), 'WD')).toHaveLength(24)
  })

  it('masks hours without service', () => {
    const levels = hourlyLevels(input(), 'WD')
    expect(levels[3]).toBe(0)
    expect(levels[23]).toBe(0)
  })

  it('masks thin hours under a quarter of peak departures', () => {
    const deps = flat(20); deps[5] = 4
    expect(hourlyLevels(input({ departures: { WD: deps, SAT: deps, SUN: deps } }), 'WD')[5]).toBe(0)
  })

  it('is busier in the evening peak than at midday for a business station', () => {
    const levels = hourlyLevels(input({ rideMin: 0, score: 90 }), 'WD')
    expect(levels[18]).toBeGreaterThan(levels[11])
  })

  it('is never busier at the weekend than on a weekday for a business station', () => {
    const s = input({ rideMin: 0, score: 90 })
    const wd = hourlyLevels(s, 'WD'), sat = hourlyLevels(s, 'SAT')
    expect(Math.max(...sat)).toBeLessThanOrEqual(Math.max(...wd))
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/model.test.ts`
Expected: FAIL, `Cannot find module './model'`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/scripts/density/model.ts
import { RIDER_CURVES } from '../../data/rider-curves'
import type { RidershipAnchor } from '../../data/ridership'
import { type Curve, reweightMorning, shiftAm, withAmShare } from './curves'
import { amShareFor, amShiftHours, type DayBucket, dayLevel, roleWeight } from './roles'

export type Level = 0 | 1 | 2 | 3

/*
 * Passengers per departing train, by operator. Same figures as the station
 * score's CAPACITY (generateStationScoresSQL.ts); restated here because that
 * file is a script with side effects on import. Keep the two in step.
 */
export const CAPACITY = { KCI: 2000, MRTJ: 1200, LRTJ: 270, LRTJBDB: 740 } as const

/*
 * Boardings per departure as a fraction of one train's capacity: below the first
 * threshold is Lengang, below the second Padat, otherwise Sangat Padat.
 * Initial values from the station analysis (Manggarai peak ≈ 0.25, Dukuh Atas BNI
 * peak ≈ 0.13, Dukuh Atas BNI midday ≈ 0.03). Tuned in Task 5 against the calibration test.
 */
export const LEVEL_THRESHOLDS = [0.08, 0.18] as const

/** An hour needs at least this fraction of the station's peak departures to get a level. */
const MIN_SERVICE_FRACTION = 0.25

/** Measured-demand log scale; must match generateStationScoresSQL.ts. */
const DEMAND_FLOOR = 500
const DEMAND_CEIL = 250_000

/** KCI's share of weekday boardings before 10:00, from its 2026 releases (JakLingko says 28.3%). */
const KCI_SHARE_BEFORE_10 = 0.35

export function boardingsPerDay(anchor: RidershipAnchor | undefined, score: number): number {
  if (anchor) return (anchor.gatePerDay ?? 0) / 2 + (anchor.transitPerDay ?? 0)
  const lo = Math.log(1 + DEMAND_FLOOR), hi = Math.log(1 + DEMAND_CEIL)
  return (Math.exp(lo + (score / 100) * (hi - lo)) - 1) / 2
}

export interface StationInput {
  stationId: string
  operator: keyof typeof CAPACITY
  anchor?: RidershipAnchor
  score: number
  rideMin?: number
  departures: Record<DayBucket, number[]>
}

function baseCurve(operator: StationInput['operator']): Curve {
  // LRT Jabodebek has no JakLingko curve and borrows KCI's, corrected the same way.
  if (operator === 'KCI' || operator === 'LRTJBDB') return reweightMorning([...RIDER_CURVES.KCI], 10, KCI_SHARE_BEFORE_10)
  return [...RIDER_CURVES[operator]]
}

export function stationCurve(input: StationInput, day: DayBucket): Curve {
  const b = roleWeight(input.stationId, day, input.rideMin)
  const shifted = day === 'WD' ? shiftAm(baseCurve(input.operator), amShiftHours(input.rideMin)) : baseCurve(input.operator)
  return withAmShare(shifted, amShareFor(b, day))
}

export function hourlyLevels(input: StationInput, day: DayBucket): Level[] {
  const deps = input.departures[day]
  const peak = Math.max(...deps)
  if (peak === 0) return new Array(24).fill(0)
  const b = roleWeight(input.stationId, day, input.rideMin)
  const riders = boardingsPerDay(input.anchor, input.score) * dayLevel(b, day)
  const curve = stationCurve(input, day)
  return curve.map((share, h): Level => {
    if (deps[h] < peak * MIN_SERVICE_FRACTION) return 0
    const load = riders * share / deps[h] / CAPACITY[input.operator]
    return load < LEVEL_THRESHOLDS[0] ? 1 : load < LEVEL_THRESHOLDS[1] ? 2 : 3
  })
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/density/model.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint.** Do not commit.

---

### Task 5: Generator, generated data, calibration

**Files:**
- Create: `apps/api/src/db/scripts/generateDensity.ts`
- Create (generated): `apps/api/src/db/data/density.ts`
- Create: `apps/api/src/db/data/density.calibration.test.ts`
- Modify: `apps/api/package.json` (scripts)
- Modify: `docs/station-density.md` (Status line + a short "Runbook" section)

**Interfaces:**
- Consumes: Tasks 2–4; `RIDERSHIP_BY_STATION_ID`; D1 `stations(id, operator, score, searchable)` and `schedules(stationId, estimatedDeparture, dayMask, lineCode)`.
- Produces: `DENSITY_LEVELS: Record<string, Partial<Record<'WD' | 'SAT' | 'SUN', string>>>`: a 24-char string of `0–3` per day, index = hour. Days with no service are omitted.

- [ ] **Step 1: Add the script**

In `apps/api/package.json` `scripts`, after `"generate:station-scores"`:

```json
"generate:density": "tsx ./src/db/scripts/generateDensity.ts",
```

- [ ] **Step 2: Write the generator**

```ts
// apps/api/src/db/scripts/generateDensity.ts
import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { RIDERSHIP_BY_STATION_ID } from '../data/ridership'
import { TRIP_PATTERNS } from '../data/trips'
import { rideMinutesToCore } from './density/ride-time'
import { CAPACITY, hourlyLevels, type StationInput } from './density/model'
import type { DayBucket } from './density/roles'

/*
 * Generates db/data/density.ts: a forecast crowding level (0 none, 1 Lengang,
 * 2 Padat, 3 Sangat Padat) for each rail station, day type and hour.
 * The model is in ./density/ and documented in docs/station-density.md.
 *
 * Reads D1 like generate:station-scores. Run with --remote for the real
 * output (the local D1 is stale; see docs/station-score.md runbook):
 *   pnpm --filter api generate:density -- --remote
 */
const OUTPUT = `${__dirname}/../data/density.ts`
const LOCAL = !process.argv.includes('--remote')
const DAYS: DayBucket[] = ['WD', 'SAT', 'SUN']
const DAY_BIT: Record<DayBucket, number> = { WD: 0b100, SAT: 0b010, SUN: 0b001 }

interface Row { [k: string]: string | number | null }
function d1(sql: string): Row[] {
  const args = ['wrangler', 'd1', 'execute', 'commute', LOCAL ? '--local' : '--remote', '--json', '--command', sql]
  const out = execFileSync('npx', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out.slice(out.indexOf('[')))[0]?.results ?? []
}

function main() {
  const operators = Object.keys(CAPACITY).map(o => `'${o}'`).join(',')
  const stations = d1(`SELECT id, operator, score FROM stations WHERE searchable = 1 AND operator IN (${operators})`)
  const deps = d1(`SELECT stationId, dayMask, CAST(substr(estimatedDeparture, 1, 2) AS INTEGER) AS h, COUNT(*) AS n
    FROM schedules WHERE lineCode != 'NUL' GROUP BY stationId, dayMask, h`)

  const byStation = new Map<string, Record<DayBucket, number[]>>()
  for (const r of deps) {
    const id = String(r.stationId)
    if (!byStation.has(id)) byStation.set(id, { WD: new Array(24).fill(0), SAT: new Array(24).fill(0), SUN: new Array(24).fill(0) })
    for (const day of DAYS) if (Number(r.dayMask) & DAY_BIT[day]) byStation.get(id)![day][Number(r.h) % 24] += Number(r.n)
  }

  const ride = rideMinutesToCore(TRIP_PATTERNS)
  const lines: string[] = []
  for (const s of stations) {
    const id = String(s.id)
    const departures = byStation.get(id)
    if (!departures) continue
    const input: StationInput = {
      stationId: id,
      operator: String(s.operator) as StationInput['operator'],
      anchor: RIDERSHIP_BY_STATION_ID.get(id),
      score: Number(s.score ?? 0),
      rideMin: ride.get(id),
      departures
    }
    const days = DAYS
      .map(day => [day, hourlyLevels(input, day).join('')] as const)
      .filter(([, levels]) => /[1-3]/.test(levels))
      .map(([day, levels]) => `${day}: '${levels}'`)
    if (days.length) lines.push(`  '${id}': { ${days.join(', ')} },`)
  }
  lines.sort()

  fs.writeFileSync(OUTPUT, `/*
 * Forecast platform crowding per station, day type and hour.
 *
 * GENERATED — do not edit by hand; re-run \`pnpm --filter api generate:density -- --remote\`.
 *
 * Each string is 24 digits, index = hour (WIB): 0 no estimate (no or thin
 * service), 1 Lengang, 2 Padat, 3 Sangat Padat. A modelled ESTIMATE from
 * schedules, ridership anchors and rider curves; never a live measurement.
 * Model: db/scripts/density/, rationale: docs/station-density.md.
 */
export const DENSITY_LEVELS: Record<string, Partial<Record<'WD' | 'SAT' | 'SUN', string>>> = {
${lines.join('\n')}
}
`)
  console.log(`wrote ${lines.length} stations to ${OUTPUT}${LOCAL ? ' (LOCAL D1 — re-run with --remote before shipping)' : ''}`)
}

main()
```

- [ ] **Step 3: Generate from local D1**

Run: `pnpm --filter @commute/api generate:density`
Expected: `wrote N stations …` with N roughly 140–160. The file `apps/api/src/db/data/density.ts` exists.

- [ ] **Step 4: Write the calibration test** (acceptance criteria from the spec. **Never** edit an expectation to make it pass; tune `LEVEL_THRESHOLDS`, `B0`/`TAU_MIN` or an override with a why-comment instead)

```ts
// apps/api/src/db/data/density.calibration.test.ts
import { describe, expect, it } from 'vitest'
import { DENSITY_LEVELS } from './density'

const level = (id: string, day: 'WD' | 'SAT' | 'SUN', h: number) => Number(DENSITY_LEVELS[id]?.[day]?.[h] ?? 0)

/*
 * What the spec says a rider should see. Each line cites the evidence it encodes
 * (docs/station-density.md). These are the acceptance criteria for the model:
 * tune the model, never these.
 */
describe('density calibration', () => {
  it('Manggarai is very busy in the weekday evening peak and not quiet at midday', () => {
    expect(level('KCI-MRI', 'WD', 17)).toBe(3)
    expect(level('KCI-MRI', 'WD', 12)).toBeGreaterThanOrEqual(2)
  })

  it('Sudirman: the weekday evening is its crowd, the morning is not (evening boarding, morning alighting)', () => {
    expect(level('KCI-SUD', 'WD', 18)).toBe(3)
    expect(level('KCI-SUD', 'WD', 7)).toBeLessThan(level('KCI-SUD', 'WD', 18))
  })

  it('Bogor boards in the weekday morning', () => {
    expect(level('KCI-BOO', 'WD', 6)).toBeGreaterThanOrEqual(2)
  })

  it('business stations calm down at weekends far more than origins do', () => {
    expect(level('KCI-SUD', 'SUN', 18)).toBeLessThan(level('KCI-SUD', 'WD', 18))
    expect(level('KCI-BOO', 'SUN', 17)).toBeGreaterThanOrEqual(2)
  })

  it('Dukuh Atas BNI (MRT) is busy at the weekday morning peak and quiet at midday', () => {
    expect(level('MRTJ-DKA', 'WD', 7)).toBeGreaterThanOrEqual(2)
    expect(level('MRTJ-DKA', 'WD', 12)).toBe(1)
  })

  it('nothing has a level at 03h on any day', () => {
    for (const days of Object.values(DENSITY_LEVELS)) {
      for (const levels of Object.values(days)) expect(levels![3]).toBe('0')
    }
  })

  it('not everything is Sangat Padat: under a quarter of weekday station-hours with service are level 3', () => {
    const all = Object.values(DENSITY_LEVELS).flatMap(d => (d.WD ?? '').split('')).filter(c => c !== '0')
    expect(all.filter(c => c === '3').length / all.length).toBeLessThan(0.25)
  })
})
```

- [ ] **Step 5: Run the calibration and tune**

Run: `pnpm --filter @commute/api exec vitest run src/db/data/density.calibration.test.ts`
If anything fails, adjust only `LEVEL_THRESHOLDS` (model.ts), `B0`/`TAU_MIN` (roles.ts), or add an evidence-cited `ROLE_OVERRIDES` entry. After each change, re-run Step 3 and then this step. Record final values and the reason in the constant's comment.
Expected: PASS (7 tests).

- [ ] **Step 6: Run the whole API suite and typecheck**

Run: `pnpm --filter @commute/api test && pnpm --filter @commute/api exec tsc --noEmit -p .`
Expected: all tests pass. tsc shows no NEW errors. Two errors in `src/utils/topology.ts:176` already existed before this work; report them and leave them alone.

- [ ] **Step 7: Update the spec**

In `docs/station-density.md`, change the Status line to: `**Status:** Phase 1 (rail, station page, web) implemented per docs/station-density-plan.md; Android board and per-train load (Phase 2) not started.` Add after "Revised model":

```markdown
### Runbook

pnpm --filter api generate:density -- --remote   # the user runs it; local D1 is stale
pnpm --filter api exec vitest run src/db/data/density.calibration.test.ts
# then bump API_VERSION so KV-cached station responses refresh
```

- [ ] **Step 8: Checkpoint.** Show the user the tuned constants and a few sample rows (Manggarai, Sudirman, Bogor, Tebet WD). Tell them `--remote` regeneration is theirs to run. Do not commit.

---

### Task 6: API endpoint

**Files:**
- Modify: `apps/schemas/src/station.ts` (after `HeadwayRowSchema` / `HeadwayRow`, ~line 172)
- Modify: `apps/api/src/routes/stations.ts` (new route before `export default app`)
- Test: `apps/api/src/routes/stations.density.test.ts`

**Interfaces:**
- Consumes: `DENSITY_LEVELS` (Task 5); existing `requestedDay`, `dayParam`, `doc`, `operatorParam`, `stationCodeParam`, `StationRepository.getById`, `NotFound`, `Ok` in `stations.ts`.
- Produces: `StationDensitySchema` and `type StationDensity = { day: 'WD' | 'SAT' | 'SUN', hours: ({ hour: number, level: 'LENGANG' | 'PADAT' | 'SANGAT_PADAT' | null })[] }` exported from `@commute/schemas`; `GET /stations/:operator/:stationCode/density?day=`.

- [ ] **Step 1: Add the schema**

```ts
// apps/schemas/src/station.ts — append after `export type HeadwayRow = …`
/*
 * Named with v.title + v.metadata({ ref }) like HeadwayRow, so the OpenAPI
 * snapshot carries them as components and the Android app's fabrikt build
 * generates `StationDensity` / `DensityHour` / `DensityLevel` classes instead
 * of anonymous inline ones.
 */
export const DensityLevelSchema = v.pipe(
  v.picklist(['LENGANG', 'PADAT', 'SANGAT_PADAT']),
  v.title('DensityLevel'),
  v.metadata({ ref: 'DensityLevel' })
)

export const DensityHourSchema = v.pipe(
  v.object({
    hour: v.pipe(v.number(), v.description('Jam, 0-23 waktu Jakarta.')),
    level: v.pipe(
      v.nullable(DensityLevelSchema),
      v.description('Perkiraan kepadatan biasanya di jam ini. `null` kalau lagi nggak ada layanan atau keretanya jarang banget, jadi nggak bisa diperkirakan.')
    )
  }),
  v.title('DensityHour'),
  v.metadata({ ref: 'DensityHour' })
)

export const StationDensitySchema = v.pipe(
  v.object({
    day: v.pipe(v.picklist(['WD', 'SAT', 'SUN']), v.description('Hari yang dipakai: `WD` (Senin-Jumat), `SAT`, atau `SUN`.')),
    hours: v.pipe(
      v.array(DensityHourSchema),
      v.description('24 jam, urut dari 0. Ini perkiraan dari jadwal dan data penumpang, BUKAN kondisi live.')
    )
  }),
  v.title('StationDensity'),
  v.description('Perkiraan seberapa padat stasiun ini biasanya, per jam.'),
  v.metadata({ ref: 'StationDensity' })
)
export type StationDensity = v.InferOutput<typeof StationDensitySchema>
```

Check that `apps/schemas/src/index.ts` re-exports everything from `station.ts` (it does for `HeadwayRowSchema`). If it lists names explicitly, add `DensityLevelSchema`, `DensityHourSchema`, `StationDensitySchema` and `StationDensity`.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/api/src/routes/stations.density.test.ts
import { describe, expect, it, vi } from 'vitest'

const terminalResults: unknown[] = []
function makeBuilder(): unknown {
  const proxy: unknown = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'then') return undefined
      if (prop === 'execute') return () => Promise.resolve(terminalResults.length ? terminalResults.shift() : [])
      if (prop === 'executeTakeFirst' || prop === 'executeTakeFirstOrThrow') return () => Promise.resolve(terminalResults.length ? terminalResults.shift() : undefined)
      if (prop === 'compile') return () => ({ sql: 'SELECT 1', parameters: [] })
      return () => proxy
    }
  })
  return proxy
}
vi.mock('db', () => ({ db: () => makeBuilder() }))
vi.mock('db/data/density', () => ({
  DENSITY_LEVELS: { 'KCI-MRI': { WD: '000001233322223333221000' } }
}))

const app = (await import('app')).default
type Bindings = (typeof import('app'))['Bindings']
const ctx = () => ({ waitUntil: () => undefined, passThroughOnException: () => undefined })
const env = (row: unknown) => {
  terminalResults.length = 0
  terminalResults.push(row)
  return { DB: {}, KV: { get: async () => null, put: async () => undefined }, API_VERSION: 'test' } as unknown as Bindings
}
const get = (path: string, row: unknown) =>
  app.fetch(new Request(`https://api.example${path}`), env(row), ctx() as unknown as ExecutionContext)

const STATION = { id: 'KCI-MRI', name: 'MANGGARAI', operator: 'KCI', lines: 'B,C' }

describe('GET /stations/:operator/:code/density', () => {
  it('maps the digit string to 24 named levels for the requested day', async () => {
    const res = await get('/stations/KCI/MRI/density?day=WD', STATION)
    expect(res.status).toBe(200)
    const body = await res.json() as { data: { day: string, hours: { hour: number, level: string | null }[] } }
    expect(body.data.day).toBe('WD')
    expect(body.data.hours).toHaveLength(24)
    expect(body.data.hours[3]).toEqual({ hour: 3, level: null })
    expect(body.data.hours[5].level).toBe('LENGANG')
    expect(body.data.hours[7].level).toBe('SANGAT_PADAT')
  })

  it('answers all-null for a known station with no data that day, never an error', async () => {
    const res = await get('/stations/KCI/MRI/density?day=SUN', STATION)
    const body = await res.json() as { data: { hours: { level: string | null }[] } }
    expect(res.status).toBe(200)
    expect(body.data.hours.every(h => h.level === null)).toBe(true)
  })

  it('404s an unknown station', async () => {
    const res = await get('/stations/KCI/NOPE/density', undefined)
    expect(res.status).toBe(404)
  })

  it('404s an unknown operator', async () => {
    const res = await get('/stations/XXX/MRI/density', STATION)
    expect(res.status).toBe(404)
  })
})
```

If the fixture row shape doesn't satisfy `StationRepository.getById`'s mapping, copy the exact row fixture used in `stations.headway.test.ts` (its `envFor` helper) instead of `STATION`.

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/routes/stations.density.test.ts`
Expected: FAIL with 404s on the density path (the route doesn't exist).

- [ ] **Step 4: Implement the route** (before `export default app` in `stations.ts`, and add `DENSITY_LEVELS` / `StationDensitySchema` imports at the top)

```ts
import { DENSITY_LEVELS } from 'db/data/density'
import { StationDensitySchema } from '@commute/schemas'
import type { StationDensity } from '@commute/schemas'

const LEVEL_NAMES = { 1: 'LENGANG', 2: 'PADAT', 3: 'SANGAT_PADAT' } as const

/*
 * Forecast crowding for one station, hour by hour, for one day type.
 *
 * Pure lookup into the generated DENSITY_LEVELS, so there is no KV entry: the
 * module is in memory and versioned with the deploy. The station lookup is only
 * there to tell an unknown code (404) from a known station we have no estimate
 * for (24 nulls). A TJ halte is the second case, not an error.
 */
app.get(
  '/:operator/:stationCode/density',
  doc({
    summary: 'Perkiraan kepadatan stasiun per jam',
    description: 'Seberapa padat stasiun ini BIASANYA di tiap jam, buat hari yang diminta. Ini perkiraan dari jadwal kereta, data penumpang yang dipublikasikan operator, dan pola jam sibuk. BUKAN pantauan live, jadi bisa meleset pas ada kejadian khusus.\n\nSementara cuma stasiun kereta (KCI, MRT, LRT Jakarta, LRT Jabodebek). Halte TransJakarta dapat `null` semua.',
    tag: 'Stasiun',
    data: StationDensitySchema,
    parameters: [operatorParam, stationCodeParam, dayParam],
    errors: { 404: 'Kode operator atau stasiun tidak ditemukan.' }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const stationCode = c.req.param('stationCode')
    const operator = getOperatorByCode(operatorCode)
    if (!operator) return c.json(NotFound('UNKNOWN_OPERATOR', `Unknown Operator Code: ${operatorCode}`), 404)

    const day = requestedDay(c.req.query('day'))
    const stationID = `${operator.code}-${stationCode}`
    const station = await new StationRepository(c.env.DB).getById(stationID)
    if (station === null) {
      return c.json(NotFound('UNKNOWN_STATION', `Unknown Station Code ${stationCode} in Operator ${operator.code}`), 404)
    }

    const digits = DENSITY_LEVELS[stationID]?.[day] ?? '0'.repeat(24)
    const body: StationDensity = {
      day,
      hours: [...digits].map((d, hour) => ({ hour, level: LEVEL_NAMES[Number(d) as 1 | 2 | 3] ?? null }))
    }
    return c.json(Ok(body), 200)
  }
)
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `pnpm --filter @commute/api exec vitest run src/routes/stations.density.test.ts src/routes/openapi.test.ts`
Expected: PASS. `openapi.test.ts` must still pass: it guards that every route is documented.

- [ ] **Step 6: Checkpoint.** Do not commit.

---

### Task 7: Web badge

**Files:**
- Create: `apps/web/app/components/density-badge/format.ts`
- Create: `apps/web/app/components/density-badge/index.tsx`
- Test: `apps/web/app/components/density-badge/format.test.ts`
- Modify: `apps/web/app/components/station-content.tsx` (fetch near `headwayUrl` ~line 219; render in the rail branch ~line 319, above the `Jadwal Lengkap` row)

**Interfaces:**
- Consumes: `StationDensity` from `@commute/schemas`; `serviceDayOf` from `utils/service-day`; `GET /stations/:op/:code/density?day=`.
- Produces: `currentHourLevel(density: StationDensity | undefined, now: Date): StationDensity['hours'][number]['level']`; `densityLabel(level): string | null`; `densityHour(now: Date): number`; `<DensityBadge level={…} />`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/components/density-badge/format.test.ts
import { describe, expect, it } from 'vitest'
import type { StationDensity } from '@commute/schemas'
import { currentHourLevel, densityHour, densityLabel } from './format'

const density = (day: StationDensity['day']): StationDensity => ({
  day,
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, level: hour === 0 ? 'PADAT' : hour === 18 ? 'SANGAT_PADAT' : null }))
})

describe('densityLabel', () => {
  it('speaks in the typically register, with no trailing period or em dash', () => {
    expect(densityLabel('LENGANG')).toBe('Biasanya lengang jam segini')
    expect(densityLabel('PADAT')).toBe('Biasanya padat jam segini')
    expect(densityLabel('SANGAT_PADAT')).toBe('Biasanya sangat padat jam segini')
    for (const l of ['LENGANG', 'PADAT', 'SANGAT_PADAT'] as const) {
      expect(densityLabel(l)).not.toMatch(/[.—]$|—/)
    }
  })

  it('renders nothing for a null level', () => {
    expect(densityLabel(null)).toBeNull()
  })
})

describe('currentHourLevel', () => {
  it('reads the current clock hour', () => {
    expect(currentHourLevel(density('WD'), new Date(2026, 9, 7, 18, 30))).toBe('SANGAT_PADAT')
  })

  it('uses the service day across midnight: 00:30 Saturday reads the board the page fetched for Friday', () => {
    // station-content fetches ?day=serviceDayOf(now), which is WD at 00:30 Sat; hour stays 0.
    expect(densityHour(new Date(2026, 9, 10, 0, 30))).toBe(0)
    expect(currentHourLevel(density('WD'), new Date(2026, 9, 10, 0, 30))).toBe('PADAT')
  })

  it('is null while loading', () => {
    expect(currentHourLevel(undefined, new Date())).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm --filter @commute/web exec vitest run app/components/density-badge/format.test.ts`

Expected: FAIL, `Cannot find module './format'`.

- [ ] **Step 3: Implement format.ts**

```ts
// apps/web/app/components/density-badge/format.ts
import type { StationDensity } from '@commute/schemas'

type Level = StationDensity['hours'][number]['level']

/*
 * The badge is a forecast, so the copy says "biasanya" every time. The failure
 * we're avoiding is a rider trusting a green badge onto a packed platform: an
 * honestly labelled estimate survives being wrong, a fake live one doesn't.
 */
const LABELS: Record<NonNullable<Level>, string> = {
  LENGANG: 'Biasanya lengang jam segini',
  PADAT: 'Biasanya padat jam segini',
  SANGAT_PADAT: 'Biasanya sangat padat jam segini'
}

export function densityLabel(level: Level): string | null {
  return level ? LABELS[level] : null
}

/** Clock hour on the device (the app already assumes WIB, like serviceDayOf). */
export function densityHour(now: Date): number {
  return now.getHours()
}

/*
 * The level for right now. The page fetches ?day=serviceDayOf(now), so after
 * midnight it already holds the previous service day's board; only the clock
 * hour is read here.
 */
export function currentHourLevel(density: StationDensity | undefined, now: Date): Level {
  return density?.hours[densityHour(now)]?.level ?? null
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @commute/web exec vitest run app/components/density-badge/format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Choose the badge look with the user (scratchpad variants workflow)**

Per memory `scratchpad-variants-workflow.md`, put 2–3 labelled variants of the badge on the temporary `/scratchpad` route: a status pill (green/amber/red dot + label), a three-segment meter + label, and plain text with a coloured dot. Screenshot them in both themes using the xvfb recipe from `map-webgl-testing.md` (web dev server :5174; check for the user's running dev server first). **Stop and let the user pick.** Constraints for every variant:
- status colours (green / amber / red), never line colours, so it never clashes with a `LineRoundel`
- the label is always visible, so identity never rests on colour alone
- no "live" wording

- [ ] **Step 6: Implement the picked variant** in `apps/web/app/components/density-badge/index.tsx` as `export default function DensityBadge({ level }: { level: Level })`. It returns `null` when `densityLabel(level)` is null. Delete the scratchpad route afterwards.

- [ ] **Step 7: Wire into station-content.tsx**

Next to `headwayUrl` (~line 219):

```tsx
  /*
   * Rail only: the density model has no TransJakarta estimate (no usable
   * departures per hour), so TJ pages skip the request entirely.
   */
  const densityUrl = useMemo(() =>
    operator !== 'TJ'
      ? new URL(`/stations/${operator}/${code}/density?day=${day}`, import.meta.env.VITE_API_BASE_URL).href
      : null,
  [operator, code, day]
  )
```

After the `headway` SWR line:

```tsx
  const density = useSWR<StandardResponse<StationDensity>>(unserved ? null : densityUrl, fetcher, swrConfig)
```

In the rail branch, directly above `<div className="flex flex-row gap-2">{otwButton}…`:

```tsx
              <DensityBadge level={currentHourLevel(density.data?.data, new Date())} />
```

Add the imports: `DensityBadge` from `~/components/density-badge`, `currentHourLevel` from `~/components/density-badge/format`, `type { StationDensity }` from `@commute/schemas`.

- [ ] **Step 8: Verify in the running app**

Start or reuse the web dev server (:5174) against a local API (`pnpm --filter @commute/api dev`). Open `/stations/KCI/MRI`, `/stations/KCI/SUD`, `/stations/KCI/BOO` and one TJ halte. Expected:
- rail pages show a badge whose label matches `DENSITY_LEVELS` for the current hour, or no badge if the hour is null
- the TJ page shows no badge and makes no `/density` request (check the network tab)

Screenshot all four and show the user.

- [ ] **Step 9: Run web tests and typecheck**

Run: `pnpm --filter @commute/web exec vitest run && pnpm --filter @commute/web exec tsc --noEmit`
Expected: PASS, no new type errors.

- [ ] **Step 10: Checkpoint.** Show the screenshots and the diff. Do not commit. Remind the user of `generate:density -- --remote` plus an `API_VERSION` bump before shipping.

---

## Out of scope (separate plans)

See `docs/station-density-roadmap.md` for every later phase and its plan:
- KCI weekend boards: `docs/kci-weekend-boards-plan.md`
- Android: deferred until `feature/android-app` is rebased (roadmap has the outline)
- Calendar day types: `docs/station-density-calendar-plan.md`
- Per-train load: `docs/train-load-plan.md`
- TransJakarta: blocked, see the roadmap
