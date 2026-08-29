import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from 'utils/haptics'

// Sheet height as a fraction of viewport height. Peek is tall enough that
// the content head + a few rows are visible without dragging. Exported so the
// map's fly-to can center a selection in the area left visible above the sheet.
export const PEEK_FRACTION = 0.3
const FULL_FRACTION = 0.9
// Below this fraction at gesture-end, dismiss.
const DISMISS_FRACTION = 0.18
// Pointer-velocity (CSS px/ms) threshold for snap-on-flick.
const FLICK_THRESHOLD = 0.5
// Body-scroll fling: native momentum is unavailable here (we drive scrollTop
// manually under touch-action:none), so we replay the release velocity with
// exponential decay. TAU = glide length (ms); MIN = velocity floor (px/ms).
const SCROLL_MOMENTUM_TAU = 325
const SCROLL_MIN_VELOCITY = 0.02

type SnapState = 'closed' | 'peek' | 'full'

// Exported because SidePane implements the same contract and DetailSurface
// picks between the two by viewport width.
export interface BottomSheetProps {
  // Parent-controlled open state. The sheet opens to peek when this flips true
  // and animates closed (then calls onClose) when it flips false or the user
  // dismisses it.
  open: boolean
  onClose: () => void
  // Fires the moment a close *begins* (dismiss flick, close button, backdrop
  // tap, or parent flipping `open` off) — before the close animation runs.
  // Use for effects that should exit alongside the sheet rather than after it
  // settles (onClose). May fire without a subsequent user action reversing it;
  // it is never followed by a re-open without `open` cycling.
  onDismissStart?: () => void
  ariaLabel: string
  // Snap the sheet lands on when `open` flips true. Defaults to 'peek', which
  // is what every caller wanted until the map's fare sheet: a cold open with
  // empty fields has nothing to peek at. Read on the open transition only —
  // changing it while open does not re-snap, and a drag always wins after.
  // SidePane accepts and ignores it; it has no snap states.
  initialSnap?: 'peek' | 'full'
  // Drag handle / header. Rendered inside the grabbable handle region. Receives
  // a `close` callback to animate the sheet shut (e.g. a header close button).
  // Interactive controls (here and in the body) stay tappable because pointer
  // capture is deferred until a drag commits — a plain tap never captures, so
  // its click lands on the control as usual.
  header: (close: () => void) => ReactNode
  // Body content, mounted only once the open animation lands (`ready`) so the
  // first render of heavy subtrees doesn't drop frames during the slide.
  children: (ready: boolean) => ReactNode
}

export default function BottomSheet({ open, onClose, onDismissStart, ariaLabel, initialSnap, header, children }: BottomSheetProps) {
  // Snap state controlled by parent open/close; persists open height across renders.
  const [snap, setSnap] = useState<SnapState>('closed')
  const [viewportH, setViewportH] = useState(0)
  // Defer mounting the heavy body until the open animation finishes. Otherwise
  // the first render of dozens of nodes happens during the 0→peek slide and
  // drops frames.
  const [contentReady, setContentReady] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{
    y: number
    sheetTopAtStart: number
    time: number
  } | null>(null)
  // Velocity samples (clientY, timestamp) over the last ~100ms for flick detection.
  const velocityRef = useRef<Array<{ t: number, y: number }>>([])
  // Current sheet height in CSS px. The ref is the *only* source of truth —
  // drag handlers and the rAF lerp write it imperatively without going
  // through React state. There deliberately is no state mirror: every prior
  // attempt to keep a state copy in sync produced a stale-value flash on
  // release (the parent map route re-renders constantly, and any render
  // mid-drag would paint with the state value while the ref had moved on).
  const heightRef = useRef(0)

  // Ref-mirrored so the open effect below can keep `[open]` as its sole
  // dependency. With initialSnap in the deps directly, a parent re-render that
  // changed it would yank a sheet the user had already dragged somewhere else.
  const initialSnapRef = useRef(initialSnap)
  useEffect(() => {
    initialSnapRef.current = initialSnap
  })

  // Open the sheet to its initial snap whenever it becomes open; close
  // otherwise. Keyed on the open edge, so each re-open re-reads the snap the
  // caller wants for *that* opening.
  useEffect(() => {
    if (open) {
      setContentReady(false)
      setSnap(initialSnapRef.current ?? 'peek')
    } else {
      setSnap('closed')
    }
  }, [open])

  useLayoutEffect(() => {
    const update = () => setViewportH(window.innerHeight)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Compute target height in px for the active snap.
  const peekPx = Math.round(viewportH * PEEK_FRACTION)
  const fullPx = Math.round(viewportH * FULL_FRACTION)
  const targetPx = snap === 'full' ? fullPx : snap === 'peek' ? peekPx : 0

  // Imperative DOM write: position the sheet and dim the backdrop. Used by
  // both the rAF lerp and the drag move handler so we never round-trip
  // through React state during animation (which would re-render the heavy
  // body subtree on every frame).
  const applyHeight = (h: number) => {
    heightRef.current = h
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${fullPx - h}px)`
    }
    if (backdropRef.current) {
      const progress = Math.max(0, Math.min(1, (h - peekPx) / Math.max(1, fullPx - peekPx)))
      backdropRef.current.style.opacity = String(progress * 0.35)
    }
  }

  // Re-apply the imperative transform/opacity before paint on every render.
  // The rAF loop writes these directly to the DOM during animation/drag while
  // React state stays stale on purpose (re-rendering on each frame would
  // thrash the heavy body subtree). Without this, the render that setSnap
  // triggers on pointer-up would paint with the *pre-drag* state-derived
  // inline styles for one frame before the next rAF tick corrects them —
  // visible as a flash/jitter on release.
  useLayoutEffect(() => {
    applyHeight(heightRef.current)
  })

  // Tracks whether the sheet has ever been opened. Used so the initial-mount
  // close (before we open) doesn't immediately call onClose.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (snap !== 'closed') wasOpenRef.current = true
  }, [snap])
  // Notify the parent as soon as a close starts (any path that sets snap to
  // 'closed'), guarded against the initial-mount close. Runs after the
  // wasOpenRef effect above, so open→closed transitions see it still true.
  const onDismissStartRef = useRef(onDismissStart)
  useEffect(() => {
    onDismissStartRef.current = onDismissStart
  }, [onDismissStart])
  useEffect(() => {
    if (snap === 'closed' && wasOpenRef.current) onDismissStartRef.current?.()
  }, [snap])
  // Ref-mirror onClose so the rAF effect can call the latest callback without
  // re-creating the effect (which would interrupt the lerp) on parent renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Re-arms the lerp loop after it parks. Set by the rAF effect below; called
  // from gesture release and wheel input, which move the sheet *without*
  // changing `targetPx`/`snap` (a snap change re-runs the effect instead).
  const lerpWakeRef = useRef<() => void>(() => {})

  // Animate height toward targetPx using rAF + exponential lerp. The loop
  // parks (stops rescheduling) while a pointer gesture owns the height and
  // once the sheet has settled at its target, instead of spinning at 60fps
  // for the whole time the sheet is open; every path that moves the sheet
  // outside this loop wakes it again via lerpWakeRef.
  useEffect(() => {
    if (viewportH === 0) return
    let raf = 0
    let scheduled = false
    let last = performance.now()
    const TAU = 80
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      // Fresh clock on a wake from parked: the gap was rest, not a stall.
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    const tick = (now: number) => {
      scheduled = false
      const dt = Math.min(64, now - last)
      last = now
      if (dragStartRef.current || scrollDragRef.current) {
        // Pointer gesture in progress (dragging the sheet OR passthrough-
        // scrolling the body). The finger owns the height/scroll. Park until
        // release (handlePointerUp wakes the loop) — parking rather than
        // idling also means the rAF closure (captured with the *old*
        // targetPx) can't lerp a just-handed-off sheet back toward the
        // pre-handoff snap before the effect re-runs.
        return
      }
      const current = heightRef.current
      const delta = targetPx - current
      if (Math.abs(delta) < 0.5) {
        if (current !== targetPx) {
          applyHeight(targetPx)
        }
        // Animation landed — safe to mount the heavy content now.
        if (snap !== 'closed') setContentReady(true)
        if (snap === 'closed' && current <= 0.5) {
          // Closed and settled — notify parent if this was a user-initiated
          // close (not the initial-mount close before we ever opened).
          if (wasOpenRef.current) {
            wasOpenRef.current = false
            onCloseRef.current()
          }
          return
        }
        // Settled at an open snap — park until something moves the sheet.
        return
      }
      const alpha = 1 - Math.exp(-dt / TAU)
      const next = current + delta * alpha
      applyHeight(next)
      schedule()
    }
    lerpWakeRef.current = schedule
    schedule()
    return () => {
      lerpWakeRef.current = () => {}
      cancelAnimationFrame(raf)
    }
  }, [targetPx, snap, viewportH])

  // Track whether the current pointer interaction has committed to dragging
  // the sheet (vs. forwarding the gesture to body scroll). We delay
  // committing until the user moves a few pixels so we can choose the right
  // behavior based on direction + sheet state + body scroll position.
  const dragCandidateRef = useRef<{
    y: number
    sheetTopAtStart: number
    pointerId: number
    fromHandle: boolean
  } | null>(null)
  // Active "passthrough scroll": the sheet root captured the pointer but the
  // gesture should drive body scrolling rather than resize the sheet.
  const scrollDragRef = useRef<{ pointerId: number, lastY: number } | null>(null)
  // Swallow the click that follows a committed drag/scroll gesture. Capture
  // retargeting usually prevents it, but engines have differed — a fling that
  // started on a hub member link must never also navigate to that station.
  const suppressClickRef = useRef(false)
  // Committing a gesture (sheet drag or passthrough scroll): take pointer
  // capture so the stream survives the pointer leaving the sheet, and arm the
  // click suppressor. Not done at pointerdown — see handlePointerDown.
  const commitGesture = (pointerId: number) => {
    sheetRef.current?.setPointerCapture(pointerId)
    suppressClickRef.current = true
  }
  // rAF id for the post-release inertial body scroll (0 = none).
  const momentumRef = useRef(0)
  // Cancel any in-flight inertial scroll if the sheet unmounts mid-glide.
  useEffect(() => () => {
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current)
  }, [])
  const DRAG_COMMIT_THRESHOLD = 6 // CSS px

  const handlePointerDown = (e: React.PointerEvent) => {
    // A new touch cancels any in-flight inertial scroll glide.
    if (momentumRef.current) {
      cancelAnimationFrame(momentumRef.current)
      momentumRef.current = 0
    }
    suppressClickRef.current = false
    const target = e.target as HTMLElement
    const fromHandle = !!target.closest('[data-sheet-handle]')
    // Every pointerdown is a drag candidate, even on links and buttons — the
    // hub sheet's body is tiled edge-to-edge with member links, and bailing on
    // interactive targets made that whole sheet undraggable. Pointer capture
    // is deferred to the commit in handlePointerMove: capturing here would
    // retarget the eventual click to this root and break plain taps on those
    // controls. Touch pointers are implicitly captured by the target itself,
    // so the move stream reaches us (bubbling) either way; nothing native can
    // reclaim the gesture because the sheet is touch-action: none.
    dragCandidateRef.current = {
      y: e.clientY,
      sheetTopAtStart: heightRef.current,
      pointerId: e.pointerId,
      fromHandle
    }
    velocityRef.current = []
  }

  const pushVelocity = (t: number, y: number) => {
    velocityRef.current.push({ t, y })
    const cutoff = t - 100
    while (velocityRef.current.length > 1 && velocityRef.current[0].t < cutoff) {
      velocityRef.current.shift()
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    // Already committed to dragging the sheet.
    if (dragStartRef.current) {
      const start = dragStartRef.current
      const dy = e.clientY - start.y
      const wanted = start.sheetTopAtStart - dy
      const next = Math.max(0, Math.min(fullPx, wanted))
      applyHeight(next)
      pushVelocity(e.timeStamp, e.clientY)
      // Android-style handoff: if the sheet hit fullPx and the finger wants
      // to keep going up, switch to scrolling the body. We re-baseline the
      // scroll-drag using the *current* pointer Y so there's no jump.
      // Also commit snap to 'full' so the rAF lerp doesn't pull the sheet
      // back to whatever the pre-drag snap was when the gesture ends.
      if (wanted > fullPx && bodyRef.current) {
        dragStartRef.current = null
        scrollDragRef.current = { pointerId: e.pointerId, lastY: e.clientY }
        if (snap !== 'full') setSnap('full')
      }
      return
    }

    // Already committed to passthrough scroll — drive bodyRef.scrollTop.
    if (scrollDragRef.current && scrollDragRef.current.pointerId === e.pointerId) {
      const body = bodyRef.current
      const dy = e.clientY - scrollDragRef.current.lastY
      scrollDragRef.current.lastY = e.clientY
      if (!body) return
      // Android-style handoff: if the user is dragging down and the body is
      // already at the top, switch from scrolling to shrinking the sheet.
      // Re-baseline the sheet drag from fullPx so the next move continues
      // smoothly from the current finger position.
      if (dy > 0 && body.scrollTop <= 0) {
        scrollDragRef.current = null
        dragStartRef.current = {
          y: e.clientY,
          sheetTopAtStart: fullPx,
          time: e.timeStamp
        }
        velocityRef.current = []
        pushVelocity(e.timeStamp, e.clientY)
        return
      }
      body.scrollTop -= dy
      pushVelocity(e.timeStamp, e.clientY)
      return
    }

    // Not yet committed — decide whether to start dragging.
    const cand = dragCandidateRef.current
    if (!cand || cand.pointerId !== e.pointerId) return
    const dy = e.clientY - cand.y
    if (Math.abs(dy) < DRAG_COMMIT_THRESHOLD) return

    // From handle: always drag. From body: drag when the gesture should
    // resize the sheet; scroll otherwise. The mid-gesture handoff logic
    // above bridges the two modes when the sheet or scroll hits its bound.
    const draggingDown = dy > 0
    const body = bodyRef.current
    const atTop = !body || body.scrollTop <= 0
    const isFullSnap = snap === 'full'

    // Start in scroll mode when the user is at full snap and the body has
    // scroll room in the direction they're going. Otherwise start in sheet-
    // drag mode — the handoff in the committed branches will swap modes if
    // we reach a bound.
    const startScroll = !cand.fromHandle
      && isFullSnap
      && (!draggingDown || !atTop)

    if (startScroll) {
      dragCandidateRef.current = null
      scrollDragRef.current = { pointerId: e.pointerId, lastY: e.clientY }
      commitGesture(e.pointerId)
      return
    }

    dragStartRef.current = {
      y: cand.y,
      sheetTopAtStart: cand.sheetTopAtStart,
      time: e.timeStamp
    }
    dragCandidateRef.current = null
    commitGesture(e.pointerId)

    // Apply the move we just observed so the sheet jumps to where the finger
    // already is (rather than lagging by DRAG_COMMIT_THRESHOLD pixels).
    const next = Math.max(0, Math.min(fullPx, cand.sheetTopAtStart - dy))
    applyHeight(next)
    pushVelocity(e.timeStamp, e.clientY)
  }

  // Inertial body scroll after a flick: native momentum doesn't exist here
  // (touch-action:none + manual scrollTop), so glide the release velocity with
  // exponential decay until it drops below the floor or hits a scroll bound.
  const startScrollMomentum = (releaseVy: number) => {
    const body = bodyRef.current
    if (!body) return
    // scrollTop moves opposite to the finger; releaseVy is finger velocity.
    let v = -releaseVy
    if (Math.abs(v) < SCROLL_MIN_VELOCITY) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const max = body.scrollHeight - body.clientHeight
      const next = body.scrollTop + v * dt
      if (next <= 0 || next >= max) {
        body.scrollTop = next <= 0 ? 0 : max
        momentumRef.current = 0
        return
      }
      body.scrollTop = next
      v *= Math.exp(-dt / SCROLL_MOMENTUM_TAU)
      if (Math.abs(v) < SCROLL_MIN_VELOCITY) {
        momentumRef.current = 0
        return
      }
      momentumRef.current = requestAnimationFrame(step)
    }
    momentumRef.current = requestAnimationFrame(step)
  }

  const handlePointerUp = () => {
    dragCandidateRef.current = null
    const wasScrolling = scrollDragRef.current !== null
    scrollDragRef.current = null
    const start = dragStartRef.current
    // The gesture parked the lerp; re-arm it. The rAF fires after this handler
    // finishes, so it sees the cleared drag refs (and the snap set below) and
    // eases the sheet home even when the snap didn't change.
    lerpWakeRef.current()

    // Release velocity (CSS px/ms); positive = finger moving down. Require >1
    // frame of movement so sub-pixel jitter on the final sample can't
    // masquerade as a flick. Shared by the sheet-snap decision and the
    // body-scroll momentum below.
    const samples = velocityRef.current
    let vy = 0
    if (samples.length >= 2) {
      const first = samples[0]
      const last = samples[samples.length - 1]
      const dt = last.t - first.t
      if (dt >= 16) vy = (last.y - first.y) / dt
    }

    if (!start) {
      // Gesture was a body scroll, not a sheet drag — fling the body.
      if (wasScrolling) startScrollMomentum(vy)
      return
    }
    dragStartRef.current = null

    const current = heightRef.current
    const fraction = viewportH > 0 ? current / viewportH : 0

    // Flick decides direction over position when above threshold.
    let nextSnap: SnapState
    if (vy > FLICK_THRESHOLD) {
      nextSnap = fraction < PEEK_FRACTION * 0.9 ? 'closed' : 'peek'
    } else if (vy < -FLICK_THRESHOLD) {
      nextSnap = 'full'
    } else {
      if (fraction < DISMISS_FRACTION) nextSnap = 'closed'
      else if (fraction < (PEEK_FRACTION + FULL_FRACTION) / 2) nextSnap = 'peek'
      else nextSnap = 'full'
    }
    if (nextSnap !== snap) haptic()
    setSnap(nextSnap)
  }

  const handleClose = useCallback(() => setSnap('closed'), [])

  // Wheel/trackpad: same Android-style handoff as touch. Wheel deltaY > 0
  // (scrolling "down" in content terms) maps to swiping up — expand the sheet
  // first, then scroll the body. Wheel deltaY < 0 maps to swiping down —
  // scroll the body up until top, then shrink the sheet.
  //
  // Attached via native addEventListener with passive: false so preventDefault
  // actually suppresses the native scroll. React's synthetic onWheel is
  // passive by default in modern versions.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaY
      if (dy > 0) {
        const headroom = fullPx - heightRef.current
        if (headroom > 0.5) {
          e.preventDefault()
          const grow = Math.min(dy, headroom)
          applyHeight(heightRef.current + grow)
          if (heightRef.current >= fullPx - 0.5) setSnap('full')
          const remainder = dy - grow
          if (remainder > 0) body.scrollTop += remainder
          // Wheel moved the sheet without a snap change — wake the (possibly
          // parked) lerp so it keeps easing toward the committed snap.
          lerpWakeRef.current()
        }
      } else if (dy < 0) {
        if (body.scrollTop > 0) return
        const shrinkable = heightRef.current - peekPx
        if (shrinkable > 0.5) {
          e.preventDefault()
          const shrink = Math.min(-dy, shrinkable)
          applyHeight(heightRef.current - shrink)
          if (heightRef.current <= peekPx + 0.5) setSnap('peek')
          lerpWakeRef.current()
        }
      }
    }
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => body.removeEventListener('wheel', onWheel)
  }, [fullPx, peekPx])

  // When the sheet is fully closed AND the parent isn't requesting open, don't render.
  if (!open) return null
  if (viewportH === 0) return null

  const isFull = snap === 'full'

  return (
    <>
      {/* Backdrop: pointer-events only when at or past peek-to-full progress.
          At peek the map remains interactive (pointer-events: none).
          Opacity is owned by `applyHeight` (imperative); not rendered from
          React state. */}
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-black"
        style={{
          // One below the sheet rather than sharing its layer. The two were
          // both bare `z-30`, so which covered which came down to their order
          // in this JSX — same silent dependency the deck's cards used to have.
          // The backdrop belongs under the sheet as a fact, not as a
          // consequence of being written first.
          zIndex: 'calc(var(--z-index-detail-surface) - 1)',
          pointerEvents: isFull ? 'auto' : 'none'
        }}
        onClick={handleClose}
        aria-hidden
      />

      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-detail-surface bg-white rounded-t-2xl shadow-2xl flex flex-col"
        style={{
          // Sheet is always sized to its `full` height; we translate it down
          // off-screen and only show the requested portion. This avoids
          // relaying out the (heavy) body on every drag frame.
          // `transform` is owned by `applyHeight` (imperative) — not rendered
          // from React state.
          height: fullPx,
          willChange: 'transform',
          // Own all touch gestures ourselves. Native pan-y would otherwise
          // claim vertical touches on the body and cancel our pointer stream
          // mid-drag.
          touchAction: 'none'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={(e) => {
          if (!suppressClickRef.current) return
          suppressClickRef.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        // Mouse-dragging the sheet from a link would otherwise start a native
        // HTML5 link drag, which cancels the pointer stream mid-gesture.
        onDragStart={e => e.preventDefault()}
        role="dialog"
        aria-label={ariaLabel}
      >
        <div
          data-sheet-handle
          className="shrink-0 px-6 pt-3 pb-4 border-b border-slate-100 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex justify-center mb-2">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>
          {header(handleClose)}
        </div>
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto overscroll-contain"
          // touch-action: none on the body too — overflow-y-auto would
          // otherwise let the browser do its own native pan-y scrolling
          // alongside our pointer-driven scroll, double-counting the gesture.
          style={{ touchAction: 'none' }}
        >
          {children(contentReady)}
        </div>
      </div>
    </>
  )
}
