# Per-Train Load (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "can I get on?" by showing, against the next departure on each line row of a rail station page, how full that train typically is when it leaves this station.

**Architecture:** A second generator walks every timetabled trip in `TRIP_PATTERNS`. At each stop:
1. Riders get off in proportion to where they're likely going (an alighting curve, the commuter mirror of Phase 1's boarding curve).
2. Riders get on: the station's boardings for that hour, split inbound vs outbound by station role, and divided among the departures in that direction.

Loads are averaged per (station, line, headsign, day, hour) and quantised to Lengang / Padat / Sangat Padat against train capacity. A new endpoint serves them. The web `LineCard` shows the level under the next departure. All model maths is pure and reuses Phase 1's `density/` modules.

**Tech Stack:** As Phase 1.

**Spec:** `docs/station-density.md` → "Station roles" (commuter mirror: business stations alight 80–88% before noon), "Revised model", and the roadmap's Phase 2 description. **Requires Phase 1** (`docs/station-density-plan.md`). It works without the calendar plan. With KCI weekend boards (`docs/kci-weekend-boards-plan.md`), weekend levels get better.

## Global Constraints

- Everything in Phase 1's Global Constraints applies.
- **Coverage is honest.** Only trips in `TRIP_PATTERNS` (timetabled, chained) contribute. A (station, line, headsign, hour) with no such trip has **no level**, never a guess.
- **Day buckets WD/SAT/SUN only.** Calendar variants are a later extension (same `VARIANT_BASE` idea).
- Train-load copy talks about **the train**, platform copy about **the station**, and both stay in the "biasanya" register.

## Review Focus

1. **The last stop of a trip.** Nobody boards there and everyone gets off, so the board must never show a level for a departure that terminates here. Pinned in Task 3 (`no boarding at the last stop`).
2. **Terminus headsigns that aren't station names** (`Bandara Soekarno-Hatta`, `Terminal 3`): the join is on headsign text exactly as the board shows it, so it must not be normalised differently on either side. Pinned in Task 5.
3. **A loop line** (Cikarang loop via Kampung Bandan / Angke) where "toward the core" flips mid-trip. Direction is judged **per stop** from ride time to the next stop, never once per trip. Pinned in Task 2.
4. **Departures with no pattern trip** (KCI chain gaps, ~22% of trips): the row shows nothing rather than borrowing a neighbour hour's level. Pinned in Task 3 (`hours without trips stay empty`).
5. **The LineCard's next departure crossing midnight** (00:10 on a board fetched for the previous service day): the hour used is the departure's clock hour on the board the page fetched. Pinned in Task 6.

---

### Task 1: Shared input loading

**Files:**
- Create: `apps/api/src/db/scripts/density/inputs.ts`
- Modify: `apps/api/src/db/scripts/generateDensity.ts`

**Interfaces:**
- Produces: `type D1 = (sql: string) => Record<string, string | number | null>[]`; `makeD1(remote: boolean): D1`; `loadStationInputs(d1: D1): StationInput[]` (exactly what `generateDensity` builds today); `loadServiceDepartures(d1: D1): Map<string, Record<DayBucket, number[]>>` keyed `stationId|line|boundFor`.

- [ ] **Step 1:** Move the `d1` helper, the two queries and the `StationInput` assembly out of `generateDensity.ts` into `inputs.ts` as the functions above, unchanged. `generateDensity.ts` becomes `const d1 = makeD1(!LOCAL)` plus `loadStationInputs(d1)` plus the existing output loop.

- [ ] **Step 2:** Add the per-service departures query to `inputs.ts`:

```ts
export function loadServiceDepartures(d1: D1): Map<string, Record<DayBucket, number[]>> {
  const rows = d1(`SELECT stationId, lineCode, boundFor, dayMask, CAST(substr(estimatedDeparture, 1, 2) AS INTEGER) AS h, COUNT(*) AS n
    FROM schedules WHERE lineCode != 'NUL' GROUP BY stationId, lineCode, boundFor, dayMask, h`)
  const out = new Map<string, Record<DayBucket, number[]>>()
  for (const r of rows) {
    const key = `${r.stationId}|${r.lineCode}|${r.boundFor}`
    if (!out.has(key)) out.set(key, { WD: new Array(24).fill(0), SAT: new Array(24).fill(0), SUN: new Array(24).fill(0) })
    for (const day of ['WD', 'SAT', 'SUN'] as const) {
      if (Number(r.dayMask) & DAY_BIT[day]) out.get(key)![day][Number(r.h) % 24] += Number(r.n)
    }
  }
  return out
}
```

(`DAY_BIT` moves to `inputs.ts` with the rest.)

- [ ] **Step 3: Prove no behaviour change**

Run: `cp apps/api/src/db/data/density.ts /tmp/density.before.ts && pnpm --filter @commute/api generate:density && diff /tmp/density.before.ts apps/api/src/db/data/density.ts`
Expected: no diff. Then `pnpm --filter @commute/api exec vitest run src/db` passes.

- [ ] **Step 4: Checkpoint.** Do not commit.

---

### Task 2: Flows: alighting curve and direction

**Files:**
- Modify: `apps/api/src/db/scripts/density/model.ts` (add `alightingCurve`)
- Create: `apps/api/src/db/scripts/train-load/flows.ts`
- Test: `apps/api/src/db/scripts/train-load/flows.test.ts`

**Interfaces:**
- Consumes: Phase 1 `stationCurve`, `boardingsPerDay`, `StationInput`, `roleWeight`, `amShareFor`, `dayLevel`.
- Produces: `alightingCurve(input: StationInput, day: DayBucket): Curve`; `inboundShare(b: number, hour: number): number`; `isInbound(rideNow: number | undefined, rideNext: number | undefined): boolean | undefined`; `stationHourly(input, day): { board: number[], alight: number[] }` (riders per hour).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/db/scripts/train-load/flows.test.ts
import { describe, expect, it } from 'vitest'
import { alightingCurve, stationCurve, type StationInput } from '../density/model'
import { inboundShare, isInbound, stationHourly } from './flows'

const flat = (n: number) => Array.from({ length: 24 }, (_, h) => h >= 5 && h < 23 ? n : 0)
const station = (over: Partial<StationInput> = {}): StationInput => ({
  stationId: 'KCI-XXX', operator: 'KCI', score: 70, rideMin: 0,
  departures: { WD: flat(20), SAT: flat(18), SUN: flat(18) }, ...over
})
const before13 = (c: number[]) => c.slice(0, 13).reduce((a, b) => a + b, 0)

describe('alightingCurve (the commuter mirror)', () => {
  it('a business station alights mostly in the morning: Sudirman Baru 80–88% before noon', () => {
    const am = before13(alightingCurve(station({ rideMin: 0 }), 'WD'))
    expect(am).toBeGreaterThan(0.7)
    expect(am).toBeLessThan(0.9)
  })

  it('mirrors the boarding share before 13:00', () => {
    const s = station({ rideMin: 60 })
    expect(before13(alightingCurve(s, 'WD'))).toBeCloseTo(1 - before13(stationCurve(s, 'WD')), 3)
  })
})

describe('inboundShare', () => {
  it('sends origins in toward the core in the morning and business stations out in the evening', () => {
    expect(inboundShare(0.05, 7)).toBeGreaterThan(0.8)
    expect(inboundShare(0.85, 18)).toBeLessThan(0.2)
  })
})

describe('isInbound', () => {
  it('is judged per stop from ride time to the next stop, so a loop flips mid-trip', () => {
    expect(isInbound(40, 35)).toBe(true)
    expect(isInbound(5, 10)).toBe(false)
    expect(isInbound(undefined, 10)).toBeUndefined()
  })
})

describe('stationHourly', () => {
  it('boards and alights the same daily total', () => {
    const { board, alight } = stationHourly(station(), 'WD')
    const sum = (c: number[]) => c.reduce((a, b) => a + b, 0)
    expect(sum(board)).toBeCloseTo(sum(alight), 3)
  })
})
```

- [ ] **Step 2: Run and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/train-load/flows.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

In `density/model.ts`:

```ts
/*
 * When a station's riders ARRIVE: the commuter mirror of stationCurve. Whoever
 * boards in the morning at an origin alights in the morning at a destination, so
 * the alighting share before 13:00 is 1 − the boarding share. That puts Sudirman
 * at ~78% before 13:00, against Sudirman Baru's measured 80–88% before noon.
 */
export function alightingCurve(input: StationInput, day: DayBucket): Curve {
  const b = roleWeight(input.stationId, day, input.rideMin)
  return withAmShare(baseCurve(input.operator), 1 - amShareFor(b, day))
}
```

```ts
// apps/api/src/db/scripts/train-load/flows.ts
import { alightingCurve, boardingsPerDay, stationCurve, type StationInput } from '../density/model'
import { type DayBucket, dayLevel, roleWeight } from '../density/roles'

/*
 * Of a station's boardings at `hour`, the share heading IN toward the core.
 * Morning: origins (b≈0) send ~90% in, business stations about half. Evening:
 * business stations (b≈0.85) send ~84% OUT, home. Linear in b; the two ends
 * are the spec's commuter mirror.
 */
export function inboundShare(b: number, hour: number): number {
  return hour < 13 ? 0.9 - 0.5 * b : 0.5 - 0.4 * b
}

/** Heading in when the next stop is closer to the core. Undefined when either ride time is unknown. */
export function isInbound(rideNow: number | undefined, rideNext: number | undefined): boolean | undefined {
  if (rideNow === undefined || rideNext === undefined) return undefined
  return rideNext < rideNow
}

/** Riders per hour boarding and alighting at a station: same daily total, mirrored timing. */
export function stationHourly(input: StationInput, day: DayBucket): { board: number[], alight: number[] } {
  const b = roleWeight(input.stationId, day, input.rideMin)
  const daily = boardingsPerDay(input.anchor, input.score) * dayLevel(b, day)
  return {
    board: stationCurve(input, day).map(x => x * daily),
    alight: alightingCurve(input, day).map(x => x * daily)
  }
}
```

- [ ] **Step 4: Run and verify they pass** (and Phase 1's `density/` tests still pass), then **Checkpoint**.

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/train-load src/db/scripts/density`
Expected: PASS.

---

### Task 3: Walking a trip

**Files:**
- Create: `apps/api/src/db/scripts/train-load/walk.ts`
- Test: `apps/api/src/db/scripts/train-load/walk.test.ts`

**Interfaces:**
- Produces:
  - `interface WalkContext { hourly: Map<string, { board: number[], alight: number[] }>, rideMin: Map<string, number>, inboundDeps: (stationId: string, hour: number, inbound: boolean | undefined) => number, roleB: (stationId: string) => number }`
  - `walkTrip(stations: string[], times: number[], ctx: WalkContext): { stationId: string, hour: number, load: number }[]`: riders on board when leaving each stop, last stop excluded.
  - `LOAD_THRESHOLDS: readonly [number, number]`
  - `aggregate(samples: { key: string, hour: number, fraction: number }[]): Map<string, string>` (24-char 0–3 strings)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/db/scripts/train-load/walk.test.ts
import { describe, expect, it } from 'vitest'
import { aggregate, walkTrip, type WalkContext } from './walk'

const hours = (v: number) => new Array(24).fill(v)
const ctx = (over: Partial<WalkContext> = {}): WalkContext => ({
  hourly: new Map([
    ['A', { board: hours(1000), alight: hours(10) }],    // origin: many board, few alight
    ['B', { board: hours(100), alight: hours(100) }],
    ['C', { board: hours(10), alight: hours(1000) }]     // destination
  ]),
  rideMin: new Map([['A', 60], ['B', 30], ['C', 0]]),
  inboundDeps: () => 10,
  roleB: () => 0.05,
  ...over
})

describe('walkTrip', () => {
  it('fills from the origin and records the load leaving each stop', () => {
    const out = walkTrip(['A', 'B', 'C'], [7 * 3600, 7 * 3600 + 1800, 8 * 3600], ctx())
    expect(out.map(o => o.stationId)).toEqual(['A', 'B'])
    expect(out[1].load).toBeGreaterThan(out[0].load * 0.9) // little alights at B, more boards
  })

  it('no boarding at the last stop: it is never in the output', () => {
    expect(walkTrip(['A', 'C'], [0, 600], ctx()).some(o => o.stationId === 'C')).toBe(false)
  })

  it('never goes negative and empties toward a strong destination', () => {
    const out = walkTrip(['A', 'B', 'C'], [0, 600, 1200], ctx())
    out.forEach(o => expect(o.load).toBeGreaterThanOrEqual(0))
  })

  it('splits by direction: an outbound trip from an origin in the morning carries little', () => {
    const inbound = walkTrip(['A', 'B'], [7 * 3600, 7 * 3600 + 600], ctx())[0].load
    const outbound = walkTrip(['B', 'A'], [7 * 3600, 7 * 3600 + 600], ctx({ hourly: new Map([
      ['B', { board: hours(1000), alight: hours(10) }], ['A', { board: hours(10), alight: hours(1000) }]
    ]) }))[0].load
    expect(outbound).toBeLessThan(inbound)
  })
})

describe('aggregate', () => {
  it('averages per key and hour, quantises, and leaves hours without trips empty', () => {
    const out = aggregate([
      { key: 'S|B|Bogor', hour: 7, fraction: 0.95 },
      { key: 'S|B|Bogor', hour: 7, fraction: 0.85 },
      { key: 'S|B|Bogor', hour: 12, fraction: 0.2 }
    ])
    const levels = out.get('S|B|Bogor')!
    expect(levels[7]).toBe('3')
    expect(levels[12]).toBe('1')
    expect(levels[13]).toBe('0')
  })
})
```

- [ ] **Step 2: Run and verify they fail**

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/train-load/walk.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/db/scripts/train-load/walk.ts
import { inboundShare, isInbound } from './flows'

export interface WalkContext {
  hourly: Map<string, { board: number[], alight: number[] }>
  rideMin: Map<string, number>
  /** Departures at a station in an hour in one direction (undefined = direction unknown). */
  inboundDeps: (stationId: string, hour: number, inbound: boolean | undefined) => number
  roleB: (stationId: string) => number
}

const hourOf = (s: number) => Math.floor(s / 3600) % 24

/*
 * Riders on board leaving each stop of one trip. At stop k: riders whose
 * destination is k get off (k's share of the alighting pull of every stop from k
 * on), then k's boardings for this direction and hour, divided by that
 * direction's departures, get on. The last stop only alights.
 */
export function walkTrip(stations: string[], times: number[], ctx: WalkContext) {
  const out: { stationId: string, hour: number, load: number }[] = []
  const pull = stations.map((s, k) => ctx.hourly.get(s)?.alight[hourOf(times[k])] ?? 0)
  let load = 0
  for (let k = 0; k < stations.length; k++) {
    const remaining = pull.slice(k).reduce((a, b) => a + b, 0)
    const alightFraction = k === stations.length - 1 ? 1 : remaining > 0 ? pull[k] / remaining : 0
    load -= load * alightFraction
    if (k === stations.length - 1) break
    const s = stations[k], h = hourOf(times[k])
    const inbound = isInbound(ctx.rideMin.get(s), ctx.rideMin.get(stations[k + 1]))
    const boardHour = ctx.hourly.get(s)?.board[h] ?? 0
    const share = inbound === undefined ? 0.5 : inbound ? inboundShare(ctx.roleB(s), h) : 1 - inboundShare(ctx.roleB(s), h)
    const deps = Math.max(1, ctx.inboundDeps(s, h, inbound))
    load += boardHour * share / deps
    out.push({ stationId: s, hour: h, load: Math.max(0, load) })
  }
  return out
}

/*
 * Load as a fraction of one train's crush capacity: under the first threshold is
 * Lengang (seats or easy standing), under the second Padat, otherwise Sangat Padat.
 * Initial values; tuned in Task 4 against KCI's 2025 dynamic occupancy (42.82%).
 */
export const LOAD_THRESHOLDS = [0.45, 0.8] as const

export function aggregate(samples: { key: string, hour: number, fraction: number }[]): Map<string, string> {
  const acc = new Map<string, { sum: number[], n: number[] }>()
  for (const { key, hour, fraction } of samples) {
    if (!acc.has(key)) acc.set(key, { sum: new Array(24).fill(0), n: new Array(24).fill(0) })
    acc.get(key)!.sum[hour] += fraction
    acc.get(key)!.n[hour] += 1
  }
  const out = new Map<string, string>()
  for (const [key, { sum, n }] of acc) {
    out.set(key, sum.map((s, h) => {
      if (n[h] === 0) return '0'
      const f = s / n[h]
      return f < LOAD_THRESHOLDS[0] ? '1' : f < LOAD_THRESHOLDS[1] ? '2' : '3'
    }).join(''))
  }
  return out
}
```

- [ ] **Step 4: Run and verify they pass**, then **Checkpoint**.

Run: `pnpm --filter @commute/api exec vitest run src/db/scripts/train-load/walk.test.ts`
Expected: PASS (5 tests).

---

### Task 4: Generator, generated data, calibration

**Files:**
- Create: `apps/api/src/db/scripts/generateTrainLoad.ts`
- Create (generated): `apps/api/src/db/data/train-load.ts`
- Create: `apps/api/src/db/data/train-load.calibration.test.ts`
- Modify: `apps/api/package.json` (`"generate:train-load": "tsx ./src/db/scripts/generateTrainLoad.ts"`)

**Interfaces:**
- Consumes: Tasks 1–3, `TRIP_PATTERNS`, `rideMinutesToCore`, `CAPACITY`.
- Produces: `TRAIN_LOAD_LEVELS: Record<string, Partial<Record<DayBucket, string>>>` keyed `stationId|lineCode|boundFor`.

- [ ] **Step 1: Write the generator**

```ts
// apps/api/src/db/scripts/generateTrainLoad.ts
import * as fs from 'node:fs'
import { TRIP_PATTERNS } from '../data/trips'
import { rideMinutesToCore } from './density/ride-time'
import { CAPACITY } from './density/model'
import { type DayBucket, roleWeight } from './density/roles'
import { loadServiceDepartures, loadStationInputs, makeD1 } from './density/inputs'
import { isInbound, stationHourly } from './train-load/flows'
import { aggregate, walkTrip } from './train-load/walk'

/*
 * Generates db/data/train-load.ts: how full a train typically is when it leaves
 * a station, per (station, line, headsign, day, hour). Only trips in
 * TRIP_PATTERNS contribute; everything else stays '0'. Model: ./train-load/,
 * rationale: docs/train-load-plan.md.
 *   pnpm --filter api generate:train-load -- --remote
 */
const OUTPUT = `${__dirname}/../data/train-load.ts`
const DAYS: DayBucket[] = ['WD', 'SAT', 'SUN']
const DAY_BIT: Record<DayBucket, number> = { WD: 0b100, SAT: 0b010, SUN: 0b001 }

function main() {
  const d1 = makeD1(process.argv.includes('--remote'))
  const inputs = new Map(loadStationInputs(d1).map(i => [i.stationId, i]))
  const services = loadServiceDepartures(d1)
  const ride = rideMinutesToCore(TRIP_PATTERNS)

  // Direction of each (station, line, headsign), from the patterns that serve it.
  const direction = new Map<string, boolean | undefined>()
  for (const p of TRIP_PATTERNS) {
    p.trips.forEach(t => p.stations.forEach((s, k) => {
      if (k < p.stations.length - 1) direction.set(`${s}|${p.line}|${t.f}`, isInbound(ride.get(s), ride.get(p.stations[k + 1])))
    }))
  }

  const perDay = new Map<string, Partial<Record<DayBucket, string>>>()
  for (const day of DAYS) {
    const hourly = new Map([...inputs].map(([id, i]) => [id, stationHourly(i, day)]))
    const deps = new Map<string, number>() // `${station}|${hour}|${in|out|?}`
    for (const [key, byDay] of services) {
      const [station, line, boundFor] = key.split('|')
      const dir = direction.get(`${station}|${line}|${boundFor}`)
      byDay[day].forEach((n, h) => {
        const k = `${station}|${h}|${dir === undefined ? '?' : dir ? 'in' : 'out'}`
        deps.set(k, (deps.get(k) ?? 0) + n)
      })
    }
    const ctx = {
      hourly,
      rideMin: ride,
      roleB: (s: string) => roleWeight(s, day, ride.get(s)),
      inboundDeps: (s: string, h: number, inbound: boolean | undefined) =>
        deps.get(`${s}|${h}|${inbound === undefined ? '?' : inbound ? 'in' : 'out'}`) ?? 0
    }
    const samples: { key: string, hour: number, fraction: number }[] = []
    for (const p of TRIP_PATTERNS) {
      for (const t of p.trips) {
        if (!(t.d & DAY_BIT[day])) continue
        for (const { stationId, hour, load } of walkTrip(p.stations, t.s, ctx)) {
          const op = inputs.get(stationId)?.operator
          if (!op) continue
          samples.push({ key: `${stationId}|${p.line}|${t.f}`, hour, fraction: load / CAPACITY[op] })
        }
      }
    }
    for (const [key, levels] of aggregate(samples)) {
      if (!/[1-3]/.test(levels)) continue
      perDay.set(key, { ...perDay.get(key), [day]: levels })
    }
  }

  const lines = [...perDay].sort(([a], [b]) => a.localeCompare(b)).map(([key, days]) =>
    `  ${JSON.stringify(key)}: { ${Object.entries(days).map(([d, l]) => `${d}: '${l}'`).join(', ')} },`)
  fs.writeFileSync(OUTPUT, `/*
 * Typical train load when leaving a station, per (station|line|headsign), day and hour.
 *
 * GENERATED — do not edit by hand; re-run \`pnpm --filter api generate:train-load -- --remote\`.
 *
 * 24 digits per day, index = hour: 0 no estimate (no timetabled trip that hour),
 * 1 Lengang, 2 Padat, 3 Sangat Padat. A modelled ESTIMATE, never a live reading.
 */
export const TRAIN_LOAD_LEVELS: Record<string, Partial<Record<'WD' | 'SAT' | 'SUN', string>>> = {
${lines.join('\n')}
}
`)
  console.log(`wrote ${lines.length} services`)
}

main()
```

- [ ] **Step 2: Generate**

Run: `pnpm --filter @commute/api generate:train-load`
Expected: `wrote N services`, N in the hundreds.

- [ ] **Step 3: Write the calibration test** (tune `LOAD_THRESHOLDS` or the `inboundShare` coefficients, never the expectations)

```ts
// apps/api/src/db/data/train-load.calibration.test.ts
import { describe, expect, it } from 'vitest'
import { TRAIN_LOAD_LEVELS } from './train-load'

const level = (key: string, day: 'WD' | 'SAT' | 'SUN', h: number) => Number(TRAIN_LOAD_LEVELS[key]?.[day]?.[h] ?? 0)
const find = (prefix: string, headsign: string) =>
  Object.keys(TRAIN_LOAD_LEVELS).find(k => k.startsWith(prefix) && k.endsWith(`|${headsign}`))!

describe('train load calibration', () => {
  it('Bogor-line trains heading into Jakarta are packed by the inner stations in the morning', () => {
    const k = find('KCI-POC|B', 'Jakarta Kota') // Pondok Cina; any inner Bogor-line station on the B pattern works
    expect(level(k, 'WD', 7)).toBe(3)
  })

  it('the same service is not packed at midday', () => {
    expect(level(find('KCI-POC|B', 'Jakarta Kota'), 'WD', 12)).toBeLessThan(3)
  })

  it('trains leaving Manggarai toward Bogor are packed in the evening', () => {
    expect(level(find('KCI-MRI|B', 'Bogor'), 'WD', 18)).toBe(3)
  })

  it('not every departure is packed: under a third of weekday service-hours are level 3', () => {
    const all = Object.values(TRAIN_LOAD_LEVELS).flatMap(d => (d.WD ?? '').split('')).filter(c => c !== '0')
    expect(all.filter(c => c === '3').length / all.length).toBeLessThan(0.33)
  })
})
```

If `KCI-POC` isn't on a B pattern with headsign `Jakarta Kota`, list the keys (`grep "KCI-.*|B|Jakarta Kota" apps/api/src/db/data/train-load.ts`) and pick the innermost Bogor-line station south of Manggarai that has one. Note the substitution in the test comment.

Separately, as a sanity check (printed, not asserted): the mean `fraction` over all weekday samples. Add a `console.log` behind `--stats` in the generator. Expect it to sit near KCI's **42.82% dynamic occupancy** (2025 annual report). Far below 0.25 or above 0.6 means the boarding volumes are off, and the anchors and `boardingsPerDay` need a look before the thresholds do.

- [ ] **Step 4: Run, tune, and run the whole API suite**

Run: `pnpm --filter @commute/api exec vitest run src/db/data/train-load.calibration.test.ts && pnpm --filter @commute/api test`
Expected: PASS.

- [ ] **Step 5: Checkpoint.** Show the `--stats` mean and a few keys. Do not commit.

---

### Task 5: API endpoint

**Files:**
- Modify: `apps/schemas/src/station.ts`, `apps/api/src/routes/stations.ts`
- Test: `apps/api/src/routes/stations.train-load.test.ts`

**Interfaces:**
- Produces: `TrainLoadSchema` / `type TrainLoad = { day: 'WD' | 'SAT' | 'SUN', services: { line: string, boundFor: string, hours: (DensityLevel | null)[] }[] }` (named via `v.title` + `v.metadata({ ref: 'TrainLoad' })`, reusing `DensityLevelSchema`); `GET /stations/:operator/:stationCode/train-load?day=`.

- [ ] **Step 1: Write the failing tests**, copying the D1 mock, `get` helper and `STATION` fixture from `stations.density.test.ts`, with:

```ts
vi.mock('db/data/train-load', () => ({
  TRAIN_LOAD_LEVELS: {
    'KCI-MRI|B|Bogor': { WD: '000001233322223333221000' },
    'KCI-MRI|A|Bandara Soekarno-Hatta': { WD: '000001111111111111110000' },
    'KCI-THB|R|Rangkasbitung': { WD: '000003333333333333333000' }
  }
}))

describe('GET /stations/:operator/:code/train-load', () => {
  it('returns only this station\'s services, headsigns verbatim, hours as named levels', async () => {
    const res = await get('/stations/KCI/MRI/train-load?day=WD', STATION)
    const body = await res.json() as { data: { services: { line: string, boundFor: string, hours: (string | null)[] }[] } }
    expect(body.data.services.map(s => s.boundFor).sort()).toEqual(['Bandara Soekarno-Hatta', 'Bogor'])
    const bogor = body.data.services.find(s => s.boundFor === 'Bogor')!
    expect(bogor.line).toBe('KCI:B')
    expect(bogor.hours[7]).toBe('SANGAT_PADAT')
    expect(bogor.hours[3]).toBeNull()
  })

  it('answers an empty list for a known station without data', async () => {
    const res = await get('/stations/KCI/MRI/train-load?day=SUN', STATION)
    expect((await res.json() as { data: { services: unknown[] } }).data.services).toEqual([])
  })

  it('404s an unknown station', async () => {
    expect((await get('/stations/KCI/NOPE/train-load', undefined)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run and verify they fail.** Run: `pnpm --filter @commute/api exec vitest run src/routes/stations.train-load.test.ts`. Expected: 404 on the new path.

- [ ] **Step 3: Implement.** The schema mirrors `StationDensitySchema`, with a `services` array of `{ line, boundFor, hours: v.array(v.nullable(DensityLevelSchema)) }`. Descriptions in Indonesian: `'Seberapa penuh keretanya BIASANYA waktu berangkat dari stasiun ini, per lin dan tujuan, per jam. Perkiraan dari jadwal dan pola penumpang, BUKAN kondisi live.'` The route copies the density route's operator/station checks, then:

```ts
    const prefix = `${stationID}|`
    const services = Object.entries(TRAIN_LOAD_LEVELS)
      .filter(([key, days]) => key.startsWith(prefix) && days[day])
      .map(([key, days]) => {
        const [, lineCode, boundFor] = key.split('|')
        return {
          line: `${operator.code}:${lineCode}`,
          boundFor,
          hours: [...days[day]!].map(d => LEVEL_NAMES[Number(d) as 1 | 2 | 3] ?? null)
        }
      })
    return c.json(Ok({ day, services }), 200)
```

(`LEVEL_NAMES` is the Phase 1 constant in the same file.) Line keys use `OPERATOR:CODE`, the format the web's `useLines` resolves.

- [ ] **Step 4: Run and verify they pass** (plus `openapi.test.ts`), then **Checkpoint**.

---

### Task 6: Web: the next train's level on each line row

**Files:**
- Create: `apps/web/app/components/line-card/train-load.ts`
- Test: `apps/web/app/components/line-card/train-load.test.ts`
- Modify: `apps/web/app/components/line-card/index.tsx` (new optional prop; the destination row ~line 309)
- Modify: `apps/web/app/components/station-content.tsx` (fetch, pass to `LineCard` ~line 330)

**Interfaces:**
- Consumes: `TrainLoad` from `@commute/schemas`; the Phase 1 `DensityBadge` component (compact use).
- Produces: `trainLoadIndex(load: TrainLoad | undefined): Map<string, TrainLoad['services'][number]['hours']>` keyed `${line}|${boundFor}`; `trainLevelAt(index, line, boundFor, departure: Date)`; `trainLoadLabel(level): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/components/line-card/train-load.test.ts
import { describe, expect, it } from 'vitest'
import type { TrainLoad } from '@commute/schemas'
import { trainLevelAt, trainLoadIndex, trainLoadLabel } from './train-load'

const load: TrainLoad = { day: 'WD', services: [
  { line: 'KCI:B', boundFor: 'Bogor', hours: Array.from({ length: 24 }, (_, h) => h === 18 ? 'SANGAT_PADAT' : h === 0 ? 'LENGANG' : null) }
] }

describe('trainLevelAt', () => {
  it('reads the departure\'s clock hour for that line and headsign', () => {
    const index = trainLoadIndex(load)
    expect(trainLevelAt(index, 'KCI:B', 'Bogor', new Date(2026, 9, 7, 18, 5))).toBe('SANGAT_PADAT')
    expect(trainLevelAt(index, 'KCI:B', 'Depok', new Date(2026, 9, 7, 18, 5))).toBeNull()
  })

  it('uses the departure\'s own hour across midnight, on the board the page fetched', () => {
    expect(trainLevelAt(trainLoadIndex(load), 'KCI:B', 'Bogor', new Date(2026, 9, 8, 0, 10))).toBe('LENGANG')
  })
})

describe('trainLoadLabel', () => {
  it('talks about the train, in the typically register, no trailing period', () => {
    expect(trainLoadLabel('LENGANG')).toBe('Keretanya biasanya lega')
    expect(trainLoadLabel('PADAT')).toBe('Keretanya biasanya padat')
    expect(trainLoadLabel('SANGAT_PADAT')).toBe('Keretanya biasanya penuh')
    expect(trainLoadLabel(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and verify they fail.** Run: `pnpm --filter @commute/web exec vitest run app/components/line-card/train-load.test.ts`

- [ ] **Step 3: Implement**

```ts
// apps/web/app/components/line-card/train-load.ts
import type { TrainLoad } from '@commute/schemas'

type Hours = TrainLoad['services'][number]['hours']
type Level = Hours[number]

/*
 * The train, not the platform: Phase 1's badge says how crowded the STATION
 * usually is; this says how full the next train usually is when it leaves here.
 * Different nouns keep the two from being read as the same claim.
 */
const LABELS: Record<NonNullable<Level>, string> = {
  LENGANG: 'Keretanya biasanya lega',
  PADAT: 'Keretanya biasanya padat',
  SANGAT_PADAT: 'Keretanya biasanya penuh'
}

export const trainLoadLabel = (level: Level): string | null => level ? LABELS[level] : null

export function trainLoadIndex(load: TrainLoad | undefined): Map<string, Hours> {
  return new Map((load?.services ?? []).map(s => [`${s.line}|${s.boundFor}`, s.hours]))
}

export function trainLevelAt(index: Map<string, Hours>, line: string, boundFor: string, departure: Date): Level {
  return index.get(`${line}|${boundFor}`)?.[departure.getHours()] ?? null
}
```

Show the label copy to the user before wiring it in. Brand voice is casual Jakarta-commuter Indonesian (memory: `brand-voice.md`), and "penuh" vs "padat banget" is their call.

- [ ] **Step 4: Wire it in**

`station-content.tsx`: next to `densityUrl`, add `trainLoadUrl` (rail only, `?day=${day}`), fetch it with SWR, build `const trainLoad = useMemo(() => trainLoadIndex(trainLoadQuery.data?.data), [trainLoadQuery.data])`, and pass `trainLoad={trainLoad}` to every `<LineCard …/>`.

`line-card/index.tsx`: add the optional prop with a comment (`trainLoad?: Map<string, …>`, "station page only; the map sheet omits it"). In the destination row, under the time block, render:

```tsx
{trainLoad && (() => {
  const level = trainLevelAt(trainLoad, line.line, destination.boundFor, departure)
  const label = trainLoadLabel(level)
  return label ? <DensityBadge level={level} label={label} size="compact" /> : null
})()}
```

This needs Phase 1's `DensityBadge` to accept an optional `label` override and `size`. Extend it in this task (keep its default rendering unchanged and covered by Phase 1's tests). It shows for the row's **next** departure only. Check that `line.line` is already the `OPERATOR:CODE` key in `CompactLineTimetable`. If it's the bare code, build the key with the station's operator.

- [ ] **Step 5: Verify in the running app**

Open `/stations/KCI/MRI` and `/stations/KCI/POC` on the :5174 dev server (reuse the user's if running), against a local API. Expected:
- B-line rows show a train level under the next departure, and it matches `TRAIN_LOAD_LEVELS` for that hour
- rows whose headsign has no data show nothing
- the map station sheet (no `trainLoad` prop) is unchanged

Screenshot and show the user.

- [ ] **Step 6: Web tests + typecheck, then Checkpoint**

Run: `pnpm --filter @commute/web exec vitest run && pnpm --filter @commute/web exec tsc --noEmit`
Expected: PASS. Remind the user: `generate:train-load -- --remote` and an `API_VERSION` bump. Do not commit.
