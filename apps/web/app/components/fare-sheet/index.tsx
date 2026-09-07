import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloseButton, DialogTitle } from '@headlessui/react'
import { XIcon } from '@phosphor-icons/react'
import { useSearchParams } from 'react-router'
import FarePanel from './fare-panel'
import FareShareButton from './fare-share-button'
import { fareQueryParams, readCriteriaFromUrl, type FareCriteria } from 'utils/fare-criteria'
import { useFareQuery } from './use-fare-query'
import { journeysOf } from './journeys'
import { findJourneyByKey, journeyKey } from 'utils/journey-key'

// Rendered inside a headlessui Dialog in both contexts: the homepage
// SheetButton morph and the standalone /fare route (which wraps it in an
// always-open Dialog, same as the /settings route) — so CloseButton works.
//
// This is the canonical home of fare deep links: functions/_middleware.ts only
// SEO-decorates `/fare`, the OG image worker is keyed on it, and the sitemap
// lists it. The search sheet renders the same FarePanel but never writes these
// URLs — see use-fare-query.ts.
// The heading, the close-button label and the document title all say this.
const TITLE = 'Cek Tarif'

export default function FareSheet() {
  const [searchParams] = useSearchParams()

  // On the homepage the sheet lives behind a faked URL (SheetButton pushStates
  // '/fare' while the router still thinks it's on '/'), so setSearchParams
  // would resolve against '/' and stomp the pathname. Write the query string
  // directly instead; window.location.pathname is '/fare' in both contexts,
  // and keeping history.state intact preserves SheetButton's modalOpen flag.
  //
  // One writer for the pair AND the criteria: they share a query string, so
  // writing either on its own wipes the other. Never rebuild the params from
  // scratch here — that silently drops a chosen payment method.
  // Stable identity: this is `onStateChange`, which the fare handlers in
  // useFareQuery close over — a fresh function each render would churn their
  // dep arrays and undo their memoization. It reads only its arguments.
  const writeUrl = useCallback((fromId: string | null, toId: string | null, criteria: FareCriteria) => {
    const params = new URLSearchParams()
    // Written independently, not only as a pair: a to-only deep link from the
    // station page must survive a criteria change made before the origin is
    // picked, or the URL would silently lose its `?to=`.
    if (fromId) params.set('from', fromId)
    if (toId) params.set('to', toId)
    for (const [key, value] of fareQueryParams(criteria)) params.set(key, value)
    const search = params.toString()
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}`
    )
  }, [])

  const query = useFareQuery({
    initialPair: { fromId: searchParams.get('from'), toId: searchParams.get('to') },
    // The URL beats the recipient's stored preferences for this visit: a shared
    // link's payment method shows the number the sender saw, and `?operator=`
    // lands an operator-specific entry point (FDTJ's fare calculator) on a
    // picker already scoped to that operator. See readCriteriaFromUrl for why
    // only one of the two is written back.
    initialCriteria: readCriteriaFromUrl(searchParams),
    onStateChange: writeUrl,
    syncDocumentTitle: true
    // documentTitlePrefix left at its default, which is this same wording.
  })
  const { origin, destination, criteria, openPickerFor, fare } = query

  /*
   * Which option is showing, lifted out of the result card.
   *
   * Only so the share button can name it: a link carries the ROUTE the sender
   * was looking at (see utils/journey-key.ts), and the card cannot hand that
   * up from inside its own state. The map lifts the same value for a different
   * reason — its canvas overlay draws the chosen journey.
   */
  const [selectedJourney, setSelectedJourney] = useState(0)
  const journeys = useMemo(() => (fare?.data ? journeysOf(fare.data) : []), [fare])
  /*
   * The route a shared link named, applied once.
   *
   * Read from the *initial* params via ref, for the same reason the origin
   * picker below is: writeUrl rewrites the query string on every change, so
   * re-reading it later would resurrect a key the rider has already moved off.
   * One-shot, and cleared whether or not it matched.
   */
  const sharedJourney = useRef(searchParams.get('j'))
  /*
   * Which row the shared key names, resolved during render rather than in an
   * effect.
   *
   * The pager resets its page in a layout effect keyed on `journeys`, so a flag
   * raised by an effect here would arrive one commit too late and the rider
   * would land on the list anyway. Deriving it alongside the journeys it
   * describes is what makes the two agree within a single commit.
   *
   * Latched rather than recomputed: the key is consumed once, and a later
   * answer — the rider changes the payment method — must fall back to the
   * ordinary reset rather than re-applying a route they have moved on from.
   * Without the latch, clearing the ref would also flip `openOnDetail` back to
   * false and bounce them off the detail they were sent to.
   */
  const [sharedIndex, setSharedIndex] = useState<number | null>(null)
  const sharedResolved = useRef(false)
  if (!sharedResolved.current && journeys.length > 0) {
    sharedResolved.current = true
    const found = findJourneyByKey(journeys, sharedJourney.current)
    sharedJourney.current = null
    if (found !== null) setSharedIndex(found)
  }

  /*
   * The index is an ordinal into a set recomputed per request, so a new answer
   * invalidates it. Same rule as the card's own reset, and map.tsx's.
   *
   * A shared key gets first refusal on that reset. Not matching is an ordinary
   * outcome — a route can disappear between the sender's request and the
   * recipient's — so it falls back to the first row silently rather than
   * reporting a journey nobody asked for by name.
   */
  useEffect(() => setSelectedJourney(sharedIndex ?? 0), [fare, sharedIndex])

  const sharedKey = journeys[selectedJourney] ? journeyKey(journeys[selectedJourney]!) : null

  // A to-only deep link (station page's "Petunjuk Arah") lands here with the
  // destination set and no origin — open the origin picker so the next step is
  // obvious. One-shot, keyed on the *initial* params via ref: writeUrl's
  // replaceState later rewrites the query string, and clearing the picker must
  // not re-trigger. Waiting for `destination` (not the raw param) guarantees
  // the station index has loaded, so the picker never opens against an empty
  // list; the always-mounted StationPickerDialog animates in normally.
  const wantsOriginPicker = useRef(!!searchParams.get('to') && !searchParams.get('from'))
  useEffect(() => {
    if (!wantsOriginPicker.current) return
    if (destination && !origin) {
      wantsOriginPicker.current = false
      openPickerFor('origin')
    }
  }, [destination, origin, openPickerFor])

  return (
    <section className="bg-white w-screen h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="p-8 pb-4 max-w-3xl mx-auto">
        <div className="flex gap-4 items-center justify-between">
          <DialogTitle className="font-bold text-2xl">{ TITLE }</DialogTitle>
          <div className="flex gap-4">
            <FareShareButton fromId={origin?.id} toId={destination?.id} criteria={criteria} journeyKey={sharedKey} />
            <CloseButton
              aria-label={`Tutup halaman ${TITLE.toLowerCase()}`}
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </CloseButton>
          </div>
        </div>

        <FarePanel
          query={query}
          selectedIndex={selectedJourney}
          onSelectIndex={setSelectedJourney}
          openOnDetail={sharedIndex !== null}
        />
      </div>
    </section>
  )
}
