import type { FareResult, TripResult } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { useSearchables } from '~/hooks/use-searchables'
import {
  DEFAULT_FARE_CRITERIA,
  criteriaToPersist,
  readFareCriteria,
  writeFareCriteria,
  type FareCriteria
} from 'utils/fare-criteria'
import { FARE_SWR_CONFIG, fareApiUrl, tripApiUrl } from 'utils/fare-api'
import { resolveStationId, toPickableStations, type PickableStation } from './pickable-station'

/** Leading words of the tab title on the surfaces that own one. */
const DOCUMENT_TITLE_PREFIX = 'Cek Tarif'

export interface FareQueryOptions {
  // Station ids to preselect, from a `/fare?from=&to=` deep link. Applied once,
  // the first time at least one side resolves — see deepLinkApplied. The search
  // sheet passes nothing: coupling it to the router's search params would let
  // unrelated param changes stomp the user's selection.
  initialPair?: { fromId: string | null, toId: string | null }
  /*
   * Externally-owned pair. The hook stops holding the pair itself: origin and
   * destination resolve from these ids, and a pick or swap reports through
   * onStateChange instead of setting local state.
   *
   * The map needs this because the pair has three writers there — the picker, a
   * station tap on the canvas, and the chip's clear — and its copy must outlive
   * the fare sheet, which unmounts on close.
   *
   * Mutually exclusive with initialPair: a controlled pair is never a one-shot
   * seed, so the deep-link latch is skipped entirely.
   */
  controlledPair?: { fromId: string | null, toId: string | null }
  // Called whenever the pair or criteria change, so the caller can mirror both
  // into the URL. Only /fare does this. One callback rather than two because
  // they share a query string: writing either separately clobbers the other.
  onStateChange?: (fromId: string | null, toId: string | null, criteria: FareCriteria) => void
  // Criteria named by the incoming URL, which beat stored preferences for this
  // visit. Applied once, like initialPair.
  initialCriteria?: Partial<FareCriteria>
  // Whether to drive document.title from the selection. On for the standalone
  // routes, where the title is the page's; off in the search sheet, which owns
  // its own title.
  syncDocumentTitle?: boolean
  // Ask `/_internal/trips` for every journey worth choosing between, rather
  // than the single route `/fares` returns. Driven by the router toggle.
  alternatives?: boolean
  /*
   * Hold the fetch until the caller's own async state has landed. Defaults to
   * true, so a caller with nothing to wait for is unaffected.
   *
   * /fare passes `routerReady` here. `alternatives` picks the endpoint and is
   * read from storage after mount, so without this gate a beta rider's first
   * paint fires at /fares and the next render fires again at /_internal/trips —
   * warming a KV and edge entry on an endpoint the rider never reads, on the
   * more expensive of the two.
   */
  gate?: boolean
}

/*
 * `TResult` follows the endpoint: a caller that never asks for alternatives is
 * talking to `/fares`, which cannot answer with a `journeys` array, so it should
 * not have to narrow a union it can never receive. The map's overlay and chip
 * rely on this — they consume the flat route fields directly.
 */
export interface FareQuery<TResult = FareResult | TripResult> {
  origin: PickableStation | null
  destination: PickableStation | null
  /*
   * The pair the fare is actually fetched for, as raw station ids.
   *
   * Not the same thing as `origin`/`destination` being set: those are resolved
   * against the search index for display, and the index legitimately omits some
   * stops (TJ topology-only halte). So an id can price correctly while its field
   * still reads "Pilih stasiun" — gate anything about the *fare* on these, and
   * only anything about the station's name on the resolved objects.
   */
  pairFromId: string | null
  pairToId: string | null
  pickerTarget: 'origin' | 'destination'
  pickerOpen: boolean
  openPickerFor: (target: 'origin' | 'destination') => void
  // Set the target without raising the dialog — see the implementation.
  aimPickerAt: (target: 'origin' | 'destination') => void
  closePicker: () => void
  handleSelect: (station: PickableStation) => void
  handleSwap: () => void
  pickableStations: PickableStation[]
  criteria: FareCriteria
  setCriteria: (criteria: FareCriteria) => void
  /* Either shape: `/fares` answers with one route, `/_internal/trips` with
   * several. FareResultCard normalises the two via journeysOf. */
  fare: StandardResponse<TResult> | undefined
  error: unknown
  isLoading: boolean
}

// The fare query state machine, shared by the /fare route and the search sheet's
// route mode. Owns the station pair, the picker, and the fare fetch; renders
// nothing. Both call sites go through the same useSWR key, so SWR dedupes across
// them.
export function useFareQuery(options?: FareQueryOptions & { alternatives?: false }): FareQuery<FareResult>
export function useFareQuery(options: FareQueryOptions & { alternatives: boolean }): FareQuery<FareResult | TripResult>
export function useFareQuery({
  initialPair,
  controlledPair,
  onStateChange,
  initialCriteria,
  syncDocumentTitle = false,
  alternatives = false,
  gate = true
}: FareQueryOptions = {}): FareQuery {
  const controlled = controlledPair !== undefined
  // The prebuilt search index, shared with the search sheet through the same
  // SWR key, so opening both surfaces costs one fetch. It carries everything
  // the picker needs — see pickable-station.ts.
  const { searchables } = useSearchables()
  // Only used when uncontrolled; a controlled caller owns the pair and these
  // stay null. Resolution of the controlled ids happens below, once the station
  // index has been built.
  const [originState, setOriginState] = useState<PickableStation | null>(null)
  const [destinationState, setDestinationState] = useState<PickableStation | null>(null)
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
   * Keep the handlers below memoized. FarePanel stays mounted, just hidden,
   * behind the search sheet's mode toggle, so plain declarations hand it a new
   * prop surface on every keystroke typed in STATION mode and re-render a panel
   * nobody is looking at.
   */
  const openPickerFor = useCallback((target: 'origin' | 'destination') => {
    setPickerTarget(target)
    setPickerOpen(true)
  }, [])
  /*
   * Aim the picker without opening the dialog.
   *
   * The map's desktop rail searches inline, so it needs the target — which is
   * what handleSelect reads to decide which end a station fills — without the
   * full-screen sheet that openPickerFor also raises. Opening that over a rail
   * on a desktop map would cover the map the rider is picking from.
   */
  const aimPickerAt = useCallback((target: 'origin' | 'destination') => {
    setPickerTarget(target)
  }, [])
  const closePicker = useCallback(() => setPickerOpen(false), [])

  // No filtering needed: the index is already Jabodetabek-only and excludes the
  // topology-only stops (TJ feeder/non-BRT) that would balloon the picker to
  // ~2,300 rows.
  const allPickableStations = useMemo(
    () => toPickableStations(searchables),
    [searchables]
  )

  // The operator criterion narrows what the picker offers. Deep links resolve
  // against the UNFILTERED list below, so a stored filter can never make a
  // shared link fail to open.
  const pickableStations = useMemo(
    () => (criteria.operator
      ? allPickableStations.filter(station => station.operator === criteria.operator)
      : allPickableStations),
    [allPickableStations, criteria.operator]
  )

  /*
   * Controlled ids resolved into stations for display. Against the UNFILTERED
   * list, like the deep-link latch: a stored operator filter must never make an
   * already-chosen endpoint vanish from its own field.
   *
   * A null here is not necessarily an error — the id can be real while the
   * search index is still loading, or while it legitimately does not carry that
   * stop. The fare fetch keys on the raw ids below for exactly that reason.
   */
  const controlledOrigin = useMemo(
    () => (controlledPair?.fromId ? resolveStationId(allPickableStations, controlledPair.fromId) : null),
    [allPickableStations, controlledPair?.fromId]
  )
  const controlledDestination = useMemo(
    () => (controlledPair?.toId ? resolveStationId(allPickableStations, controlledPair.toId) : null),
    [allPickableStations, controlledPair?.toId]
  )
  const origin = controlled ? controlledOrigin : originState
  const destination = controlled ? controlledDestination : destinationState

  // Declared after the pair is derived, not up with the other memoized handlers:
  // it reports the current pair alongside the new criteria, and under the
  // controlled-pair model that pair only exists once the ids above resolve.
  const setCriteria = useCallback((next: FareCriteria) => {
    setCriteriaState(next)
    // Persist what the rider chose, not what the URL handed them — otherwise
    // the first criteria change on an ?operator= link would bake that scope
    // into their own stored preference. criteriaFromUrl is a ref, so this stays
    // out of the dep array and the callback keeps its stable identity.
    writeFareCriteria(criteriaToPersist(next, criteriaFromUrl.current))
    onStateChange?.(origin?.id ?? null, destination?.id ?? null, next)
  }, [onStateChange, origin?.id, destination?.id])

  // Deep link applies once, not on every change of the incoming pair.
  // onPairChange rewrites the query string as the user picks stations, which
  // feeds back into initialPair on the /fare route — without the latch a pick
  // would be immediately overwritten by the params it had just written.
  const deepLinkApplied = useRef(false)
  const fromId = initialPair?.fromId ?? null
  const toId = initialPair?.toId ?? null

  useEffect(() => {
    // A controlled pair is the caller's live state, not a seed to apply once.
    if (controlled) return
    if (deepLinkApplied.current) return
    if ((!fromId && !toId) || allPickableStations.length === 0) return

    // Apply whichever side resolves: a to-only link fills the destination and
    // leaves the origin to the picker, and a full link with one bogus id still
    // applies the valid half rather than nothing.
    const fromStation = fromId ? resolveStationId(allPickableStations, fromId) : null
    const toStation = toId ? resolveStationId(allPickableStations, toId) : null
    if (!fromStation && !toStation) return

    deepLinkApplied.current = true
    if (fromStation) setOriginState(fromStation)
    if (toStation) setDestinationState(toStation)
  }, [allPickableStations, fromId, toId, controlled])

  // "Cek Tarif Bekasi ke Blok A - Commute". /fare is the only titled surface.
  useEffect(() => {
    if (!syncDocumentTitle) return
    if (origin && destination) {
      document.title = `${DOCUMENT_TITLE_PREFIX} ${origin.name} ke ${destination.name} - Commute`
    } else {
      document.title = `${DOCUMENT_TITLE_PREFIX} - Commute`
    }
  }, [origin, destination, syncDocumentTitle])

  /*
   * Built through the shared helpers so this key is byte-identical to the map's
   * — the two surfaces must share one SWR entry, or the chip and the sheet can
   * show different prices for one route. `alternatives` picks the endpoint, and
   * with it the key: see tripApiUrl for why the two must not converge.
   *
   * Keyed on the controlled ids rather than the resolved stations: those ids can
   * arrive before the search index does (a /map?from=&to= deep link), and the
   * price must not wait on the picker's data.
   */
  const keyFromId = controlled ? controlledPair?.fromId ?? null : origin?.id ?? null
  const keyToId = controlled ? controlledPair?.toId ?? null : destination?.id ?? null
  const journeyApiUrl = alternatives ? tripApiUrl : fareApiUrl
  const fareUrl = criteriaReady && gate ? journeyApiUrl(keyFromId, keyToId, criteria) : null
  const { data: fare, error, isLoading }
    = useSWR<StandardResponse<FareResult | TripResult>>(fareUrl, fetcher, FARE_SWR_CONFIG)

  /*
   * The one place the pair moves. Uncontrolled keeps the both-ends guard it has
   * always had: /fare's writeUrl is the consumer, and a half pair there is a
   * deep-link state rather than a pick. Controlled always reports, because the
   * caller IS the store — a half pair has to reach it or a single-ended pin
   * would never draw.
   */
  const commitPair = useCallback((
    nextOrigin: PickableStation | null,
    nextDestination: PickableStation | null
  ) => {
    if (!controlled) {
      setOriginState(nextOrigin)
      setDestinationState(nextDestination)
    }
    const bothEnds = nextOrigin !== null && nextDestination !== null
    if (controlled || bothEnds) {
      onStateChange?.(nextOrigin?.id ?? null, nextDestination?.id ?? null, criteria)
    }
  }, [controlled, criteria, onStateChange])

  const handleSwap = useCallback(
    () => commitPair(destination, origin),
    [commitPair, destination, origin]
  )

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

    commitPair(newOrigin, newDestination)
  }, [origin, destination, pickerTarget, commitPair])

  return {
    origin,
    destination,
    pairFromId: keyFromId,
    pairToId: keyToId,
    pickerTarget,
    pickerOpen,
    openPickerFor,
    aimPickerAt,
    closePicker,
    handleSelect,
    handleSwap,
    pickableStations,
    criteria,
    setCriteria,
    fare,
    error,
    isLoading
  }
}
