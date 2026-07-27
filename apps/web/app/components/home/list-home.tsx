import { useEffect, useMemo, useState } from 'react'
import type { Station } from 'models/stations'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import type { StandardResponse } from '@schema/response'
import LineCard from '~/components/line-card'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'
import SearchStationsButton from '~/components/nav-buttons/search-stations'
import { CaretRightIcon, DownloadSimpleIcon, InfoIcon, WarningIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import SettingsButton from '~/components/nav-buttons/settings'
import FareButton from '~/components/nav-buttons/fare'
import { useNetworkStatus } from '~/hooks/network'
import { useInstall } from '~/contexts/installable'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

function EmptyState() {
  return (
    <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="polite">
      <picture>
        <source srcSet="/img/station.webp" type="image/webp" />
        <img src="/img/station.png" alt="Gambar peron stasiun dengan jembatan di atasnya" className="w-48 h-48 aspect-square object-contain" fetchPriority="high" />
      </picture>
      <span className="text-2xl text-center font-bold mt-0">Belum Ada Stasiun Disimpan</span>
      <p className="text-center mt-2">
        Klik tombol
        {' '}
        <b>Cari Stasiun</b>
        {' '}
        di bawah untuk mulai cari jadwal & simpan stasiun!
      </p>
    </div>
  )
}

function StationCard({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const timetableData = useMemo(() => normalizeGroupedTimetable(timetable.data?.data), [timetable.data])
  const networkStatus = useNetworkStatus()

  if (station.isLoading) {
    return (
      <li className="animate-pulse px-4">
        <article>
          <div className="h-6 w-64 mt-4 mx-4 bg-slate-200 rounded" />
          <div className="mt-4 w-full h-[320px] bg-slate-200 rounded-xl" />
        </article>
      </li>
    )
  }

  if (station.data?.data) {
    return (
      <li>
        <article>
          <h1 className="font-semibold text-sm uppercase tracking-wide text-slate-500 flex px-4 py-3 sticky top-0 bg-rose-50/20 backdrop-blur-2xl z-10 lg:relative lg:backdrop-blur-none lg:bg-transparent">
            <Link to={`/stations/${station.data.data.operator.code}/${station.data.data.code}`} className="group flex-grow">
              Stasiun&nbsp;
              { station.data.data.formattedName }
              <CaretRightIcon weight="bold" className="inline w-3.5 h-3.5 group-hover:ml-3 ml-2 transition-[margin] duration-200 -mt-0.5" />
            </Link>
          </h1>
          { timetable.isLoading
            ? (
                <div className="flex h-[320px] bg-slate-200 rounded-xl mx-4 animate-pulse" />
              )
            : timetableData?.length
              ? (
                  <ul className="flex flex-col lg:grid lg:grid-cols-2 gap-4 mx-4">
                    {timetableData.map(line => (
                      <LineCard key={line.lineCode} line={line} />
                    ))}
                  </ul>
                )
              : (
                  <div className="mx-4 p-4 bg-rose-50 rounded-xl flex flex-col gap-2 items-start">
                    <span className="text-slate-700 font-semibold">
                      {timetable.error ? 'Gagal memuat jadwal' : 'Jadwal tidak tersedia'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { void timetable.mutate() }}
                      className="bg-[#F55875] text-white font-bold px-4 py-2 rounded-lg cursor-pointer text-sm"
                    >
                      Coba Lagi
                    </button>
                  </div>
                )}
        </article>
      </li>
    )
  }

  // The station itself failed to load (offline or fetch error). Render a
  // compact, retry-able card — NOT the full-screen "no saved stations" empty
  // state, which is the wrong message here (this IS a saved station) and would
  // break the list layout.
  return (
    <li className="px-4">
      <article className="mx-4 mt-4 p-4 bg-rose-50 rounded-xl flex flex-col gap-3 items-start">
        <span className="font-semibold text-slate-700">
          {networkStatus === 'OFFLINE'
            ? 'Tidak dapat memuat stasiun ini saat offline'
            : 'Gagal memuat stasiun ini'}
        </span>
        <button
          type="button"
          onClick={() => { void Promise.all([station.mutate(), timetable.mutate()]) }}
          className="bg-[#F55875] text-white font-bold px-4 py-2 rounded-lg cursor-pointer"
        >
          Coba Lagi
        </button>
      </article>
    </li>
  )
}

interface Props {
  stationIds: string[]
}

export default function ListHome({ stationIds }: Props) {
  const networkStatus = useNetworkStatus()
  const { isInstallable, showIOSInstructions, isStandalone, promptInstall } = useInstall()
  const [showInstallBanner, setShowInstallBanner] = useState(false)

  const canInstall = (isInstallable || showIOSInstructions) && !isStandalone

  useEffect(() => {
    setShowInstallBanner(localStorage.getItem('is-install-banner-dismissed') !== 'true')
  }, [])

  const handleDismissInstallBannerButton = () => {
    localStorage.setItem('is-install-banner-dismissed', 'true')
    setShowInstallBanner(false)
  }

  const handleInstallBannerButton = async () => {
    const result = await promptInstall()
    if (result) {
      localStorage.setItem('is-install-banner-dismissed', 'true')
      setShowInstallBanner(false)
    }
  }

  return (
    <main className="w-full min-h-screen">
      {networkStatus === 'OFFLINE' && (
        <div className="px-4 max-w-3xl mx-auto mt-8">
          <div className="text-amber-950 bg-amber-100 flex flex-row gap-2 rounded-xl p-4 font-semibold">
            <WarningIcon weight="duotone" className="w-6 h-6" />
            Kamu sedang offline, data mungkin tidak up-to-date
          </div>
        </div>
      )}

      {showInstallBanner && canInstall && (
        <div className="px-4 max-w-3xl mx-auto mt-8">
          <div className="text-amber-950 bg-rose-100 flex flex-col gap-3 rounded-xl p-4 font-semibold">
            { isInstallable && (
              <>
                Instal Commute ke perangkatmu biar tinggal tap kalo mau cek jadwal!
                <button onClick={handleInstallBannerButton} className="flex flex-row text-center bg-[#F55875] text-white items-center justify-center rounded-lg px-4 py-2 gap-2 cursor-pointer">
                  <DownloadSimpleIcon weight="bold" className="w-6 h-6" />
                  {' '}
                  Instal Sekarang
                </button>
              </>
            )}
            { showIOSInstructions && (
              <>
                Tambahkan Commute ke Home Screen iPhone-mu biar tinggal tap kalo mau cek jadwal!
                <Link to="/settings/installation" className="flex flex-row text-center bg-[#F55875] text-white items-center justify-center rounded-lg px-4 py-2 gap-2 cursor-pointer">
                  <InfoIcon weight="bold" className="w-6 h-6" />
                  {' '}
                  Lihat Caranya
                </Link>
              </>
            )}
            <button onClick={handleDismissInstallBannerButton} className="flex flex-row text-center bg-rose-50 text-[#F55875] items-center justify-center rounded-lg px-4 py-2 gap-2 font-bold cursor-pointer">
              Nanti Saja
            </button>
          </div>
        </div>
      )}

      {stationIds.length > 0
        ? (
            <ul className="flex flex-col gap-5 pb-42 max-w-3xl mx-auto" aria-label="Daftar stasiun tersimpan">
              {stationIds.map(station => (
                <StationCard key={station} stationId={station} />
              ))}
            </ul>
          )
        : (
            <EmptyState />
          )}

      <nav className="fixed bottom-0 py-4 bg-gradient-to-t from-50% from-[#FFF8F8] to-transparent w-screen z-20" aria-label="Navigasi utama">
        <div className="w-full max-w-3xl mx-auto flex gap-3 overflow-x-auto no-scrollbar">
          <SearchStationsButton className="ml-4 lg:ml-2" />
          <FareButton />
          <SettingsButton className={canInstall ? '' : 'mr-4 lg:mr-2'} />
        </div>
      </nav>
    </main>
  )
}
