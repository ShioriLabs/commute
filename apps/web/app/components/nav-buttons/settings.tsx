import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { Cog6ToothIcon } from '@heroicons/react/20/solid'
import { useRef, useState, useEffect } from 'react'
import SettingsSheet from '../settings-sheet'

interface Props {
  className?: string
}

export default function SettingsButton({ className }: Props) {
  const [isSearchSheetOpen, setIsSearchSheetOpen] = useState(false)
  const [originalUrl, setOriginalUrl] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleOpen = () => {
    // Store the current URL before changing it
    setOriginalUrl(window.location.pathname + window.location.search)

    // Use pushState to create a history entry for the back button
    window.history.pushState(
      { modalOpen: true, originalUrl: window.location.pathname + window.location.search },
      '',
      '/settings'
    )

    setIsSearchSheetOpen(true)

    if (buttonRef.current) {
      const startRect = buttonRef.current.getBoundingClientRect()
      const sw = startRect.width
      const sh = startRect.height
      const sx = startRect.left
      const sy = startRect.top

      const ew = window.innerWidth
      const eh = window.innerHeight
      const ex = 0
      const ey = 0

      const dx = sx - ex
      const dy = sy - ey
      const dw = sw / ew
      const dh = sh / eh
      document.documentElement.style.setProperty('--panel-transform', `translate(${dx}px, ${dy}px) scale(${dw}, ${dh})`)
    }
  }

  const handleClose = () => {
    // Go back in history instead of manually changing URL
    if (window.history.state?.modalOpen) {
      window.history.back()
    } else {
      // Fallback if state is lost
      window.history.replaceState(
        { ...window.history.state, modalOpen: false },
        '',
        originalUrl
      )
    }

    setIsSearchSheetOpen(false)
  }

  // Handle browser navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // If we're popping back from the search modal state
      if (event.state?.modalOpen && isSearchSheetOpen) {
        // This is moving forward to search, ignore
        return
      }

      // If modal is open and we're going back, close it
      if (isSearchSheetOpen) {
        setIsSearchSheetOpen(false)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isSearchSheetOpen])

  return (
    <div>
      <button
        type="button"
        className={`bg-white p-4 rounded-xl shadow-2xs w-screen h-screen max-w-44 max-h-32 border-2 border-rose-50 flex flex-col relative overflow-clip select-none text-left cursor-pointer scale-100 lg:hover:scale-105 transition-transform transform-gpu ease-in-out ${className ? className : ''}`}
        aria-label="Cari stasiun"
        onClick={handleOpen}
        ref={buttonRef}
      >
        <Transition show={!isSearchSheetOpen}>
          <TransitionChild>
            <div className="absolute -bottom-4 -right-4 rounded-full bg-slate-100 p-4 z-[1] ease-in-out translate-y-0 data-closed:translate-y-full transition-transform data-enter:delay-200 transform-gpu duration-200">
              <TransitionChild>
                <Cog6ToothIcon className="w-12 h-12 translate-y-0 data-closed:translate-y-4 ease-in-out data-enter:delay-200 transform-gpu text-slate-700" />
              </TransitionChild>
            </div>
          </TransitionChild>
          <TransitionChild>
            <b
              className="z-[2] translate-y-0 data-closed:-translate-y-[200%] ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              Pengaturan
            </b>
          </TransitionChild>
          <TransitionChild>
            <span
              className="text-lg leading-tight z-[2] translate-y-0 data-closed:-translate-y-[250%] ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              Aplikasi
            </span>
          </TransitionChild>
        </Transition>
      </button>
      <Dialog open={isSearchSheetOpen} onClose={handleClose} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-white/90 duration-200 ease-out data-closed:opacity-0" />
        <div className="fixed inset-0 flex w-screen">
          <DialogPanel
            transition
            className="overflow-hidden relative w-screen h-screen mt-auto transition-all duration-250 transform-gpu ease-out rounded-none data-closed:transform-[var(--panel-transform)] data-closed:rounded-xl origin-top-left"
          >
            <SettingsSheet />
            <Transition show={isSearchSheetOpen} appear>
              <div className="block w-screen h-screen absolute top-0 bg-white opacity-0 pointer-events-none data-closed:opacity-100 transition-all duration-300" />
            </Transition>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  )
}
