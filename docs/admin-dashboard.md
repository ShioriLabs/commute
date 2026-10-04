# Admin dashboard: foundation + transfers (design spec)

## Context

Every data change today is a hand-written SQL seed applied to remote D1 by hand (e.g. `apps/api/src/db/scripts/measured_transfers_2026_09_29.sql`), followed by an `API_VERSION` bump in `apps/api/wrangler.toml` and a deploy to bust KV. The user wants an admin app that eventually covers data editing, data-quality audits, ops/health, service notices and (later) editorials.

That is five subsystems, so they are decomposed. **This spec covers only the foundation plus the first module: the transfers editor and its audit queue.** Those exercise the full write → publish → cache-bust loop on the most-repeated seed chore. Later modules get their own specs.

### Decisions made (with the user)
- First module: transfers editor + unmeasured-transfer audit.
- Hosting: deployed, behind Cloudflare Access.
- Freshness: edits stage as drafts; a **Publish** step bumps a runtime data version. A lag of up to the HTTP max-age on clients is acceptable.
- Source of truth: **overrides layer**. Admin never edits imported rows. Importers keep owning base tables and stay safe to re-run.
- Stack: **one Hono Worker, server-rendered Hono JSX**, no SPA, no client build. Simplicity.

## Architecture

```
admin.commute.shiorilabs.id ──(Cloudflare Access)──▶ apps/admin  (Hono Worker, JSX SSR)
                                                        │ binds same D1 (DB) + KV
                                                        ▼
                                  transfer_overrides, publishes  ──▶ view transfers_effective
                                                                            ▲
apps/api (public) ── reads transfers_effective, KV keys suffixed with dataVersion ┘
```

- `apps/admin`: a new workspace package. A Hono Worker with `wrangler.toml` binding the same `DB` and `KV` as `apps/api`. It imports Kysely `db()` and table types from `@commute/api` as a workspace dependency, no copying.
- The public API gains **no write routes**. It only (a) reads through the view and (b) mixes the data version into cache keys.
- Never run `wrangler deploy`. Local dev only, and the user deploys.

## Data model (new migration in `apps/api/src/db/migrations/`)

`transfer_overrides`
| col | notes |
|---|---|
| `id` PK | same key as `transfers.id` (`${from}->${to}`) |
| `op` | `upsert` \| `delete` |
| `fromStationId`, `toStationId` | needed when the override ADDS a transfer that has no base row |
| `distance`, `noTap`, `notes` | upsert payload (`notes` also carries "blocked: Grogol flyover"-style annotations) |
| `status` | `draft` \| `published` |
| `editedBy`, `updatedAt` | from the Access JWT email |
| `publishId` | FK to `publishes`, null while draft |

`publishes`: `id`, `publishedAt`, `publishedBy`, `changeCount`, `summary`.

`transfers_effective` (VIEW): base `transfers` rows, replaced by published `upsert` overrides, plus published upserts with no base row (INTERNAL, built from from/to ids), minus published `delete` overrides. Drafts are invisible.

Scope note: overrides cover INTERNAL transfers only. EXTERNAL rows (`toStationData` JSON) pass through the view untouched.

## API changes (`apps/api`)

1. **Readers switch to the view**. These are the only two:
   - `EdgeRepository.getGraphInputs`: `apps/api/src/db/repositories/edges.ts:33`
   - `StationRepository.getTransfersFromStationId`: `apps/api/src/db/repositories/stations.ts:365`
   (Kysely: add the view to the DB schema types.)
2. **`dataVersion(env)` helper** (`apps/api/src/utils/data-version.ts`): reads KV `meta:dataVersion`, memoised in isolate memory for 60s, defaulting to `'0'`. It exposes `cacheVersion(env) = ${API_VERSION}.${dataVersion}`.
3. **KV keys** change from `…:${c.env.API_VERSION}` to `…:${await cacheVersion(c.env)}`. Call sites: `routes/cache.ts`, `routes/internal.ts` (`searchablesKVKey`), `routes/stations.ts`, `routes/lines.ts`, `routes/hubs.ts`, `routes/sync.ts`, `utils/journey-endpoint.ts`, `utils/places.ts`. Grep `API_VERSION` to be exhaustive.
4. **Router memo**: `cachedRouter` in `apps/api/src/routes/fares.ts:24` is a never-invalidated singleton. Key it by data version so a publish rebuilds the graph. Check `getPlaceIndex` in `utils/places.ts` for the same pattern.
5. Deploy-time `API_VERSION` bumps keep working unchanged.

## Admin app (`apps/admin`)

**Auth middleware**: verifies `Cf-Access-Jwt-Assertion` against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` and the app `aud` (both wrangler vars), then sets `c.var.user = email`. Local dev skips the check with an explicit `ACCESS_DEV_USER` in `.dev.vars` (see correction 9). A failed check returns 403. Defence in depth behind Access.

**Shell**: a JSX `Layout` with a nav (Transfers live; Notices, Audits, Ops, Editorials greyed out). Tailwind 4 utility classes inline in the JSX, with `clsx` for conditional classes, compiled by the Tailwind CLI as wrangler's `[build]` step into `public/admin.css` and served as a static asset (behind the same Access policy). Mobile-first, because transfers get measured on foot. A **publish bar** appears on every page when drafts exist: "N draft changes · Review · Publish".

**Routes** (plain forms, POST → redirect, zero client JS):
- `GET /transfers?tab=unmeasured|missing-reverse|deletes|drafts`: queue tables over `transfers_effective` + overrides. Rows show from→to names, operator, effective distance, notes, and a line-colour tint (port of `getTintFromColor` if it's pure, so it can be shared via `@commute/constants`). Busiest hubs come first via station scores. Rows noted "blocked" are shown but marked.
- `GET /transfers/:id`: form for distance, noTap, notes, and **"apply to reverse" checked by default**. Shows the imported value beside the override. `POST` upserts draft override(s). `POST /transfers/:id/revert` deletes the override(s).
- `GET /transfers/new`: from/to via a GET station-name search (server-side `LIKE`/fuzzy over `stations`), then the same form. Creates `upsert` overrides with no base row.
- `POST /transfers/:id/delete`: draft `delete` override.
- `GET /publish`: diff of base vs draft per row. `POST /publish`: one D1 batch (drafts → published, `publishes` row, set `publishId`). Only after the batch succeeds does it `KV.put('meta:dataVersion', publishId)`. If the KV write fails, the page shows a "Retry version bump" button, since D1 is already correct.

## Error handling
- A KV write failing after the D1 batch is recoverable via retry, and the page says so explicitly.
- Validation: distance is an integer ≥ 0 (0 is rejected on save: "distance=0 means UNMEASURED", so the user deletes or leaves it); from ≠ to; both stations exist.
- Concurrency: single user. Last write wins, no locking.

## Testing
- **View semantics** against real SQLite (Node 24 `node:sqlite`): run the migrations, then test override-replaces-base, add-without-base, delete hides base, drafts invisible, EXTERNAL pass-through.
- Auth middleware: valid token, wrong aud, expired, missing header, localhost bypass.
- `dataVersion`: memo TTL, default `'0'`, key composition. Router rebuilds when the version changes.
- Admin routes via `app.request()` against the node:sqlite-backed D1 shim: form → draft row; apply-to-reverse writes 2 rows; publish flips status, writes the log, and calls KV exactly once after D1.
- Regression: existing api tests (613) and `auditRouter --baseline` show 0 diffs with no overrides present (the view equals the base table).

## Verification (end to end, local)
1. Apply the migration to local D1. Run `wrangler dev` for `apps/admin` and `apps/api` together on the same local D1/KV (shared `--persist-to`).
2. In admin, set Grogol (or any distance=0 row) to 300 m with reverse applied, check the Drafts tab, Publish.
3. `curl` the API station transfers for that station: the new distance shows; KV key suffix changed; `/_internal/trips` for a pair through it reflects the new walk.
4. Re-run a transfers importer seed locally, then confirm the override still wins.

## Out of scope (own specs later)
Service notices (public-site surface), ops/health dashboard, other editors (amenities, hubs, station flags/renames), broader audits, editorials, multi-user/roles.

## Corrections from planning (2026-10-01, override the sections above)

Found while writing `docs/admin-dashboard-plan.md`:

1. **No Kysely import from `@commute/api`.** The API resolves bare imports from `baseUrl: src` (`'db/…'`, `'utils/…'`), and those paths don't resolve from another package. Admin writes raw D1 prepared statements instead. Its SQL is small and gets tested against real SQLite anyway.
2. **Override PK is `(id, status)`, and a third op `revert` exists.** With `id` alone as the key, editing an already-published override would turn it back into a draft and take the live value down before publish. Now at most one live row and one pending row exist per transfer. `revert` is a draft-only op meaning "drop the live override on publish".
3. **`distance` on an upsert is nullable, meaning "keep the imported distance".** Otherwise a "blocked: Grogol flyover" note couldn't be saved on a row that has no measurement. `distance > 0` is enforced by a CHECK, so 0 can never be written.
4. **No line-colour tint in admin.** A transfer row has no single line to tint by. The operator code is shown as text instead.
5. **Tests use `node:sqlite`** (built into Node 24, which is installed).
6. **`workers_dev = false`**, so the localhost auth bypass can never be reached through a second, unprotected hostname.
7. **`DATA_VERSION_KV_KEY` lives in `@commute/constants`**, shared by the API and admin.
8. **Styling is Tailwind 4 + clsx** (user decision), not hand-written CSS. The CLI runs as wrangler's `[build]` command (`watch_dir = "src"` under dev), and shared class recipes live in `views/ui.ts`.
9. **No localhost bypass; local dev uses `ACCESS_DEV_USER` from `.dev.vars`.** Under `wrangler dev` the Worker sees the `routes` host (`admin.commute.shiorilabs.id`), not localhost, so a hostname check never fires there. An explicit var, which only `.dev.vars` sets and which never deploys, is both what works and the safer rule.
