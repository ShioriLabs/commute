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
  // Current sheet height in CSS px. Stored as a ref + state so we re-render on
  // change but can also write to it imperatively during drag without React lag.
  const [heightPx, setHeightPx] = useState(0)
  const heightRef = useRef(0)
  heightRef.current = heightPx

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
      if (dragStartRef.current) {
        // Drag in progress; finger owns the height. Idle until release.
        raf = requestAnimationFrame(tick)
        return
      }
      const current = heightRef.current
      const delta = targetPx - current
      if (Math.abs(delta) < 0.5) {
        if (current !== targetPx) {
          applyHeight(targetPx)
          setHeightPx(targetPx)
        }
        // Animation landed — safe to mount the heavy content now.
        if (snap !== 'closed') setContentReady(true)
        if (snap === 'closed' && current <= 0.5) return
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

  // After a user-initiated "closed" animation lands, notify the parent so it
  // can clear its selection state. Distinguish initial-mount close (which
  // would otherwise immediately dismiss the just-opened sheet) by requiring
  // that we've actually been open at least once.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (snap !== 'closed') wasOpenRef.current = true
  }, [snap])
  useEffect(() => {
    if (
      snap === 'closed'
      && heightPx < 1
      && operator && code
      && wasOpenRef.current
    ) {
      wasOpenRef.current = false
      onClose()
    }
  }, [snap, heightPx, operator, code, onClose])

  // Track whether the current pointer interaction has committed to dragging
  // the sheet (vs. letting the body scroll natively). We delay committing
  // until the user moves a few pixels so we can choose the right behavior
  // based on direction + sheet state + body scroll position.
  const dragCandidateRef = useRef<{
    y: number
    sheetTopAtStart: number
    pointerId: number
    fromHandle: boolean
  } | null>(null)
  const DRAG_COMMIT_THRESHOLD = 6 // CSS px

  const handlePointerDown = (e: React.PointerEvent) => {
    // Ignore taps on interactive controls inside the header.
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, [role="button"]')) return
    const fromHandle = !!target.closest('[data-sheet-handle]')
    // Body pointerdowns are candidates too (for swipe-up to expand).
    dragCandidateRef.current = {
      y: e.clientY,
      sheetTopAtStart: heightRef.current,
      pointerId: e.pointerId,
      fromHandle
    }
    velocityRef.current = [{ t: e.timeStamp, y: e.clientY }]
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    // Already committed to dragging — update sheet position.
    if (dragStartRef.current) {
      const start = dragStartRef.current
      const dy = e.clientY - start.y
      const next = Math.max(0, Math.min(fullPx, start.sheetTopAtStart - dy))
      applyHeight(next)
      velocityRef.current.push({ t: e.timeStamp, y: e.clientY })
      const cutoff = e.timeStamp - 100
      while (velocityRef.current.length > 2 && velocityRef.current[0].t < cutoff) {
        velocityRef.current.shift()
      }
      return
    }

    // Not yet committed — decide whether to start dragging.
    const cand = dragCandidateRef.current
    if (!cand || cand.pointerId !== e.pointerId) return
    const dy = e.clientY - cand.y
    if (Math.abs(dy) < DRAG_COMMIT_THRESHOLD) return

    // From handle: always commit. The header isn't scrollable.
    // From body: commit only when the gesture should resize the sheet
    // rather than scroll the body content.
    const draggingUp = dy < 0
    const draggingDown = dy > 0
    const body = bodyRef.current
    const atTop = !body || body.scrollTop <= 0
    const isFullSnap = snap === 'full'

    let shouldDrag = false
    if (cand.fromHandle) {
      shouldDrag = true
    } else if (!isFullSnap && draggingUp) {
      // At peek and swiping up → expand the sheet.
      shouldDrag = true
    } else if (!isFullSnap && draggingDown) {
      // At peek and swiping down → close.
      shouldDrag = true
    } else if (isFullSnap && draggingDown && atTop) {
      // At full, scrolled to top, swiping down → shrink.
      shouldDrag = true
    }

    if (!shouldDrag) {
      // Body scroll wins; clear candidate so we don't keep checking.
      dragCandidateRef.current = null
      return
    }

    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
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
  }

  const handlePointerUp = () => {
    dragCandidateRef.current = null
    const start = dragStartRef.current
    if (!start) return
    dragStartRef.current = null
    // Reconcile React state with the imperatively-updated DOM height so the
    // rAF loop's first post-drag tick sees the correct starting height and
    // the backdrop opacity calc renders accurately.
    setHeightPx(heightRef.current)

    // Compute velocity over the last samples; positive = dragging down.
    const samples = velocityRef.current
    let vy = 0
    if (samples.length >= 2) {
      const first = samples[0]
      const last = samples[samples.length - 1]
      const dt = last.t - first.t
      if (dt > 0) vy = (last.y - first.y) / dt
    }

    const current = heightRef.current
    const fraction = viewportH > 0 ? current / viewportH : 0

    // Flick decides direction over position when above threshold.
    if (vy > FLICK_THRESHOLD) {
      if (fraction < PEEK_FRACTION * 0.9) setSnap('closed')
      else setSnap('peek')
    } else if (vy < -FLICK_THRESHOLD) {
      setSnap('full')
    } else {
      // No flick — snap to nearest position. Below dismiss threshold = closed.
      if (fraction < DISMISS_FRACTION) setSnap('closed')
      else if (fraction < (PEEK_FRACTION + FULL_FRACTION) / 2) setSnap('peek')
      else setSnap('full')
    }
  }

  const handleClose = useCallback(() => setSnap('closed'), [])

  // When the sheet is fully closed AND no station is selected, don't render.
  if (!operator || !code) return null
  if (viewportH === 0) return null

  const isFull = snap === 'full'
  // Backdrop fades in as the sheet approaches full; at peek there's no dim.
  const fullProgress = Math.max(0, Math.min(1, (heightPx - peekPx) / Math.max(1, fullPx - peekPx)))
  const backdropOpacity = fullProgress * 0.35

  return (
    <>
      {/* Backdrop: pointer-events only when at or past peek-to-full progress.
          At peek the map remains interactive (pointer-events: none).
          Opacity is set imperatively by the rAF tick (via `applyHeight`) so
          we don't re-render this on every frame. */}
      <div
        ref={backdropRef}
        className="fixed inset-0 z-30 bg-black"
        style={{
          opacity: backdropOpacity,
          pointerEvents: isFull ? 'auto' : 'none'
        }}
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
          height: fullPx,
          transform: `translateY(${fullPx - heightPx}px)`,
          willChange: 'transform'
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
          className="flex-1 overflow-y-auto overscroll-contain touch-pan-y"
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
          to={`/station/${operator}/${code}`}
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
