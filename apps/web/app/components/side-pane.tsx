import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '~/hooks/reduced-motion'
import type { BottomSheetProps } from './bottom-sheet'
import { useDeckSlot } from './pane-stack/context'
import { deckGeometry, deckZ } from './pane-stack/model'

// Horizontal band the pane takes out of the viewport: left margin + card width
// + an equal gap on its right. Exported so the map's fly-to can center a
// selection in the area left visible beside the pane, the way PEEK_FRACTION
// does for the sheet.
export const SIDE_PANE_OCCUPIED_PX = 432
// Slide duration, ms. Longer than a sheet snap because the travel is longer.
const DURATION = 250

type Phase = 'entering' | 'open' | 'exiting'

// Desktop counterpart to BottomSheet: the same detail content as a floating
// card down the left edge, with the map fully visible and interactive around
// it. Deliberately static — no drag, no snap points, no backdrop; the body
// scrolls natively. Shares BottomSheet's props contract so the two are
// interchangeable behind DetailSurface.
// `initialSnap` is deliberately not destructured: this pane has exactly one
// open state, and the props contract is shared with BottomSheet, so accepting
// and ignoring the prop is the whole implementation.
export default function SidePane({ open, onClose, onDismissStart, ariaLabel, header, children }: BottomSheetProps) {
  // Where this card sits in the deck. Defaults to the top of a stack of one, so
  // a pane rendered without a PaneStackProvider behaves exactly as it did before
  // the deck existed.
  const slot = useDeckSlot()
  const [phase, setPhase] = useState<Phase>('entering')
  // Drives the transition. Separate from `phase` because the entrance needs one
  // painted frame in the closed position before flipping to the open one.
  const [visible, setVisible] = useState(false)
  const duration = useReducedMotion() ? 0 : DURATION

  // Every card enters and leaves past the left edge, pushed ones included. The
  // surface is anchored there, so that is both the shorter travel and the same
  // motion the base card appears with — a pushed card reads as another one of
  // these arriving, rather than as a different kind of thing sliding in from the
  // far side of the map.
  const enterFrom = 'translateX(calc(-100% - 2rem))'

  // Ref-mirror the callbacks so `close` can stay a single stable identity:
  // station-sheet captures it in a ref for the departure action, and
  // StationContent is memoized against the prop chain it feeds.
  const onCloseRef = useRef(onClose)
  const onDismissStartRef = useRef(onDismissStart)
  const durationRef = useRef(duration)
  useEffect(() => {
    onCloseRef.current = onClose
    onDismissStartRef.current = onDismissStart
    durationRef.current = duration
  })

  // A close is in flight — guards against firing the dismiss callbacks twice
  // when the parent also flips `open` off mid-exit.
  const closingRef = useRef(false)
  // Whether the pane has been opened at least once. Without it the initial
  // mount (parent renders with open=false until a selection exists) would
  // immediately report a close, same guard BottomSheet's wasOpenRef provides.
  const hasOpenedRef = useRef(false)

  // Entrance: render closed, let it paint, then transition open.
  useEffect(() => {
    if (!open) return
    closingRef.current = false
    hasOpenedRef.current = true
    setPhase('entering')
    setVisible(false)
    // Two frames, not one: effects run before paint, so a single rAF would
    // apply the open styles in the same frame that first painted the closed
    // ones and the browser would see no change to transition.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setVisible(true))
    })
    const timer = setTimeout(() => setPhase('open'), duration)
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      clearTimeout(timer)
    }
  }, [open, duration])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setPhase('exiting')
    setVisible(false)
    // Before the animation, not after: the map hangs its spotlight exit off
    // this so the scrim lifts alongside the pane rather than once it lands.
    onDismissStartRef.current?.()
    // Deliberately not cleared on unmount. The parent's close setter is
    // idempotent, and clearing would swallow the close outright if the
    // viewport crosses the breakpoint mid-exit and swaps this pane out.
    setTimeout(() => {
      hasOpenedRef.current = false
      onCloseRef.current()
    }, durationRef.current)
  }, [])

  // Parent-driven close. The map switches between hub and station details by
  // setting the other selection, which flips `open` off without any gesture —
  // report it like BottomSheet does so the `if (!selectedHubSlug)` spotlight
  // guards on the other side still see a matching dismiss.
  useEffect(() => {
    if (open || !hasOpenedRef.current) return
    hasOpenedRef.current = false
    if (closingRef.current) return
    onDismissStartRef.current?.()
    onCloseRef.current()
  }, [open])

  // Hand the animated close to the deck, so it can dismiss several cards as one
  // motion. The provider must never drive an exit by flipping `open` off: that
  // path unmounts the card outright (see the early return below), which is the
  // same trap station-sheet.tsx's animatedCloseRef exists to avoid.
  const registerClose = slot.registerClose
  useEffect(() => {
    if (!registerClose || !open) return
    registerClose(close)
    // Station and hub surfaces share the base slot and are mutually exclusive,
    // but both stay mounted — clearing on close stops a dismissed one from
    // answering for whichever is actually on screen.
    return () => registerClose(null)
  }, [registerClose, close, open])

  // Escape belongs to whichever card is on top. Every mounted pane registers a
  // window listener, so without the `above` bail one press would run three
  // handlers at depth 2 and collapse the whole deck at once. On a pushed card it
  // pops one level, matching the back button and the browser's own Back.
  const onBack = slot.onBack
  useEffect(() => {
    if (!open || slot.above > 0) return
    const dismiss = slot.role === 'pushed' ? onBack : close
    if (!dismiss) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, onBack, slot.above, slot.role])

  if (!open) return null

  const { x, scale } = deckGeometry(slot.above)

  return (
    <div
      className="fixed left-4 top-4 bottom-4 z-detail-surface w-[25rem] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      // Covered by another card: out of the tab order and out of the
      // accessibility tree, so exactly one dialog is reachable at any depth.
      inert={slot.above > 0}
      style={{
        // Paint order comes from the deck depth rather than from DOM order —
        // see deckZ. This overrides the z-detail-surface class above, which is
        // kept because it is what makes the card's layer legible at a glance;
        // the two cannot disagree, since both resolve the same token.
        zIndex: `calc(var(--z-index-detail-surface) + ${deckZ(slot.above)})`,
        // Inline rather than Tailwind translate utilities: v4 emits those as
        // the `translate` property, which would need a different transition
        // property name than the `transform` this reads as. Same reason the
        // deck's scale is composed into this string rather than applied as a
        // `scale-*` utility.
        transform: visible ? `translateX(${x}px) scale(${scale})` : enterFrom,
        // Anchor the left edge, so scaling a covered card shows up as a shorter
        // card rather than eating the sliver the deck offset just exposed.
        transformOrigin: 'left center',
        // The base card fades as it travels, because it arrives over the map and
        // the fade softens it appearing out of nothing. A pushed card arrives
        // over another card, where the same fade reads as a double exposure —
        // both sets of content legible through each other for the whole slide.
        // It stays opaque and lets the movement alone carry the entrance.
        opacity: slot.role === 'pushed' || visible ? 1 : 0,
        transition: duration > 0
          ? `transform ${duration}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${duration}ms ease-out`
          : undefined,
        willChange: 'transform'
      }}
      role="dialog"
      aria-label={ariaLabel}
    >
      <div className="shrink-0 px-6 py-4 border-b border-slate-100">
        {header(close)}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Content stays mounted through the exit so the pane doesn't empty
            out as it slides away. */}
        {children(phase !== 'entering')}
      </div>
    </div>
  )
}
