import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent } from 'react'
import { cubicBezierAt, linearEasing, measureBox, morphStyle, type CubicBezier } from 'utils/morph'
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

// Card face (and the tint that stands in for it during the morph).
const ACCENT_BG = 'bg-[#F55875]'

// Timing for the morph. Derived from one another rather than restated, and fed
// to the elements as custom properties, because the relationships between them
// are load-bearing rather than stylistic — a class string that drifts out of
// step with these breaks the animation in ways that look like something else.

// Card → fullscreen. Everything else is expressed relative to this.
const PANEL_MS = 250
// --ease-ios-spring from app.css, restated as numbers because the accent tint
// below is computed from it. Not Tailwind's ease-out: that one covers 95% of
// the distance by 60% of the duration and crawls the rest, so the landing read
// as a stall.
const PANEL_EASE: CubicBezier = [0.36, 0.66, 0.04, 1]

// The accent tint's opacity as a function of the panel's SIZE, not of time:
// how close the panel is to card size, raised to TINT_POWER, in both
// directions. Measured against the clock instead (a delay plus ease-in on
// close, a short fade on open), the colour lagged the shape by ~100ms either
// way, because the panel is ~95% of the way there well before it ends: closing
// shrank as a white ghost and only turned pink once it had stopped moving.
//
// The power keeps the colour to the card end of the morph. At 2 the pink
// covered about half of a still-large panel, and colour plus shape changing
// across that much screen read as hyperactive next to the plain white Settings
// card; at 4 the large moving surface stays white and the pink gathers only as
// the panel closes in on the card. linear() because "a power of another curve"
// is not a cubic-bezier.
//
// Opening animates the tint 1 → 0, so its easing is 1 - (1 - p)^n; closing
// animates 0 → 1 against progress toward the card, so it is p^n.
const TINT_POWER = 4
const TINT_IN_EASE = linearEasing(x => 1 - (1 - cubicBezierAt(PANEL_EASE, x)) ** TINT_POWER)
const TINT_OUT_EASE = linearEasing(x => cubicBezierAt(PANEL_EASE, x) ** TINT_POWER)

// On close the landed panel crossfades into the card over this tail. Linear,
// and starting once the panel is ~97% landed with the tint ~94% in: on the
// panel's own front-loaded curve it was 80% gone before the tint had finished
// turning pink, and any later than this the iOS curve leaves a blank card
// sitting still for ~80ms before the face's slide-in shows through.
const LAND_FADE_MS = 100

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
  // this used to, assumes a geometry nobody guarantees: `mt-auto` pushes the
  // panel down by whatever space is left over, and the panel's own height is a
  // CSS unit that can be retuned (it was 100vh, which tracks the *large*
  // viewport and so diverged from innerHeight for as long as the URL bar was
  // showing; it is dvh now). Measuring stays correct across all of that.
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
          accent ? clsx(ACCENT_BG, 'text-white border-[#F55875]') : 'bg-white border-rose-50',
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
            matching and the face just snaps.

            The enter delays are the reveal on close: the panel lands as a blank
            card (~120ms on the iOS curve) and crossfades out from 150ms, so the
            text and icon slide in as it clears. Without the delay they finish
            hidden under the panel and the reveal never shows.

            Title and subtitle travel the same fixed distance (enough to clear
            the subtitle, the lower of the two) so they move as one block. As
            percentages of their own heights they travelled different distances
            and crossed each other mid-slide. */}
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
              className="z-[2] translate-y-0 data-closed:-translate-y-20 motion-reduce:data-closed:translate-y-0 ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              {title}
            </b>
          </TransitionChild>
          <TransitionChild>
            <span
              className="leading-tight z-[2] translate-y-0 data-closed:-translate-y-20 motion-reduce:data-closed:translate-y-0 ease-in-out transition-transform data-enter:delay-150 transform-gpu duration-200"
            >
              {subtitle}
            </span>
          </TransitionChild>
        </Transition>
      </button>
      <Dialog open={isOpen} onClose={handleClose} className="relative z-modal">
        <DialogBackdrop transition className="fixed inset-0 bg-white/90 duration-200 ease-out data-closed:opacity-0" />
        <div className="fixed inset-0 flex w-screen">
          <DialogPanel
            ref={setPanelRef}
            transition
            style={{
              '--panel-ms': `${PANEL_MS}ms`,
              '--panel-ease': `cubic-bezier(${PANEL_EASE.join(', ')})`,
              '--land-fade-ms': `${LAND_FADE_MS}ms`
            } as CSSProperties}
            onTransitionEnd={handlePanelTransitionEnd}
            className={clsx(
              // h-dvh, not h-screen: 100vh is the large viewport, so the bottom
              // of a `h-full` scroller inside this panel (search-content,
              // settings-sheet) sat under a bottom browser toolbar and could
              // not be scrolled into view. Safe for the morph because it
              // measures the panel's real box rather than assuming one — see
              // applyMorph above.
              'overflow-hidden relative w-screen h-dvh mt-auto transform-gpu ease-[var(--panel-ease)] rounded-none origin-top-left',
              // Named rather than transition-all: these three are the only
              // properties that ever animate here, and narrowing it keeps the
              // transitionend filter above unambiguous.
              'transition-[transform,border-radius,opacity] duration-[var(--panel-ms)]',
              reducedMotion
                ? 'data-closed:opacity-0'
                : clsx(
                    'data-closed:transform-[var(--panel-transform,none)] data-closed:rounded-[var(--panel-radius,var(--radius-xl))]',
                    // Closing only: crossfade the landed panel into the card (see
                    // LAND_FADE_MS). It lands as a face-less copy of the card, so
                    // without this the text and icon popped in the frame it
                    // unmounted. Each list follows the transition-property order
                    // above (transform, border-radius, opacity).
                    'data-leave:data-closed:opacity-0',
                    'data-leave:[transition-duration:var(--panel-ms),var(--panel-ms),var(--land-fade-ms)]',
                    'data-leave:[transition-delay:0ms,0ms,calc(var(--panel-ms)-var(--land-fade-ms))]',
                    'data-leave:[transition-timing-function:var(--panel-ease),var(--panel-ease),linear]'
                  )
            )}
          >
            {/* Its own stacking context, so nothing a sheet z-indexes can paint
                over the masks below. The search header is sticky with z-[2],
                and without this it sat squashed on top of the mask for the
                whole morph in both directions. */}
            <div className="relative isolate h-full">
              {children}
            </div>
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
                  'block w-screen h-dvh absolute top-0 opacity-0 pointer-events-none data-closed:opacity-100 transition-opacity duration-[var(--mask-ms)] data-enter:delay-50 data-enter:duration-100 data-leave:ease-[cubic-bezier(0,0.95,0.2,1)] bg-white'
                )}
              />
            </Transition>
            {/* The accent colour rides its own layer over the white mask, with
                its opacity tied to the panel's size (TINT_IN/OUT_EASE, same
                duration as the panel). Folded into the mask it could only be
                pink everywhere or nowhere: a pink mask was a wash across most of
                the screen, a white one turned the card white on frame 0. Not
                under reduced motion: the panel is fullscreen from frame 0
                there, so the tint would just wash the whole screen pink. */}
            {accent && !reducedMotion && (
              <Transition show={isOpen} appear>
                <div
                  style={{ '--tint-in': TINT_IN_EASE, '--tint-out': TINT_OUT_EASE } as CSSProperties}
                  className={clsx(
                    'block w-screen h-dvh absolute top-0 opacity-0 pointer-events-none data-closed:opacity-100 transition-opacity duration-[var(--panel-ms)] data-enter:ease-[var(--tint-in)] data-leave:ease-[var(--tint-out)]',
                    ACCENT_BG
                  )}
                />
              </Transition>
            )}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
