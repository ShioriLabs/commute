import { useEffect, useState } from 'react'
import { readSavedStations } from 'utils/saved-stations'
import { useMapUnlock } from '~/hooks/secret-features'
import ListHome from '~/components/home/list-home'
import MapHome from '~/components/home/map-home'

export function meta() {
  return [
    { title: 'Commute' },
    { name: 'theme-color', content: '#FFF8F8' }
  ]
}

export default function HomePage() {
  const [stationIds, setStationIds] = useState<string[]>([])
  const [isReady, setIsReady] = useState(false)
  const { isUnlocked: isMapUnlocked } = useMapUnlock()

  // Both localStorage reads land in the same post-mount pass, so the spinner
  // covers the unlock flag too. Without that, an unlocked user would see the
  // list home paint and then swap to the map — `useMapUnlock` returns false
  // until mount, which is correct for SSR but visible if left ungated.
  useEffect(() => {
    setStationIds(readSavedStations())
    setIsReady(true)
  }, [])

  if (!isReady) {
    return (
      <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="assertive">
        <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
      </div>
    )
  }

  if (isMapUnlocked) {
    return <MapHome stationIds={stationIds} />
  }

  return <ListHome stationIds={stationIds} />
}
