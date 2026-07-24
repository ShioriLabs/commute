# Authoring FDTJ map tap-targets (`points.json`)

**Status:** Rail (`KCI-`/`MRTJ-`/`LRTJBDB-`/`LRTJ-`/`HUB-`) and **Koridor 1**
(Blok M ↔ Kota, 23 TJ haltes, verified) are done. Other TJ corridors: TODO.

`apps/web/public/maps/fdtj/points.json` holds tap-target shapes, consumed by
`app/routes/map.tsx` → `app/lib/map-renderer.ts`. The map is a **schematic**
(TfL-style, not geo-accurate) — read positions **off the drawing**, never from
GTFS lat/lon.

## Point shape

```jsonc
{ "id": "TJ-H00014P", "ax": 3320, "ay": 5040, "bx": 3320, "by": 5040, "r": 14 }
```

`ax,ay → bx,by` is the capsule centerline, `r` the half-width (`Point` in
`map-renderer.ts`); `ax==bx && ay==by` is a dot. Coords are world/viewBox space
`0 0 9513.57 6726.88`. `cr` = optional corner radius (hubs only).

## id → station

`map.tsx` splits the id on the **first hyphen** → `/stations/{operator}/{code}`.
A TJ point is `TJ-<code>`, where `<code>` is the GTFS **`location_type=1` parent**
stop_id (`H…P/S/C`) — the same codes `apps/api/src/db/data/topology.tj.ts` uses.
Names ↔ codes: `stops.txt` in `file_gtfs.zip` (repo root). The **map is
authoritative** for which halte sits where; the feed is only the name→code
dictionary (e.g. the map draws Monas `H00131P` on K1 where the feed routes via
Petojo `H00170P` — follow the map).

## Pixel → world

`@2x` tiles are exactly **2 px/world-unit** (`tile-{r}-{c}@2x.webp` = 4757×3363 px
per 2378.3925×1681.72 world tile):

```
origin: x0 = c*2378.3925,  y0 = r*1681.72   (c=col, r=row, 0..3)
world  = origin + px_@2x / 2
```

Sanity-check a known rail point first (e.g. `MRTJ-BHI` = 3635,3494 on the M13 marker).

## Shapes

- **Stack of markers** (`○○`, or `○○△▽△` like Monas) → capsule spanning the two
  extreme marker centers, oriented along the row. Precedent: Manggarai `KCI-MRI`.
- **Single marker** → dot.
- **Radius:** `r≈12`; black pills/loops (e.g. Dukuh Atas) `r≈14` — match the shape.
- Hug the markers; don't overshoot.

## Workflow

Helpers are throwaway scratchpad PIL scripts (grid / fine-crop / overlay). Loop:

1. **Grid overlay** a tile crop (world-coord ruler); read marker centers, convert.
2. **Fine-crop** (5–7×) dense clusters to nail endpoints + orientation.
3. **Verify overlay** — draw the shapes back on the map, eyeball every one, iterate.
4. **Write** — append to the end of `points` (match 4/6-space indent, pure add;
   leave existing lines and `version`/`manifest.json` untouched).
5. **Validate** — JSON parses; `len(points)` and ids unique.

Final human check: `/map?author=1` (dev) renders all hitboxes. Author mode
hydrates from `localStorage['fdtj-author-points-v1']` first, so clear that key to
see edits made directly in the file.

## Koridor 1 — conventions set

- **Directional-split haltes:** two points when the map draws two distinct
  direction markers (1-2 → ASEAN `H00265P` on the `▷`, Kejaksaan Agung `H00266P`
  on the `▽`); one point when it's a single `○○` marker (Kebon Sirih = `H00268S`).
- A code the API doesn't yet serve on a corridor can 404 at `/stations/TJ/<code>`
  until seeded — expected, not a blocker.

See also `docs/tj-gtfs-import.md` (feed) and `platform-codes.md`.
