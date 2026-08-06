import type { FareResult } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { useSearchables } from '~/hooks/use-searchables'
import {
  DEFAULT_FARE_CRITERIA,
  criteriaToPersist,
  fareQueryParams,
  readFareCriteria,
  writeFareCriteria,
  type FareCriteria
} from 'utils/fare-criteria'
import { resolveStationId, toPickableStations, type PickableStation } from './pickable-station'
import { operatorsPresent } from './criteria/labels'
import type { OperatorCode } from '@commute/schemas'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

export interface FareQueryOptions {
  // Station ids to preselect, from a `/fare?from=&to=` deep link (or the
  // station page's to-only `/fare?to=`). Applied once, the first time at least
  // one side resolves against the station list — see deepLinkApplied.
  // The search sheet passes nothing: it has no deep link and must not be coupled
  // to the router's search params, which would let unrelated param changes stomp
  // the user's selection.
  initialPair?: { fromId: string | null, toId: string | null }
  // Called whenever the pair or the criteria change, so the caller can mirror
  // both into the URL. Only /fare does this — the sheet leaves the address bar
  // alone. One callback rather than two because they share a query string:
  // writing either separately would clobber the other.
  onStateChange?: (fromId: string | null, toId: string | null, criteria: FareCriteria) => void
  // Criteria named by the incoming URL, which beat stored preferences for this
  // visit. Applied once, like initialPair.
  initialCriteria?: Partial<FareCriteria>
  // Whether to drive document.title from the selection. On for /fare, where the
  // title is the page's; off in the search sheet, which owns its own title.
  syncDocumentTitle?: boolean
}

export interface FareQuery {
  origin: PickableStation | null
  destination: PickableStation | null
  pickerTarget: 'origin' | 'destination'
  pickerOpen: boolean
  openPickerFor: (target: 'origin' | 'destination') => void
  closePicker: () => void
  handleSelect: (station: PickableStation) => void
  handleSwap: () => void
  pickableStations: PickableStation[]
  /**
   * Operators available to filter by, derived from the UNFILTERED set.
   *
   * Deriving these from the filtered list would strand the rider: pick TJ, and
   * the only operator left in the list is TJ, so the sheet could never offer a
   * way back out.
   */
  operators: OperatorCode[]
  criteria: FareCriteria
  setCriteria: (criteria: FareCriteria) => void
  fare: StandardResponse<FareResult> | undefined
  error: unknown
  isLoading: boolean
}

// The fare query state machine, shared by the /fare route and the search sheet's
// route mode. Owns the station pair, the picker, and the fare fetch; renders
// nothing. Both call sites go through the same useSWR key, so SWR dedupes across
// them.
export function useFareQuery({
  initialPair,
  onStateChange,
  initialCriteria,
  syncDocumentTitle = false
}: FareQueryOptions = {}): FareQuery {
  // The prebuilt search index, shared with the search sheet through the same
  // SWR key — opening both surfaces now costs one fetch, not two overlapping
  // station lists. It also already carries everything the picker needs, so the
  // /stations call this used to make is gone: see pickable-station.ts.
  const { searchables } = useSearchables()
  const [origin, setOrigin] = useState<PickableStation | null>(null)
  const [destination, setDestination] = useState<PickableStation | null>(null)
  // Which field is being picked never resets on close, so the picker title
  // stays correct while the dialog animates out.
  const [pickerTarget, setPickerTarget] = useState<'origin' | 'destination'>('origin')
  const [pickerOpen, setPickerOpen] = useState(false)

  /*
   * Criteria start at the defaults and are replaced by stored preferences after
   * mount — never read storage in a useState initializer, per search-mode.ts:
   * first paint must not depend on it.
   *
   * `criteriaReady` gates the fare fetch. Without it a deep-linked pair resolves
   * against the default criteria, fires a request, and then fires a second one
   * the moment the stored criteria land — showing the rider a price under a
   * payment method they did not choose, however briefly.
   */
  const [criteria, setCriteriaState] = useState<FareCriteria>(DEFAULT_FARE_CRITERIA)
  const [criteriaReady, setCriteriaReady] = useState(false)
  const criteriaFromUrl = useRef(initialCriteria)

  useEffect(() => {
    // The URL wins over storage for this visit: following a shared fare link
    // must show the sender's number, and an ?operator= entry point must open
    // already scoped. Deliberately not written back — reading someone else's
    // link should not silently change your own default. setCriteria enforces
    // the other half of that, via criteriaToPersist.
    setCriteriaState({ ...readFareCriteria(), ...criteriaFromUrl.current })
    setCriteriaReady(true)
  }, [])

  /*
   * The handlers below are memoized because FarePanel stays mounted (just
   * hidden) behind the search sheet's mode toggle — so as plain declarations
   * they handed it a brand-new prop surface on every keystroke typed in STATION
   * mode, re-rendering a panel nobody was looking at.
   *
   * Deps are the values each one actually closes over; the two that only drive
   * setters are genuinely stable.
   */
  const setCriteria = useCallback((next: FareCriteria) => {
    setCriteriaState(next)
    // Persist what the rider chose, not what the URL handed them — otherwise
    // the first criteria change on an ?operator= link would bake that scope
    // into their own stored preference. criteriaFromUrl is a ref, so this stays
    // out of the dep array and the callback keeps its stable identity.
    writeFareCriteria(criteriaToPersist(next, criteriaFromUrl.current))
    onStateChange?.(origin?.id ?? null, destination?.id ?? null, next)
  }, [onStateChange, origin?.id, destination?.id])

  const openPickerFor = useCallback((target: 'origin' | 'destination') => {
    setPickerTarget(target)
    setPickerOpen(true)
  }, [])
  const closePicker = useCallback(() => setPickerOpen(false), [])

  // No filtering left to do here: the index is already Jabodetabek-only and
  // already excludes the topology-only stops (TJ feeder/non-BRT) that would
  // otherwise balloon the picker to ~2,300 rows. That used to be a client-side
  // `regionCode === 'CGK' && searchable` pass over the full station list.
  const allPickableStations = useMemo(
    () => toPickableStations(searchables),
    [searchables]
  )

  // The operator criterion narrows what the picker offers. Deep links resolve
  // against the UNFILTERED list below, so a stored filter can never make a
  // shared link fail to open.
  const operators = useMemo(
    () => operatorsPresent(allPickableStations),
    [allPickableStations]
  )

  const pickableStations = useMemo(
    () => (criteria.operator
      ? allPickableStations.filter(station => station.operator === criteria.operator)
      : allPickableStations),
    [allPickableStations, criteria.operator]
  )

  // Deep link applies once, not on every change of the incoming pair.
  // onPairChange rewrites the query string as the user picks stations, which
  // feeds back into initialPair on the /fare route — without the latch a pick
  // would be immediately overwritten by the params it had just written.
  const deepLinkApplied = useRef(false)
  const fromId = initialPair?.fromId ?? null
  const toId = initialPair?.toId ?? null

  useEffect(() => {
    if (deepLinkApplied.current) return
    if ((!fromId && !toId) || allPickableStations.length === 0) return

    // Apply whichever side resolves: a to-only link fills the destination and
    // leaves the origin to the picker, and a full link with one bogus id still
    // applies the valid half rather than nothing.
    const fromStation = fromId ? resolveStationId(allPickableStations, fromId) : null
    const toStation = toId ? resolveStationId(allPickableStations, toId) : null
    if (!fromStation && !toStation) return

    deepLinkApplied.current = true
    if (fromStation) setOrigin(fromStation)
    if (toStation) setDestination(toStation)
  }, [allPickableStations, fromId, toId])

  useEffect(() => {
    if (!syncDocumentTitle) return
    if (origin && destination) {
      const fromName = origin.name
      const toName = destination.name
      document.title = `Cek Tarif ${fromName} ke ${toName} - Commute`
    } else {
      document.title = 'Cek Tarif - Commute'
    }
  }, [origin, destination, syncDocumentTitle])

  const query = fareQueryParams(criteria).toString()
  const fareUrl = criteriaReady && origin && destination && origin.id !== destination.id
    ? new URL(
      `/fares/${origin.id}/${destination.id}${query ? `?${query}` : ''}`,
      import.meta.env.VITE_API_BASE_URL
    ).href
    : null
  const { data: fare, error, isLoading } = useSWR<StandardResponse<FareResult>>(fareUrl, fetcher, swrConfig)

  const handleSwap = useCallback(() => {
    setOrigin(destination)
    setDestination(origin)

    if (origin && destination) {
      onStateChange?.(destination.id, origin.id, criteria)
    }
  }, [origin, destination, criteria, onStateChange])

  const handleSelect = useCallback((station: PickableStation) => {
    let newOrigin = origin
    let newDestination = destination

    if (pickerTarget === 'origin') {
      // Picking the other end's station swaps instead of dead-ending on SAME_STATION.
      if (station.id === destination?.id) newDestination = origin
      newOrigin = station
    } else {
      if (station.id === origin?.id) newOrigin = destination
      newDestination = station
    }

    setOrigin(newOrigin)
    setDestination(newDestination)

    if (newOrigin && newDestination) {
      onStateChange?.(newOrigin.id, newDestination.id, criteria)
    }
  }, [origin, destination, pickerTarget, criteria, onStateChange])

  return {
    origin,
    destination,
    pickerTarget,
    pickerOpen,
    openPickerFor,
    closePicker,
    handleSelect,
    handleSwap,
    pickableStations,
    operators,
    criteria,
    setCriteria,
    fare,
    error,
    isLoading
  }
}
