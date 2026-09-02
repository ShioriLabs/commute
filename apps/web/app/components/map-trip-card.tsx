import { useLayoutEffect, useRef, useState } from 'react'
import { CaretLeftIcon, CaretUpIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { FareJourney } from '@commute/schemas'
import { useReducedMotion } from '~/hooks/reduced-motion'
import { JourneyCardFace, JourneyTimeline } from './fare-sheet/fare-result-card'

interface MapTripCardProps {
  /*
   * Every journey the answer carries, in the engine's own order. One entry on
   * the standard router; up to five on beta.
   */
  journeys: FareJourney[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  open: boolean
  onCollapse: () => void
}

// The header's own height, matching the rail pill's so the two cards read as
// one column of the same object rather than two unrelated boxes.
const HEAD_HEIGHT_PX = 44

/*
 * The gap between this card and the rail card above it.
 *
 * Padding on the clipping box rather than the column's flex gap, because it has
 * to collapse with the card: a flex gap survives its sibling shrinking to zero,
 * which left a dead band under the rail with nothing in it.
 *
 * Dropped to zero while closed, not just animated past. Padding sets a floor on
 * a border-box element's height, so a padded box asked for `height: 0` still
 * measures 12px — which is exactly enough of a band for the card's rounded
 * corner and drop shadow to show under the rail as a sliver of white.
 */
const COLUMN_GAP_PX = 12

/*
 * How much of the collapse the card slides, as a fraction of its own height.
 *
 * At 1 the content keeps pace with the closing edge exactly and the whole thing
 * reads as a slide with no shrink at all. Low enough and the card just vanishes
 * in place. A third lets the bottom edge visibly gain on the content — the card
 * gets shorter — while still drifting up under the rail rather than collapsing
 * onto a fixed point.
 */
const SLIDE_FRACTION = 1 / 3

/*
 * Space kept clear below the card, for the map's bottom-centre wordmark and the
 * bottom-right controls the column must never reach.
 */
const FLOOR_CLEARANCE_PX = 72

type Page = 'detail' | 'options'

/*
 * The drawn route's legs, docked under the desktop rail card.
 *
 * Desktop's rail card names the two ends and prices them, and until this card
 * existed that was the whole of what a rider could see without opening the fare
 * pane over the map. Phones never had that gap: the chip opens the sheet at a
 * peek, so the route and its legs are on screen together. This is the desktop
 * equivalent of that peek — the same timeline the pane draws, always up, with
 * the map still fully visible around it.
 *
 * Two pages rather than one scroll, when the router offers a choice. An options
 * list and a timeline cannot share this column: the list alone is ~500px of
 * plates and the timeline is already capped against the viewport, so stacking
 * them would push the card off screen on anything short of a tall display. They
 * answer different questions anyway — "which of these" and "what is this one" —
 * and a rider is only ever asking one of them.
 */
export default function MapTripCard({
  journeys,
  selectedIndex,
  onSelectIndex,
  open,
  onCollapse
}: MapTripCardProps) {
  const reduced = useReducedMotion()
  const [page, setPage] = useState<Page>('options')

  /*
   * A lone journey was never compared against anything, so there is nothing to
   * choose between and no way to reach the options page. This is what keeps the
   * standard router looking exactly as it did before beta existed.
   */
  const hasOptions = journeys.length > 1
  const journey = journeys[selectedIndex] ?? journeys[0]
  const showing: Page = hasOptions ? page : 'detail'

  /*
   * Every new answer lands on the options, when there are options to land on.
   *
   * Which of these is the rider's first question on the beta router — the
   * detail is what they read once they have chosen. Opening on the detail
   * showed them one journey out of several, picked by ordinal rather than by
   * them, and left the list they actually wanted behind a click.
   *
   * Reset on every answer rather than only the first, because the index is an
   * ordinal into a set recomputed per request: change the payment method and
   * option three may be a different route or may not exist. Holding a rider on
   * a detail page through that would quietly swap the journey under them, so
   * the honest move is to show the new set and let them re-confirm. Same
   * reasoning as the selection reset in map.tsx.
   */
  useLayoutEffect(() => setPage('options'), [journeys])

  /*
   * Replay the body's fade whenever the page changes.
   *
   * Rewinding the running animation is what actually restarts it; toggling the
   * class off and on would need a forced reflow between the two writes to have
   * any effect at all. getAnimations() is empty under reduced motion, where
   * app.css sets `animation: none`, so this quietly does nothing there — which
   * is the behaviour that block asks for.
   */
  const pageFadeRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    for (const animation of pageFadeRef.current?.getAnimations() ?? []) {
      animation.currentTime = 0
      animation.play()
    }
  }, [showing])

  /*
   * The card's own natural height, measured rather than transitioned.
   *
   * The whole card is what moves here, header included — it slides up under the
   * rail card and out of sight, rather than shrinking in place to a stub. So
   * this measures the card, not just its body: the travel has to carry the
   * header past the rail's bottom edge too.
   *
   * ResizeObserver rather than an effect on the journey, because the height
   * also settles as a long station name wraps, as a rider expands a leg's stop
   * list, and as the two pages swap — only the element knows when it has
   * stopped moving.
   */
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(0)
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setCardHeight(el.getBoundingClientRect().height + COLUMN_GAP_PX)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /*
   * How tall a page may get before it scrolls, measured rather than assumed.
   *
   * A cross-city pair runs to five or six legs and beta answers with up to five
   * ~120px option plates, so both pages need a ceiling. It cannot be a fixed
   * rem figure: what is left depends on where this card starts, and the rail
   * above it grew by ~180px when the criteria chips and the router toggle moved
   * into it — a constant tuned for the old pill overflowed a 720px viewport by
   * a hundred pixels. Reading the card's own top is what keeps the two in step.
   */
  const [bodyMaxH, setBodyMaxH] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || typeof window === 'undefined') return
    const measure = () => {
      const top = el.getBoundingClientRect().top
      // The head is outside the scrolling body, so it comes off the budget too.
      setBodyMaxH(Math.max(120, window.innerHeight - top - HEAD_HEIGHT_PX - FLOOR_CLEARANCE_PX))
    }
    measure()
    window.addEventListener('resize', measure)
    // The rail above changes height as it opens, as a field is armed, and as
    // the toggle's caption wraps — all of which move this card's top edge.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && el.parentElement?.parentElement) ro.observe(el.parentElement.parentElement)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [])

  return (
    /*
     * The card shrinks from the bottom and slides up under the rail — one
     * motion, but the two halves are not the same amount.
     *
     * The clipping box carries the HEIGHT. Its top edge is pinned under the
     * rail, so closing it brings the BOTTOM edge up: that is the shrink, and it
     * is what gives the column its space back for the camera inset. Set from a
     * measurement rather than transitioned from `auto`, so the timeline's legs
     * never go back through layout.
     *
     * The card inside carries the SLIDE, and deliberately travels less than the
     * full height. At a 1:1 translation the content moved up exactly as fast as
     * the box closed, which pins the card's top edge to its own content and
     * reads as pure sliding — the card never appears to get shorter. Holding
     * the content back lets the closing edge catch up to it, so the shrink is
     * the part the eye reads and the slide is what carries it out of sight.
     */
    <div
      /*
       * The shadow lives here rather than on the card, and this box carries the
       * card's radius to match.
       *
       * `overflow-hidden` is what makes the height animation a clip instead of a
       * squash, and a clip crops its child's drop shadow to the clipping box's
       * own shape — a square one, which is why the card's corners had a hard
       * rectangular shadow around them. Cast from the element doing the
       * clipping and the shadow is outside what gets cropped.
       */
      className={clsx(
        'w-full overflow-hidden rounded-2xl',
        open && 'shadow-lg',
        !reduced && 'transition-[height] duration-200 ease-ios-spring'
      )}
      style={{ height: open ? cardHeight : 0, paddingTop: open ? COLUMN_GAP_PX : 0, boxSizing: 'border-box' }}
    >
      <div
        ref={cardRef}
        /*
         * Collapsed, nothing in here is reachable. The card stays mounted so it
         * can animate, and its header button plus RideLeg's stop-expanders would
         * otherwise be focusable controls parked off-screen. `inert` covers the
         * whole subtree, which a tabIndex here could not — those buttons belong
         * to JourneyTimeline.
         */
        inert={!open}
        className={clsx(
          // Same surface as the rail card, minus the shadow the box above casts
          // on its behalf.
          'w-full overflow-hidden rounded-2xl bg-white/90 backdrop-blur',
          !reduced && 'transition-transform duration-200 ease-ios-spring will-change-transform'
        )}
        style={{
          transform: open || reduced
            ? 'translateY(0)'
            : `translateY(-${Math.round(cardHeight * SLIDE_FRACTION)}px)`
        }}
      >
        <div
          style={{ height: HEAD_HEIGHT_PX }}
          className="flex items-center gap-1 px-4"
        >
          {/*
            * The options are where a beta rider starts, so that page takes the
            * plain title and the detail is the one carrying a way back. The
            * caret leads the label because it points at where the rider came
            * from, which on the detail page is always the list.
            *
            * A lone journey has no list to return to, so it keeps the plain
            * heading it always had.
            */}
          {showing === 'detail' && hasOptions
            ? (
                <button
                  type="button"
                  onClick={() => setPage('options')}
                  aria-label="Kembali ke pilihan rute"
                  className="flex-1 min-w-0 flex items-center gap-1 -ml-1 text-left rounded-lg px-1 py-1 cursor-pointer transition-colors duration-150 ease hover:bg-slate-100"
                >
                  <CaretLeftIcon weight="bold" className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  <span className="font-bold text-sm text-slate-500 truncate">Rincian perjalanan</span>
                </button>
              )
            : (
                <h2 className="flex-1 min-w-0 font-bold text-sm text-slate-500 truncate">
                  {showing === 'options' ? 'Pilihan rute' : 'Rincian perjalanan'}
                </h2>
              )}

          <button
            type="button"
            onClick={onCollapse}
            aria-label="Sembunyikan panel rute"
            aria-expanded={open}
            className="rounded-full flex items-center justify-center w-9 h-9 -mr-1.5 text-slate-700 cursor-pointer shrink-0 transition-[background-color,transform] duration-150 ease hover:bg-slate-100 active:scale-[0.97]"
          >
            <CaretUpIcon weight="bold" className="w-4 h-4" />
          </button>
        </div>

        {/*
          * The swapped body, faded in on every swap.
          *
          * The card animates its own height around this, and without the fade
          * the box glided while the contents hard-cut — movement and content
          * disagreeing at the one moment the rider is watching. Opacity only:
          * the height transition is already carrying the movement, and a
          * second transform here would read as the content correcting itself.
          *
          * A `key` alone does not do it. Both arms render a plain div in the
          * same slot, so React reconciles them as one node, the element is
          * never remounted and the CSS animation never restarts — measured:
          * the same DOM node survived the swap with its animation already at
          * its 180ms end. pageFadeRef restarts it by hand instead.
          */}
        <div ref={pageFadeRef} className="content-fade">
          {showing === 'options'
            ? (
                /*
                 * Opaque, where the detail page is glass.
                 *
                 * The plates publish --plate-ground so the route bar's roundels
                 * can halo against the surface they sit on, and route-bar.tsx
                 * calls that ring the only thing keeping a filled TJ roundel
                 * legible on track of its own colour. Over the card's translucent
                 * white the ring would be a keyline of map artwork, exactly where
                 * the rider is looking, so the options page gives the plates the
                 * solid ground their halos assume.
                 */
                <div
                  className="bg-white px-4 pb-4 border-t border-slate-100 overflow-y-auto overscroll-contain"
                  style={{ maxHeight: bodyMaxH ?? undefined }}
                >
                  <ul className="mt-3 flex flex-col gap-2">
                    {journeys.map((option, index) => (
                      <li key={index}>
                        <JourneyCardFace
                          journey={option}
                          selected={index === selectedIndex}
                          onSelect={() => {
                            onSelectIndex(index)
                            // Straight back to the detail: picking an option is
                            // asking to see it, not to stay in the list.
                            setPage('detail')
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            : (
                /* The timeline opens with its own mt-6, which is the spacing it
                   wants against a heading. Here the head above is already a
                   heading, so the gap is pulled back to sit under the rule. */
                <div
                  className="px-4 pb-4 border-t border-slate-100 overflow-y-auto overscroll-contain [&>ol]:mt-4"
                  style={{ maxHeight: bodyMaxH ?? undefined }}
                >
                  <JourneyTimeline legs={journey.legs} />
                </div>
              )}
        </div>
      </div>
    </div>
  )
}
