# Label tap-targets

**Status: wired into the map.** Output is
`apps/web/app/data/label-points.json` — 376 rects in `points.json`'s own shape.
`apps/web/app/routes/map.tsx` fetches it via SWR and merges it into
`workingPoints` for hit-testing/rendering alongside the regular tap points.

## Commands

```
MAP_PDF="<edition>.pdf" python3 apps/web/scripts/build_label_points.py
MAP_PDF="<edition>.pdf" python3 apps/web/scripts/audit_label_points.py
```

The build is idempotent — byte-identical output on an unchanged PDF, which is
what makes `utils/label-points-geometry.test.ts` meaningful. The audit writes a
contact sheet (60 cells on an 800-unit grid, each with a 100-unit coordinate
overlay, every box drawn and a leader line to its marker) plus `defects.tsv`,
into `scratch/label-audit/`.

**Python, not TypeScript beside the other build scripts.** This needs per-line
text geometry, and `pdf2svg` — what `build-map-tiles.ts` uses — renders text as
glyph OUTLINES: the master SVG for this edition has zero `<text>` elements and
11,583 `<use>` references into anonymous `glyph-N-M` paths. A Node port would
have to re-implement text layout to recover which glyphs spell which word.
PyMuPDF hands over assembled lines already in points.json's world space.

## Why a visual sweep, not just metrics

The first pass was tuned reactively — spot a bad label, fix that class,
re-measure. Overlaps fell 44 → 6 that way, and the numbers looked healthy while
**nine labels were silently glued to a neighbour**: one r=86 box read
`"10-12 Pemuda Pramuka 10-13 Utan Kayu Rawamangun"` with two stations claiming
it. No metric being watched named that defect, so nothing found it.

Sweeping every populated cell on a coordinate grid found it in one pass, along
with two more classes no detector was looking for. Detectors find what they are
told to look for; the sheets find the rest.

## What this is

Station *names* on the FDTJ map are far bigger than their markers but are currently
inert. This extracts a tap-target capsule for each drawn label so the name becomes
tappable too.

Median label capsule is ~5,800 world units² against ~450 u² for an `r=12` dot —
roughly **13x the target area**. That is the whole argument for doing it.

## How it works

`pdftotext`-style extraction is not enough: we need geometry. PyMuPDF's
`page.get_text('dict')` gives per-line bboxes **and a direction vector**, in the
same world space as `points.json` (`0 0 9513.57 6726.88`), so no coordinate
translation is involved.

1. Pull every text line with its bbox, font size and `dir`.
2. Merge vertically stacked lines into one label block. Three conditions, each
   of which was needed to fix a real case:
   - **Horizontal labels wrap either FLUSH-LEFT or CENTRED**, and the map uses
     both, so accept a line whose left edge is within 0.30x font size OR whose
     centre is within 0.90x. "14-5 / JIEXPO / Kemayoran" is left-aligned and
     fails a centre test (its lines differ in width, so the centres slide);
     "Pondok / Jati" and "Pasar / Genjing" are centred and fail a left test
     (69.5 and 16.2 units of left offset). The thresholds separate cleanly: real
     wraps measure 0.00-0.68x centre offset, while the nearest false pair —
     "BNI City" above "Dukuh Atas" — is 3.63x.
   - **Rotated labels need the same test in text-local axes.** "Bojong Gede" is
     two 45-degree lines whose left edges differ by 31 units because the wrap
     offsets diagonally. Project the centre-to-centre offset onto the baseline
     direction and its perpendicular instead, and require little slide along the
     baseline. The two orientations genuinely need different rules — one set of
     thresholds cannot satisfy both.
   - **The vertical gap may be NEGATIVE** (-0.45 to +0.45 x font size). The map
     sets multi-line labels with tight leading, so consecutive line bboxes
     overlap by ~14 units. An earlier `0 <= gap` rule silently rejected every
     tightly-led label — "14-5 / JIEXPO / Kemayoran" came out as a 62-unit
     capsule reading only "JIEXPO".
   - **A badge-only line below the group starts a NEW label.** A line that is
     nothing but corridor sequence numbers (`12-12 14-7`) is how this map opens
     a label, so it can never be a continuation. Without it "12-14 Sunter Utara"
     swallowed the first line of "12-12 14-7 Danau Agung". A badge at the TOP of
     a group is that label's own prefix and is kept.
3. Emit an **oriented rounded rect** along the text direction rather than an
   axis-aligned box, then **shrink-wrap it onto the label's own ink** — render
   the region, find the dark-glyph extent in text-local axes, and rebuild the
   shape around that with 3 units of padding (`cr = 6`).

   Deriving the box from font size alone is wrong in both directions at once. It
   overshoots horizontally (a font-size half-width past each end of the glyph
   run) while running *tight* vertically: measured against the ink, the median
   vertical slack was **-3.8 units** and **-6.0 on multi-line labels**, so
   descenders on "Genjing", "Kayu" and "Sari" hung outside their own hitbox.
   Only ink inside the original shape is counted, or a neighbouring label's
   glyphs drag the box outward — but that guard is not enough on its own. Where
   the starting box already overlapped a neighbour, the neighbour's glyphs were
   *inside* it, so re-measuring could never shrink past them: "4-12 Pasar
   Genjing" stayed 33 units too wide on each side because "4-11 Utan Kayu" sat
   in its box. So after the pixel fit, clamp the extent ALONG the baseline to
   the label's own text spans, matched by consuming the label text as an ordered
   token stream (a raw line must equal the next unconsumed tokens, so a stray
   "Pasar" from another label cannot be claimed).

   Clamp only along the baseline. Rebuilding the whole shape from spans instead
   is much worse — 109 overlaps against 6 — because a multi-line label's spans
   force `r` to cover the entire stack, making every wrapped label tall and fat.
   The pixel fit handles the perpendicular extent well; spans are only needed
   for the one thing pixels cannot disambiguate. A capsule bulges a
   half-width past each end of the glyph run, which is wrong for a word: the rect
   hugs the text and leaves visibly wider gaps between neighbouring labels. This
   needs no renderer work — `Point.cr` and the rounded-rect SDF already exist for
   hubs; a label is just the same shape with a small corner radius. 80 of the 371 labels are drawn at
   45 degrees, and their bounding boxes overlap each other badly while the
   capsules do not. This is free: `Point` in `map-renderer.ts` is already a
   rotatable capsule. The radius matters as much as the orientation — at
   `0.72 x size` the pills were fat enough to bleed sideways into their
   neighbours along the Cikarang and LRT Jabodebek diagonals even though their
   centrelines never touched.
4. Match each existing point to a label by normalised name (corridor sequence
   numbers like `3-11` and bare line badges stripped) scored against distance,
   with a **spacing-insensitive fallback** — the map writes "Bojong Gede" where
   the DB has "Bojonggede", and "Jurangmangu" where it has "Jurang Mangu" —
   **plus an operator nudge**: a corridor-sequence badge in the label text is a
   TransJakarta halte number, so a badged label leans TJ and a bare one leans
   rail. It has to be a nudge and not a filter, because plenty of TJ haltes are
   drawn without their badge.

   Without it, three "Kemayoran" labels sit within 300 units of each other and
   nearest-wins gave the TJ halte the KCI station's bare label, leaving
   "14-4 Kemayoran" unclaimed. Global one-label-one-station assignment does not
   fix this either — greedy-by-score just swaps which of the two is wrong,
   because it has no idea the badge means TransJakarta.

## Results

- **376 of 381 points matched (98.7%)** — the practical ceiling.
- 5 unmatched, and **none of them are extraction failures**: the four `HUB-*`
  display-only points and `KCI-BST` all have no name drawn on the map at all
  (nothing within 230 units of BST).
- Median label-to-marker distance 130 u, max 396 u.

## Selection

Label points set `noRing`, so tapping one draws the scrim but not the halo. The
ring is an offset outline that settles onto the shape's edge — right for a
marker, wrong for a word, where it reads as a box drawn around the text rather
than a selection. The scrim alone isolates the tapped label perfectly well.

`ringProgress` drives both the ring and its glow, so zeroing it removes the halo
outright. It is zeroed where the overlay is built rather than in the phase
animation, so the spotlight's own bookkeeping stays uniform across point kinds
and only the drawn result differs. Both renderers already guard on
`ringProgress > 0`, so neither needed changing.

## Open questions before this could ship

1. **26 label capsules overlap another label capsule, and 25 of those are one
   drawn name serving several operators at an interchange** — Dukuh Atas
   MRTJ/LRTJBDB, Manggarai KCI/LRTJ, Matraman KCI/TJ. That is not a bug in the
   extraction, it is a genuine question: which station should the name resolve
   to? Options are nearest-marker, a hub id where one exists, or a
   disambiguation tap. Only ONE overlap is between different labels
   (`7-3 Raya Bogor` / `7-2 Merdeka`), down from 44 before the merge and radius
   were tightened.

   Measure overlap as true capsule-to-capsule distance (segment-segment minus
   the two radii). Sampling one centreline against the other misses the fat-pill
   case entirely — it reported zero rotated overlaps while the render clearly
   showed the Cikunir labels bleeding together.

   Six different-name overlaps remain, all between genuinely adjacent labels,
   and no label box contains another station's marker. Shrink-wrapping took
   them 18 -> 14 and the baseline clamp 14 -> 6, at no cost in hit area.

5. A small curated fallback table supplies a name where the DB cannot.
   - **No API station at all:** `KCI-GMR` Gambir and the two temporary Manggarai
     haltes are drawn on the map but absent from the stations API.
   - **LRTJ Phase 1B renames:** the map is already on the new names while the DB
     is not. `LRTJ-KYM` is S09 **Matraman** and `LRTJ-MAT` is S10 **Proklamasi**
     (see the note in `db/data/topology.ts` — the codes are misnomers and the
     name must come from the drawing, never from the code). Without the
     `LRTJ-MAT` entry it matched the TJ halte label "5-12 Matraman" 190 units
     away, which also stole that label from `TJ-H00128P`. Both entries come out
     once `lrtj_phase1b_rename.sql` reaches prod.
2. **7 label capsules contain a different station's marker.** A tap in the
   overlap is ambiguous and needs a rule — marker-beats-label is the obvious one,
   since the marker is the more precise target.
3. **Labels are not always adjacent to their marker** (up to 396 u away). Tapping
   a name and activating a station whose dot is visibly elsewhere may read as a
   misfire.
4. **Where should this live?** It is derived data, so generating it at build time
   next to `map-corridors.json` fits better than growing the hand-curated
   `points.json` by ~370 rows. It would need regenerating on every map edition.

## Regenerating

The extraction lives in this session's scratchpad rather than a committed script —
it is a prototype and the merge heuristics are still moving. Promote it to
`apps/web/scripts/` if this becomes real.
