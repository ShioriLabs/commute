import { MapPinIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from '~/contexts/location'

const DISMISSED_KEY = 'is-location-banner-dismissed'

/*
 * In-page opt-in for location, mirroring the install banner. The app never
 * raises a permission dialog on its own — the user taps here first.
 *
 * Shown once: dismissing or granting both retire it for good, and the settings
 * page becomes the permanent control from then on.
 */
export default function LocationBanner() {
  const { isReady, status, request } = useLocation()
  // Starts dismissed so nothing flashes in before localStorage is read.
  const [isDismissed, setIsDismissed] = useState(true)
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    setIsDismissed(localStorage.getItem(DISMISSED_KEY) === 'true')
  }, [])

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setIsDismissed(true)
  }, [])

  const handleEnable = useCallback(async () => {
    setIsRequesting(true)
    const granted = await request()
    setIsRequesting(false)

    if (granted) {
      localStorage.setItem(DISMISSED_KEY, 'true')
      setIsDismissed(true)
    }
  }, [request])

  if (!isReady || isDismissed || status !== 'prompt') {
    return null
  }

  return (
    <div className="px-4 max-w-3xl mx-auto mt-8">
      <div className="text-amber-950 bg-rose-100 flex flex-col gap-3 rounded-xl p-4 font-semibold">
        Izinkan lokasi biar stasiun yang lagi kamu datangi otomatis naik ke urutan atas!
        <button
          onClick={handleEnable}
          disabled={isRequesting}
          className="flex flex-row text-center bg-[#F55875] text-white items-center justify-center rounded-lg px-4 py-2 gap-2 cursor-pointer disabled:opacity-60"
        >
          <MapPinIcon weight="bold" className="w-6 h-6" />
          { isRequesting ? 'Lagi Cari Lokasi...' : 'Aktifkan Lokasi' }
        </button>
        <button onClick={handleDismiss} className="flex flex-row text-center bg-rose-50 text-[#F55875] items-center justify-center rounded-lg px-4 py-2 gap-2 font-bold cursor-pointer">
          Nanti Saja
        </button>
      </div>
    </div>
  )
}
