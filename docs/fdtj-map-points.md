# Authoring FDTJ map tap-targets (`points.json`)

**Status:** Rail (`KCI-`/`MRTJ-`/`LRTJBDB-`/`LRTJ-`/`HUB-`) and **all TransJakarta
BRT corridors** are done and verified — 229 `TJ-` points across Koridor 1–14
(355 points total). 15 GTFS halte codes are deliberately unplotted: 14 directional
`Arah …` pairs that share one drawn marker with their partner code, plus Kebon
Sirih `H00267S`, which has no marker of its own. Non-BRT TJ services: TODO.

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
  A stack belongs to **one** halte — it is that stop's glyphs across the corridor
  lines it serves. **A black connector joining two glyph clusters is an interchange
  link between two different haltes, not one big stack**: e.g. the Kuningan elbow
  carries Underpass Kuningan (`○▽` at ~4214,4820) at one end and Simpang Kuningan
  (`○◁` at ~4304,4890) at the other — 304 m apart in reality. Give each end its
  own point; never let a capsule cross the connector. Same for the Velbak/Kebayoran
  elbow and the Jatinegara bar.
- **Single marker** → dot.
- **Radius:** `r≈12`; black pills/loops (e.g. Dukuh Atas) `r≈14` — match the shape.
- Hug the markers; don't overshoot.

## Reading marker centres

**Do not eyeball centres off the grid ruler.** Reading a coordinate by eye inside
a thick marker ring is unreliable — it lands on the ring's *top edge*, ~25 world
units high, and a wide-zoom overlay still looks correct. Detect the centre
instead: flood-fill the near-white disc inside the ring (a component that doesn't
touch the crop border), filter by radius/aspect/fill, and take its centroid.
Marker discs are **r≈8.9 world units**; hitbox `r` is 12 (14 for black
pills/bars/loops). Triangle glyphs (△/▽/▷) fail the circularity filter — drop
the aspect/fill constraints to get their blob centroid.

Verify every point with a **tight** overlay crop (a few hundred world units
tall): the shape must sit *concentrically on* its marker, not above or beside it.

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
  Where one marker serves two codes, the **lower corridor-label number wins** and
  the sibling goes unplotted (see the 16 codes listed under *Status*).
- **Match haltes by NAME, never by the corridor-label number.** The map's printed
  numbers routinely disagree with the feed's stop order (a stop listed as `4-13`
  may be drawn `5-13`), and similar names are distinct markers ~110 units apart —
  `Flyover Jatinegara` (K10) vs `Stasiun Jatinegara` (K11) vs `Jatinegara` (K5).
  Confirm a candidate by checking that its neighbours along the drawn line are the
  adjacent haltes in the corridor.
- **A shared number is NOT evidence of a shared marker.** The marker drawn
  `9-25 12-25 Penjaringan` is Penjaringan only — both numbers are its own (stop 25
  on K9 *and* on K12). Bandengan `H00007P` is a separate `◁` glyph at
  (3109, 1918) labelled `12-24`, ~1.7 km away in reality. Note the map's K12
  numbering runs one *behind* the feed's near the corridor end (feed `12-25` =
  Bandengan, drawn `12-24`). Two codes only share a marker when the drawing shows
  a single glyph for them — verify with GTFS lat/lon before merging any pair.
- A code the API doesn't yet serve on a corridor can 404 at `/stations/TJ/<code>`
  until seeded — expected, not a blocker.

See also `docs/tj-gtfs-import.md` (feed) and `platform-codes.md`.
