import { XIcon } from '@phosphor-icons/react'
import { CloseButton, DialogTitle } from '@headlessui/react'
import SearchContent from './search-content'

// Dialog-bound header elements live here; everything else is shared with the
// standalone /search route via SearchContent.
export default function SearchSheet() {
  return (
    <SearchContent
      title={<DialogTitle className="font-bold text-2xl">Temukan</DialogTitle>}
      closeButton={(
        <CloseButton
          aria-label="Tutup halaman pencarian"
          className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
          aria-expanded="false"
          aria-controls="search-input"
        >
          <XIcon weight="bold" className="w-6 h-6" />
        </CloseButton>
      )}
    />
  )
}
