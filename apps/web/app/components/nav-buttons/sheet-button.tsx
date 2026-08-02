import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent } from 'react'
import { measureBox, morphStyle } from 'utils/morph'
import { useReducedMotion } from '~/hooks/reduced-motion'

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
// --panel-transform, see the layout effect below), so opening animates the card
// expanding to fill the screen. The real URL is swapped with pushState so the
// back button (and the sheet's CloseButton) restores the previous page without a
// navigation.

// Timing for the morph. Derived from one another rather than restated, and fed
// to the elements as custom properties, because the relationships between them
// are load-bearing rather than stylistic — a class string that drifts out of
// step with these breaks the animation in ways that look like something else.

// Card → fullscreen. Everything else is expressed relative to this.
const PANEL_MS = 250

// The card-face mask has to outlive the panel's shrink. Drop it to or below
// PANEL_MS and headlessui unmounts the mask while the panel is still shrinking,
// which re-reveals the sheet mid-morph. Front-load the *curve* on leave (see the
// mask's class) rather than shortening this.
const MASK_MS = PANEL_MS + 50

// Last-resort upper bound on how long we wait before popping history anyway. The
// two signals in runPendingBack are the real ones; this only covers the case
// where neither arrives at all. It has to be far larger than PANEL_MS, because
// the leave does not begin until React has committed the closed state — on a
// slow device that alone can take ~500ms, and a fallback that lands mid-shrink
// causes the very stutter the other signals exist to avoid. Firing late is
// harmless (the URL just restores a little later); firing early is not. Any
// instinct to reduce this needs a 4x-CPU measurement first.
const LEAVE_FALLBACK_MS = 2500

// Tags each history entry with the instance that pushed it. The rail holds more
// than one sheet and each has its own deferred back(), so "is the current entry
// mine?" has to be answerable — see runPendingBack.
let sheetEntrySeq = 0

export default function SheetButton({ url, ariaLabel, title, subtitle, icon, className, accent = false, children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const reducedMotion = useReducedMotion()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Mirrors isOpen for the handlers that cannot wait for a render. React batches
  // state updates, so two taps landing in the same frame would both read
  // isOpen === false.
  const isOpenRef = useRef(false)
  // Deferred history.back() scheduled by handleClose, and the id of the entry it
  // is allowed to pop.
  const pendingBackRef = useRef<number | null>(null)
  const entryIdRef = useRef<number | null>(null)
  // popstate's deferred close, kept so unmount can cancel it.
  const pendingCloseRef = useRef<number | null>(null)
  const originalUrlRef = useRef('')

  const runPendingBack = useCallback(() => {
    if (pendingBackRef.current === null) return
    clearTimeout(pendingBackRef.current)
    pendingBackRef.current = null

    // Only pop the entry this instance actually pushed. Close Search and
    // immediately tap Settings and the current entry is Settings', not ours —
    // popping would close the sheet the user just opened. Content inside the
    // sheet can push entries too (the fare share link), and a react-router
    // `replace` from a result row drops our state entirely; in every one of
    // those cases there is nothing of ours on top to pop, and leaving the entry
    // behind is far cheaper than taking someone else's.
    //
    // Note it deliberately leaves entryIdRef *set* when the entry is not ours:
    // that id is the only way the popstate handler can later recognise the entry
    // we abandoned here and clear it once it surfaces again.
    if (window.history.state?.sheetEntryId !== entryIdRef.current) return

    entryIdRef.current = null
    window.history.back()
  }, [])

  // The POP re-renders the route underneath, so it has to land after the shrink
  // has finished painting — on a slow device the leave starts late enough that a
  // fixed timer fires mid-animation and visibly stutters the tail of it.
  //
  // Only the panel's own box counts: the card-face mask's opacity bubbles up
  // from a child, so a stray child transition would otherwise pop history early.
  // Opacity is listed alongside transform because under reduced motion that is
  // the property the panel actually animates.
  const handlePanelTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.propertyName !== 'transform' && event.propertyName !== 'opacity') return
    runPendingBack()
  }

  // The panel's closed state maps its own box onto the card's.
  //
  // Measuring the panel itself is the whole point. Deriving its box from
  // window.innerWidth/innerHeight and assuming an origin of (0, 0) instead, as
  // this used to, is wrong twice over: the panel is sized in vh, which tracks
  // the *large* viewport, while innerHeight tracks the current visual one, so
  // the two diverge for as long as the URL bar is showing; and `mt-auto` then
  // pushes the panel down by whatever is left over.
  //
  // Written straight to the element rather than through state: the custom
  // properties have to be in place before the closed state's first paint, and
  // re-measuring on resize should not cost a render.
  const applyMorph = useCallback(() => {
    const button = buttonRef.current
    const panel = panelRef.current
    if (!button || !panel) return

    // Read rather than hardcoded, so the morph tracks the button's rounding
    // (including a caller's className).
    const cardRadius = parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0
    const morph = morphStyle(measureBox(button), measureBox(panel), cardRadius)

    // No usable geometry. Setting `none` explicitly leaves the panel to appear
    // under the card-face mask — a plain fade, worse than the morph but intact.
    panel.style.setProperty('--panel-transform', morph?.transform ?? 'none')
    panel.style.setProperty('--panel-radius', morph?.radius ?? '0px')
  }, [])

  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node

    // Measured here rather than from an effect keyed on isOpen, because the
    // dialog portals its panel in a later commit than the one that opened it —
    // an effect keyed on isOpen runs while this ref is still null and would
    // never fire again. A ref callback runs during commit, so the custom
    // properties are still in place before the closed state is painted.
    if (node !== null) {
      applyMorph()
      return
    }

    // The panel leaving the DOM is the one signal that always arrives.
    // transitionend above is faster and more precise, but it is a promise the
    // browser only keeps when a transition actually ran — a degenerate
    // transform, a forced `transition: none`, or headlessui deciding there is
    // nothing to wait for all produce a close with no transitionend at all, and
    // the URL would then sit stale until LEAVE_FALLBACK_MS. Both funnel into
    // runPendingBack, which is idempotent, so whichever comes first wins.
    //
    // Safe to fire on a real unmount too (a navigation away mid-animation): the
    // entry-ownership check in runPendingBack sees that the current history
    // entry is no longer ours and declines to pop.
    runPendingBack()
  }, [applyMorph, runPendingBack])

  const handleOpen = () => {
    // React batches, so a double-tap inside one frame would reach here twice
    // with isOpen still false and push two history entries — after which one
    // back() lands on a duplicate sheet URL instead of the page behind it. The
    // ref is written synchronously, so the second tap sees it.
    if (isOpenRef.current) return
    isOpenRef.current = true

    if (pendingBackRef.current !== null) {
      // Reopened while the previous close's deferred back() is still pending:
      // history is still on the sheet's entry, so reuse it instead of pushing
      // a duplicate.
      clearTimeout(pendingBackRef.current)
      pendingBackRef.current = null
    } else {
      originalUrlRef.current = window.location.pathname + window.location.search
      entryIdRef.current = ++sheetEntrySeq

      // pushState rather than a navigation, so the back button restores the
      // previous page without react-router re-rendering the route underneath
      // the animation.
      window.history.pushState(
        { modalOpen: true, sheetEntryId: entryIdRef.current, originalUrl: originalUrlRef.current },
        '',
        url
      )
    }

    setIsOpen(true)
  }

  const handleClose = () => {
    isOpenRef.current = false
    setIsOpen(false)

    // history.back() in the same tick makes react-router process its POP
    // navigation while headlessui is starting the leave transition, which
    // stomps it (the dialog unmounts instantly instead of morphing back).
    // Close first, pop the history entry once the animation is done.
    if (window.history.state?.modalOpen) {
      pendingBackRef.current = window.setTimeout(runPendingBack, LEAVE_FALLBACK_MS)
      return
    }

    // Our entry was rewritten out from under us — a react-router `replace` from
    // inside the sheet drops the state we put there. Nothing of ours is left to
    // pop, so just put the URL back.
    entryIdRef.current = null
    window.history.replaceState(
      { ...window.history.state, modalOpen: false },
      '',
      originalUrlRef.current
    )
  }

  // Rotation, a resize, or the soft keyboard (the search sheet focuses its input
  // 250ms in) all move the boxes the morph was derived from, and a stale
  // transform means the shrink lands somewhere the card no longer is. Bound to
  // the open state only: recomputing during the leave would jump the target
  // mid-shrink.
  useEffect(() => {
    if (!isOpen) return

    window.addEventListener('resize', applyMorph)
    window.addEventListener('orientationchange', applyMorph)
    return () => {
      window.removeEventListener('resize', applyMorph)
      window.removeEventListener('orientationchange', applyMorph)
    }
  }, [isOpen, applyMorph])

  // Handle browser navigation. Subscribed once and reading refs, rather than
  // re-subscribing on every open/close.
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (pendingBackRef.current !== null) {
        // The user pressed back before our deferred back() fired — this pop
        // already consumed the sheet's entry, so firing ours too would pop
        // one entry too far.
        clearTimeout(pendingBackRef.current)
        pendingBackRef.current = null
        entryIdRef.current = null
      }

      const onOurEntry = entryIdRef.current !== null
        && event.state?.sheetEntryId === entryIdRef.current

      if (isOpenRef.current) {
        // Moving forward onto our own still-open sheet: nothing to do.
        if (onOurEntry) return

        // Going back out of the open sheet — deferred so react-router's POP
        // re-render (same popstate tick) commits before the leave transition
        // starts, instead of stomping it.
        entryIdRef.current = null
        isOpenRef.current = false
        pendingCloseRef.current = window.setTimeout(() => setIsOpen(false), 0)
        return
      }

      // Closed, but we have landed back on an entry we pushed and then had to
      // abandon (another sheet had opened on top of it, so runPendingBack could
      // not pop it without taking that sheet's entry instead). Clear it now that
      // it is current again, so escaping a sheet that is not there does not cost
      // the user a second press of back.
      if (onOurEntry) {
        entryIdRef.current = null
        window.history.back()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Don't fire stale deferred work after unmount (e.g. a real navigation away
  // while the close animation is still running). Clearing only, never firing:
  // a back() on unmount would be wrong precisely when the component went away
  // because we navigated somewhere else.
  useEffect(() => () => {
    if (pendingBackRef.current !== null) clearTimeout(pendingBackRef.current)
    if (pendingCloseRef.current !== null) clearTimeout(pendingCloseRef.current)
    pendingBackRef.current = null
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
        {/* Each TransitionChild below wraps exactly one element on purpose:
            headlessui merges its classes and data-* onto the child only in that
            case, and renders a wrapper div instead as soon as there are two —
            at which point every data-closed: variant here silently stops
            matching and the face just snaps. */}
        <Transition show={!isOpen}>
          <TransitionChild>
            <div className={clsx(
              'absolute -bottom-5 -right-5 rounded-full p-4 z-[1] ease-in-out translate-y-0 data-closed:translate-y-full motion-reduce:data-closed:translate-y-0 transition-transform data-enter:delay-200 transform-gpu duration-200',
              accent ? 'bg-white/20' : 'bg-slate-100'
            )}
            >
              <TransitionChild>
                <div className="translate-y-0 data-closed:translate-y-4 motion-reduce:data-closed:translate-y-0 ease-in-out transition-transform data-enter:delay-200 transform-gpu duration-200">
                  {icon}
                </div>
              </TransitionChild>
            </div>
          </TransitionChild>
          <TransitionChild>
            <b
              className="z-[2] translate-y-0 data-closed:-translate-y-[200%] motion-reduce:data-closed:translate-y-0 ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              {title}
            </b>
          </TransitionChild>
          <TransitionChild>
            <span
              className="leading-tight z-[2] translate-y-0 data-closed:-translate-y-[250%] motion-reduce:data-closed:translate-y-0 ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
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
            ref={setPanelRef}
            transition
            style={{ '--panel-ms': `${PANEL_MS}ms` } as CSSProperties}
            onTransitionEnd={handlePanelTransitionEnd}
            className={clsx(
              'overflow-hidden relative w-screen h-screen mt-auto transform-gpu ease-out rounded-none origin-top-left',
              // Named rather than transition-all: these three are the only
              // properties that ever animate here, and narrowing it keeps the
              // transitionend filter above unambiguous.
              'transition-[transform,border-radius,opacity] duration-[var(--panel-ms)]',
              reducedMotion
                ? 'data-closed:opacity-0'
                : 'data-closed:transform-[var(--panel-transform,none)] data-closed:rounded-[var(--panel-radius,var(--radius-xl))]'
            )}
          >
            {children}
            <Transition show={isOpen} appear>
              <div
                style={{ '--mask-ms': `${MASK_MS}ms` } as CSSProperties}
                className={clsx(
                  // Both directions resolve their colour early and let the morph
                  // carry the rest. Opening holds the card face flat over the
                  // first ~75ms, which is the window where the panel is still
                  // scaled enough to visibly distort its content, then clears in
                  // 150ms instead of trailing a tint over an already full-size
                  // sheet. Closing front-loads the curve so the face is opaque
                  // within ~60ms of the shrink starting — without which the
                  // panel sits at scale 0.61/0.42 behind a mask only 31% opaque
                  // and you watch the text distort.
                  // transition-opacity, NOT transition-all: the mask's colour must
                  // SNAP between states rather than interpolate. That is what lets
                  // the accent face be pink on the way out and white on the way in
                  // (see below) — with transition-all the colour would crossfade
                  // instead, which is the pink wash all over again.
                  'block w-screen h-screen absolute top-0 opacity-0 pointer-events-none data-closed:opacity-100 transition-opacity duration-[var(--mask-ms)] data-enter:delay-50 data-enter:duration-100 data-leave:ease-[cubic-bezier(0,0.95,0.2,1)]',
                  // The mask covers the panel for the whole morph, so it is
                  // exactly as large as the panel — up to the full viewport. That
                  // is fine while it is white (a white mask over a white sheet is
                  // invisible) and is why the non-accent cards never flashed. In
                  // accent pink it was a flash across two thirds of the screen:
                  // the panel is ~42% of fullscreen by 30ms and ~79% by 80ms, so
                  // there is no fade fast enough to keep a pink mask small. The
                  // colour has to go, not the timing.
                  //
                  // Direction is what makes it safe to drop. Opening, the pink is
                  // decorative — the card face is already behind the backdrop and
                  // the sheet it becomes is white, so entering white loses nothing
                  // and the mask still hides the scaled content underneath.
                  // Closing, the pink IS the destination: the sheet has to read as
                  // collapsing back into a pink card, so data-closed keeps it.
                  accent ? 'bg-white data-closed:bg-[#F55875]' : 'bg-white'
                )}
              />
            </Transition>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
