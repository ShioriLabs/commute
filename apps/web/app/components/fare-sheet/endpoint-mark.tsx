import clsx from 'clsx'
import type { Line } from '@commute/schemas'
import LineRoundel from '~/components/line-roundel'

/*
 * One end of a fare pair, signed with the lines serving it.
 *
 * Two surfaces draw this and used to disagree: the map's desktop rail signed
 * each stop with its lines while the fare panel's Dari/Ke fields signed nothing,
 * so the same station read as two different things depending on the viewport.
 *
 * The stack grows LEFTWARD out of the mark column, so a caller has to leave it
 * room in its own padding — and cap the depth to what that room holds. See
 * endpointRoundelLines, which takes the cap.
 */

/*
 * The mark column both stops and the arrow between them share. Fixed rather
 * than intrinsic so the two names start on the same x whether a row shows a
 * roundel or the placeholder dot, and so the arrow can centre on it.
 *
 * One SM roundel wide, and it stays that width when a stop stacks several: the
 * extra roundels are laid out RIGHT-TO-LEFT out of the column's left edge, into
 * the 12px the card's padding leaves free. The anchor — the first line in
 * display order — holds the column, so the names, the arrow and the rows'
 * alignment do not move when a stack of three collapses to the one line a
 * resolved route rides.
 */
export const ROUNDEL_COL = 'w-6 shrink-0'

/*
 * Taken out of the normal flow rather than laid out in it. In flow the group is
 * wider than the column, and `justify-center` then splits the overflow evenly:
 * measured, that pushed the anchor 18px right into the station name and hung
 * the last roundel 2px past the card's left edge. Absolute, with its right edge
 * pinned to the column, the stack can only grow the one direction there is room
 * for — leftward, into the padding.
 */
const ROUNDEL_STACK_CLASS = 'absolute right-0 top-1/2 -translate-y-1/2 flex flex-row-reverse'

/*
 * How far a stacked roundel sits under the one before it: 16px of a 24px mark,
 * applied per roundel rather than via `space-x`, which reverses awkwardly.
 *
 * Deep enough to cover the codes behind the anchor, which is the point rather
 * than a cost. The row already answers "which line" with the anchor on top; the
 * ones behind it are saying "and this stop has others", and a deck of cards is
 * how that reads at a glance. Trying to keep every code legible instead spread
 * the stack past the card's left edge and only ever fitted two.
 *
 * About 8px of each is left showing, less as they scale down behind the anchor
 * — enough to read as a distinct disc in its line's colour, which is the whole
 * signal a covered roundel still carries.
 */
const ROUNDEL_STACK_OVERLAP_PX = 16

/*
 * Each roundel further back is drawn smaller, compounding per depth.
 *
 * Overlap alone says one disc is in front of another, but says nothing about
 * which — two flat circles at the same size read as a row that happens to
 * collide. Shrinking the ones behind gives the stack a front, so the anchor is
 * the mark and the rest are visibly a pile under it.
 *
 * `scale` rather than a smaller roundel size: it leaves the layout box alone,
 * so the 8px step above stays the thing that positions them, and SM is already
 * the smallest size the component draws.
 */
const ROUNDEL_STACK_SCALE = 0.85

/*
 * The row's mark: the stacked roundels, or a dot holding the column until there
 * is something to draw.
 *
 * Shared by the row's two forms — armed it is an input, at rest a button — which
 * used to render this block twice. They had already drifted once (only one of
 * them carried the comment explaining the operator), and the mark is the part
 * that must not differ between them: a roundel that changed as a field took
 * focus would read as the answer changing.
 */
export default function EndpointMark({ marks }: { marks: { line: Line, operator: string }[] }) {
  return (
    <span className={clsx(ROUNDEL_COL, 'relative flex justify-center')}>
      {marks.length > 0
        ? (
            /*
             * `flex-row-reverse` so the stack is painted right-to-left: the
             * anchor ends up rightmost, with each earlier roundel tucked under
             * the one to its right. Rendered in reverse too, so display order
             * still reads left-to-right on screen. Which one is on TOP is set
             * explicitly below — source order would stack them upside down.
             */
            <span className={ROUNDEL_STACK_CLASS}>
              {[...marks].reverse().map((mark, index) => (
                /*
                 * The offset rides a wrapper rather than the roundel:
                 * LineRoundel already spends its own `style` on the line
                 * colour, and widening a component the whole app shares for one
                 * caller's margin is the wrong trade.
                 *
                 * The anchor (index 0 here, painted last) keeps the column;
                 * every roundel behind it is pulled left under its neighbour.
                 * `marginRight`, not left: the row is `flex-row-reverse`, so a
                 * child's right margin is the gap on its LEFT on screen.
                 */
                <span
                  key={`${mark.operator}:${mark.line.lineCode}`}
                  className="leading-0"
                  style={{
                    ...(index > 0 ? { marginRight: -ROUNDEL_STACK_OVERLAP_PX } : {}),
                    /*
                     * Painted front-to-back by hand. Source order alone gets
                     * this backwards: the anchor is rendered FIRST so that
                     * `flex-row-reverse` puts it rightmost, which also makes it
                     * the first thing painted and therefore the bottom of the
                     * pile — the smallest disc ended up on top of the mark it
                     * is supposed to sit behind.
                     */
                    zIndex: marks.length - index,
                    /*
                     * Scaled about its RIGHT edge, which is the sliver left
                     * showing. Scaling about the centre would pull each disc
                     * away from the anchor as it shrank, opening a gap exactly
                     * where the stack is supposed to look continuous.
                     */
                    ...(index > 0
                      ? {
                          transform: `scale(${ROUNDEL_STACK_SCALE ** index})`,
                          transformOrigin: 'right center'
                        }
                      : {})
                  }}
                >
                  <LineRoundel
                    size="SM"
                    // The operator, not the line's `mode`: the resolved line
                    // carries how it runs, while the roundel's filled-vs-ringed
                    // style keys off who runs it.
                    operator={mark.operator}
                    code={mark.line.lineCode}
                    color={mark.line.colorCode as `#${string}`}
                  />
                </span>
              ))}
            </span>
          )
        // No lines resolved yet: a neutral dot holds the column so the name
        // does not shift left when the roundel arrives.
        : <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden />}
    </span>
  )
}
