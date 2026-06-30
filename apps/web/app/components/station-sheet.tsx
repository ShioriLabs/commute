import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { XIcon, ArrowSquareOutIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import StationContent, { useStationHeader } from './station-content'

// Sheet height as a fraction of viewport height. Peek is tall enough that
// the timetable head + a few rows are visible without dragging.
const PEEK_FRACTION = 0.3
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

interface StationSheetProps {
  operator: string | null
  code: string | null
  onClose: () => void
}

type SnapState = 'closed' | 'peek' | 'full'

export default function StationSheet({ operator, code, onClose }: StationSheetProps) {
  // Snap state controlled by parent open/close; persists open height across renders.
  const [snap, setSnap] = useState<SnapState>('closed')
  const [viewportH, setViewportH] = useState(0)
  // Defer mounting the heavy StationContent until the open animation finishes.
  // Otherwise the first render of dozens of timetable/amenity nodes happens
  // during the 0→peek slide and drops frames.
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

  // Open the sheet to peek whenever a new station code arrives; close otherwise.
  useEffect(() => {
    if (operator && code) {
      setContentReady(false)
      setSnap('peek')
    } else {
      setSnap('closed')
    }
  }, [operator, code])

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
  // StationContent subtree on every frame).
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
  // thrash the heavy StationContent subtree). Without this, the render that
  // setSnap triggers on pointer-up would paint with the *pre-drag* state-
  // derived inline styles for one frame before the next rAF tick corrects
  // them — visible as a flash/jitter on release.
  useLayoutEffect(() => {
    applyHeight(heightRef.current)
  })

  // Tracks whether the sheet has ever been opened. Used so the initial-mount
  // close (before we open) doesn't immediately call onClose.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (snap !== 'closed') wasOpenRef.current = true
  }, [snap])
  // Ref-mirror onClose so the rAF effect can call the latest callback without
  // re-creating the effect (which would interrupt the lerp) on parent renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Animate height toward targetPx using rAF + exponential lerp. The loop is
  // paused while the user is actively dragging so it doesn't fight the finger.
  useEffect(() => {
    if (viewportH === 0) return
    let raf = 0
    let last = performance.now()
    const TAU = 80
    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      if (dragStartRef.current || scrollDragRef.current) {
        // Pointer gesture in progress (dragging the sheet OR passthrough-
        // scrolling the body). The finger owns the height/scroll. Idle until
        // release — and also after a sheet→scroll handoff, so the rAF closure
        // (captured with the *old* targetPx) doesn't lerp the just-handed-off
        // sheet back toward the pre-handoff snap before the effect re-runs.
        raf = requestAnimationFrame(tick)
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
        raf = requestAnimationFrame(tick)
        return
      }
      const alpha = 1 - Math.exp(-dt / TAU)
      const next = current + delta * alpha
      applyHeight(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
    // Ignore taps on interactive controls inside the header.
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, [role="button"]')) return
    const fromHandle = !!target.closest('[data-sheet-handle]')
    // Capture immediately so touch UAs can't reclaim the gesture for native
    // scrolling once it crosses a few pixels.
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
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
      return
    }

    dragStartRef.current = {
      y: cand.y,
      sheetTopAtStart: cand.sheetTopAtStart,
      time: e.timeStamp
    }
    dragCandidateRef.current = null

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
        }
      } else if (dy < 0) {
        if (body.scrollTop > 0) return
        const shrinkable = heightRef.current - peekPx
        if (shrinkable > 0.5) {
          e.preventDefault()
          const shrink = Math.min(-dy, shrinkable)
          applyHeight(heightRef.current - shrink)
          if (heightRef.current <= peekPx + 0.5) setSnap('peek')
        }
      }
    }
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => body.removeEventListener('wheel', onWheel)
  }, [fullPx, peekPx])

  // When the sheet is fully closed AND no station is selected, don't render.
  if (!operator || !code) return null
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
        className="fixed inset-0 z-30 bg-black"
        style={{ pointerEvents: isFull ? 'auto' : 'none' }}
        onClick={handleClose}
        aria-hidden
      />

      <div
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-30 bg-white rounded-t-2xl shadow-2xl flex flex-col"
        style={{
          // Sheet is always sized to its `full` height; we translate it down
          // off-screen and only show the requested portion. This avoids
          // relaying out the (heavy) StationContent on every drag frame.
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
        role="dialog"
        aria-label="Detail stasiun"
      >
        <SheetHeader operator={operator} code={code} onClose={handleClose} />
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto overscroll-contain"
          // touch-action: none on the body too — overflow-y-auto would
          // otherwise let the browser do its own native pan-y scrolling
          // alongside our pointer-driven scroll, double-counting the gesture.
          style={{ touchAction: 'none' }}
        >
          {contentReady
            ? <StationContent operator={operator} code={code} />
            : (
                <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
                  <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
                </div>
              )}
        </div>
      </div>
    </>
  )
}

function SheetHeader({ operator, code, onClose }: { operator: string, code: string, onClose: () => void }) {
  const { header } = useStationHeader(operator, code)
  return (
    <div
      data-sheet-handle
      className="shrink-0 px-6 pt-3 pb-4 border-b border-slate-100 cursor-grab active:cursor-grabbing select-none"
    >
      <div className="flex justify-center mb-2">
        <div className="w-10 h-1 rounded-full bg-slate-300" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {header.isLoading
            ? (
                <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
              )
            : (
                <h2 className="font-bold text-xl truncate">{header.formattedName}</h2>
              )}
        </div>
        <Link
          to={`/stations/${operator}/${code}`}
          aria-label="Buka halaman stasiun lengkap"
          className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100"
        >
          <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup detail stasiun"
          className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <XIcon weight="bold" className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
