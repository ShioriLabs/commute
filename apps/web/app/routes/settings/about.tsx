/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { useCallback, useState } from 'react'
import { CaretLeftIcon } from '@phosphor-icons/react'
import CommuteLogotype from 'public/img/logotype.svg'
import { useMapUnlock } from '~/hooks/secret-features'

export function meta() {
  return [
    { title: 'Tentang - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

declare const __APP_VERSION__: string

// Taps on the version line needed to reveal the unreleased map. Stays silent
// for the first few so it can't be stumbled into by an idle tap; the counter
// is component state, so leaving the page resets it.
const UNLOCK_TAP_COUNT = 7
const TAPS_BEFORE_HINT = 4

export default function AboutSettingsPage() {
  const { isUnlocked, setUnlocked } = useMapUnlock()
  const [tapCount, setTapCount] = useState(0)

  const handleVersionTap = useCallback(() => {
    if (isUnlocked) return
    const next = tapCount + 1
    setTapCount(next)
    if (next >= UNLOCK_TAP_COUNT) setUnlocked(true)
  }, [isUnlocked, tapCount, setUnlocked])

  const handleHideButtonClick = useCallback(() => {
    setUnlocked(false)
    setTapCount(0)
  }, [setUnlocked])

  const showTapHint = !isUnlocked && tapCount >= TAPS_BEFORE_HINT

  return (
    <main className="bg-white w-full h-full overflow-y-auto pb-4 min-h-screen">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <CaretLeftIcon weight="bold" className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-2xl">Tentang</h1>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white px-8">
        <img src={CommuteLogotype} className="h-12" alt="Commute" />
        <h2 className="text-lg mt-4 font-bold text-[#F55875]">Aplikasi Jadwal Kereta Buat Anak Jakarta</h2>
        <p className="mt-4">
          Aplikasi Jadwal Kereta yang dibikin biar kita gak perlu buka 4 aplikasi cuma buat cek kereta berikutnya<br />
          Mudah, cepat, gratis, dan bisa offline (kalau udah di-save stasiunnya tapi)
        </p><br />
        <p>Dibuat dengan perasaan cinta, layaknya dapet kursi kosong di <i>rush hour</i> Sudirman, oleh <b className="text-[#F55875]">Shiori Labs</b></p><br />
        <p>
          Punya pertanyaan, saran, atau pengen curhat kenapa Sudirman rame banget pas jam pulang kerja?<br />
          Langsung aja Hubungi Kami di:<br />
          Email: <a href="mailto:hai@shiorilabs.id" className="text-[#F55875] font-semibold">hai@shiorilabs.id</a><br />
          Repo: <a href="https://github.com/ShioriLabs/commute" className="text-[#F55875] font-semibold">ShioriLabs/commute</a><br />
          Laman Web: <a href="https://shiorilabs.id" className="text-[#F55875] font-semibold">shiorilabs.id</a><br />
          (tidak menerima curhatan soal percintaan)
        </p>
        <div className="block mt-8 font-mono text-slate-500">
          {/* Deliberately styled as plain text — cursor-default so it doesn't
              advertise itself, select-none so rapid taps don't raise the mobile
              text-selection callout instead of registering. */}
          <button type="button" onClick={handleVersionTap} className="text-left cursor-default select-none">
            @commute/web {__APP_VERSION__}
          </button><br />
          dari pekerja jakarta, oleh commuter jakarta, untuk pejuang jakarta
          {showTapHint && (
            <span className="block mt-2 text-slate-400">
              {UNLOCK_TAP_COUNT - tapCount} langkah lagi...
            </span>
          )}
          {isUnlocked && (
            <span className="block mt-2 text-slate-400">
              Peta integrasi aktif{' '}
              <button type="button" onClick={handleHideButtonClick} className="underline cursor-pointer">
                Sembunyikan
              </button>
            </span>
          )}
        </div>
      </div>
    </main>
  )
}
