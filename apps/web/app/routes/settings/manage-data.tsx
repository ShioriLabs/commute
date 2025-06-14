import { ChevronLeftIcon, TrashIcon } from '@heroicons/react/20/solid'
import { useState, useEffect, useCallback } from 'react'
import { createStore, get, keys as getAllKeys, clear } from 'idb-keyval'
import { useMemo } from 'react'

export function meta() {
  return [
    { title: 'Atur Data - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

interface DataEntryItemProps {
  title: string
  subtitle: string
  onClearButtonClick: () => void
  showClearButton?: boolean
}

function DataEntryItem({ title, subtitle, onClearButtonClick, showClearButton = true }: DataEntryItemProps) {
  const handleClearButtonClick = useCallback(() => {
    onClearButtonClick()
  }, [onClearButtonClick])

  return (
    <li>
      <article className="px-8 py-4 flex items-center gap-4 justify-between">
        <div>
          <h1 className="font-semibold text-lg flex">
            { title }
          </h1>
          <h2 className="font-semibold text-sm text-slate-700">
            { subtitle }
          </h2>
        </div>
        <button onClick={handleClearButtonClick} className={!showClearButton ? 'hidden' : ''}>
          <TrashIcon className="w-6 h-6 text-red-400" />
        </button>
      </article>
    </li>
  )
}

async function getSWRCacheSize() {
  let sizeBytes = 0
  const store = createStore('swr-db', 'cache-store')
  const keys = await getAllKeys(store)

  for (const key of keys) {
    const data = await get(key, store)
    const bytes = new TextEncoder().encode(JSON.stringify(data.data)).length
    sizeBytes += bytes
  }

  return sizeBytes / 1024
}

async function clearSWRCache() {
  const store = createStore('swr-db', 'cache-store')
  await clear(store)
}

export default function ManageDataSettingsPage() {
  const [recentlySearchedCount, setRecentlySearchedCount] = useState(0)
  const [savedStationsCount, setSavedStationsCount] = useState(0)
  const [cacheSize, setCacheSize] = useState(0)
  const [isCacheSizeLoading, setIsCacheSizeLoading] = useState(true)

  useEffect(() => {
    const recentlySearchedRaw = localStorage.getItem('recently-searched')
    const savedStationsRaw = localStorage.getItem('saved-stations')

    if (recentlySearchedRaw) {
      try {
        const parsedRecentlySearched: string[] = JSON.parse(recentlySearchedRaw)
        if (parsedRecentlySearched.length) {
          setRecentlySearchedCount(parsedRecentlySearched.length)
        }
      } catch {
        localStorage.setItem('recently-searched', JSON.stringify([]))
      }
    }

    if (savedStationsRaw) {
      try {
        const parsedSavedStations: string[] = JSON.parse(savedStationsRaw)
        if (parsedSavedStations.length) {
          setSavedStationsCount(parsedSavedStations.length)
        }
      } catch {
        localStorage.setItem('saved-stations', JSON.stringify([]))
      }
    }

    loadCacheSize()
  }, [
    setRecentlySearchedCount,
    setSavedStationsCount
  ])

  const loadCacheSize = async () => {
    const size = await getSWRCacheSize()
    setIsCacheSizeLoading(false)
    setCacheSize(size)
  }

  const cacheSizeSubtitle = useMemo(() => {
    if (isCacheSizeLoading) return 'Memuat...'
    return `${cacheSize.toFixed(2)} KB`
  }, [cacheSize, isCacheSizeLoading])

  const handleClearRecentlySearched = useCallback(() => {
    localStorage.setItem('recently-searched', JSON.stringify([]))
    setRecentlySearchedCount(0)
  }, [setRecentlySearchedCount])

  const handleClearSavedStation = useCallback(() => {
    const confirmed = confirm('Yakin mau hapus semua stasiun disimpan?')
    if (confirmed) {
      localStorage.setItem('saved-stations', JSON.stringify([]))
      setSavedStationsCount(0)
    }
  }, [setSavedStationsCount])

  const handleClearCache = useCallback(async () => {
    const confirmed = confirm('Yakin mau hapus cache? Loading berikutnya bakal sedikit lebih lambat')
    if (confirmed) {
      setIsCacheSizeLoading(true)
      await clearSWRCache()
      setIsCacheSizeLoading(false)
      setCacheSize(0)
    }
  }, [setCacheSize])

  return (
    <main className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <ChevronLeftIcon />
          </button>
          <h1 className="font-bold text-2xl">Atur Data</h1>
        </div>
      </div>
      <ul className="max-w-3xl mx-auto">
        <DataEntryItem
          title="Riwayat Pencarian"
          subtitle={recentlySearchedCount > 0 ? `${recentlySearchedCount} item` : 'Riwayat pencarian kosong'}
          onClearButtonClick={handleClearRecentlySearched}
          showClearButton={recentlySearchedCount > 0}
        />
        <DataEntryItem
          title="Stasiun Disimpan"
          subtitle={savedStationsCount > 0 ? `${savedStationsCount} stasiun` : 'Tidak ada stasiun disimpan'}
          onClearButtonClick={handleClearSavedStation}
          showClearButton={savedStationsCount > 0}
        />
        <DataEntryItem
          title="Cache"
          subtitle={cacheSizeSubtitle}
          onClearButtonClick={handleClearCache}
          showClearButton={cacheSize > 0}
        />
      </ul>
    </main>
  )
}
