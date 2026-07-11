import { XIcon } from '@phosphor-icons/react'
import SearchContent from '~/components/search-sheet/search-content'

export function meta() {
  return [
    { title: 'Cari Stasiun - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

// Standalone fallback for hard navigations to /search; the home screen opens
// the same content inside the morphing sheet (see nav-buttons/search-stations).
export default function SearchPage() {
  return (
    <main className="h-dvh bg-white">
      <SearchContent
        title={<h1 className="font-bold text-2xl">Temukan</h1>}
        closeButton={(
          <button
            onClick={() => history.back()}
            aria-label="Tutup halaman pencarian"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            aria-expanded="false"
            aria-controls="search-input"
          >
            <XIcon weight="bold" className="w-6 h-6" />
          </button>
        )}
      />
    </main>
  )
}
