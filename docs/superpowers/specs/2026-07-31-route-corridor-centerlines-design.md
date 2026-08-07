# Route overlay corridor centerlines — design

**Date:** 2026-07-31
**Status:** approved (follows the fare↔map route overlay, phase 1)
**Scope:** rail + BRT

## Problem

The map's route overlay draws ride legs as straight chords between station tap-target
centroids. On dense straight corridors this looks right; on curved corridors it visibly
cuts across the artwork (e.g. the Manggarai→Sudirman leg of the Cikarang line draws a
long diagonal over unrelated map furniture). The overlay should follow the schematic's
own corridor centerlines.

## Constraints discovered up front

- `app/data/map-skeleton.json` already holds the rail centerlines (16 strokes, width 25,
  world coordinates identical to `points.json`, curves pre-flattened at 8-unit sampling
  and RDP-simplified at ε=2.5 — sub-pixel at every zoom the overlay is seen at). BRT
  (width 15, ~39 short mesh segments) was deliberately excluded for the loader animation.
- Stroke colors are artwork hex (MRT is `#CA2B51` crimson on the sheet), NOT the API's
  `lineColor` brand colors. Matching legs to strokes must be geometric, never by color.
- Station tap-targets sit on their corridor stroke, so projection distance onto the
  correct stroke is ~0–15 world units.
- Known trap (docs'd 2026-07-29): the Cikarang main line passes straight through
  Jatinegara, so a single-point proximity test matches the wrong stroke. Matching must
  consider both endpoints of a pair plus a path-length sanity check.

## Design

### Data: `app/data/map-corridors.json` (new, generated)

`scripts/build-map-skeleton.ts` gains a second output alongside the skeleton:

```json
{
  "version": "<map edition>",
  "corridors": [ { "w": 25, "pts": [[x, y], ...] }, ... ]
}
```

- Includes both width classes: 25 (rail) and 15 (BRT).
- Plain point arrays, not SVG `d` strings — the consumer needs no path parser. Color is
  omitted: matching is geometric and rendering uses the API leg color.
- BRT uses a lower minimum-length cutoff than rail's 320 (BRT corridor segments are
  short); the station-tick/icon guard remains.
- `map-skeleton.json` and the loader are untouched — the ~60 KB of duplicated rail
  geometry between the two generated files is accepted so a corridors retune can never
  change the load animation.
- Loaded by the /map route the same way as `points.json` (`?url` import + SWR), passed
  into the overlay model builder pre-parsed.

### Matching: per adjacent stop pair, in `map-route-overlay.ts`

For each consecutive pair of resolved stop centroids (a, b) in a RIDE leg:

1. Project a and b onto every corridor polyline (closest point, arc-length parameter).
2. Candidate corridors: `max(dist(a), dist(b)) ≤ 40` world units.
3. Among candidates, pick the smallest `max(dist(a), dist(b))`.
4. Extract the sub-polyline between the two arc-length parameters (either direction).
5. Sanity check: if sub-path length > 2.5 × straight-line distance, it is a wrong-stroke
   detour (loop arc, parallel corridor) — reject the candidate and try the next; if none
   survive, fall back to the chord.
6. Emit the sub-path as consecutive `RouteSegment`s (kind `ride`, leg's API color,
   existing half-width). No match at all → today's chord, unchanged.

Per-pair (not per-leg) matching is what makes branches, the Cikarang loop, and
interlined trunks work without any line↔stroke mapping table. Transfers keep their
straight dashed connectors. Pins, casing, scrim, chip, camera fit: all unchanged — the
bbox simply grows to cover the sub-paths.

### What deliberately does not change

- `RouteOverlay` / `Renderer` API, both renderers, `routeDrawItems`.
- Fallback behavior for stops missing from points.json (skip + chord).
- `map-skeleton.json`, the loader, and tile assets.

## Error handling

- Corridors file missing/failed fetch → model builds without it; every pair chords
  (exactly phase-1 behavior). No error surface.
- Version skew between corridors and points: harmless — matching is geometric; a moved
  tap-target just projects slightly differently or falls back to a chord.
- Degenerate projections (pair projecting to the same arc point) → chord.

## Testing

- Unit (vitest, pure functions): point→polyline projection with arc params; sub-path
  extraction across vertices and direction reversal; detour rejection (loop fixture);
  both-endpoint threshold rejection (Jatinegara fixture: point ON a passing stroke whose
  partner is far); chord fallback when no corridors match; existing
  `map-route-overlay.test.ts` passes unchanged when no corridors are supplied.
- Build script: regenerate, assert corridors count sanity (rail ≥ 12, BRT ≥ 20) in the
  script's own guardrails.
- End-to-end (Playwright drill, existing recipe): MRI→Blok M — the Sudirman diagonal
  must follow the corridor curve; one TJ pair hugging a BRT stroke; screenshot review.
