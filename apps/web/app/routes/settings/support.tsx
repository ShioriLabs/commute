/* eslint-disable @stylistic/jsx-one-expression-per-line */
import { useCallback, useState } from 'react'
import { ArrowSquareOutIcon, CaretLeftIcon, ShareNetworkIcon } from '@phosphor-icons/react'

export function meta() {
  return [
    { title: 'Dukung - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

const SAWERIA_URL = 'https://saweria.co/shiorilabs'
const BUTTON_CLASS_NAME = 'mt-4 inline-flex items-center gap-2 rounded-full bg-[#F55875] px-5 py-3 font-semibold text-white cursor-pointer'

export default function SupportSettingsPage() {
  const [copied, setCopied] = useState(false)

  /*
   * The app's own origin rather than this page's URL: the rider is sharing
   * Commute, not a settings page. The share sheet first, the clipboard when
   * there is none. A cancelled sheet is the rider changing their mind, so it
   * must not quietly copy the link anyway.
   */
  const handleShare = useCallback(async () => {
    const url = window.location.origin
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Commute', text: 'Aplikasi Jadwal Kereta Buat Anak Jakarta', url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

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
          <h1 className="font-bold text-2xl">Dukung Commute</h1>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white px-8">
        <h2 className="text-lg font-bold text-[#F55875]">Commute gratis, dan bakal tetep gratis</h2>
        <p className="mt-4">
          Commute dibikin sama <b className="text-[#F55875]">Shiori Labs</b> di sela-sela kegabutan pas lagi nggak commuting.
          Nggak ada iklan maupun langganan, tapi maintain server dan benerin jadwal juga butuh usaha lohya
        </p>

        <section className="mt-10">
          <h3 className="font-bold">Bagiin ke sesama pejuang transum</h3>
          <p className="mt-2">
            Cara paling gampang buat dukung: kasih tau temen kantor, grup WA keluarga, atau orang di peron sebelah yang lagi bingung naik apa
          </p>
          <button type="button" onClick={handleShare} className={BUTTON_CLASS_NAME}>
            <ShareNetworkIcon weight="bold" className="w-5 h-5" />
            {copied ? 'Link udah disalin' : 'Bagikan Commute'}
          </button>
        </section>

        <section className="mt-10">
          <h3 className="font-bold">Traktir Shiori Labs lewat Saweria</h3>
          <p className="mt-2">
            Kalau Commute pernah nyelametin kamu dari ketinggalan kereta terakhir, boleh banget traktir kita nih. Berapa aja boleh kok!
          </p>
          <a href={SAWERIA_URL} target="_blank" rel="noreferrer" className={BUTTON_CLASS_NAME}>
            Dukung di Saweria
            <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
          </a>
        </section>
      </div>
    </main>
  )
}
