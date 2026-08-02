import type { FareResult } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { useSearchables } from '~/hooks/use-searchables'
import { resolveStationId, toPickableStations, type PickableStation } from './pickable-station'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

export interface FareQueryOptions {
  // Station ids to preselect, from a `/fare?from=&to=` deep link. Applied once,
  // the first time both resolve against the station list — see deepLinkApplied.
  // The search sheet passes nothing: it has no deep link and must not be coupled
  // to the router's search params, which would let unrelated param changes stomp
  // the user's selection.
  initialPair?: { fromId: string | null, toId: string | null }
  // Called whenever both ends are set, so the caller can mirror the pair into the
  // URL. Only /fare does this — the sheet leaves the address bar alone.
  onPairChange?: (fromId: string, toId: string) => void
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
  onPairChange,
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

  const openPickerFor = (target: 'origin' | 'destination') => {
    setPickerTarget(target)
    setPickerOpen(true)
  }
  const closePicker = () => setPickerOpen(false)

  // No filtering left to do here: the index is already Jabodetabek-only and
  // already excludes the topology-only stops (TJ feeder/non-BRT) that would
  // otherwise balloon the picker to ~2,300 rows. That used to be a client-side
  // `regionCode === 'CGK' && searchable` pass over the full station list.
  const pickableStations = useMemo(
    () => toPickableStations(searchables),
    [searchables]
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
    if (!fromId || !toId || pickableStations.length === 0) return

    const fromStation = resolveStationId(pickableStations, fromId)
    const toStation = resolveStationId(pickableStations, toId)
    if (fromStation && toStation) {
      deepLinkApplied.current = true
      setOrigin(fromStation)
      setDestination(toStation)
    }
  }, [pickableStations, fromId, toId])

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

  const fareUrl = origin && destination && origin.id !== destination.id
    ? new URL(`/fares/${origin.id}/${destination.id}`, import.meta.env.VITE_API_BASE_URL).href
    : null
  const { data: fare, error, isLoading } = useSWR<StandardResponse<FareResult>>(fareUrl, fetcher, swrConfig)

  const handleSwap = () => {
    setOrigin(destination)
    setDestination(origin)

    if (origin && destination) {
      onPairChange?.(destination.id, origin.id)
    }
  }

  const handleSelect = (station: PickableStation) => {
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
      onPairChange?.(newOrigin.id, newDestination.id)
    }
  }

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
    fare,
    error,
    isLoading
  }
}
