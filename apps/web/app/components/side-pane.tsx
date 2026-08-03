import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '~/hooks/reduced-motion'
import type { BottomSheetProps } from './bottom-sheet'

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
export default function SidePane({ open, onClose, onDismissStart, ariaLabel, header, children }: BottomSheetProps) {
  const [phase, setPhase] = useState<Phase>('entering')
  // Drives the transition. Separate from `phase` because the entrance needs one
  // painted frame in the closed position before flipping to the open one.
  const [visible, setVisible] = useState(false)
  const duration = useReducedMotion() ? 0 : DURATION

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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div
      className="fixed left-4 top-4 bottom-4 z-30 w-[25rem] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      style={{
        // Inline rather than Tailwind translate utilities: v4 emits those as
        // the `translate` property, which would need a different transition
        // property name than the `transform` this reads as.
        transform: visible ? 'translateX(0)' : 'translateX(calc(-100% - 2rem))',
        opacity: visible ? 1 : 0,
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
