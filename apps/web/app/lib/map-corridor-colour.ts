/*
 * The artwork colour of a corridor, recovered by joining it to the skeleton.
 *
 * Corridors deliberately carry no colour: `map-corridors.ts` explains that the
 * artwork hex is duplicated across lines and that leg matching is geometric. That
 * holds, and nothing here changes it. What it costs is a discriminator, and the
 * absence of one is a confirmed bug — where several strokes are drawn stacked and
 * parallel, `matchCorridorPath` can elect a corridor of an entirely different
 * colour, because it sorts on distance alone and both are within tolerance.
 *
 * That is survivable for the route overlay, which draws its own coloured line on
 * top of whatever it traced. It is not survivable for line isolation, where the
 * traced stroke IS the output: picking the neighbour means holding the wrong line
 * at full strength while the tapped one fades.
 *
 * ── Why this joins rather than regenerating ────────────────────────────────
 *
 * `build-map-skeleton.ts` writes both files from ONE extraction pass, and it
 * already parses the stroke colour — `ExtractedStroke extends SkeletonStroke`,
 * which carries `c`. The corridor writer drops it on the way out. So the colour
 * is not missing from the artwork, only from one of the two files derived from it.
 *
 * The skeleton keeps it, and the skeleton is rail-only (`w: 25`) by construction.
 * Rail corridors and skeleton strokes therefore come from the same strokes in the
 * same order: 16 and 16 today, joining 16/16 on endpoints with zero ambiguity.
 * Recovering the colour is a lookup, not a rebuild.
 *
 * The honest alternative is adding `c` to `CorridorEntry` and re-running the
 * Playwright extraction. That is the right fix and BRT will require it, since the
 * skeleton has no BRT strokes to join against. It is deliberately not the fix
 * taken first: it regenerates a committed artifact that three other things read,
 * to obtain a value already sitting in a file beside it.
 *
 * ── Rail only, and it fails loudly rather than quietly ─────────────────────
 *
 * A BRT corridor has nothing to join to and comes back null. Callers must treat
 * null as "no colour information", never as "no match" — a corridor whose colour
 * is unknown has to stay eligible, or deferring BRT would silently become
 * excluding it.
 */

import type { SkeletonStroke } from 'utils/map-skeleton-order'
import type { Corridor } from './map-corridors'

/*
 * How close two endpoints must sit to be the same stroke, world units.
 *
 * Both files are written from the same sampled-and-simplified polyline, so a
 * match is exact up to the rounding each applies on the way out (the skeleton
 * writes integers into a path string; corridors keep numbers). A whole world
 * unit is far tighter than the gap between any two distinct strokes — the
 * closest parallel pair on the sheet is ~22 units apart — and far looser than
 * rounding, so this separates cleanly from both sides.
 */
const ENDPOINT_EPSILON_WORLD = 1.5

// Leading `M`/`L` commands and their coordinate pairs. The skeleton's `d` is
// machine-written by build-map-skeleton.ts and only ever uses these two, so this
// deliberately does not try to be a general SVG path parser.
const PATH_POINT = /(-?[\d.]+) (-?[\d.]+)/g

function pathEndpoints(d: string): { first: [number, number], last: [number, number] } | null {
  let first: [number, number] | null = null
  let last: [number, number] | null = null
  for (const match of d.matchAll(PATH_POINT)) {
    const point: [number, number] = [Number(match[1]), Number(match[2])]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (!first) first = point
    last = point
  }
  return first && last ? { first, last } : null
}

function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) <= ENDPOINT_EPSILON_WORLD
    && Math.abs(a[1] - b[1]) <= ENDPOINT_EPSILON_WORLD
}

/*
 * Colour per corridor, by index, aligned with the array passed in.
 *
 * Null where no colour is known: every BRT corridor, and any rail corridor whose
 * stroke did not join. Both mean the same thing to a caller — do not filter on
 * colour here — which is why they are not distinguished.
 *
 * Matched on both endpoints rather than one. A single endpoint is shared by every
 * stroke meeting at a junction, so it would join a corridor to whichever
 * neighbour happened to be listed first, which is the exact class of error this
 * exists to prevent. Direction is not assumed: the two files agree today, but a
 * reversed polyline is a plausible regeneration artefact and silently colouring a
 * corridor from the wrong stroke is worse than any cost of checking.
 */
export function corridorColours(
  corridors: readonly Corridor[],
  strokes: readonly SkeletonStroke[]
): Array<string | null> {
  const prepared = strokes
    .map(stroke => ({ c: stroke.c, ends: pathEndpoints(stroke.d) }))
    .filter((s): s is { c: string, ends: NonNullable<ReturnType<typeof pathEndpoints>> } => s.ends !== null)

  return corridors.map((corridor) => {
    const first = corridor.pts[0]
    const last = corridor.pts[corridor.pts.length - 1]
    if (!first || !last) return null

    let found: string | null = null
    for (const stroke of prepared) {
      const forward = samePoint(stroke.ends.first, first) && samePoint(stroke.ends.last, last)
      const reversed = samePoint(stroke.ends.first, last) && samePoint(stroke.ends.last, first)
      if (!forward && !reversed) continue
      // Two strokes answering to one corridor means the endpoint join is no
      // longer the identity it is relied on to be. Refuse rather than take the
      // first: an ambiguous colour is what would put the wrong line on screen.
      if (found !== null && found !== stroke.c) return null
      found = stroke.c
    }
    return found
  })
}

/*
 * Worst per-channel difference between two `#rrggbb` strings, 0..255.
 *
 * Per-channel rather than a distance in RGB, so one badly-off channel cannot be
 * averaged away by two close ones. Mirrors the comparison build-map-skeleton.ts
 * uses to pair station discs with their line.
 */
export function channelDistance(a: string, b: string): number {
  let worst = 0
  for (let i = 1; i < 7; i += 2) {
    const av = parseInt(a.slice(i, i + 2), 16)
    const bv = parseInt(b.slice(i, i + 2), 16)
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 255
    worst = Math.max(worst, Math.abs(av - bv))
  }
  return worst
}

/*
 * How far a corridor's artwork colour may sit from a line's brand colour and
 * still be that line, per channel.
 *
 * The two palettes are related but not identical: MRTJ's brand `#ca2a51` matches
 * its artwork stroke exactly, while others drift. This has to absorb that drift
 * while still separating the colours actually confused on the sheet, which are
 * nothing alike — the confirmed failure traces a yellow line onto a blue stroke,
 * `#F8C434` against `#2355A2`, 165 apart on the worst channel.
 *
 * Measured over the 10 distinct rail colours (45 pairs): the closest are 36
 * apart (`#CA2A51` vs `#EE3637`, two reds) and 37 of 45 pairs exceed this
 * value. So at 72 the palette's genuinely-similar reds and blues stay
 * indistinguishable — `#BF6433`/`#EE3637`, `#1351A1`/`#282A65` — while anything
 * grossly different separates.
 *
 * Checked from the other side too: all 10 non-BUS lines match their own artwork
 * stroke, and each to a DIFFERENT one, so the join is 1:1 over the shipped set.
 * Worst drift is KCI:C at 37 (`#25B8EB` brand against `#00BDEE` drawn); MRTJ is
 * exact. 37 against a 36-apart closest pair is why this cannot be tightened much
 * without a line failing to match itself.
 *
 * That is the intent, not a shortfall. This is a discriminator against a
 * grossly different stroke, not an identity test: tightening it far enough to
 * split two reds would start rejecting a line from its own stroke wherever the
 * brand and artwork palettes drift. Every use must fall back to colour-blind
 * matching rather than dropping a segment outright.
 */
export const CORRIDOR_COLOUR_TOLERANCE = 72

export function colourMatches(corridorColour: string | null, lineColour: string | undefined): boolean {
  // Unknown either side is not a mismatch. A BRT corridor, an unjoined stroke and
  // a line with no brand colour all have to stay eligible.
  if (!corridorColour || !lineColour) return true
  return channelDistance(corridorColour, lineColour) <= CORRIDOR_COLOUR_TOLERANCE
}
