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
