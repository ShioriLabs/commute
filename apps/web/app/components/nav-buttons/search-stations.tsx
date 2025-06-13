import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { useRef, useState } from 'react'
import SearchSheet from './search-sheet'

interface Props {
  className?: string
}

export default function SearchStationsButton({ className }: Props) {
  const [isSearchSheetOpen, setIsSearchSheetOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleOpen = () => {
    if (buttonRef.current) {
      const left = buttonRef.current.getBoundingClientRect().left
      document.documentElement.style.setProperty('--panel-left', `${left}px`)
    }

    setIsSearchSheetOpen(true)
  }

  return (
    <div>
      <button
        type="button"
        className={`bg-white p-4 rounded-xl shadow-2xs w-screen h-screen max-w-44 max-h-32 border-2 border-gray-200 flex flex-col relative overflow-clip select-none text-left ${className ? className : ''}`}
        aria-label="Cari stasiun"
        onClick={handleOpen}
        ref={buttonRef}
      >
        <Transition show={!isSearchSheetOpen}>
          <TransitionChild>
            <div className="absolute -bottom-4 -right-4 rounded-full bg-slate-100 p-4 z-[1] ease-in-out translate-y-0 data-closed:translate-y-full transition-transform data-enter:delay-200 transform-gpu duration-200">
              <TransitionChild>
                <MagnifyingGlassIcon className="w-12 h-12 translate-y-0 data-closed:translate-y-4 ease-in-out data-enter:delay-200 transform-gpu" />
              </TransitionChild>
            </div>
          </TransitionChild>
          <TransitionChild>
            <b className="z-[2] translate-y-0 data-closed:-translate-y-[200%] ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200">Cari</b>
          </TransitionChild>
          <TransitionChild>
            <span className="text-xl z-[2] translate-y-0 data-closed:-translate-y-[250%] ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200">Stasiun</span>
          </TransitionChild>
        </Transition>
      </button>
      <Dialog open={isSearchSheetOpen} onClose={() => setIsSearchSheetOpen(false)} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-white/30 duration-200 ease-out data-closed:opacity-0 hidden" />
        <div className="fixed inset-0 flex w-screen">
          <DialogPanel
            transition
            className="overflow-hidden relative w-screen h-screen mt-auto transition-all duration-250 ease-in-out mb-0 ml-0 max-w-screen max-h-screen rounded-none left-0 data-closed:ml-4 data-closed:mb-4 data-closed:max-w-40 data-closed:max-h-28 data-closed:rounded-xl data-closed:left-[var(--panel-left)] transform-gpu"
          >
            <SearchSheet />
            <Transition show={isSearchSheetOpen} appear>
              <div className="block w-screen h-screen absolute top-0 bg-white opacity-0 pointer-events-none data-closed:opacity-100 transition-all duration-250" />
            </Transition>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  )
}
