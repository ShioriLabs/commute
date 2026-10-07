import { useEffect, useState, type SyntheticEvent } from 'react'
import { CaretLeftIcon } from '@phosphor-icons/react'

export function meta() {
  return [
    { title: 'Closed Test Android - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

const TALLY_EMBED_SCRIPT = 'https://tally.so/widgets/embed.js'
const TALLY_FORM_URL = 'https://tally.so/embed/Y5Lvjv?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1'

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void }
  }
}

/*
 * Tally's own snippet, minus the inline <script>. embed.js is what drives
 * dynamicHeight; when it fails to load (blocked, offline) the iframes still get
 * their src so the form works, just at its fixed height.
 */
function loadTallyEmbeds() {
  if (window.Tally) {
    window.Tally.loadEmbeds()
    return
  }
  document.querySelectorAll<HTMLIFrameElement>('iframe[data-tally-src]:not([src])').forEach((iframe) => {
    iframe.src = iframe.dataset.tallySrc!
  })
}

// Mirrors the form's own layout (two text fields, a checkbox, the submit
// button) so nothing jumps much when it swaps in.
function TallyFormSkeleton() {
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 flex flex-col animate-pulse pt-10">
      <div className="w-40 h-5 bg-slate-200 rounded-lg" />
      <div className="mt-3 w-full h-9 bg-slate-200 rounded-lg" />
      <div className="mt-6 w-56 h-5 bg-slate-200 rounded-lg" />
      <div className="mt-3 w-full h-9 bg-slate-200 rounded-lg" />
      <div className="mt-6 w-44 h-5 bg-slate-200 rounded-lg" />
      <div className="mt-3 flex gap-3 items-center">
        <div className="w-5 h-5 bg-slate-200 rounded" />
        <div className="w-60 h-4 bg-slate-200 rounded-lg" />
      </div>
      <div className="mt-8 w-24 h-9 bg-slate-200 rounded-lg" />
    </div>
  )
}

export default function AndroidClosedTestSettingsPage() {
  const [formLoaded, setFormLoaded] = useState(false)

  // The iframe has no src until embed.js (or the fallback) assigns one, and
  // Chrome fires load for that initial about:blank, so only a load with a src
  // counts as the form.
  const handleFormLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    if (event.currentTarget.getAttribute('src')) setFormLoaded(true)
  }

  useEffect(() => {
    if (window.Tally) {
      loadTallyEmbeds()
      return
    }
    // A script tag from an earlier visit may still be loading; its onload
    // covers this mount too, since it queries the document, not a ref.
    if (document.querySelector(`script[src="${TALLY_EMBED_SCRIPT}"]`)) return
    const script = document.createElement('script')
    script.src = TALLY_EMBED_SCRIPT
    script.onload = loadTallyEmbeds
    script.onerror = loadTallyEmbeds
    document.body.appendChild(script)
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
          <h1 className="font-bold text-2xl">Closed Test Android</h1>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto bg-white px-8">
        <h2 className="text-lg font-bold text-[#F55875]">Bantu kita ngetes Commute di Android</h2>
        <p className="mt-4">
          Commute versi Android lagi disiapin buat Play Store. Sebelum bisa rilis publik, Google minta aplikasinya dites dulu sama sekelompok tester selama beberapa waktu
        </p>
        <p className="mt-4">
          Isi formnya pakai akun Gmail yang kamu pakai di Play Store ya, nanti kita kabarin kalau undangannya udah siap
        </p>

        <section className="mt-8 relative">
          {!formLoaded && <TallyFormSkeleton />}
          {/* Tally insets its form 8px inside the frame; the negative margin
              lines the fields up with the copy above */}
          <iframe
            data-tally-src={TALLY_FORM_URL}
            loading="lazy"
            height={387}
            title="Daftar Closed Test Commute Android"
            onLoad={handleFormLoad}
            className={`-mx-2 w-[calc(100%+1rem)] border-0 transition-opacity duration-300 ${formLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </section>
      </div>
    </main>
  )
}
