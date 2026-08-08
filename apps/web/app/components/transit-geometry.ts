/*
 * The rail vocabulary, shared by the line strip and the fare timeline.
 *
 * These live outside either component folder because two unrelated surfaces now
 * draw the same object at different gauges: the line strip's full-page rail and
 * the fare card's compact itinerary. Keeping the numbers in one place is what
 * stops the two drifting into subtly different diagrams of the same network.
 */

/* The rail is a 6px bar whose centerline sits at RAIL_CENTER within the row's
   leading gutter. Both gauges share the bar width — only the gutter changes, so
   the strokes read as the same instrument at two scales. */
export const RAIL_WIDTH_PX = 6

/* Line strip: a 44px gutter carrying a 32px station roundel. */
export const RAIL_CENTER_PX = 22
export const GUTTER_CLASS = 'grid-cols-[2.75rem_1fr]'

/* Fare timeline: a 28px gutter carrying a 16px board/alight node. Narrower
   because the fare card sits inside a sheet at max-w-3xl and its rows carry a
   station name, not a roundel and a link target. */
export const FARE_RAIL_CENTER_PX = 14
export const FARE_GUTTER_CLASS = 'grid-cols-[1.75rem_1fr]'

/*
 * The narrowest a ride segment is allowed to be drawn: one SM roundel.
 *
 * A leg's width is its share of the ground covered, but a 634m hop beside a
 * 14km run is 3% of the bar — narrower than the roundel marking where you board
 * it, so the badge overhung into the next leg and the two read as one clump.
 * Flooring every segment at the badge it carries costs strict proportionality:
 * a floored leg takes its width from the rest, so the long legs are drawn very
 * slightly short. Worth it — the bar is read as a sequence of services first and
 * a distance chart second, and legibility of the sequence is the whole job.
 */
export const ROUTE_BAR_MIN_SEGMENT_PX = 24

/*
 * Stand-in when a line key resolves to nothing.
 *
 * Happens during deploy skew, when a response references a line the cached
 * dictionary predates. Neutral grey is deliberate: it reads as "unknown line",
 * where any hue would read as a specific — and wrong — one.
 *
 * Must stay a 6-digit hex. getForegroundColor parses it, and a malformed value
 * yields NaN luminance, which silently resolves to 'LIGHT' and paints white
 * text on a white ground.
 */
export const LINE_COLOR_FALLBACK = '#888888'

/*
 * How interlined track is painted, shared by the route bar and the timeline.
 *
 * Interlined track carries several services at once — any of them gets you
 * there — so the segment has to show more than one colour without claiming the
 * line changes partway.
 *
 * Two things here are measured rather than picked:
 *
 * `in oklch` is the interpolation space. sRGB interpolates gamma-encoded
 * numbers, so it is not averaging light: the LRT trunk (BK #006838 -> CB
 * #21409A) ran through #105469, whose chroma is 0.072 against 0.114 and 0.152
 * at the ends. A colour less saturated than both endpoints is what reads as
 * muddy, and it belongs to neither operator. srgb-linear fixes the lightness
 * but not the dip, and oklab barely moves it (0.077) because a straight line
 * still cuts across the colour solid; OKLCH is polar, so it travels around and
 * holds chroma at 0.133. Support matches Tailwind v4's own baseline, which this
 * app already requires.
 *
 * BLEND_PCT is why each colour gets a run of flat track. Blending edge to edge
 * leaves each service's real colour only at the extreme ends, so the middle —
 * the part the eye lands on — is the one colour nobody owns. Every colour holds
 * flat across its own band and the transition is spent at the seam, which makes
 * the blend a join between two identified lines rather than the subject of the
 * segment. Divided evenly: each band gives up half a blend to each seam it
 * touches, so a two-colour leg holds 0-40% and 60-100%.
 *
 * Colours are deduped first. TJ runs up to five services on one hop, but they
 * collapse to fewer colours (6 and 6A are both #1BAC47, 13E and L13E both
 * #7A357B); undeduped, those seams are invisible and the stops are spent
 * drawing nothing.
 */
const BLEND_PCT = 20

/** A flat fill, or a blended one. Spread straight into a `style`. */
export interface TrackFill {
  backgroundColor?: string
  backgroundImage?: string
}

export function interlinedTrackFill(
  colors: readonly string[],
  /* The track's own direction: the route bar runs across, the timeline down. */
  direction: 'to right' | 'to bottom' = 'to right'
): TrackFill {
  const distinct = [...new Set(colors)]
  if (distinct.length === 0) return { backgroundColor: LINE_COLOR_FALLBACK }
  if (distinct.length === 1) return { backgroundColor: distinct[0]! }

  /*
   * Each colour owns an equal band and holds flat across it, minus the half
   * blend it gives to every seam it touches. The outer edges of the track are
   * seams for nobody, so the first and last colours run flat to 0% and 100%.
   */
  const band = 100 / distinct.length
  const half = BLEND_PCT / 2
  const stops = distinct.map((color, index) => {
    const from = index === 0 ? 0 : index * band + half
    const to = index === distinct.length - 1 ? 100 : (index + 1) * band - half
    return `${color} ${+from.toFixed(4)}% ${+to.toFixed(4)}%`
  })

  // The leading `0` reads better than `0%`, and the first stop is always zero.
  return { backgroundImage: `linear-gradient(${direction} in oklch, ${stops.join(', ').replace(/^(\S+) 0%/, '$1 0')})` }
}
