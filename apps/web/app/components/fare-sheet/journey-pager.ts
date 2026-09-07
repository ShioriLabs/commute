import { useLayoutEffect, useRef, useState } from 'react'
import type { FareJourney } from '@commute/schemas'

/*
 * Which of two pages a trip list is showing, and how to get back.
 *
 * A hook rather than a component, because the two surfaces that page between an
 * options list and a journey's detail do not agree on ANY of the chrome around
 * them. The map's trip card is glass over the canvas, measures its own height
 * to animate a collapse, and shows the timeline alone; the fare sheet is an
 * opaque scroll that also carries the fare breakdown and the tariff disclaimer.
 * Extracting a component would have meant a prop for each of those differences
 * — which is the same two implementations again, wearing one name.
 *
 * What genuinely IS shared is the state machine, and every rule in it was
 * learned the hard way in map-trip-card.tsx. That is what lives here.
 */

export type JourneyPage = 'options' | 'detail'

export interface JourneyPager {
  /** The page to render. Never 'options' when there is nothing to choose. */
  showing: JourneyPage
  /** Whether a list exists at all, and so whether a way back should be drawn. */
  hasOptions: boolean
  /** Show the list again. No-op when there is no list. */
  toDetail: () => void
  toOptions: () => void
  /**
   * Attach to the element wrapping the swapped body to replay its fade.
   *
   * A `key` alone does not do it: both pages render a plain element into the
   * same slot, so React reconciles them as one node, the element is never
   * remounted, and a CSS animation that already ran stays finished. Measured in
   * map-trip-card.tsx — the same DOM node survived the swap with its animation
   * sitting at its 180ms end. Rewinding by hand is what actually restarts it.
   */
  pageFadeRef: React.RefObject<HTMLDivElement | null>
}

/*
 * `journeys` must be referentially stable across renders of one answer — it is
 * the reset dependency, so a fresh array each render would send a rider back to
 * the list on every keystroke elsewhere in the tree. Both callers memoise it
 * against the response object.
 */
export function useJourneyPager(
  journeys: FareJourney[],
  /*
   * Open straight on the detail for this answer, for a link that named a route.
   *
   * A shared link is a rider arriving to see ONE journey — someone sent it to
   * them — so landing them on the list would make them find it again among rows
   * that all look plausible. Only honoured when the key actually matched: an
   * unmatched key falls back to the list, which is the right place to be when
   * the route you were sent no longer runs.
   */
  openOnDetail = false
): JourneyPager {
  const [page, setPage] = useState<JourneyPage>(openOnDetail ? 'detail' : 'options')

  /*
   * A lone journey was never compared against anything, so there is nothing to
   * choose between and no list to go back to. It renders as the detail it is.
   */
  const hasOptions = journeys.length > 1
  const showing: JourneyPage = hasOptions ? page : 'detail'

  /*
   * Every new answer lands on the options, when there are options to land on.
   *
   * "Which of these" is the rider's first question when there are several; the
   * detail is what they read once they have chosen. Opening on the detail shows
   * them one journey out of many, picked by ordinal rather than by them.
   *
   * Reset on every answer rather than only the first, because the index is an
   * ordinal into a set recomputed per request — change the payment method and
   * option three may be a different route, or may not exist. Holding a rider on
   * a detail page through that would quietly swap the journey under them.
   */
  /*
   * Read through a ref so the reset below does not list it as a dependency:
   * this is a property of the ARRIVAL, and re-running the reset when it flips
   * back to false would bounce a rider off the detail they were sent to.
   */
  const openOnDetailRef = useRef(openOnDetail)
  openOnDetailRef.current = openOnDetail

  useLayoutEffect(
    () => setPage(openOnDetailRef.current ? 'detail' : 'options'),
    [journeys]
  )

  const pageFadeRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    for (const animation of pageFadeRef.current?.getAnimations() ?? []) {
      animation.currentTime = 0
      animation.play()
    }
  }, [showing])

  return {
    showing,
    hasOptions,
    toDetail: () => setPage('detail'),
    toOptions: () => setPage('options'),
    pageFadeRef
  }
}
