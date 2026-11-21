# TJ feed refresh, 2026-11 (prod runbook)

Local D1 already has this applied (committed `dd3795f0`). Remote is NOT applied.
**TJ only**: `edges.sql` also carries the Gapeka line A rows, which stay held for the
1 Dec 00:00-03:30 WIB changeover, so never run the full `edges.sql` on remote before then.

## What the new feed changed

- No `shape_dist_traveled` anywhere: `pnpm --filter api fill:tj-shape-dist` snaps stops onto
  each trip's shape (Viterbi, monotonic, cross-trip consensus prior). Run it before the
  generators on any feed that lacks the column.
- Directional haltes added on 3H fold back onto the poster halte (`tjStopFold.ts`).
- Lines 7 and 7F recoloured pink (poster), overriding the feed's brown.
- 100 -> 95 lines: 10C, 1N, 2C, 8A gone, PRJ2/PRJ3 ended; 51ST, 9ST added.

## Apply to remote (user runs; never `wrangler deploy`)

Order matters; each file is idempotent.

1. `tj_refresh_2026_11_1_stations.sql`: upsert, unchanged rows are not rewritten (~63 writes: 42 new + 21 changed on the local pre-refresh DB).
2. `tj_refresh_2026_11_2_stationlines.sql`: 169 per-row DELETEs of stale TJ stationLines, then INSERT OR IGNORE of the 3,927 current rows.
3. `tj_refresh_2026_11_3_edges.sql`: 997 INSERT OR REPLACE rows (220 of them change a distance), TJ rows only.
   No regeneration is needed. `generate:edges` warns that `TJ-B08301P` / `TJ-B08302P` have no coordinates because
   prod's public `/stations` lists only searchable stops; both stops exist on remote (hidden Manggarai Temporer haltes),
   and the four hops through them are unchanged from the previous commit. To regenerate anyway:
   `pnpm --filter api generate:edges`, keep `grep -F "'TJ-"`, then `git checkout` the full `edges.sql` (Gapeka rail rows).
4. Apply step 3 (any time after steps 1-2).
5. Bump `API_VERSION` and deploy with the rest.

Rehearsed on a copy of the pre-refresh local D1: 2,250 TJ stations (245 searchable), 3,927 stationLines, `foreign_key_check` clean, re-running step 1 rewrites 0 rows.
Estimated writes ~5-6k, well inside one day's free budget.

## Remote check (2026-11-21, read-only SELECT)

Remote D1 equals the local pre-refresh state: 2,208 TJ stations, 3,986 TJ stationLines, 996 TJ edges, and the
dropped lines present with the same row counts (10C 10, 10D 20, 1N 52, 2C 7, 8A 10, PRJ2 15, PRJ3 16). Step 2's
DELETE list therefore matches remote exactly. Afterwards those seven lines should have 0 rows.
