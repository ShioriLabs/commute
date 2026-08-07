import { useCallback, useEffect, useRef } from 'react'
import { CloseButton, DialogTitle } from '@headlessui/react'
import { XIcon } from '@phosphor-icons/react'
import { useSearchParams } from 'react-router'
import FarePanel from './fare-panel'
import FareShareButton from './fare-share-button'
import { fareQueryParams, readCriteriaFromUrl, type FareCriteria } from 'utils/fare-criteria'
import { useFareQuery } from './use-fare-query'

// Rendered inside a headlessui Dialog in both contexts: the homepage
// SheetButton morph and the standalone /fare route (which wraps it in an
// always-open Dialog, same as the /settings route) — so CloseButton works.
//
// This is the canonical home of fare deep links: functions/_middleware.ts only
// SEO-decorates `/fare`, the OG image worker is keyed on it, and the sitemap
// lists it. The search sheet renders the same FarePanel but never writes these
// URLs — see use-fare-query.ts.
export default function FareSheet() {
  const [searchParams] = useSearchParams()

  // On the homepage the sheet lives behind a faked URL (SheetButton pushStates
  // '/fare' while the router still thinks it's on '/'), so setSearchParams
  // would resolve against '/' and stomp the pathname. Write the query string
  // directly instead; window.location.pathname is '/fare' in both contexts,
  // and keeping history.state intact preserves SheetButton's modalOpen flag.
  //
  // One writer for the pair AND the criteria: they share a query string, so
  // writing either on its own would wipe the other. Picking a station used to
  // rebuild the params from scratch, which would now silently drop a chosen
  // payment method.
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
  })
  const { origin, destination, criteria, openPickerFor } = query

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
          <DialogTitle className="font-bold text-2xl">Cek Tarif</DialogTitle>
          <div className="flex gap-4">
            <FareShareButton fromId={origin?.id} toId={destination?.id} criteria={criteria} />
            <CloseButton
              aria-label="Tutup halaman cek tarif"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </CloseButton>
          </div>
        </div>

        <FarePanel query={query} />
      </div>
    </section>
  )
}
