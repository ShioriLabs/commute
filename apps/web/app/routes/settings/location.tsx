import { useCallback, useState } from 'react'
import { CaretLeftIcon, TrashIcon } from '@phosphor-icons/react'
import SettingsToggle from '~/components/settings-sheet/settings-toggle'
import { useLocation } from '~/contexts/location'
import type { LocationStatus } from '~/contexts/location'

export function meta() {
  return [
    { title: 'Lokasi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

const PERMISSION_DESCRIPTION: Record<LocationStatus, string> = {
  granted: 'Diizinkan',
  prompt: 'Belum diizinkan',
  // A browser will not re-prompt after a denial, so the only way back is the
  // browser's own site settings. Say so instead of offering a dead button.
  denied: 'Ditolak. Buka pengaturan situs di browser kamu buat ngaktifin lagi.',
  error: 'Gagal ambil lokasi. Coba lagi.',
  unsupported: 'Browser kamu nggak dukung fitur lokasi'
}

function formatAge(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`

  return `${Math.round(hours / 24)} hari lalu`
}

export default function LocationSettingsPage() {
  const { isReady, status, fix, request, clearFix, prefs, setNearbyEnabled, setHereEnabled } = useLocation()
  const [isRequesting, setIsRequesting] = useState(false)

  const canRequest = status === 'prompt' || status === 'error'

  const handleRequest = useCallback(async () => {
    setIsRequesting(true)
    await request()
    setIsRequesting(false)
  }, [request])

  return (
    <main className="bg-white w-screen h-full min-h-screen overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <CaretLeftIcon weight="bold" className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-2xl">Lokasi</h1>
        </div>
      </div>

      <ul className="max-w-3xl mx-auto">
        <li>
          <article className="px-8 py-6 flex items-center gap-4 justify-between">
            <div>
              <h2 className="font-semibold text-lg">Izin Lokasi</h2>
              <p className="font-semibold text-sm text-slate-700">
                { isReady ? PERMISSION_DESCRIPTION[status] : 'Memuat...' }
              </p>
            </div>
            {isReady && canRequest && (
              <button
                onClick={handleRequest}
                disabled={isRequesting}
                className="shrink-0 bg-[#F55875] text-white font-bold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-60"
              >
                { isRequesting ? 'Mencari...' : 'Aktifkan' }
              </button>
            )}
          </article>
        </li>

        <SettingsToggle
          title="Stasiun Terdekat"
          description="Tampilkan stasiun di sekitarmu waktu buka pencarian"
          checked={prefs.nearby}
          onChange={setNearbyEnabled}
        />

        <SettingsToggle
          title="Kamu di Sini"
          description="Naikkan stasiun yang lagi kamu datangi ke urutan atas"
          checked={prefs.here}
          onChange={setHereEnabled}
        />

        {fix && (
          <li>
            <article className="px-8 py-6 flex items-center gap-4 justify-between">
              <div>
                <h2 className="font-semibold text-lg">Lokasi Tersimpan</h2>
                <p className="font-semibold text-sm text-slate-700">
                  { `${fix.lat.toFixed(4)}, ${fix.lng.toFixed(4)} · ${formatAge(fix.at)}` }
                </p>
              </div>
              <button onClick={clearFix} aria-label="Hapus lokasi tersimpan" className="cursor-pointer">
                <TrashIcon weight="fill" className="w-6 h-6 text-red-400" />
              </button>
            </article>
          </li>
        )}
      </ul>

      <p className="max-w-3xl mx-auto px-8 mt-4 text-sm text-slate-500">
        Lokasi kamu diproses di perangkat ini aja dan nggak pernah dikirim ke server Commute.
      </p>
    </main>
  )
}
