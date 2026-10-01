import { OPERATORS } from '@commute/constants'
import { ArrowRightIcon, CaretDownIcon, CaretLeftIcon, CaretUpIcon, PushPinIcon, PushPinSlashIcon } from '@phosphor-icons/react'
import type { StandardResponse } from '@schema/response'
import type { Station } from '@commute/schemas'
import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { entryKey, isSavedRoute, moveEntry, readSavedEntries, writeSavedEntries, type SavedEntry, type SavedRoute } from 'utils/saved-stations'
import { useSearchables } from '~/hooks/use-searchables'

export function meta() {
  return [
    { title: 'Stasiun & Rute Disimpan - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

interface SavedStationItemProps {
  stationId: string
  isSaved: boolean
  onSaveButtonClick: (id: string) => void
  // Ends of the list disable the matching chevron rather than wrapping around.
  isFirst: boolean
  isLast: boolean
  onMove: (id: string, offset: -1 | 1) => void
}

interface SavedStationObject {
  entry: SavedEntry
  id: string
  isSaved: boolean
}

function SavedStationItem({ stationId, isSaved, onSaveButtonClick, isFirst, isLast, onMove }: SavedStationItemProps) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)

  const handleSaveStationButton = useCallback(() => {
    onSaveButtonClick(stationId)
  }, [stationId, onSaveButtonClick])

  if (station.isLoading) {
    return (
      <li className="animate-pulse">
        <article className="px-8 py-4 flex items-center gap-4 justify-between">
          <div>
            <div className="h-4 w-64 bg-slate-200 rounded" />
            <div className="h-3 w-32 mt-1 bg-slate-200 rounded" />
          </div>
          <div className="w-6 h-6 bg-slate-200 rounded" />
        </article>
      </li>
    )
  }

  if (station.error || station.data === undefined || station.data.data === undefined) {
    return null
  }

  return (
    <li>
      <article className="px-8 py-4 flex items-center gap-4 justify-between">
        <div>
          <h1 className="font-semibold text-lg flex">
            { station.data.data.name }
          </h1>
          <h2 className="font-semibold text-sm text-slate-700">
            {OPERATORS[station.data.data.operator]?.name ?? station.data.data.operator}
          </h2>
        </div>
        <ItemControls name={station.data.data.name} id={stationId} isSaved={isSaved} isFirst={isFirst} isLast={isLast} onMove={onMove} onToggle={handleSaveStationButton} />
      </article>
    </li>
  )
}

// Reorder chevrons and the pin, shared by station and route rows. Ends of the
// list disable the matching chevron rather than wrapping around.
function ItemControls({ name, id, isSaved, isFirst, isLast, onMove, onToggle }: {
  name: string
  id: string
  isSaved: boolean
  isFirst: boolean
  isLast: boolean
  onMove: (id: string, offset: -1 | 1) => void
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => onMove(id, -1)}
        disabled={isFirst}
        aria-label={`Naikkan ${name}`}
        className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer disabled:cursor-default disabled:text-slate-300"
      >
        <CaretUpIcon weight="bold" className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => onMove(id, 1)}
        disabled={isLast}
        aria-label={`Turunkan ${name}`}
        className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer disabled:cursor-default disabled:text-slate-300"
      >
        <CaretDownIcon weight="bold" className="w-5 h-5" />
      </button>
      <button onClick={onToggle} aria-label={isSaved ? `Hapus ${name}` : `Simpan lagi ${name}`} className="ms-2 cursor-pointer">
        {isSaved
          ? <PushPinSlashIcon weight="fill" className="w-6 h-6 text-red-400" />
          : <PushPinIcon weight="fill" className="w-6 h-6" />}
      </button>
    </div>
  )
}

interface SavedRouteItemProps extends Omit<SavedStationItemProps, 'stationId'> {
  route: SavedRoute
  id: string
}

// Names come from the search index rather than two /stations fetches per row;
// it is already cached for the search sheet.
function SavedRouteItem({ route, id, isSaved, onSaveButtonClick, isFirst, isLast, onMove }: SavedRouteItemProps) {
  const { searchables, isLoading } = useSearchables()
  const lookup = (stationId: string) => searchables.find(item => item.type === 'STATION' && item.data?.['station-id'] === stationId)
  const from = lookup(route.from)
  const to = lookup(route.to)
  const operatorName = (operator?: string) => (operator ? (OPERATORS as Record<string, { name: string }>)[operator]?.name ?? operator : '')

  // A pair whose station left the index (a retired stop) still has to be
  // removable here, so it falls back to its ids instead of loading forever.
  if (!isLoading && (!from || !to)) {
    return (
      <li>
        <article className="px-8 py-4 flex items-center gap-4 justify-between">
          <div className="min-w-0">
            <h1 className="font-semibold text-lg truncate">{`${route.from} → ${route.to}`}</h1>
            <h2 className="font-semibold text-sm text-slate-700">Stasiun tidak ditemukan</h2>
          </div>
          <ItemControls name={`rute ${route.from} ke ${route.to}`} id={id} isSaved={isSaved} isFirst={isFirst} isLast={isLast} onMove={onMove} onToggle={() => onSaveButtonClick(id)} />
        </article>
      </li>
    )
  }

  if (!from || !to) {
    return (
      <li className="animate-pulse">
        <article className="px-8 py-4 flex items-center gap-4 justify-between">
          <div>
            <div className="h-4 w-64 bg-slate-200 rounded" />
            <div className="h-3 w-32 mt-1 bg-slate-200 rounded" />
          </div>
          <div className="w-6 h-6 bg-slate-200 rounded" />
        </article>
      </li>
    )
  }

  const fromOperator = from.type === 'STATION' ? from.operator : undefined
  const toOperator = to.type === 'STATION' ? to.operator : undefined
  const operators = fromOperator === toOperator
    ? operatorName(fromOperator)
    : `${operatorName(fromOperator)} · ${operatorName(toOperator)}`
  const name = `rute ${from.title} ke ${to.title}`

  return (
    <li>
      <article className="px-8 py-4 flex items-center gap-4 justify-between">
        <div className="min-w-0">
          <h1 className="font-semibold text-lg flex items-center gap-2 min-w-0">
            <span className="truncate">{from.title}</span>
            <ArrowRightIcon weight="bold" className="w-4 h-4 shrink-0" />
            <span className="truncate">{to.title}</span>
          </h1>
          <h2 className="font-semibold text-sm text-slate-700">{operators}</h2>
        </div>
        <ItemControls name={name} id={id} isSaved={isSaved} isFirst={isFirst} isLast={isLast} onMove={onMove} onToggle={() => onSaveButtonClick(id)} />
      </article>
    </li>
  )
}

export default function SavedStationsSettingsPage() {
  const [stations, setStations] = useState<SavedStationObject[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    setStations(readSavedEntries().map(entry => ({ entry, id: entryKey(entry), isSaved: true })))
    setIsReady(true)
  }, [])

  useEffect(() => {
    return () => {
      if (isDirty) {
        writeSavedEntries(stations.filter(station => station.isSaved).map(station => station.entry))
      }
    }
  }, [isDirty, stations])

  const handleSaveStationButton = (id: string) => {
    setStations(prevStations =>
      prevStations.map(station =>
        station.id === id
          ? { ...station, isSaved: !station.isSaved }
          : station
      )
    )

    setIsDirty(true)
  }

  // Order is what the search sheet's pin pills follow, so a move is a change
  // like any other and commits on leaving the page.
  const handleMove = (id: string, offset: -1 | 1) => {
    setStations((prevStations) => {
      const from = prevStations.findIndex(station => station.id === id)
      return from === -1 ? prevStations : moveEntry(prevStations, from, from + offset)
    })
    setIsDirty(true)
  }

  return (
    <main className="bg-white w-full h-full min-h-screen overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <CaretLeftIcon weight="bold" className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-2xl">Stasiun & Rute Disimpan</h1>
        </div>
        <h2 className="mt-4 text-sm">Perubahan pada stasiun dan rute di bawah ini akan disimpan pada saat meninggalkan halaman ini</h2>
      </div>
      {!isReady
        ? (
            <div className="flex items-center justify-center mt-4 p-8 max-w-3xl mx-auto">
              <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
            </div>
          )
        : (
            <ul className="max-w-3xl mx-auto">
              {stations.length > 0
                ? (
                    stations.map((station, index) => isSavedRoute(station.entry)
                      ? (
                          <SavedRouteItem
                            route={station.entry}
                            id={station.id}
                            key={station.id}
                            onSaveButtonClick={handleSaveStationButton}
                            isSaved={station.isSaved}
                            isFirst={index === 0}
                            isLast={index === stations.length - 1}
                            onMove={handleMove}
                          />
                        )
                      : (
                          <SavedStationItem
                            stationId={station.id}
                            key={station.id}
                            onSaveButtonClick={handleSaveStationButton}
                            isSaved={station.isSaved}
                            isFirst={index === 0}
                            isLast={index === stations.length - 1}
                            onMove={handleMove}
                          />
                        ))
                  )
                : (
                    <li className="px-8 py-4 font-bold">Tidak ada stasiun atau rute disimpan</li>
                  )}
            </ul>
          )}
    </main>
  )
}
