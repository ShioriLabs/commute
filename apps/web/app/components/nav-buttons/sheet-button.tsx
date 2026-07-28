import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent } from 'react'

interface Props {
  // URL swapped in with pushState while the sheet is open ('/search', '/fare', …)
  url: string
  ariaLabel: string
  // Button face: bold first line, rest of the label, and the icon in the
  // bottom-right circle (pass sizing classes on the icon, e.g. "w-12 h-12").
  title: string
  subtitle: ReactNode
  icon: ReactNode
  className?: string
  // Fills the card face with the app accent instead of white. The rail holds
  // more cards than fit on a phone, so the one action most people came for has
  // to be visibly the primary one rather than the first of several identical
  // white cards.
  accent?: boolean
  // Sheet content, rendered inside the fullscreen DialogPanel. Use headlessui
  // CloseButton/DialogTitle inside it; closing goes through this Dialog.
  children: ReactNode
}

// Nav rail card that morphs into a fullscreen sheet: the DialogPanel's closed
// state is transformed to the button's rect (via a panel-scoped
// --panel-transform), so opening animates the card expanding to fill the
// screen. The real URL is swapped with pushState so the back button (and the
// sheet's CloseButton) restores the previous page without a navigation.
// Last-resort upper bound on how long we wait for the panel's leave transition
// before popping history anyway. The transform's transitionend is the real
// signal; this only covers the case where it never arrives at all. It has to be
// far larger than the 250ms transform, because the leave does not begin until
// React has committed the closed state — on a slow device that alone can take
// ~500ms, and a fallback that lands mid-shrink causes the very stutter the
// transitionend handler exists to avoid. Firing late is harmless (the URL just
// restores a little later); firing early is not.
const LEAVE_FALLBACK_MS = 2500

export default function SheetButton({ url, ariaLabel, title, subtitle, icon, className, accent = false, children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [originalUrl, setOriginalUrl] = useState('')
  const [panelTransform, setPanelTransform] = useState('')
  const [panelRadius, setPanelRadius] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Deferred history.back() scheduled by handleClose (see below).
  const pendingBackRef = useRef<number | null>(null)

  const handleOpen = () => {
    if (pendingBackRef.current !== null) {
      // Reopened while the previous close's deferred back() is still pending:
      // history is still on the sheet's entry, so reuse it instead of pushing
      // a duplicate.
      clearTimeout(pendingBackRef.current)
      pendingBackRef.current = null
    } else {
      // Store the current URL before changing it
      setOriginalUrl(window.location.pathname + window.location.search)

      // Use pushState to create a history entry for the back button
      window.history.pushState(
        { modalOpen: true, originalUrl: window.location.pathname + window.location.search },
        '',
        url
      )
    }

    setIsOpen(true)

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
      setPanelTransform(`translate(${dx}px, ${dy}px) scale(${dw}, ${dh})`)
      // The closed radius is painted through that scale, so the card's own 12px
      // corner comes out as 12*dw wide by 12*dh tall — about 5px by 2px, i.e.
      // visibly sharp against the real card it is morphing into. Divide it back
      // out so both axes land on the card's radius once scaled. Two-value
      // syntax is horizontal / vertical radii. Read rather than hardcoded, so
      // it tracks the button's rounding (including a caller's className).
      const cardRadius = parseFloat(getComputedStyle(buttonRef.current).borderTopLeftRadius) || 0
      setPanelRadius(`${cardRadius / dw}px / ${cardRadius / dh}px`)
    }
  }

  const runPendingBack = () => {
    if (pendingBackRef.current === null) return
    clearTimeout(pendingBackRef.current)
    pendingBackRef.current = null
    window.history.back()
  }

  // The POP re-renders the route underneath, so it has to land after the shrink
  // has finished painting — on a slow device the leave starts late enough that a
  // fixed timer fires mid-animation and visibly stutters the tail of it. Only
  // the panel's own transform counts: transition-all also ends on border-radius,
  // and the card-face overlay's opacity bubbles up from a child.
  const handlePanelTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return
    runPendingBack()
  }

  const handleClose = () => {
    setIsOpen(false)

    // history.back() in the same tick makes react-router process its POP
    // navigation while headlessui is starting the leave transition, which
    // stomps it (the dialog unmounts instantly instead of morphing back).
    // Close first, pop the history entry once the animation is done.
    if (window.history.state?.modalOpen) {
      pendingBackRef.current = window.setTimeout(runPendingBack, LEAVE_FALLBACK_MS)
    } else {
      // Fallback if state is lost
      window.history.replaceState(
        { ...window.history.state, modalOpen: false },
        '',
        originalUrl
      )
    }
  }

  // Handle browser navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (pendingBackRef.current !== null) {
        // The user pressed back before our deferred back() fired — this pop
        // already consumed the sheet's entry, so firing ours too would pop
        // one entry too far.
        clearTimeout(pendingBackRef.current)
        pendingBackRef.current = null
      }

      // If we're popping back from the sheet state
      if (event.state?.modalOpen && isOpen) {
        // This is moving forward to the sheet, ignore
        return
      }

      // If the sheet is open and we're going back, close it — deferred so
      // react-router's POP re-render (same popstate tick) commits before the
      // leave transition starts, instead of stomping it.
      if (isOpen) {
        setTimeout(() => setIsOpen(false), 0)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isOpen])

  // Don't fire a stale deferred back() after unmount (e.g. a real navigation
  // away while the close animation is still running).
  useEffect(() => () => {
    if (pendingBackRef.current !== null) clearTimeout(pendingBackRef.current)
  }, [])

  return (
    <>
      <button
        type="button"
        className={clsx(
          'p-4 rounded-xl shadow-2xs w-screen h-screen max-w-42 max-h-32 border-2 flex flex-col relative overflow-clip select-none text-left cursor-pointer scale-100 lg:hover:scale-105 transition-transform transform-gpu ease-in-out shrink-0',
          accent ? 'bg-[#F55875] text-white border-[#F55875]' : 'bg-white border-rose-50',
          className
        )}
        aria-label={ariaLabel}
        onClick={handleOpen}
        ref={buttonRef}
      >
        <Transition show={!isOpen}>
          <TransitionChild>
            <div className={clsx(
              'absolute -bottom-5 -right-5 rounded-full p-4 z-[1] ease-in-out translate-y-0 data-closed:translate-y-full transition-transform data-enter:delay-200 transform-gpu duration-200',
              accent ? 'bg-white/20' : 'bg-slate-100'
            )}
            >
              <TransitionChild>
                <div className="translate-y-0 data-closed:translate-y-4 ease-in-out data-enter:delay-200 transform-gpu">
                  {icon}
                </div>
              </TransitionChild>
            </div>
          </TransitionChild>
          <TransitionChild>
            <b
              className="z-[2] translate-y-0 data-closed:-translate-y-[200%] ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              {title}
            </b>
          </TransitionChild>
          <TransitionChild>
            <span
              className="leading-tight z-[2] translate-y-0 data-closed:-translate-y-[250%] ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              {subtitle}
            </span>
          </TransitionChild>
        </Transition>
      </button>
      <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-white/90 duration-200 ease-out data-closed:opacity-0" />
        <div className="fixed inset-0 flex w-screen">
          <DialogPanel
            transition
            style={{ '--panel-transform': panelTransform, '--panel-radius': panelRadius } as CSSProperties}
            onTransitionEnd={handlePanelTransitionEnd}
            className="overflow-hidden relative w-screen h-screen mt-auto transition-all duration-250 transform-gpu ease-out rounded-none data-closed:transform-[var(--panel-transform)] data-closed:rounded-[var(--panel-radius,var(--radius-xl))] origin-top-left"
          >
            {children}
            <Transition show={isOpen} appear>
              <div className={clsx(
                // Both directions resolve their colour early and let the morph
                // carry the rest; the 300ms base only exists so the element
                // outlives the panel's 250ms shrink (drop below that and
                // headlessui unmounts the mask mid-shrink, re-revealing the
                // sheet). Opening holds the card face flat over the first
                // ~75ms, which is the window where the panel is still scaled
                // enough to visibly distort its content, then clears in 150ms
                // instead of trailing a tint over an already full-size sheet.
                // Closing front-loads the curve so the face is opaque within
                // ~60ms of the shrink starting.
                'block w-screen h-screen absolute top-0 opacity-0 pointer-events-none data-closed:opacity-100 transition-all duration-300 data-enter:delay-50 data-enter:duration-100 data-leave:ease-[cubic-bezier(0,0.95,0.2,1)]',
                accent ? 'bg-[#F55875]' : 'bg-white'
              )}
              />
            </Transition>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
