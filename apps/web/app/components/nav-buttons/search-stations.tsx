import { Dialog, DialogBackdrop, DialogPanel, Transition } from '@headlessui/react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { useState } from 'react'
import SearchSheet from './search-sheet'

interface Props {
  className?: string
}

export default function SearchStationsButton({ className }: Props) {
  const [isSearchSheetOpen, setIsSearchSheetOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={`bg-white p-4 rounded-xl shadow-2xs w-screen h-screen max-w-40 max-h-28 border-2 border-gray-200 flex flex-col relative overflow-clip select-none text-left ${className ? className : ''}`}
        aria-label="Cari stasiun"
        onClick={() => setIsSearchSheetOpen(true)}
      >
        <div className="absolute -bottom-4 -right-4 rounded-full bg-slate-100 p-4 z-[1]">
          <MagnifyingGlassIcon className="w-12 h-12" />
        </div>
        <b className="z-[2]">Cari</b>
        <span className="text-xl z-[2]">Stasiun</span>
      </button>
      <Dialog open={isSearchSheetOpen} onClose={() => setIsSearchSheetOpen(false)} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-black/30 duration-300 ease-out data-closed:opacity-0" />
        <div className="fixed inset-0 flex w-screen">
          <DialogPanel transition className="overflow-hidden relative w-screen h-screen mt-auto transition-all duration-250 mb-0 ml-0 max-w-screen max-h-screen rounded-none data-closed:ml-4 data-closed:mb-4 data-closed:max-w-40 data-closed:max-h-28 data-closed:rounded-xl">
            <SearchSheet />
            <Transition show={isSearchSheetOpen} appear>
              <div className="block w-screen h-screen absolute top-0 bg-white opacity-0 pointer-events-none data-closed:opacity-100 transition-all duration-250" />
            </Transition>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
