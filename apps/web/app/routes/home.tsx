import { useMemo, useState } from 'react'
import type { CompactLineGroupedTimetable, Station } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import LineCard from '~/components/line-card'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'
import SearchStationsButton from '~/components/nav-buttons/search-stations'
import { CaretRightIcon, DownloadSimpleIcon, InfoIcon, WarningIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import SettingsButton from '~/components/nav-buttons/settings'
import MapButton from '~/components/nav-buttons/map'
import { useNetworkStatus } from '~/hooks/network'
import { useInstall } from '~/contexts/installable'
import { useMapUnlock } from '~/hooks/secret-features'
import { CARD_STAGGER, NAV_STAGGER, staggerDelay } from 'utils/stagger'
import clsx from 'clsx'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

export function meta() {
  return [
    { title: 'Commute' },
    { name: 'theme-color', content: '#FFF8F8' }
  ]
}

// Ceiling on placeholder blocks while a timetable loads. Interchanges like
// Manggarai serve enough lines that one block each would fill several screens,
// and a skeleton taller than the content it stands in for shoves the page the
// other way when it resolves.
const MAX_SKELETON_LINES = 3

function EmptyState({ mode = 'NO_SAVED' }: { mode: 'NO_SAVED' | 'OFFLINE' }) {
  return (
    <div className="home-enter w-full h-screen flex items-center justify-center flex-col p-2" aria-live="polite">
      <picture>
        <source srcSet="/img/station.webp" type="image/webp" />
        <img src="/img/station.png" alt="Gambar peron stasiun dengan jembatan di atasnya" className="w-48 h-48 aspect-square object-contain" fetchPriority="high" />
      </picture>
      {mode === 'NO_SAVED' && (
        <>
          <span className="text-2xl text-center font-bold mt-0">Belum Ada Stasiun Disimpan</span>
          <p className="text-center mt-2">
            Klik tombol
            {' '}
            <b>Mau ke mana?</b>
            {' '}
            di bawah untuk cari jadwal, cek tarif & simpan stasiun!
          </p>
        </>
      )}

      {mode === 'OFFLINE' && (
        <>
          <span className="text-2xl text-center font-bold mt-0">Jaringan Tidak Tersedia</span>
          <p className="text-center mt-2">
            Silakan coba lagi beberapa saat lagi saat jaringan Anda tersambung
          </p>
        </>
      )}
    </div>
  )
}

// The entrance lives on the outer <li>, above the loading fork on purpose: the
// skeleton and the loaded card are different subtrees, so animating whichever
// one happens to render would fire on the skeleton — and SWR's cache resolves a
// warm revisit synchronously, meaning it would animate on some visits and not
// others. Mounting one <li> for the card's whole life makes the entrance fire
// exactly once, whatever is inside it.
function StationCard({ stationId, index = 0 }: { stationId: string, index?: number }) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const timetableData = useMemo(() => normalizeGroupedTimetable(timetable.data?.data), [timetable.data])
  const networkStatus = useNetworkStatus()

  // Every branch below is wrapped by the single <li> at the end of this
  // component. Horizontal padding stays on the branches, not the wrapper: the
  // loaded card's children already inset themselves with `mx-4`, so hoisting a
  // `px-4` would double the gutter on that branch only.
  const content = (() => {
    if (station.isLoading) {
      // The fade and the pulse have to sit on separate elements: `animation` is
      // a single property, so putting both classes on one node means the later
      // rule wins and the skeleton silently stops pulsing.
      return (
        <article className="content-fade px-4">
          <div className="animate-pulse">
            <div className="h-6 w-64 mt-4 mx-4 bg-slate-200 rounded" />
            <div className="mt-4 w-full h-[320px] bg-slate-200 rounded-xl" />
          </div>
        </article>
      )
    }

    if (station.data?.data) {
      return (
        <article className="content-fade">
          <h1 className="font-bold text-xl flex px-4 py-4 sticky top-0 bg-rose-50/20 backdrop-blur-2xl z-10 lg:relative lg:backdrop-blur-none lg:bg-transparent">
            <Link to={`/stations/${station.data.data.operator.code}/${station.data.data.code}`} className="group flex-grow">
              Stasiun&nbsp;
              { station.data.data.formattedName }
              <CaretRightIcon weight="bold" className="inline w-4 h-4 group-hover:ml-3 ml-2 transition-[margin] duration-200 mb-1" />
            </Link>
          </h1>
          { timetable.isLoading
            ? (
                // One placeholder per line the station serves, rather than a
                // single fixed block. /stations resolves before the timetable
                // and carries `lines`, so the skeleton can be roughly the shape
                // of what replaces it — a flat 320px was ~536px short on
                // Manggarai, and that gap is what made the swap feel like a
                // shove rather than a load.
                //
                // It stays an estimate: a line with no departures is dropped
                // from the timetable, and real cards run 203-638px depending on
                // direction groups. Close beats exact here — the crossfade
                // absorbs what's left.
                <div className="content-fade">
                  <div className="flex flex-col lg:grid lg:grid-cols-2 gap-4 mx-4 animate-pulse">
                    {station.data.data.lines.slice(0, MAX_SKELETON_LINES).map(line => (
                      <div key={line.lineCode} className="h-[280px] bg-slate-200 rounded-xl" />
                    ))}
                  </div>
                </div>
              )
            : timetableData?.length
              ? (
                  // Fades in over the skeleton it replaces. The per-line
                  // placeholders above get the height close, so this only has
                  // to soften the remaining difference.
                  <ul className="content-fade flex flex-col lg:grid lg:grid-cols-2 gap-4 mx-4">
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
      )
    }

    // The station itself failed to load (offline or fetch error). Render a
    // compact, retry-able card — NOT the full-screen "no saved stations" empty
    // state, which is the wrong message here (this IS a saved station) and would
    // break the list layout.
    return (
      <div className="px-4">
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
      </div>
    )
  })()

  return (
    <li className="home-enter" style={{ animationDelay: staggerDelay(index, CARD_STAGGER) }}>
      { content }
    </li>
  )
}

// Synchronous on purpose: reading localStorage in an effect meant one render
// with nothing to show, which put a full-screen spinner between the boot
// splash and the skeletons. This route is not in the prerender list
// (react-router.config.ts), so the component body only ever runs in the
// browser and localStorage is safe to touch directly. The try/catch covers
// blocked storage (private mode), where the old effect would have thrown
// before setting ready and spun forever.
function readSavedStations(): string[] {
  try {
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw) {
      localStorage.setItem('saved-stations', '[]')
      return []
    }

    const parsedSavedStations = JSON.parse(savedStationsRaw)
    if (!(parsedSavedStations instanceof Array)) {
      localStorage.setItem('saved-stations', '[]')
      return []
    }

    return parsedSavedStations as string[]
  } catch (e) {
    if (e instanceof SyntaxError) {
      try {
        localStorage.setItem('saved-stations', '[]')
      } catch {
        // Storage unwritable — nothing to reset.
      }
    }
    return []
  }
}

export default function HomePage() {
  const [stations] = useState<string[]>(readSavedStations)
  const networkStatus = useNetworkStatus()
  const { isInstallable, showIOSInstructions, isStandalone, promptInstall } = useInstall()
  const [showInstallBanner, setShowInstallBanner] = useState(() => {
    try {
      return localStorage.getItem('is-install-banner-dismissed') !== 'true'
    } catch {
      // A dismissal that can't persist would nag on every load — prefer hidden.
      return false
    }
  })
  const { isUnlocked: isMapUnlocked } = useMapUnlock()

  const canInstall = (isInstallable || showIOSInstructions) && !isStandalone

  // Built as a list so the rail's entrance stagger indexes cleanly whether or
  // not the map card is unlocked — otherwise Setelan's delay would jump when
  // the card in front of it disappears.
  const navItems = [
    { key: 'search', railClassName: 'ml-4 lg:ml-2', node: <SearchStationsButton /> },
    ...(isMapUnlocked ? [{ key: 'map', railClassName: '', node: <MapButton /> }] : []),
    { key: 'settings', railClassName: canInstall ? '' : 'mr-4 lg:mr-2', node: <SettingsButton /> }
  ]

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

      {stations.length > 0
        ? (
            <ul className="flex flex-col gap-5 pb-42 max-w-3xl mx-auto" aria-label="Daftar stasiun tersimpan">
              {stations.map((station, index) => (
                <StationCard key={station} stationId={station} index={index} />
              ))}
            </ul>
          )
        : (
            <EmptyState mode="NO_SAVED" />
          )}
      {/* w-full, not w-screen: 100vw includes the scrollbar gutter, which would
          center the rail 7.5px off the feed's grid on classic-scrollbar
          platforms (a fixed element's 100% resolves against the viewport minus
          the scrollbar, same as the flow content). */}
      <nav className="fixed bottom-0 py-4 bg-gradient-to-t from-50% from-[#FFF8F8] to-transparent w-full z-20" aria-label="Navigasi utama">
        {/* Three cards can't fit a phone (510px against ~380px usable at 412px
            wide), so the rail scrolls by design. The accent primary card is
            always the first thing in view, and the right-edge fade signals
            there's more — the previous `no-scrollbar` hid that entirely, which
            is why Peta and Setelan read as missing rather than off-screen.
            Fare is no longer here: the search sheet's route mode covers it. */}
        {/* py-2/-my-2: overflow-x-auto computes overflow-y to auto as well, so
            the rail clips vertically too and shaves the cards' hover scale (and
            their shadow) off the top and bottom. The padding gives that growth
            room without changing the rail's layout height. */}
        <div className="w-full max-w-3xl mx-auto flex gap-3 overflow-x-auto py-2 -my-2 no-scrollbar [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] lg:[mask-image:none]">
          {navItems.map((item, index) => (
            <div
              key={item.key}
              // The entrance rides a wrapper, not the card: the button owns
              // `transition-transform` for its hover scale and a headlessui
              // Transition for its face, and a third writer on that element
              // would fight both.
              className={clsx('home-enter-nav shrink-0', item.railClassName)}
              style={{ animationDelay: staggerDelay(index, NAV_STAGGER) }}
            >
              { item.node }
            </div>
          ))}
        </div>
      </nav>
    </main>
  )
}
