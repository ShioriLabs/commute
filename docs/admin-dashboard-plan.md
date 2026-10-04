# Admin Dashboard (foundation + transfers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-rendered admin Worker where transfer walk distances get edited as drafts, published in one step, and picked up by the public API without a deploy.

**Architecture:** A new migration adds `transfer_overrides` + `publishes` and a `transfers_effective` view that layers published overrides over imported `transfers`. The public API reads the view, and folds a runtime `dataVersion` (KV `meta:dataVersion`, memoised 60s per isolate) into every KV cache key and into the router memo. `apps/admin` is one Hono Worker rendering Hono JSX, writing D1 with raw prepared statements, gated by Cloudflare Access JWT verification.

**Tech Stack:** Cloudflare Workers (+ static assets), D1, KV, Hono 4.12 (incl. `hono/jsx`), Tailwind 4 (`@tailwindcss/cli`) + clsx, jose (JWT/JWKS), Kysely (API side only), vitest 4 (vite 6 / esbuild), `node:sqlite` (Node 24 on this machine) for real-SQL tests.

**Spec:** `docs/admin-dashboard.md` (read it first; the "Corrections from planning" section there overrides earlier parts of the spec)

## Global Constraints

- Never run `wrangler deploy`, and never apply migrations with `--remote`. Local only. The user deploys.
- Never `git commit`. Leave every change uncommitted; the user commits.
- `distance = 0` means UNMEASURED. Admin must never write 0; reject it on save.
- Override key = transfer id `${fromStationId}->${toStationId}` (same as the seeds).
- KV key for the data version: `meta:dataVersion` (exported as `DATA_VERSION_KV_KEY` from `@commute/constants`).
- Cache version string = `${API_VERSION}.${dataVersion}`; dataVersion defaults to `'0'`.
- Admin UI copy: plain English. Admin is server-rendered with zero client JS (plain forms, POST → 303 redirect).
- Styling: Tailwind 4 utility classes inline in JSX (`class=`), `clsx` for conditional classes. Shared class recipes live in `apps/admin/src/views/ui.ts`. No hand-written CSS beyond `@import "tailwindcss"`.
- `apps/admin/wrangler.toml` sets `workers_dev = false` (the only way in is the Access-protected custom domain).
- Code style: single quotes, no semicolons, 2-space indent, no trailing commas (root eslint). The house comment style is "why" prose; don't narrate "what".
- node:sqlite rejects JS booleans as bind params: always bind `noTap` as `0`/`1`.

## Review Focus

1. **Editing an already-published override:** the live value must stay live until the next publish (the draft row is separate, PK `(id, status)`). Pinned in Task 1 (view ignores drafts when a published row exists) and Task 6 (`saveDraft` on a published id leaves the published row untouched).
2. **A KV failure while reading the data version:** the API must keep serving the last known version, not flap to `'0'` (which would rebuild the router and miss every KV key). Pinned in Task 2.
3. **The `localhost` auth bypass on a deployed host:** a request to the real hostname without the Access header must get 403. Pinned in Task 5 (`workers_dev = false` is in Task 4).
4. **Publish with zero drafts:** a no-op, with no empty publish row and no version bump (a bump would cold-start every KV key for nothing). Pinned in Task 6.
5. **"Apply to reverse" when the reverse transfer doesn't exist in the base table and no distance was given:** this must give a validation error, not a half-written pair. Pinned in Task 6.

---

### Task 1: Migration 0017: overrides, publishes, `transfers_effective` view

**Files:**
- Create: `apps/api/src/db/migrations/0017_add_transfer_overrides.sql`
- Create: `apps/api/src/db/migrations.test.ts`

**Interfaces:**
- Produces: tables `publishes(id TEXT PK, publishedAt, publishedBy, changeCount, summary)` and `transfer_overrides(id, status, op, fromStationId, toStationId, distance, noTap, notes, editedBy, updatedAt, publishId)` with PK `(id, status)`; view `transfers_effective` with exactly the columns of `transfers` (`id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt, noTap`).
- Semantics: only `status='published'` rows affect the view. `op='upsert'` with `distance NULL` keeps the base distance (lets notes-only annotations like "blocked: flyover demolition" exist). An `op='upsert'` with no base row ADDS an INTERNAL transfer. `op='delete'` hides the base row. `op='revert'` only exists as a draft.

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/migrations.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

/*
 * The view is SQL semantics, which a mocked Kysely `execute` cannot prove. So
 * this runs every real migration, in order, against an in-memory SQLite.
 */
const MIGRATIONS = path.resolve(__dirname, 'migrations')

function migratedDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

function station(db: DatabaseSync, id: string) {
  const [operator, code] = id.split('-')
  db.prepare(`INSERT INTO stations (id, name, code, region, regionCode, operator) VALUES (?, ?, ?, 'Jakarta', 'JAK', ?)`)
    .run(id, `Station ${code}`, code!, operator!)
}

function transfer(db: DatabaseSync, from: string, to: string, distance: number) {
  db.prepare(`INSERT INTO transfers (id, dataType, fromStationId, toStationId, distance) VALUES (?, 'INTERNAL', ?, ?, ?)`)
    .run(`${from}->${to}`, from, to, distance)
}

function override(db: DatabaseSync, row: { id: string, status: string, op: string, from: string, to: string, distance?: number | null, notes?: string | null }) {
  db.prepare(`INSERT INTO transfer_overrides (id, status, op, fromStationId, toStationId, distance, noTap, notes, editedBy) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'test')`)
    .run(row.id, row.status, row.op, row.from, row.to, row.distance ?? null, row.notes ?? null)
}

const effective = (db: DatabaseSync) =>
  db.prepare('SELECT id, distance, notes, dataType FROM transfers_effective ORDER BY id').all()

describe('transfers_effective', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = migratedDb()
    for (const id of ['KCI-AAA', 'KCI-BBB', 'TJ-CCC']) station(db, id)
    transfer(db, 'KCI-AAA', 'KCI-BBB', 0)
  })

  it('equals the base table when there are no overrides', () => {
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 0, notes: null, dataType: 'INTERNAL' }])
  })

  it('replaces the base distance with a published upsert', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 300 })
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 300, notes: null, dataType: 'INTERNAL' }])
  })

  it('keeps the base distance when a published upsert only annotates', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: null, notes: 'blocked: flyover' })
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 0, notes: 'blocked: flyover', dataType: 'INTERNAL' }])
  })

  it('ignores drafts, including a draft that sits on top of a published override', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 300 })
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'draft', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 999 })
    expect(effective(db)).toEqual([{ id: 'KCI-AAA->KCI-BBB', distance: 300, notes: null, dataType: 'INTERNAL' }])
  })

  it('adds a transfer that has no base row', () => {
    override(db, { id: 'KCI-BBB->TJ-CCC', status: 'published', op: 'upsert', from: 'KCI-BBB', to: 'TJ-CCC', distance: 530 })
    expect(effective(db)).toEqual([
      { id: 'KCI-AAA->KCI-BBB', distance: 0, notes: null, dataType: 'INTERNAL' },
      { id: 'KCI-BBB->TJ-CCC', distance: 530, notes: null, dataType: 'INTERNAL' }
    ])
  })

  it('hides a base row with a published delete', () => {
    override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'delete', from: 'KCI-AAA', to: 'KCI-BBB' })
    expect(effective(db)).toEqual([])
  })

  it('passes EXTERNAL rows through untouched', () => {
    db.prepare(`INSERT INTO transfers (id, dataType, fromStationId, toStationData, distance) VALUES ('KCI-AAA->EXT', 'EXTERNAL', 'KCI-AAA', '{"name":"X","operatorName":"Y"}', 120)`).run()
    expect(effective(db)).toContainEqual({ id: 'KCI-AAA->EXT', distance: 120, notes: null, dataType: 'EXTERNAL' })
  })

  it('rejects distance 0 and a published revert', () => {
    expect(() => override(db, { id: 'KCI-AAA->KCI-BBB', status: 'draft', op: 'upsert', from: 'KCI-AAA', to: 'KCI-BBB', distance: 0 })).toThrow()
    expect(() => override(db, { id: 'KCI-AAA->KCI-BBB', status: 'published', op: 'revert', from: 'KCI-AAA', to: 'KCI-BBB' })).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run src/db/migrations.test.ts`
Expected: FAIL with `no such table: transfer_overrides` (or `no such table: transfers_effective`). If an EARLIER migration fails to exec under node:sqlite, stop and report which one. Don't edit old migrations.

- [ ] **Step 3: Write the migration**

`apps/api/src/db/migrations/0017_add_transfer_overrides.sql`:

```sql
-- Migration number: 0017 	 2026-10-01T00:00:00.000Z

-- Human edits to transfers, layered over the imported rows instead of written
-- into them, so importers (generateTJSQL, the measured_transfers seeds) keep
-- owning `transfers` and can re-run without clobbering an edit. Written only
-- by apps/admin. Readers go through `transfers_effective`.

CREATE TABLE IF NOT EXISTS publishes (
  id TEXT PRIMARY KEY NOT NULL,
  publishedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publishedBy TEXT NOT NULL,
  changeCount INTEGER NOT NULL,
  summary TEXT NOT NULL
);

-- One live row and at most one pending row per transfer: PK (id, status).
-- Editing a published override writes a separate draft, so the live value
-- stays live until the next publish.
CREATE TABLE IF NOT EXISTS transfer_overrides (
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete', 'revert')),
  fromStationId VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  toStationId VARCHAR(32) NOT NULL REFERENCES stations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- NULL on an upsert keeps the imported distance (a notes-only edit). Never 0:
  -- 0 is the "unmeasured" sentinel and must stay an importer-side fact.
  distance INT NULL CHECK (distance IS NULL OR distance > 0),
  noTap BOOLEAN NOT NULL DEFAULT 0,
  notes TEXT NULL,
  editedBy TEXT NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publishId TEXT NULL REFERENCES publishes(id),

  PRIMARY KEY (id, status),
  -- 'revert' means "drop the published override on publish"; it is never live.
  CHECK (status = 'draft' OR op != 'revert')
);

CREATE VIEW IF NOT EXISTS transfers_effective AS
  SELECT
    t.id, t.dataType, t.fromStationId, t.toStationId, t.toStationData,
    COALESCE(o.distance, t.distance) AS distance,
    CASE WHEN o.id IS NULL THEN t.notes ELSE o.notes END AS notes,
    t.createdAt,
    COALESCE(o.updatedAt, t.updatedAt) AS updatedAt,
    CASE WHEN o.id IS NULL THEN t.noTap ELSE o.noTap END AS noTap
  FROM transfers t
  LEFT JOIN transfer_overrides o
    ON o.id = t.id AND o.status = 'published' AND o.op = 'upsert' AND t.dataType = 'INTERNAL'
  WHERE NOT EXISTS (
    SELECT 1 FROM transfer_overrides d
    WHERE d.id = t.id AND d.status = 'published' AND d.op = 'delete' AND t.dataType = 'INTERNAL'
  )
  UNION ALL
  SELECT
    o.id, 'INTERNAL', o.fromStationId, o.toStationId, NULL,
    o.distance, o.notes, o.updatedAt, o.updatedAt, o.noTap
  FROM transfer_overrides o
  WHERE o.status = 'published' AND o.op = 'upsert' AND o.distance IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.id = o.id);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/db/migrations.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Apply locally**

Run: `cd apps/api && npx wrangler d1 migrations apply commute --local`
Expected: `0017_add_transfer_overrides.sql` applied. (Local only. Never `--remote`.)

- [ ] **Step 6: Checkpoint.** No commit (user rule).

---

### Task 2: `dataVersion` / `cacheVersion` helper

**Files:**
- Modify: `apps/constants/src/index.ts` (append the export)
- Create: `apps/api/src/utils/data-version.ts`
- Test: `apps/api/src/utils/data-version.test.ts`

**Interfaces:**
- Produces: `DATA_VERSION_KV_KEY = 'meta:dataVersion'` (from `@commute/constants`); `dataVersion(kv: KVNamespace | undefined, now?: number): Promise<string>`; `cacheVersion(env: { API_VERSION: string, KV?: KVNamespace }): Promise<string>`; `resetDataVersionMemo(): void` (tests only).

- [ ] **Step 1: Add the constant**

Append to `apps/constants/src/index.ts`:

```ts
/*
 * KV key holding the id of the latest admin publish. The API folds it into
 * every cache key (see apps/api/src/utils/data-version.ts) so a publish busts
 * caches without a deploy. Written only by apps/admin.
 */
export const DATA_VERSION_KV_KEY = 'meta:dataVersion'
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/utils/data-version.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_VERSION_KV_KEY } from '@commute/constants'
import { cacheVersion, dataVersion, resetDataVersionMemo } from 'utils/data-version'

const kvReturning = (value: unknown) => ({ get: vi.fn(async () => value) }) as unknown as KVNamespace & { get: ReturnType<typeof vi.fn> }

describe('dataVersion', () => {
  beforeEach(() => resetDataVersionMemo())

  it("defaults to '0' when nothing has been published", async () => {
    expect(await dataVersion(kvReturning(null), 0)).toBe('0')
  })

  it("defaults to '0' without a KV binding", async () => {
    expect(await dataVersion(undefined, 0)).toBe('0')
  })

  it("treats a non-string value as '0' (test mocks return objects for any key)", async () => {
    expect(await dataVersion(kvReturning({ stations: [] }), 0)).toBe('0')
  })

  it('reads the key once per 60 s per isolate', async () => {
    const kv = kvReturning('20261001T161500-ab12')
    expect(await dataVersion(kv, 0)).toBe('20261001T161500-ab12')
    expect(await dataVersion(kv, 59_999)).toBe('20261001T161500-ab12')
    expect(kv.get).toHaveBeenCalledTimes(1)
    expect(kv.get).toHaveBeenCalledWith(DATA_VERSION_KV_KEY)
    await dataVersion(kv, 60_000)
    expect(kv.get).toHaveBeenCalledTimes(2)
  })

  it('keeps the last known version when KV throws, and retries on the next call', async () => {
    const kv = kvReturning('v-good')
    await dataVersion(kv, 0)
    kv.get.mockRejectedValueOnce(new Error('KV down'))
    expect(await dataVersion(kv, 61_000)).toBe('v-good')
    expect(await dataVersion(kv, 61_001)).toBe('v-good')
    expect(kv.get).toHaveBeenCalledTimes(3)
  })
})

describe('cacheVersion', () => {
  beforeEach(() => resetDataVersionMemo())

  it('joins API_VERSION and the data version', async () => {
    expect(await cacheVersion({ API_VERSION: '20261001a', KV: kvReturning('p1') })).toBe('20261001a.p1')
    resetDataVersionMemo()
    expect(await cacheVersion({ API_VERSION: '20261001a' })).toBe('20261001a.0')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run src/utils/data-version.test.ts`
Expected: FAIL, `Cannot find module 'utils/data-version'`.

- [ ] **Step 4: Implement**

`apps/api/src/utils/data-version.ts`:

```ts
import { DATA_VERSION_KV_KEY } from '@commute/constants'

/*
 * The runtime half of the cache version. API_VERSION changes with a deploy;
 * this changes with an admin publish (apps/admin), so data edits reach KV-cached
 * responses without one.
 *
 * Memoised per isolate for a minute: every cached route needs it, and a KV read
 * per request would double KV reads. The cost is that isolates can disagree for
 * up to a minute after a publish, which only delays the edit.
 */
const TTL_MS = 60_000

let memo: { value: string, at: number } | null = null

export async function dataVersion(kv: KVNamespace | undefined, now = Date.now()): Promise<string> {
  if (memo && now - memo.at < TTL_MS) return memo.value

  try {
    const raw: unknown = kv ? await kv.get(DATA_VERSION_KV_KEY) : null
    const value = typeof raw === 'string' && raw !== '' ? raw : '0'
    memo = { value, at: now }
    return value
  } catch {
    // Falling back to '0' would rebuild the router and miss every KV key for a
    // transient blip, so keep serving the last version and retry next call.
    return memo?.value ?? '0'
  }
}

export async function cacheVersion(env: { API_VERSION: string, KV?: KVNamespace }): Promise<string> {
  return `${env.API_VERSION}.${await dataVersion(env.KV)}`
}

export function resetDataVersionMemo() {
  memo = null
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && npx vitest run src/utils/data-version.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Checkpoint.** No commit.

---

### Task 3: API reads transfers through the view; cache keys and router follow the data version

**Files:**
- Modify: `apps/api/src/db/schemas/index.ts` (add the view to `Database`)
- Modify: `apps/api/src/db/repositories/edges.ts:33`, `apps/api/src/db/repositories/stations.ts:365-368`
- Modify: `apps/api/src/routes/fares.ts:23-25` (+ wherever `cachedRouter` is assigned), `apps/api/src/utils/journey-endpoint.ts:153,176,211`, `apps/api/src/routes/internal.ts:44,153,168`
- Modify: every `c.env.API_VERSION` cache-key site: `routes/cache.ts`, `routes/sync.ts`, `routes/hubs.ts`, `routes/lines.ts`, `routes/stations.ts`
- Test: `apps/api/src/routes/fares.router-memo.test.ts`, plus existing tests updated where they assert key strings

**Interfaces:**
- Consumes: `cacheVersion(env)`, `resetDataVersionMemo()` from Task 2; view `transfers_effective` from Task 1.
- Produces: `getRouter(d1: D1Database, version: string): Promise<Tsundere>` (was `(d1)`); `handleJourneyRequest`'s `getRouter` param typed `(db: D1Database, version: string) => Promise<Tsundere>`.

- [ ] **Step 1: Write the failing router-memo test**

`apps/api/src/routes/fares.router-memo.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

/*
 * A publish changes transfers, and transfers are baked into the graph, so the
 * per-isolate router must rebuild when the data version moves, and only then.
 */
const getGraphInputs = vi.fn(async () => ({ edges: [], transfers: [] }))
vi.mock('db/repositories/edges', () => ({
  EdgeRepository: class { getGraphInputs = getGraphInputs }
}))

const { getRouter } = await import('routes/fares')

describe('getRouter memo', () => {
  it('reuses the graph for the same version and rebuilds on a new one', async () => {
    const d1 = {} as D1Database
    const a = await getRouter(d1, 'v1.0')
    const b = await getRouter(d1, 'v1.0')
    expect(b).toBe(a)
    expect(getGraphInputs).toHaveBeenCalledTimes(1)

    const c = await getRouter(d1, 'v1.p1')
    expect(c).not.toBe(a)
    expect(getGraphInputs).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm --filter @commute/tsundere build && npx vitest run src/routes/fares.router-memo.test.ts`
Expected: FAIL. The second version returns the same router (`expected … not to be …`), and `getGraphInputs` is called once.
If it instead fails because `loadGraph` throws on empty edges (TRIP_PATTERNS naming stations that aren't in the graph), add `vi.mock('@commute/tsundere', async orig => ({ ...(await orig<object>()), loadGraph: () => ({}) }))` so the test measures only the memo.

- [ ] **Step 3: Key the router memo by version**

In `apps/api/src/routes/fares.ts`, replace

```ts
let cachedRouter: Tsundere | null = null
export async function getRouter(d1: D1Database): Promise<Tsundere> {
  if (cachedRouter) return cachedRouter
```

with

```ts
/*
 * Per isolate, keyed by cache version (API_VERSION + admin data version): the
 * graph bakes in transfers, which an admin publish changes without a deploy.
 */
let cachedRouter: { version: string, router: Tsundere } | null = null
export async function getRouter(d1: D1Database, version: string): Promise<Tsundere> {
  if (cachedRouter?.version === version) return cachedRouter.router
```

Then change the assignment `cachedRouter = loadGraph({ ... })` to build into a local, and store both. The function ends:

```ts
  const router = loadGraph({ /* unchanged arguments */ })
  cachedRouter = { version, router }
  return router
```

(Keep every existing `loadGraph` argument exactly as is. If the function returns `cachedRouter` at the end, return `router` instead.)

- [ ] **Step 4: Thread the version through the journey endpoint**

In `apps/api/src/utils/journey-endpoint.ts`:
- Line 153: `getRouter: (db: D1Database) => Promise<Tsundere>,` → `getRouter: (db: D1Database, version: string) => Promise<Tsundere>,`
- Just above line 175 (`const kvRepository = …`), add `const version = await cacheVersion(c.env)`.
- Line 176: replace `c.env.API_VERSION` with `version`.
- Line 211: `getRouter(c.env.DB)` → `getRouter(c.env.DB, version)`.
- Add `import { cacheVersion } from 'utils/data-version'`.

In `apps/api/src/routes/internal.ts:168`: `await getRouter(c.env.DB),` → `await getRouter(c.env.DB, await cacheVersion(c.env)),` (and add the import).

- [ ] **Step 5: Replace every remaining cache-key `c.env.API_VERSION`**

For each site in `routes/cache.ts`, `routes/sync.ts`, `routes/hubs.ts`, `routes/lines.ts`, `routes/stations.ts`, `routes/internal.ts:44`: insert `const version = await cacheVersion(c.env)` at the top of the enclosing handler, and replace `c.env.API_VERSION` with `version` in the key. Two sites sit inside a non-async `.map(format => …)` (`routes/sync.ts:78`, `routes/cache.ts:188`). Hoisting `version` above the `.map` handles them. Add `import { cacheVersion } from 'utils/data-version'` to each file.

Verify none are left:
Run: `cd apps/api && grep -rn "c.env.API_VERSION" src --include='*.ts' | grep -v '\.test\.ts'`
Expected: no output.

- [ ] **Step 6: Readers switch to the view**

`apps/api/src/db/schemas/index.ts`: add to `Database`:

```ts
  // Imported transfers with published admin overrides applied (migration 0017).
  // Read-only: write `transfers` (importers) or `transfer_overrides` (admin).
  transfers_effective: TransferSchema
```

`apps/api/src/db/repositories/edges.ts:33`: `selectFrom('transfers')` → `selectFrom('transfers_effective')`.
`apps/api/src/db/repositories/stations.ts:367`: `.selectFrom('transfers')` → `.selectFrom('transfers_effective')`.

- [ ] **Step 7: Run the whole API suite and fix key-string assertions**

Run: `cd apps/api && pnpm test`
Expected: the new memo test passes. Tests that assert literal KV keys (e.g. `…:v1`) now see `…:v1.0`. Update those expectations to the `.0` suffix and nothing else. Wherever a test touches cached routes across cases, add `beforeEach(() => resetDataVersionMemo())`. Re-run until all pass; the count is the previous 613 plus 15 new.

- [ ] **Step 8: Router regression baseline**

Run: `cd apps/api && npx tsx src/db/scripts/auditRouter.ts --baseline` (against local D1, which has no overrides)
Expected: 0 diffs. With no overrides the view equals the table.

- [ ] **Step 9: Checkpoint.** No commit.

---

### Task 4: Scaffold `apps/admin` (Worker, JSX layout, D1 test shim)

**Files:**
- Create: `apps/admin/package.json`, `apps/admin/wrangler.toml`, `apps/admin/tsconfig.json`, `apps/admin/vitest.config.ts`
- Create: `apps/admin/src/env.ts`, `apps/admin/src/app.tsx`, `apps/admin/src/views/layout.tsx`, `apps/admin/src/views/ui.ts`, `apps/admin/src/styles.css`, `apps/admin/.gitignore`
- Create: `apps/admin/test/sqlite-d1.ts`, `apps/admin/src/app.test.tsx`
- Modify: root `eslint.config.*` globalIgnores (add `'apps/admin/.wrangler/**/*'`)

**Interfaces:**
- Produces: `Bindings`, `AdminEnv` (`apps/admin/src/env.ts`); `createApp(options?: { getKey?: (teamDomain: string) => JWTVerifyGetKey }): Hono<AdminEnv>` with `export default createApp()`; `Layout` component `({ title, draftCount, children })`; class recipes from `views/ui.ts`: `muted`, `cell`, `field`, `stack`, `button(variant?: 'primary' | 'secondary')`, `badge(tone?: 'neutral' | 'warn')`, `errorBox`; test helpers `migratedD1(): { db: DatabaseSync, d1: D1Database }` and `seedStations(db, ids: string[])`.

- [ ] **Step 1: Package files**

`apps/admin/package.json`:

```json
{
  "name": "@commute/admin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Admin dashboard: drafts and publishes data overrides over the imported D1 tables.",
  "scripts": {
    "dev": "wrangler dev --persist-to ../api/.wrangler/state",
    "build:css": "tailwindcss -i src/styles.css -o public/admin.css --minify",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint",
    "lint:fix": "eslint --fix"
  },
  "license": "MIT",
  "dependencies": {
    "@commute/constants": "workspace:../constants",
    "clsx": "^2.1.1",
    "hono": "^4.12.32",
    "jose": "^6.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250610.0",
    "@tailwindcss/cli": "^4.0.0",
    "@types/node": "^24.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.8.0",
    "vitest": "^4.1.9",
    "wrangler": "^4.43.0"
  }
}
```

`apps/admin/wrangler.toml`:

```toml
name = "commute-admin"
main = "src/app.tsx"
dev.port = 3002
compatibility_date = "2025-10-18"

# The only way in is the Access-protected custom domain. A workers.dev URL
# would be a second, unprotected door.
workers_dev = false
routes = [{ pattern = "admin.commute.shiorilabs.id", custom_domain = true }]

[observability]
enabled = true

# Tailwind is compiled before every `wrangler dev` / deploy, and again when src/
# changes under dev. The output is served as a static asset, so it sits behind
# the same Access policy as the pages.
[build]
command = "pnpm build:css"
watch_dir = "src"

[assets]
directory = "./public"

# Same database and namespace as apps/api: admin writes the overrides the API
# reads. `wrangler dev` shares apps/api's local state via --persist-to.
[[d1_databases]]
binding = "DB"
database_name = "commute"
database_id = "1d187383-95a3-4e34-aee8-7c99b45aeaa0"
migrations_dir = "../api/src/db/migrations"

[[kv_namespaces]]
binding = "KV"
id = "000e0f51c09844f1b9f85ad26e068129"
preview_id = "6cb9d95fe3324afeb9017776a11a0d4d"

# Filled in by the user from Zero Trust > Access > Applications once the app
# exists. Empty values fail closed (every non-localhost request is 403).
[vars]
ACCESS_TEAM_DOMAIN = ""
ACCESS_AUD = ""
```

`apps/admin/src/styles.css`:

```css
@import "tailwindcss";
```

(Tailwind 4 finds the classes by scanning the package's non-gitignored files, which covers `src/**/*.tsx` and `views/ui.ts`.)

`apps/admin/.gitignore`:

```
public/admin.css
.wrangler/
```

`apps/admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types", "@types/node"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`apps/admin/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'hono/jsx' },
  test: { include: ['src/**/*.test.{ts,tsx}'] }
})
```

Run: `pnpm install` (from the repo root)
Expected: `@commute/admin` is linked and jose is installed.

- [ ] **Step 2: Test shim (real SQLite behind the D1 interface)**

`apps/admin/test/sqlite-d1.ts`:

```ts
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/*
 * The admin's SQL is its logic, so tests run it for real: every apps/api
 * migration against an in-memory SQLite, behind just enough of the D1 surface
 * (prepare/bind/all/first/run/batch) for the code under test.
 */
const MIGRATIONS = path.resolve(import.meta.dirname, '../../api/src/db/migrations')

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: SQLInputValue[] = []) {}
  bind(...params: SQLInputValue[]) { return new Statement(this.db, this.sql, params) }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} } }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null }
  async run() { const r = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes) } } }
}

export function migratedD1() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
  } as unknown as D1Database
  return { db, d1 }
}

export function seedStations(db: DatabaseSync, ids: string[]) {
  for (const id of ids) {
    const [operator, code] = id.split('-') as [string, string]
    db.prepare(`INSERT INTO stations (id, name, code, region, regionCode, operator) VALUES (?, ?, ?, 'Jakarta', 'JAK', ?)`)
      .run(id, `Station ${code}`, code, operator)
  }
}

export function seedTransfer(db: DatabaseSync, from: string, to: string, distance: number, notes: string | null = null) {
  db.prepare(`INSERT INTO transfers (id, dataType, fromStationId, toStationId, distance, notes) VALUES (?, 'INTERNAL', ?, ?, ?, ?)`)
    .run(`${from}->${to}`, from, to, distance, notes)
}

export function fakeKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  let failPuts = false
  return {
    store,
    failNextPuts(fail = true) { failPuts = fail },
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        if (failPuts) throw new Error('KV put failed')
        store.set(key, value)
      }
    } as unknown as KVNamespace
  }
}
```

- [ ] **Step 3: Write the failing app test**

`apps/admin/src/app.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { fakeKV, migratedD1 } from '../test/sqlite-d1'

const env = () => ({ DB: migratedD1().d1, KV: fakeKV().kv, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' })

describe('admin shell', () => {
  it('redirects / to the transfers queue', async () => {
    const res = await createApp().request('http://localhost/', {}, env())
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/transfers')
  })
})
```

Run: `cd apps/admin && npx vitest run src/app.test.tsx`
Expected: FAIL, `Cannot find module './app'`.

- [ ] **Step 4: Env, layout and app**

`apps/admin/src/env.ts`:

```ts
export interface Bindings {
  DB: D1Database
  KV: KVNamespace
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
}

export interface AdminEnv {
  Bindings: Bindings
  Variables: { user: string }
}
```

`apps/admin/src/views/ui.ts` (class recipes reused across pages; one-offs stay inline):

```ts
import clsx from 'clsx'

export const muted = 'text-neutral-500 dark:text-neutral-400'
export const cell = 'border-b border-neutral-200 p-2 text-left align-top dark:border-neutral-800'
export const field = 'w-full rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900'
export const stack = 'grid max-w-md gap-3'
export const errorBox = 'rounded-md bg-red-700 px-3 py-2 text-white'

export const button = (variant: 'primary' | 'secondary' = 'primary') => clsx(
  'cursor-pointer rounded-md px-3 py-2 font-medium',
  variant === 'primary' && 'bg-pink-700 text-white hover:bg-pink-800',
  variant === 'secondary' && 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
)

export const badge = (tone: 'neutral' | 'warn' = 'neutral') => clsx(
  'rounded border px-1.5 text-xs',
  tone === 'neutral' && 'border-neutral-400 text-neutral-600 dark:text-neutral-300',
  tone === 'warn' && 'border-amber-600 text-amber-700 dark:text-amber-400'
)
```

`apps/admin/src/views/layout.tsx`:

```tsx
import clsx from 'clsx'
import type { Child } from 'hono/jsx'
import { button } from './ui'

const NAV = [
  { href: '/transfers', label: 'Transfers', live: true },
  { href: '#', label: 'Notices', live: false },
  { href: '#', label: 'Audits', live: false },
  { href: '#', label: 'Ops', live: false },
  { href: '#', label: 'Editorials', live: false }
]

export function Layout({ title, draftCount, children }: { title: string, draftCount: number, children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · Commute admin`}</title>
        <link rel="stylesheet" href="/admin.css" />
      </head>
      <body class="bg-neutral-50 pb-20 text-[15px] text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <nav class="flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
          {NAV.map(item => {
            const current = item.live && title.startsWith(item.label)
            return item.live
              ? (
                <a
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  class={clsx('whitespace-nowrap rounded-md px-2.5 py-1.5', current ? 'bg-pink-700 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}
                >
                  {item.label}
                </a>
              )
              : <span class="whitespace-nowrap px-2.5 py-1.5 text-neutral-400">{item.label}</span>
          })}
        </nav>
        <main class="mx-auto max-w-4xl p-4">{children}</main>
        {draftCount > 0 && (
          <div class="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t-2 border-pink-700 bg-white px-4 py-3 dark:bg-neutral-900">
            <span>{draftCount} draft {draftCount === 1 ? 'change' : 'changes'}</span>
            <a href="/publish" class={button()}>Review and publish</a>
          </div>
        )}
      </body>
    </html>
  )
}
```

`apps/admin/src/app.tsx`:

```tsx
import { Hono } from 'hono'
import type { JWTVerifyGetKey } from 'jose'
import type { AdminEnv } from './env'

export function createApp(_options: { getKey?: (teamDomain: string) => JWTVerifyGetKey } = {}) {
  const app = new Hono<AdminEnv>()
  app.get('/', c => c.redirect('/transfers'))
  return app
}

export default createApp()
```

(`_options` is consumed in Task 5. The underscore keeps `noUnusedParameters` quiet until then.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/admin && npx vitest run && npx tsc --noEmit && pnpm build:css && grep -c 'bg-pink-700' public/admin.css`
Expected: PASS, tsc is clean, and the grep prints `1` or more (Tailwind picked up the JSX classes).

- [ ] **Step 6: Add `'apps/admin/.wrangler/**/*'` to the root eslint `globalIgnores`, then run** `pnpm lint` from the root. Expected: clean.

- [ ] **Step 7: Checkpoint.** No commit.

---

### Task 5: Cloudflare Access auth middleware

**Files:**
- Create: `apps/admin/src/auth.ts`
- Test: `apps/admin/src/auth.test.ts`
- Modify: `apps/admin/src/app.tsx` (mount the middleware first)

**Interfaces:**
- Consumes: `AdminEnv`, `createApp(options)` from Task 4.
- Produces: `accessAuth(getKey?: (teamDomain: string) => JWTVerifyGetKey)`, a Hono middleware setting `c.var.user` (an email, or `'dev@local'` on localhost).

- [ ] **Step 1: Write the failing test**

`apps/admin/src/auth.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { accessAuth } from './auth'
import type { AdminEnv } from './env'

const TEAM = 'https://commute.cloudflareaccess.com'
const AUD = 'aud-123'
let privateKey: CryptoKey
let jwk: JWK

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
})

const sign = (claims: { aud?: string, iss?: string, exp?: string, email?: string } = {}) =>
  new SignJWT(claims.email === undefined ? { email: 'me@example.com' } : { email: claims.email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(claims.iss ?? TEAM)
    .setAudience(claims.aud ?? AUD)
    .setExpirationTime(claims.exp ?? '1h')
    .sign(privateKey)

function app() {
  const a = new Hono<AdminEnv>()
  a.use('*', accessAuth(() => createLocalJWKSet({ keys: [jwk] })))
  a.get('/who', c => c.text(c.var.user))
  return a
}
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as AdminEnv['Bindings']
const call = (token?: string, host = 'https://admin.commute.shiorilabs.id') =>
  app().request(`${host}/who`, token ? { headers: { 'Cf-Access-Jwt-Assertion': token } } : {}, env)

describe('accessAuth', () => {
  it('accepts a valid Access token and exposes the email', async () => {
    const res = await call(await sign())
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('me@example.com')
  })

  it('rejects a missing header on the real host', async () => {
    expect((await call()).status).toBe(403)
  })

  it('rejects the wrong audience', async () => {
    expect((await call(await sign({ aud: 'other' }))).status).toBe(403)
  })

  it('rejects the wrong issuer', async () => {
    expect((await call(await sign({ iss: 'https://evil.cloudflareaccess.com' }))).status).toBe(403)
  })

  it('rejects an expired token', async () => {
    expect((await call(await sign({ exp: '-1m' }))).status).toBe(403)
  })

  it('fails closed when the Access vars are unset', async () => {
    const res = await app().request('https://admin.commute.shiorilabs.id/who',
      { headers: { 'Cf-Access-Jwt-Assertion': await sign() } },
      { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as AdminEnv['Bindings'])
    expect(res.status).toBe(403)
  })

  it('lets localhost through as dev@local', async () => {
    const res = await call(undefined, 'http://localhost:3002')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('dev@local')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx vitest run src/auth.test.ts`
Expected: FAIL, `Cannot find module './auth'`.

- [ ] **Step 3: Implement**

`apps/admin/src/auth.ts`:

```ts
import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { AdminEnv } from './env'

/*
 * Cloudflare Access already stands in front of the hostname. This checks its
 * signed assertion anyway, so a misconfigured Access policy or a second route
 * to the Worker fails closed instead of open. workers_dev is off for the same
 * reason (wrangler.toml).
 *
 * localhost is waved through for `wrangler dev`. That is safe only because the
 * deployed Worker is reachable solely through its custom domain: Cloudflare
 * routes by hostname, so a request cannot reach it as "localhost".
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const remoteKeySets = new Map<string, JWTVerifyGetKey>()
function remoteKeySet(teamDomain: string) {
  let keySet = remoteKeySets.get(teamDomain)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    remoteKeySets.set(teamDomain, keySet)
  }
  return keySet
}

export function accessAuth(getKey: (teamDomain: string) => JWTVerifyGetKey = remoteKeySet) {
  return createMiddleware<AdminEnv>(async (c, next) => {
    if (LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      c.set('user', 'dev@local')
      return next()
    }

    const team = c.env.ACCESS_TEAM_DOMAIN
    const aud = c.env.ACCESS_AUD
    const token = c.req.header('Cf-Access-Jwt-Assertion')
    if (!team || !aud || !token) return c.text('Forbidden', 403)

    try {
      const { payload } = await jwtVerify(token, getKey(team), { issuer: team, audience: aud })
      if (typeof payload.email !== 'string') return c.text('Forbidden', 403)
      c.set('user', payload.email)
    } catch {
      return c.text('Forbidden', 403)
    }
    return next()
  })
}
```

In `apps/admin/src/app.tsx`, rename `_options` to `options` and make the middleware the first thing registered:

```tsx
import { accessAuth } from './auth'
// …
  const app = new Hono<AdminEnv>()
  app.use('*', accessAuth(options.getKey))
  app.get('/', c => c.redirect('/transfers'))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/admin && npx vitest run && npx tsc --noEmit`
Expected: PASS (auth: 7 tests; the app test still passes because it requests localhost).

- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 6: Transfers data layer (queue, drafts, publish)

**Files:**
- Create: `apps/admin/src/transfers/repository.ts`
- Test: `apps/admin/src/transfers/repository.test.ts`

**Interfaces:**
- Consumes: `migratedD1`, `seedStations`, `seedTransfer`, `fakeKV` (Task 4); `DATA_VERSION_KV_KEY` (Task 2).
- Produces (all take `db: D1Database` first):
  - `type Tab = 'unmeasured' | 'missing-reverse' | 'deletes' | 'drafts'`, `TABS: Tab[]`
  - `interface QueueRow { id: string, fromStationId: string, fromName: string, fromOperator: string, toStationId: string, toName: string, toOperator: string, distance: number, notes: string | null, draftOp: 'upsert' | 'delete' | 'revert' | null }`
  - `listQueue(db, tab: Tab): Promise<QueueRow[]>`
  - `countDrafts(db): Promise<number>`
  - `interface OverrideRow { op: 'upsert' | 'delete' | 'revert', distance: number | null, noTap: number, notes: string | null, editedBy: string, updatedAt: string }`
  - `interface TransferDetail { id: string, fromStationId: string, fromName: string, toStationId: string, toName: string, base: { distance: number, noTap: number, notes: string | null } | null, published: OverrideRow | null, draft: OverrideRow | null }`
  - `getTransfer(db, id: string): Promise<TransferDetail | null>`
  - `interface DraftInput { fromStationId: string, toStationId: string, distance: number | null, noTap: boolean, notes: string | null, applyReverse: boolean }`
  - `saveDraft(db, input: DraftInput, user: string): Promise<{ ok: true } | { ok: false, error: string }>`
  - `markDelete(db, id: string, applyReverse: boolean, user: string): Promise<void>`
  - `revertToImported(db, id: string, applyReverse: boolean, user: string): Promise<void>`
  - `discardDraft(db, id: string): Promise<void>`
  - `listStations(db): Promise<{ id: string, name: string, operator: string }[]>`
  - `publish(db, kv: KVNamespace, user: string, now?: Date): Promise<{ publishId: string, changeCount: number, versionBumped: boolean } | null>`
  - `versionStatus(db, kv): Promise<{ latestPublishId: string | null, liveVersion: string | null }>`
  - `bumpVersion(db, kv): Promise<void>`
  - `transferId(from: string, to: string): string`

- [ ] **Step 1: Write the failing tests**

`apps/admin/src/transfers/repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { DATA_VERSION_KV_KEY } from '@commute/constants'
import { fakeKV, migratedD1, seedStations, seedTransfer } from '../../test/sqlite-d1'
import {
  bumpVersion, countDrafts, discardDraft, getTransfer, listQueue, markDelete, publish, revertToImported, saveDraft, versionStatus
} from './repository'

const A = 'KCI-AAA', B = 'TJ-BBB', C = 'MRTJ-CCC'
const AB = `${A}->${B}`, BA = `${B}->${A}`
let db: DatabaseSync
let d1: D1Database

const effective = (id: string) =>
  db.prepare('SELECT distance, notes FROM transfers_effective WHERE id = ?').get(id)

beforeEach(() => {
  ({ db, d1 } = migratedD1())
  seedStations(db, [A, B, C])
  seedTransfer(db, A, B, 0)
  seedTransfer(db, B, A, 0)
})

const draft = (over: Partial<Parameters<typeof saveDraft>[1]> = {}) =>
  saveDraft(d1, { fromStationId: A, toStationId: B, distance: 300, noTap: false, notes: null, applyReverse: true, ...over }, 'me@example.com')

describe('queue', () => {
  it('lists unmeasured transfers and flags ones with a pending draft', async () => {
    expect((await listQueue(d1, 'unmeasured')).map(r => [r.id, r.draftOp])).toEqual([[AB, null], [BA, null]])
    await draft({ applyReverse: false })
    expect((await listQueue(d1, 'unmeasured')).map(r => [r.id, r.draftOp])).toEqual([[AB, 'upsert'], [BA, null]])
  })

  it('lists transfers whose reverse direction is missing', async () => {
    seedTransfer(db, A, C, 150)
    expect((await listQueue(d1, 'missing-reverse')).map(r => r.id)).toEqual([`${A}->${C}`])
  })
})

describe('saveDraft', () => {
  it('writes both directions by default and leaves the live view untouched', async () => {
    expect(await draft()).toEqual({ ok: true })
    expect(await countDrafts(d1)).toBe(2)
    expect(effective(AB)).toEqual({ distance: 0, notes: null })
  })

  it('rejects distance 0, from = to, and unknown stations', async () => {
    expect(await draft({ distance: 0 })).toMatchObject({ ok: false })
    expect(await draft({ toStationId: A })).toMatchObject({ ok: false })
    expect(await draft({ toStationId: 'KCI-NOPE' })).toMatchObject({ ok: false })
    expect(await countDrafts(d1)).toBe(0)
  })

  it('requires a distance for a new transfer, including its reverse, and writes nothing on failure', async () => {
    seedTransfer(db, A, C, 100) // C->A does not exist
    const result = await draft({ toStationId: C, distance: null, notes: 'blocked: flyover' })
    expect(result).toMatchObject({ ok: false })
    expect(await countDrafts(d1)).toBe(0)
  })

  it('keeps the published value live while a newer draft is pending', async () => {
    await draft({ distance: 300 })
    await publish(d1, fakeKV().kv, 'me@example.com')
    await draft({ distance: 450 })
    expect(effective(AB)).toEqual({ distance: 300, notes: null })
    expect((await getTransfer(d1, AB))?.draft?.distance).toBe(450)
    expect((await getTransfer(d1, AB))?.published?.distance).toBe(300)
  })
})

describe('publish', () => {
  it('flips drafts live, logs the publish and bumps the data version once', async () => {
    const { kv, store } = fakeKV()
    await draft()
    const result = await publish(d1, kv, 'me@example.com', new Date('2026-10-01T16:15:00Z'))
    expect(result).toMatchObject({ changeCount: 2, versionBumped: true })
    expect(result!.publishId).toMatch(/^20261001T161500-[0-9a-f]{4}$/)
    expect(store.get(DATA_VERSION_KV_KEY)).toBe(result!.publishId)
    expect(effective(AB)).toEqual({ distance: 300, notes: null })
    expect(await countDrafts(d1)).toBe(0)
  })

  it('is a no-op with no drafts: no publish row, no version bump', async () => {
    const { kv, store } = fakeKV()
    expect(await publish(d1, kv, 'me@example.com')).toBeNull()
    expect(store.has(DATA_VERSION_KV_KEY)).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM publishes').get()).toEqual({ n: 0 })
  })

  it('reports a failed version bump and lets it be retried', async () => {
    const kv = fakeKV()
    kv.failNextPuts()
    await draft()
    const result = await publish(d1, kv.kv, 'me@example.com')
    expect(result).toMatchObject({ versionBumped: false })
    expect(await versionStatus(d1, kv.kv)).toEqual({ latestPublishId: result!.publishId, liveVersion: null })
    kv.failNextPuts(false)
    await bumpVersion(d1, kv.kv)
    expect(await versionStatus(d1, kv.kv)).toEqual({ latestPublishId: result!.publishId, liveVersion: result!.publishId })
  })

  it('applies delete and revert drafts', async () => {
    await draft()
    await publish(d1, fakeKV().kv, 'me@example.com')
    await revertToImported(d1, AB, false, 'me@example.com')
    await markDelete(d1, BA, false, 'me@example.com')
    await publish(d1, fakeKV().kv, 'me@example.com')
    expect(effective(AB)).toEqual({ distance: 0, notes: null })
    expect(effective(BA)).toBeUndefined()
    expect((await listQueue(d1, 'deletes')).map(r => r.id)).toEqual([BA])
  })

  it('discardDraft drops only the pending row', async () => {
    await draft({ applyReverse: false })
    await discardDraft(d1, AB)
    expect(await countDrafts(d1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/admin && npx vitest run src/transfers/repository.test.ts`
Expected: FAIL, `Cannot find module './repository'`.

- [ ] **Step 3: Implement**

`apps/admin/src/transfers/repository.ts`:

```ts
import { DATA_VERSION_KV_KEY } from '@commute/constants'

export type Tab = 'unmeasured' | 'missing-reverse' | 'deletes' | 'drafts'
export const TABS: Tab[] = ['unmeasured', 'missing-reverse', 'deletes', 'drafts']

type Op = 'upsert' | 'delete' | 'revert'

export interface QueueRow {
  id: string
  fromStationId: string, fromName: string, fromOperator: string
  toStationId: string, toName: string, toOperator: string
  distance: number
  notes: string | null
  draftOp: Op | null
}

export interface OverrideRow { op: Op, distance: number | null, noTap: number, notes: string | null, editedBy: string, updatedAt: string }

export interface TransferDetail {
  id: string
  fromStationId: string, fromName: string
  toStationId: string, toName: string
  base: { distance: number, noTap: number, notes: string | null } | null
  published: OverrideRow | null
  draft: OverrideRow | null
}

export interface DraftInput {
  fromStationId: string
  toStationId: string
  distance: number | null
  noTap: boolean
  notes: string | null
  applyReverse: boolean
}

export const transferId = (from: string, to: string) => `${from}->${to}`

const STATION_JOINS = `
  JOIN stations f ON f.id = x.fromStationId
  JOIN stations t ON t.id = x.toStationId`
const STATION_COLUMNS = `
  x.fromStationId, f.name AS fromName, f.operator AS fromOperator,
  x.toStationId, t.name AS toName, t.operator AS toOperator`
// Busiest interchanges first: the station score is the planner's own measure of
// how much a stop matters.
const ORDER = 'ORDER BY MAX(f.score, t.score) DESC, x.id'

const EFFECTIVE_WHERE: Record<'unmeasured' | 'missing-reverse', string> = {
  'unmeasured': 'x.distance = 0',
  'missing-reverse': `NOT EXISTS (
    SELECT 1 FROM transfers_effective r
    WHERE r.fromStationId = x.toStationId AND r.toStationId = x.fromStationId)`
}

export async function listQueue(db: D1Database, tab: Tab): Promise<QueueRow[]> {
  if (tab === 'unmeasured' || tab === 'missing-reverse') {
    const { results } = await db.prepare(`
      SELECT x.id, ${STATION_COLUMNS}, x.distance, x.notes, d.op AS draftOp
      FROM transfers_effective x ${STATION_JOINS}
      LEFT JOIN transfer_overrides d ON d.id = x.id AND d.status = 'draft'
      WHERE x.dataType = 'INTERNAL' AND ${EFFECTIVE_WHERE[tab]}
      ${ORDER}`).all<QueueRow>()
    return results
  }

  // Deleted rows are gone from the view, and drafts are invisible to it, so
  // these two tabs read the overrides directly.
  const where = tab === 'deletes' ? "x.op = 'delete'" : "x.status = 'draft'"
  const { results } = await db.prepare(`
    SELECT x.id, ${STATION_COLUMNS},
      COALESCE(x.distance, b.distance, 0) AS distance, x.notes,
      CASE WHEN x.status = 'draft' THEN x.op END AS draftOp
    FROM transfer_overrides x ${STATION_JOINS}
    LEFT JOIN transfers b ON b.id = x.id
    WHERE ${where}
    ${ORDER}`).all<QueueRow>()
  return results
}

export async function countDrafts(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM transfer_overrides WHERE status = 'draft'").first<{ n: number }>()
  return row?.n ?? 0
}

async function override(db: D1Database, id: string, status: 'draft' | 'published') {
  return db.prepare(`SELECT op, distance, noTap, notes, editedBy, updatedAt FROM transfer_overrides WHERE id = ? AND status = ?`)
    .bind(id, status).first<OverrideRow>()
}

async function baseRow(db: D1Database, id: string) {
  return db.prepare("SELECT fromStationId, toStationId, distance, noTap, notes FROM transfers WHERE id = ? AND dataType = 'INTERNAL'")
    .bind(id).first<{ fromStationId: string, toStationId: string, distance: number, noTap: number, notes: string | null }>()
}

export async function getTransfer(db: D1Database, id: string): Promise<TransferDetail | null> {
  const [base, published, draft] = await Promise.all([baseRow(db, id), override(db, id, 'published'), override(db, id, 'draft')])
  const ends = base ?? await db.prepare('SELECT fromStationId, toStationId FROM transfer_overrides WHERE id = ? LIMIT 1')
    .bind(id).first<{ fromStationId: string, toStationId: string }>()
  if (!ends) return null
  const names = await db.prepare('SELECT f.name AS fromName, t.name AS toName FROM stations f, stations t WHERE f.id = ? AND t.id = ?')
    .bind(ends.fromStationId, ends.toStationId).first<{ fromName: string, toName: string }>()
  return {
    id,
    fromStationId: ends.fromStationId, fromName: names?.fromName ?? ends.fromStationId,
    toStationId: ends.toStationId, toName: names?.toName ?? ends.toStationId,
    base: base ? { distance: base.distance, noTap: base.noTap, notes: base.notes } : null,
    published,
    draft
  }
}

export async function listStations(db: D1Database) {
  const { results } = await db.prepare('SELECT id, name, operator FROM stations ORDER BY name').all<{ id: string, name: string, operator: string }>()
  return results
}

const UPSERT_DRAFT = `
  INSERT INTO transfer_overrides (id, status, op, fromStationId, toStationId, distance, noTap, notes, editedBy, updatedAt)
  VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT (id, status) DO UPDATE SET
    op = excluded.op, distance = excluded.distance, noTap = excluded.noTap,
    notes = excluded.notes, editedBy = excluded.editedBy, updatedAt = CURRENT_TIMESTAMP`

function draftStatement(db: D1Database, op: Op, from: string, to: string, input: Pick<DraftInput, 'distance' | 'noTap' | 'notes'>, user: string) {
  return db.prepare(UPSERT_DRAFT).bind(transferId(from, to), op, from, to, input.distance, input.noTap ? 1 : 0, input.notes, user)
}

export async function saveDraft(db: D1Database, input: DraftInput, user: string): Promise<{ ok: true } | { ok: false, error: string }> {
  const { fromStationId: from, toStationId: to, distance } = input
  if (from === to) return { ok: false, error: 'From and to must be different stations' }
  if (distance !== null && (!Number.isInteger(distance) || distance < 0)) return { ok: false, error: 'Distance must be a whole number of metres' }
  if (distance === 0) return { ok: false, error: 'Distance 0 means unmeasured. Leave it empty to keep the imported value' }

  const found = await db.prepare('SELECT COUNT(*) AS n FROM stations WHERE id IN (?, ?)').bind(from, to).first<{ n: number }>()
  if ((found?.n ?? 0) < 2) return { ok: false, error: 'Both stations must exist' }

  const pairs: [string, string][] = input.applyReverse ? [[from, to], [to, from]] : [[from, to]]
  for (const [a, b] of pairs) {
    if (distance === null && !(await baseRow(db, transferId(a, b)))) {
      return { ok: false, error: `${transferId(a, b)} is a new transfer, so it needs a distance` }
    }
  }

  await db.batch(pairs.map(([a, b]) => draftStatement(db, 'upsert', a, b, input, user)))
  return { ok: true }
}

async function endsOf(db: D1Database, id: string) {
  const detail = await getTransfer(db, id)
  if (!detail) throw new Error(`Unknown transfer ${id}`)
  return [detail.fromStationId, detail.toStationId] as const
}

async function writeOpDraft(db: D1Database, op: Op, id: string, applyReverse: boolean, user: string) {
  const [from, to] = await endsOf(db, id)
  const pairs: [string, string][] = applyReverse ? [[from, to], [to, from]] : [[from, to]]
  const statements = []
  for (const [a, b] of pairs) {
    const pairId = transferId(a, b)
    // Reverting something that was never published is just dropping the draft.
    if (op === 'revert' && !(await override(db, pairId, 'published'))) {
      statements.push(db.prepare("DELETE FROM transfer_overrides WHERE id = ? AND status = 'draft'").bind(pairId))
    } else if (op === 'delete' || (await getTransfer(db, pairId))) {
      statements.push(draftStatement(db, op, a, b, { distance: null, noTap: false, notes: null }, user))
    }
  }
  if (statements.length) await db.batch(statements)
}

export const markDelete = (db: D1Database, id: string, applyReverse: boolean, user: string) =>
  writeOpDraft(db, 'delete', id, applyReverse, user)

export const revertToImported = (db: D1Database, id: string, applyReverse: boolean, user: string) =>
  writeOpDraft(db, 'revert', id, applyReverse, user)

export async function discardDraft(db: D1Database, id: string) {
  await db.prepare("DELETE FROM transfer_overrides WHERE id = ? AND status = 'draft'").bind(id).run()
}

function publishIdFor(now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) // 20261001T161500
  return `${stamp}-${crypto.randomUUID().slice(0, 4)}`
}

export async function publish(db: D1Database, kv: KVNamespace, user: string, now = new Date()) {
  const { results: drafts } = await db.prepare("SELECT id, op, distance FROM transfer_overrides WHERE status = 'draft' ORDER BY id")
    .all<{ id: string, op: Op, distance: number | null }>()
  if (drafts.length === 0) return null

  const publishId = publishIdFor(now)
  const summary = drafts.map(d => d.op === 'upsert' && d.distance !== null ? `${d.id} ${d.distance}m` : `${d.op} ${d.id}`).join('; ')

  // One batch is one transaction: the live set never shows half a publish.
  await db.batch([
    db.prepare('INSERT INTO publishes (id, publishedBy, changeCount, summary) VALUES (?, ?, ?, ?)').bind(publishId, user, drafts.length, summary),
    db.prepare(`DELETE FROM transfer_overrides WHERE status = 'published'
      AND id IN (SELECT id FROM transfer_overrides WHERE status = 'draft')`),
    db.prepare("DELETE FROM transfer_overrides WHERE status = 'draft' AND op = 'revert'"),
    db.prepare("UPDATE transfer_overrides SET status = 'published', publishId = ?, updatedAt = CURRENT_TIMESTAMP WHERE status = 'draft'").bind(publishId)
  ])

  // After D1, never before: a bump without the data would cache the old rows
  // under the new version for the full KV TTL.
  let versionBumped = true
  try {
    await kv.put(DATA_VERSION_KV_KEY, publishId)
  } catch {
    versionBumped = false
  }
  return { publishId, changeCount: drafts.length, versionBumped }
}

export async function versionStatus(db: D1Database, kv: KVNamespace) {
  const latest = await db.prepare('SELECT id FROM publishes ORDER BY publishedAt DESC, id DESC LIMIT 1').first<{ id: string }>()
  return { latestPublishId: latest?.id ?? null, liveVersion: await kv.get(DATA_VERSION_KV_KEY) }
}

export async function bumpVersion(db: D1Database, kv: KVNamespace) {
  const { latestPublishId } = await versionStatus(db, kv)
  if (latestPublishId) await kv.put(DATA_VERSION_KV_KEY, latestPublishId)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/admin && npx vitest run && npx tsc --noEmit`
Expected: PASS (repository: 12 tests). If the `'applies delete and revert drafts'` ordering assertion fails only because of `ORDER BY`, fix the query, not the test.

- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 7: Transfers pages (queue, edit, new)

**Files:**
- Create: `apps/admin/src/transfers/views.tsx`, `apps/admin/src/transfers/routes.tsx`
- Modify: `apps/admin/src/app.tsx` (mount `app.route('/transfers', transferRoutes)`)
- Test: `apps/admin/src/transfers/routes.test.tsx`

**Interfaces:**
- Consumes: everything from Task 6; `Layout` (Task 4); `AdminEnv`.
- Produces: `transferRoutes: Hono<AdminEnv>` serving `GET /` (`?tab=`), `GET /new`, `POST /new`, `GET /:id`, `POST /:id`, `POST /:id/delete`, `POST /:id/revert`, `POST /:id/discard`. Transfer ids contain `>`, so links use `encodeURIComponent(id)` and handlers read `decodeURIComponent(c.req.param('id'))`.
- Form fields: `distance` (text, empty = keep imported), `noTap` (checkbox), `notes` (textarea), `applyReverse` (checkbox, checked by default), and on `/new` also `from` / `to` (station ids via `<datalist>`).

- [ ] **Step 1: Write the failing route tests**

`apps/admin/src/transfers/routes.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createApp } from '../app'
import { fakeKV, migratedD1, seedStations, seedTransfer } from '../../test/sqlite-d1'

const A = 'KCI-AAA', B = 'TJ-BBB'
const AB = `${A}->${B}`
let db: DatabaseSync
let env: { DB: D1Database, KV: KVNamespace, ACCESS_TEAM_DOMAIN: string, ACCESS_AUD: string }

beforeEach(() => {
  const m = migratedD1()
  db = m.db
  seedStations(db, [A, B])
  seedTransfer(db, A, B, 0)
  seedTransfer(db, B, A, 0, 'blocked: flyover demolition')
  env = { DB: m.d1, KV: fakeKV().kv, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }
})

const app = () => createApp()
const get = (path: string) => app().request(`http://localhost${path}`, {}, env)
const post = (path: string, form: Record<string, string>) =>
  app().request(`http://localhost${path}`, { method: 'POST', body: new URLSearchParams(form) }, env)
const drafts = () => db.prepare("SELECT id, distance FROM transfer_overrides WHERE status = 'draft' ORDER BY id").all()

describe('transfers pages', () => {
  it('renders the unmeasured queue with links and a blocked marker', async () => {
    const html = await (await get('/transfers')).text()
    expect(html).toContain(`/transfers/${encodeURIComponent(AB)}`)
    expect(html).toContain('Station AAA')
    expect(html).toMatch(/blocked/i)
  })

  it('saves a draft for both directions from the edit form and redirects', async () => {
    const res = await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '300', notes: '', applyReverse: 'on' })
    expect(res.status).toBe(303)
    expect(drafts()).toEqual([{ id: AB, distance: 300 }, { id: `${B}->${A}`, distance: 300 }])
  })

  it('re-renders the form with an error on distance 0', async () => {
    const res = await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '0', applyReverse: 'on' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('Distance 0 means unmeasured')
    expect(drafts()).toEqual([])
  })

  it('shows the publish bar once a draft exists', async () => {
    await post(`/transfers/${encodeURIComponent(AB)}`, { distance: '300' })
    expect(await (await get('/transfers')).text()).toContain('1 draft change')
  })

  it('creates a new transfer from /transfers/new', async () => {
    seedStations(db, ['MRTJ-CCC'])
    const res = await post('/transfers/new', { from: A, to: 'MRTJ-CCC', distance: '210', applyReverse: 'on' })
    expect(res.status).toBe(303)
    expect(drafts()).toHaveLength(2)
  })

  it('404s an unknown transfer', async () => {
    expect((await get(`/transfers/${encodeURIComponent('KCI-X->KCI-Y')}`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/admin && npx vitest run src/transfers/routes.test.tsx`
Expected: FAIL, `/transfers` returns 404.

- [ ] **Step 3: Views**

`apps/admin/src/transfers/views.tsx`:

```tsx
import clsx from 'clsx'
import type { QueueRow, Tab, TransferDetail } from './repository'
import { TABS } from './repository'
import { badge, button, cell, errorBox, field, muted, stack } from '../views/ui'

const TAB_LABEL: Record<Tab, string> = {
  'unmeasured': 'Unmeasured',
  'missing-reverse': 'Missing reverse',
  'deletes': 'Deleted',
  'drafts': 'Drafts'
}

const href = (id: string) => `/transfers/${encodeURIComponent(id)}`
const isBlocked = (notes: string | null) => notes !== null && /^blocked\b/i.test(notes)
const link = 'text-pink-700 underline-offset-2 hover:underline dark:text-pink-400'

export function QueuePage({ tab, rows }: { tab: Tab, rows: QueueRow[] }) {
  return (
    <>
      <h1 class="mb-3 text-2xl font-semibold">Transfers</h1>
      <div class="mb-3 flex flex-wrap gap-2">
        {TABS.map(t => (
          <a
            href={`/transfers?tab=${t}`}
            aria-current={t === tab ? 'page' : undefined}
            class={clsx('rounded-md px-2.5 py-1', t === tab ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}
          >
            {TAB_LABEL[t]}
          </a>
        ))}
        <a href="/transfers/new" class={clsx('ml-auto', button('secondary'))}>+ New transfer</a>
      </div>
      {rows.length === 0
        ? <p class={muted}>Nothing here</p>
        : (
          <table class="w-full border-collapse bg-white dark:bg-neutral-900">
            <thead><tr><th class={cell}>From</th><th class={cell}>To</th><th class={cell}>Distance</th><th class={cell}>Notes</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr>
                  <td class={cell}><a href={href(r.id)} class={link}>{r.fromName}</a> <span class={muted}>{r.fromOperator}</span></td>
                  <td class={cell}>{r.toName} <span class={muted}>{r.toOperator}</span></td>
                  <td class={clsx(cell, 'tabular-nums')}>{r.distance === 0 ? <span class={muted}>unmeasured</span> : `${r.distance} m`}</td>
                  <td class={clsx(cell, 'space-x-1')}>
                    {isBlocked(r.notes) && <span class={badge('warn')}>blocked</span>}
                    <span>{r.notes}</span>
                    {r.draftOp && <span class={badge()}>draft: {r.draftOp}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  )
}

export interface FormValues { distance: string, noTap: boolean, notes: string, applyReverse: boolean }

function Fields({ values }: { values: FormValues }) {
  return (
    <>
      <label class="grid gap-1">Distance (m, gate to gate)
        <input name="distance" inputmode="numeric" value={values.distance} placeholder="Empty keeps the imported value" class={field} />
      </label>
      <label class="flex items-center gap-2"><input type="checkbox" name="noTap" checked={values.noTap} /> No tap (stays inside one paid zone)</label>
      <label class="grid gap-1">Notes
        <textarea name="notes" rows={3} placeholder="e.g. blocked: flyover demolition" class={field}>{values.notes}</textarea>
      </label>
      <label class="flex items-center gap-2"><input type="checkbox" name="applyReverse" checked={values.applyReverse} /> Apply to the reverse direction too</label>
    </>
  )
}

const Back = () => <p class="mb-2"><a href="/transfers" class={link}>← Transfers</a></p>

export function EditPage({ detail, values, error }: { detail: TransferDetail, values: FormValues, error?: string }) {
  const action = href(detail.id)
  const none = (text = 'none') => <span class={muted}>{text}</span>
  return (
    <>
      <Back />
      <h1 class="text-2xl font-semibold">{detail.fromName} → {detail.toName}</h1>
      <p class={clsx(muted, 'mb-4 font-mono text-sm')}>{detail.id}</p>
      <table class="mb-4 w-full max-w-md border-collapse">
        <tbody>
          <tr><th class={cell}>Imported</th><td class={cell}>{detail.base ? `${detail.base.distance} m${detail.base.notes ? ` · ${detail.base.notes}` : ''}` : none('none (added by admin)')}</td></tr>
          <tr><th class={cell}>Live override</th><td class={cell}>{detail.published ? `${detail.published.op} ${detail.published.distance ?? ''}` : none()}</td></tr>
          <tr><th class={cell}>Draft</th><td class={cell}>{detail.draft ? `${detail.draft.op} ${detail.draft.distance ?? ''}` : none()}</td></tr>
        </tbody>
      </table>
      {error && <p class={clsx(errorBox, 'mb-4 max-w-md')}>{error}</p>}
      <form class={stack} method="post" action={action}>
        <Fields values={values} />
        <button type="submit" class={button()}>Save draft</button>
      </form>
      <div class="mt-8 flex max-w-md flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <form method="post" action={`${action}/delete`}>
          <input type="hidden" name="applyReverse" value="on" />
          <button type="submit" class={button('secondary')}>Delete (both directions)</button>
        </form>
        {detail.published && (
          <form method="post" action={`${action}/revert`}>
            <input type="hidden" name="applyReverse" value="on" />
            <button type="submit" class={button('secondary')}>Revert to imported (both directions)</button>
          </form>
        )}
        {detail.draft && (
          <form method="post" action={`${action}/discard`}>
            <button type="submit" class={button('secondary')}>Discard draft</button>
          </form>
        )}
      </div>
    </>
  )
}

export function NewPage({ stations, values, from, to, error }: {
  stations: { id: string, name: string, operator: string }[]
  values: FormValues, from: string, to: string, error?: string
}) {
  return (
    <>
      <Back />
      <h1 class="mb-4 text-2xl font-semibold">New transfer</h1>
      {error && <p class={clsx(errorBox, 'mb-4 max-w-md')}>{error}</p>}
      <datalist id="stations">
        {stations.map(s => <option value={s.id}>{`${s.name} (${s.operator})`}</option>)}
      </datalist>
      <form class={stack} method="post" action="/transfers/new">
        <label class="grid gap-1">From (station id)<input name="from" list="stations" value={from} required class={field} /></label>
        <label class="grid gap-1">To (station id)<input name="to" list="stations" value={to} required class={field} /></label>
        <Fields values={values} />
        <button type="submit" class={button()}>Save draft</button>
      </form>
    </>
  )
}
```

- [ ] **Step 4: Routes**

`apps/admin/src/transfers/routes.tsx`:

```tsx
import { Hono, type Context } from 'hono'
import type { AdminEnv } from '../env'
import { Layout } from '../views/layout'
import {
  countDrafts, discardDraft, getTransfer, listQueue, listStations, markDelete, revertToImported, saveDraft, TABS, type Tab
} from './repository'
import { EditPage, NewPage, QueuePage, type FormValues } from './views'

export const transferRoutes = new Hono<AdminEnv>()

const idParam = (c: Context<AdminEnv>) => decodeURIComponent(c.req.param('id') ?? '')

async function page(c: Context<AdminEnv>, title: string, body: JSX.Element, status: 200 | 404 | 422 = 200) {
  return c.html(<Layout title={title} draftCount={await countDrafts(c.env.DB)}>{body}</Layout>, status)
}

async function readForm(c: Context<AdminEnv>) {
  const form = await c.req.parseBody()
  const text = (key: string) => (typeof form[key] === 'string' ? form[key] as string : '').trim()
  const values: FormValues = {
    distance: text('distance'),
    noTap: form.noTap === 'on',
    notes: text('notes'),
    applyReverse: form.applyReverse === 'on'
  }
  return { values, from: text('from'), to: text('to') }
}

// Empty keeps the imported distance; anything else must parse as an integer, and
// saveDraft owns the actual rules (0, negatives, new transfers).
const parseDistance = (raw: string) => raw === '' ? null : /^\d+$/.test(raw) ? Number(raw) : NaN

const blankValues: FormValues = { distance: '', noTap: false, notes: '', applyReverse: true }

transferRoutes.get('/', async c => {
  const requested = c.req.query('tab') as Tab | undefined
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'unmeasured'
  return page(c, 'Transfers', <QueuePage tab={tab} rows={await listQueue(c.env.DB, tab)} />)
})

transferRoutes.get('/new', async c =>
  page(c, 'Transfers · new', <NewPage stations={await listStations(c.env.DB)} values={blankValues} from="" to="" />))

transferRoutes.post('/new', async c => {
  const { values, from, to } = await readForm(c)
  const result = await saveDraft(c.env.DB, {
    fromStationId: from, toStationId: to, distance: parseDistance(values.distance),
    noTap: values.noTap, notes: values.notes || null, applyReverse: values.applyReverse
  }, c.var.user)
  if (!result.ok) {
    return page(c, 'Transfers · new', <NewPage stations={await listStations(c.env.DB)} values={values} from={from} to={to} error={result.error} />, 422)
  }
  return c.redirect('/transfers?tab=drafts', 303)
})

transferRoutes.get('/:id', async c => {
  const detail = await getTransfer(c.env.DB, idParam(c))
  if (!detail) return page(c, 'Transfers · not found', <p>No such transfer</p>, 404)
  const current = detail.draft ?? detail.published
  const values: FormValues = {
    distance: current?.distance?.toString() ?? '',
    noTap: Boolean(current?.noTap ?? detail.base?.noTap),
    notes: current?.notes ?? detail.base?.notes ?? '',
    applyReverse: true
  }
  return page(c, `Transfers · ${detail.fromName}`, <EditPage detail={detail} values={values} />)
})

transferRoutes.post('/:id', async c => {
  const detail = await getTransfer(c.env.DB, idParam(c))
  if (!detail) return page(c, 'Transfers · not found', <p>No such transfer</p>, 404)
  const { values } = await readForm(c)
  const result = await saveDraft(c.env.DB, {
    fromStationId: detail.fromStationId, toStationId: detail.toStationId, distance: parseDistance(values.distance),
    noTap: values.noTap, notes: values.notes || null, applyReverse: values.applyReverse
  }, c.var.user)
  if (!result.ok) return page(c, `Transfers · ${detail.fromName}`, <EditPage detail={detail} values={values} error={result.error} />, 422)
  return c.redirect('/transfers', 303)
})

transferRoutes.post('/:id/delete', async c => {
  const { values } = await readForm(c)
  await markDelete(c.env.DB, idParam(c), values.applyReverse, c.var.user)
  return c.redirect('/transfers?tab=drafts', 303)
})

transferRoutes.post('/:id/revert', async c => {
  const { values } = await readForm(c)
  await revertToImported(c.env.DB, idParam(c), values.applyReverse, c.var.user)
  return c.redirect('/transfers?tab=drafts', 303)
})

transferRoutes.post('/:id/discard', async c => {
  await discardDraft(c.env.DB, idParam(c))
  return c.redirect('/transfers?tab=drafts', 303)
})
```

`parseDistance` returning `NaN` hits saveDraft's `!Number.isInteger` check, so `"abc"` gives "Distance must be a whole number of metres". If tsc can't resolve the global `JSX` namespace, import it: `import type { JSX } from 'hono/jsx/jsx-runtime'`.

Mount it in `apps/admin/src/app.tsx` after the auth middleware: `app.route('/transfers', transferRoutes)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/admin && npx vitest run && npx tsc --noEmit`
Expected: PASS (routes: 6 tests).

- [ ] **Step 6: Checkpoint.** No commit.

---

### Task 8: Publish page

**Files:**
- Create: `apps/admin/src/publish/routes.tsx`
- Modify: `apps/admin/src/app.tsx` (mount `app.route('/publish', publishRoutes)`)
- Test: `apps/admin/src/publish/routes.test.tsx`

**Interfaces:**
- Consumes: `listQueue(db, 'drafts')`, `getTransfer`, `publish`, `versionStatus`, `bumpVersion` (Task 6); `Layout`.
- Produces: `publishRoutes: Hono<AdminEnv>` serving `GET /` (diff + version status), `POST /` (publish, then 303 to `/publish?done=<id>` or `/publish?bumpFailed=<id>`), and `POST /bump` (retry version bump, then 303 to `/publish`).

- [ ] **Step 1: Write the failing test**

`apps/admin/src/publish/routes.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { DATA_VERSION_KV_KEY } from '@commute/constants'
import { createApp } from '../app'
import { fakeKV, migratedD1, seedStations, seedTransfer } from '../../test/sqlite-d1'

const A = 'KCI-AAA', B = 'TJ-BBB'
let db: DatabaseSync
let kv: ReturnType<typeof fakeKV>
let env: { DB: D1Database, KV: KVNamespace, ACCESS_TEAM_DOMAIN: string, ACCESS_AUD: string }

beforeEach(() => {
  const m = migratedD1()
  db = m.db
  kv = fakeKV()
  seedStations(db, [A, B])
  seedTransfer(db, A, B, 0)
  seedTransfer(db, B, A, 0)
  env = { DB: m.d1, KV: kv.kv, ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }
})

const req = (path: string, init: RequestInit = {}) => createApp().request(`http://localhost${path}`, init, env)
const saveDraft = () => req(`/transfers/${encodeURIComponent(`${A}->${B}`)}`, { method: 'POST', body: new URLSearchParams({ distance: '300', applyReverse: 'on' }) })

describe('publish page', () => {
  it('shows imported vs draft for each pending row', async () => {
    await saveDraft()
    const html = await (await req('/publish')).text()
    expect(html).toContain('unmeasured')
    expect(html).toContain('300 m')
  })

  it('publishes and bumps the live version', async () => {
    await saveDraft()
    const res = await req('/publish', { method: 'POST' })
    expect(res.status).toBe(303)
    expect(kv.store.get(DATA_VERSION_KV_KEY)).toMatch(/^\d{8}T\d{6}-[0-9a-f]{4}$/)
  })

  it('offers a retry when the version bump failed, and the retry fixes it', async () => {
    await saveDraft()
    kv.failNextPuts()
    await req('/publish', { method: 'POST' })
    expect(await (await req('/publish')).text()).toContain('Retry version bump')
    kv.failNextPuts(false)
    await req('/publish/bump', { method: 'POST' })
    expect(kv.store.has(DATA_VERSION_KV_KEY)).toBe(true)
    expect(await (await req('/publish')).text()).not.toContain('Retry version bump')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx vitest run src/publish/routes.test.tsx`
Expected: FAIL, `/publish` returns 404.

- [ ] **Step 3: Implement**

`apps/admin/src/publish/routes.tsx`:

```tsx
import clsx from 'clsx'
import { Hono } from 'hono'
import type { AdminEnv } from '../env'
import { Layout } from '../views/layout'
import { button, cell, errorBox, muted } from '../views/ui'
import { bumpVersion, getTransfer, listQueue, publish, versionStatus } from '../transfers/repository'

export const publishRoutes = new Hono<AdminEnv>()

const metres = (d: number | null | undefined) => d === null || d === undefined ? '' : d === 0 ? 'unmeasured' : `${d} m`

publishRoutes.get('/', async c => {
  const db = c.env.DB
  const rows = await listQueue(db, 'drafts')
  const details = await Promise.all(rows.map(r => getTransfer(db, r.id)))
  const status = await versionStatus(db, c.env.KV)
  const stale = status.latestPublishId !== null && status.latestPublishId !== status.liveVersion

  return c.html(
    <Layout title="Publish" draftCount={0}>
      <h1 class="mb-4 text-2xl font-semibold">Publish</h1>
      {stale && (
        <form method="post" action="/publish/bump" class="mb-6 grid max-w-xl gap-3">
          <p class={errorBox}>
            Publish {status.latestPublishId} is in the database, but the API is still on version {status.liveVersion ?? 'none'}.
            Riders won't see it until the version is bumped
          </p>
          <button type="submit" class={clsx(button(), 'justify-self-start')}>Retry version bump</button>
        </form>
      )}
      {rows.length === 0
        ? <p class={muted}>No draft changes</p>
        : (
          <>
            <table class="mb-4 w-full border-collapse bg-white dark:bg-neutral-900">
              <thead>
                <tr><th class={cell}>Transfer</th><th class={cell}>Change</th><th class={cell}>Imported</th><th class={cell}>Live now</th><th class={cell}>After publish</th></tr>
              </thead>
              <tbody>
                {details.map(d => d && (
                  <tr>
                    <td class={cell}><a href={`/transfers/${encodeURIComponent(d.id)}`} class="text-pink-700 hover:underline dark:text-pink-400">{d.fromName} → {d.toName}</a></td>
                    <td class={cell}>{d.draft?.op}</td>
                    <td class={clsx(cell, 'tabular-nums')}>{d.base ? metres(d.base.distance) : <span class={muted}>none</span>}</td>
                    <td class={clsx(cell, 'tabular-nums')}>{metres(d.published?.op === 'upsert' ? (d.published.distance ?? d.base?.distance) : d.base?.distance)}</td>
                    <td class={clsx(cell, 'tabular-nums font-medium')}>{d.draft?.op === 'upsert' ? metres(d.draft.distance ?? d.base?.distance) : d.draft?.op === 'revert' ? metres(d.base?.distance) : 'removed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form method="post" action="/publish" class="grid max-w-xl gap-3">
              <p class={muted}>Clients pick this up when their HTTP cache expires (up to a few hours)</p>
              <button type="submit" class={clsx(button(), 'justify-self-start')}>Publish {rows.length} {rows.length === 1 ? 'change' : 'changes'}</button>
            </form>
          </>
        )}
    </Layout>
  )
})

publishRoutes.post('/', async c => {
  const result = await publish(c.env.DB, c.env.KV, c.var.user)
  if (!result) return c.redirect('/publish', 303)
  return c.redirect(`/publish?${result.versionBumped ? 'done' : 'bumpFailed'}=${result.publishId}`, 303)
})

publishRoutes.post('/bump', async c => {
  await bumpVersion(c.env.DB, c.env.KV)
  return c.redirect('/publish', 303)
})
```

Mount it in `apps/admin/src/app.tsx`: `app.route('/publish', publishRoutes)`.

- [ ] **Step 4: Run all admin tests, then typecheck and lint**

Run: `cd apps/admin && npx vitest run && npx tsc --noEmit && pnpm build:css && cd ../.. && pnpm lint`
Expected: PASS (all admin suites), tsc clean, CSS builds, lint clean.

- [ ] **Step 5: Checkpoint.** No commit.

---

### Task 9: End-to-end local verification

No new code. This proves the loop works on real workerd with the shared local D1/KV.

- [ ] **Step 1:** Check for the user's already-running dev servers before starting anything: `ss -ltnp | grep -E ':(3000|3002)\b'`. Don't kill existing ones. Reuse a running API on :3000.
- [ ] **Step 2:** `cd apps/api && npx wrangler d1 migrations apply commute --local` (no-op if Task 1 already applied it).
- [ ] **Step 3:** Start the API (`cd apps/api && pnpm dev`) if it isn't running, and the admin (`cd apps/admin && pnpm dev`; wrangler runs `build:css` first) in the background. Take a mobile-width screenshot of `/transfers` and `/transfers/<id>` (xvfb headed Chromium, per the map-testing memory) to confirm Tailwind styles load.
- [ ] **Step 4:** Pick an unmeasured row: `cd apps/api && npx wrangler d1 execute commute --local --command "SELECT id FROM transfers WHERE dataType='INTERNAL' AND distance=0 LIMIT 1"`. Call it `ID` and its from-station `FROM`.
- [ ] **Step 5:** Fetch the before state: `curl -s localhost:3000/stations/<op>/<code>/transfers` for `FROM` (look up the exact route in `routes/stations.ts:598`). Note the distance (0).
- [ ] **Step 6:** Submit the edit, then publish:
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST "localhost:3002/transfers/$(node -p 'encodeURIComponent(process.argv[1])' "$ID")" -d distance=300 -d applyReverse=on` → `303`
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3002/publish` → `303`
- [ ] **Step 7:** Wait 61 s (the dataVersion memo), then repeat Step 5. Expected: distance 300. Confirm the new KV key suffix with `npx wrangler kv key list --binding KV --local | grep transfers:`, which should show a `.<publishId>` suffix.
- [ ] **Step 8:** Run an importer re-run over that row (e.g. `npx wrangler d1 execute commute --local --file src/db/scripts/measured_transfers_2026_09_29.sql`). Then query `SELECT distance FROM transfers_effective WHERE id = '<ID>'` → still 300. The override wins.
- [ ] **Step 9:** Full suites: `cd apps/api && pnpm test` and `cd apps/admin && pnpm test`. Report the counts. Stop the servers you started (only those).
- [ ] **Step 10:** Report "ready to deploy". Remaining user-only steps: create the Access application for `admin.commute.shiorilabs.id`, fill `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `apps/admin/wrangler.toml`, apply migration 0017 remotely, then deploy the API and the admin. No commit.
