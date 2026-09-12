import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { CaretLeftIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { haptic } from 'utils/haptics'
import {
  composeDeparture,
  DEPARTURE_HOURS,
  DEPARTURE_MINUTES,
  DEPARTURE_SLOT_MINUTES,
  departureDays,
  formatDepartureDay,
  isSameLocalDay,
  quantiseToSlot,
  shiftBySlot
} from 'utils/departure-time'
import { useIsEmbed } from '~/hooks/use-is-embed'

interface Props {
  open: boolean
  /** `'now'` or the chosen ISO instant. */
  value: string
  onSelect: (value: string) => void
  onClose: () => void
}

/** Row height, and the height of one wheel step. Must match ROW_CLASS. */
const ROW_H = 44
const ROW_CLASS = 'h-11'
/** Rows visible either side of the selected one. */
const PADDING_ROWS = 2
/*
 * How long one wheel notch locks out the next.
 *
 * A mouse notch is one event; a trackpad flick is dozens of small ones for the
 * same gesture. Without a cooldown the second spins the column through hours.
 * Long enough to swallow a flick's tail, short enough that deliberate repeated
 * notches still step one row each.
 */
const WHEEL_COOLDOWN_MS = 120
/*
 * How far the pointer moves before a press becomes a drag.
 *
 * Below it the gesture stays a click and the row underneath keeps it. Above it
 * the column takes pointer capture and starts spinning. A couple of pixels of
 * slop, because a mouse click almost always carries some: at 0 a click with a
 * 1px twitch would swallow itself.
 */
const DRAG_THRESHOLD_PX = 3

/*
 * One column of the wheel.
 *
 * Scroll-snap rather than a drag handler: the browser already does momentum,
 * rubber-banding and snapping natively, and every hand-rolled version of this
 * fights the platform on one of the three. The column is a plain scroll
 * container whose children snap to centre; `scrollend` reads back which one
 * landed there.
 *
 * Spacers above and below rather than padding, because padding is not a snap
 * target — the first and last items could never reach the centre line without
 * them.
 */
function WheelColumn<T>({ items, selected, onSettle, render, label, wide }: {
  items: T[]
  selected: number
  onSettle: (index: number) => void
  render: (item: T, isSelected: boolean) => React.ReactNode
  label: string
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  /*
   * Suppress the scroll handler while we are the ones scrolling.
   *
   * Setting scrollTop to sync an external change fires `scroll` and `scrollend`
   * exactly as a finger would, so without this the column reports back the
   * value it was just told to show — harmless when they agree, an infinite
   * settle loop when a nudge button moves two columns at once.
   */
  const programmatic = useRef(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startY: number, startTop: number, moved: boolean } | null>(null)

  /*
   * Row ids, for aria-activedescendant.
   *
   * Slugged rather than built from the label directly: aria-activedescendant
   * holds a single IDREF, and a label like "Tanggal berangkat" would put a
   * space in it — which reads as a separator and leaves the reference pointing
   * at nothing a screen reader can resolve.
   */
  const rowId = (index: number) => `wheel-${label.replace(/\s+/g, '-').toLowerCase()}-${index}`

  const clampIndex = (index: number) => Math.max(0, Math.min(items.length - 1, index))

  const settleTo = (index: number) => {
    const clamped = clampIndex(index)
    if (clamped === selected) return
    haptic()
    onSettle(clamped)
  }

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const target = selected * ROW_H
    if (Math.abs(node.scrollTop - target) < 1) return
    programmatic.current = true
    node.scrollTo({ top: target, behavior: 'auto' })
    // One frame is enough: scrollTo with behavior:auto lands synchronously, and
    // the scrollend it raises is dispatched before the next paint.
    requestAnimationFrame(() => {
      programmatic.current = false
    })
  }, [selected])

  /*
   * One wheel notch moves exactly one row.
   *
   * Native listener with passive: false, not React's onWheel — the synthetic
   * one is passive in modern React, so preventDefault there is a silent no-op.
   * Same reason bottom-sheet.tsx attaches its own (see the comment there).
   *
   * The delta is read for direction only. A mouse notch, a trackpad flick and a
   * deltaMode:1 line-scroll report wildly different magnitudes for the same
   * intent, and letting them through raw made one flick cross six hours. The
   * cooldown is what stops a trackpad's delta stream from spinning the column:
   * it arrives as dozens of small events, each of which is still "one notch".
   */
  useEffect(() => {
    const node = ref.current
    if (!node) return
    let cooling = false
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 1) return
      event.preventDefault()
      if (cooling) return
      cooling = true
      window.setTimeout(() => {
        cooling = false
      }, WHEEL_COOLDOWN_MS)
      settleTo(selected + (event.deltaY > 0 ? 1 : -1))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  })

  const handleSettle = () => {
    const node = ref.current
    // Ignore snap-back during a drag: scrollTop is being written by hand there,
    // and the row under the centre line is not committed until release.
    if (!node || programmatic.current || drag.current) return
    settleTo(Math.round(node.scrollTop / ROW_H))
  }

  /*
   * Drag to spin, for a mouse that has no fling.
   *
   * Pointer events rather than mouse events so this is one path for mouse, pen
   * and touch; capture so a drag that leaves the column keeps tracking, which
   * is most of them given the column is 64px wide.
   *
   * Snapping is turned off for the duration. scroll-snap-type fights a
   * hand-written scrollTop — the browser re-snaps between frames and the column
   * judders against the finger — so the snap is restored on release, which is
   * also what animates the row into place.
   */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current
    if (!node || event.button !== 0) return
    // Armed, not captured. Capturing here would retarget the pointer stream to
    // this column, and the browser then dispatches the resulting `click`
    // against the capturing element rather than the row under the cursor —
    // which silently killed click-to-select on every row. Capture is taken in
    // onPointerMove instead, once the gesture is actually a drag.
    drag.current = { startY: event.clientY, startTop: node.scrollTop, moved: false }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current
    const state = drag.current
    if (!node || !state) return
    const dy = event.clientY - state.startY
    if (!state.moved) {
      // Below the threshold this is still a click in progress; leave it alone
      // so the row underneath gets it.
      if (Math.abs(dy) <= DRAG_THRESHOLD_PX) return
      state.moved = true
      node.setPointerCapture(event.pointerId)
      setDragging(true)
    }
    node.scrollTop = state.startTop - dy
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current
    const state = drag.current
    if (!node || !state) return
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId)
    drag.current = null
    setDragging(false)
    // A press that never moved is a click on a row, which that row's own
    // handler answers. Committing here too would fight it.
    if (state.moved) settleTo(Math.round(node.scrollTop / ROW_H))
  }

  /*
   * Arrows, Home and End. The column is a focusable listbox, so a keyboard user
   * who can reach it must be able to work it — without these it takes focus and
   * then does nothing.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step !== 0) {
      event.preventDefault()
      settleTo(selected + step)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      settleTo(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      settleTo(items.length - 1)
    }
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={rowId(selected)}
      tabIndex={0}
      onScrollEnd={handleSettle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={clsx(
        'relative overflow-y-auto no-scrollbar overscroll-contain touch-pan-y rounded-lg',
        // Focus-visible, not focus: a full pink box around the column on every
        // mouse click read as "this column is the selection", competing with
        // the centre band that actually marks it. Keyboard users still get the
        // ring they need to know where they are.
        'focus:outline-none focus-visible:outline-2 focus-visible:outline-[#F55875]/60',
        // Snap is suspended mid-drag; see onPointerDown.
        dragging ? 'cursor-grabbing select-none' : 'snap-y snap-mandatory cursor-grab',
        wide ? 'flex-1 min-w-0' : 'w-16 shrink-0'
      )}
      style={{ height: ROW_H * (PADDING_ROWS * 2 + 1) }}
    >
      <div style={{ height: ROW_H * PADDING_ROWS }} aria-hidden />
      {items.map((item, index) => {
        const isSelected = index === selected
        return (
          <div
            key={index}
            id={rowId(index)}
            role="option"
            aria-selected={isSelected}
            onClick={() => settleTo(index)}
            className={clsx(
              ROW_CLASS,
              'snap-center flex items-center justify-center cursor-pointer transition-colors duration-150',
              // The centre frame is drawn by the parent, so the rows carry only
              // weight and colour — a second box here would double the frame.
              isSelected ? 'text-slate-900 font-bold' : 'text-slate-400'
            )}
          >
            { render(item, isSelected) }
          </div>
        )
      })}
      <div style={{ height: ROW_H * PADDING_ROWS }} aria-hidden />
    </div>
  )
}

/*
 * When to leave: a day, an hour and a minute, on three synced wheels.
 *
 * After JR East's 経路検索 and Citymapper's Leave/Arrive sheet, which both land
 * on the same shape — wheels with the selection framed at the centre, quick
 * nudges beside them, and one button that commits. The wheel earns its place
 * over a grid of times because it scales: a grid of every slot is 72 cells to
 * scan, where three columns are three short scrolls no matter how many days
 * are offered.
 *
 * The minute wheel steps by DEPARTURE_SLOT_MINUTES rather than by 1 like the
 * references. Their backends answer per minute; ours keys the cache on the
 * slot, so a finer wheel would let a rider pick 13.25 and be shown the 13.20
 * answer under a label they did not choose. Three honest values beat sixty
 * that quietly floor.
 *
 * Edits are drafted here and committed by the button, never fired per scroll:
 * each change is a new SWR key and a new cache entry, so live-updating would
 * spend a request on every value the wheel passed through on its way.
 */
export default function DepartureSheet({ open, value, onSelect, onClose }: Props) {
  const isEmbed = useIsEmbed()

  /*
   * Rebuilt per opening, not memoised on a constant: "today" stops being true
   * at midnight, and a sheet mounted once and reopened for weeks would keep
   * offering a day that has passed.
   */
  const days = useMemo(() => departureDays(), [open])

  const [draft, setDraft] = useState<Date>(() => quantiseToSlot(new Date()))

  /*
   * Reset to what the criteria say each time the sheet opens, so a cancelled
   * edit does not survive as the next opening's starting point. `'now'` starts
   * the wheels at the current slot — the rider is choosing a departure, and the
   * nearest real one is the useful place to begin.
   */
  useEffect(() => {
    if (!open) return
    setDraft(value === 'now' ? quantiseToSlot(new Date()) : quantiseToSlot(new Date(value)))
  }, [open, value])

  const dayIndex = Math.max(0, days.findIndex(day => isSameLocalDay(day, draft)))
  const hourIndex = draft.getHours()
  const minuteIndex = Math.max(0, DEPARTURE_MINUTES.indexOf(draft.getMinutes()))

  const setDay = (index: number) =>
    setDraft(composeDeparture(days[index]!, draft.getHours(), draft.getMinutes()))
  const setHour = (index: number) =>
    setDraft(composeDeparture(draft, DEPARTURE_HOURS[index]!, draft.getMinutes()))
  const setMinute = (index: number) =>
    setDraft(composeDeparture(draft, draft.getHours(), DEPARTURE_MINUTES[index]!))

  const nudge = (slots: number) => {
    haptic()
    setDraft(shiftBySlot(draft.toISOString(), slots))
  }

  const commit = () => {
    haptic()
    onSelect(draft.toISOString())
    onClose()
  }

  const useNow = () => {
    haptic()
    onSelect('now')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-modal">
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/25 duration-300 ease-out data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen items-end">
        <DialogPanel
          transition
          className={clsx(
            'bg-white w-screen overflow-y-auto rounded-t-2xl will-change-transform transition duration-300 ease-ios-spring data-closed:translate-y-full',
            isEmbed ? 'max-h-[85vh]' : 'max-h-[85dvh]'
          )}
        >
          <div className="p-8 pb-4 max-w-3xl mx-auto">
            <div className="flex gap-4 items-center justify-between">
              <h2 className="font-bold text-2xl">Kapan Berangkat</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup pilihan waktu berangkat"
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                <XIcon weight="bold" className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="px-8 max-w-3xl mx-auto">
            {/*
              * The wheels, with the selection framed rather than highlighted.
              *
              * The frame is one absolutely-positioned band behind the columns,
              * not a style on the selected row: it has to span all three
              * columns as a single object, which is what says "these are one
              * value" rather than three independent lists.
              */}
            <div className="relative">
              <div
                aria-hidden
                className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-stone-100/80 pointer-events-none"
                style={{ height: ROW_H }}
              />
              <div className="relative flex items-center gap-2 figure text-lg">
                <WheelColumn
                  items={days}
                  selected={dayIndex}
                  onSettle={setDay}
                  label="Tanggal berangkat"
                  wide
                  render={day => <span className="truncate px-2">{ formatDepartureDay(day) }</span>}
                />
                <WheelColumn
                  items={DEPARTURE_HOURS}
                  selected={hourIndex}
                  onSettle={setHour}
                  label="Jam berangkat"
                  render={hour => <span className="tabular-nums">{ String(hour).padStart(2, '0') }</span>}
                />
                <WheelColumn
                  items={DEPARTURE_MINUTES}
                  selected={minuteIndex}
                  onSettle={setMinute}
                  label="Menit berangkat"
                  render={minute => <span className="tabular-nums">{ String(minute).padStart(2, '0') }</span>}
                />
              </div>
            </div>

            {/*
              * Nudges by one slot, after JR East's 5分前 / 現在時刻 / 5分後.
              * One slot rather than five minutes, because a smaller step would
              * move the label without moving the answer.
              */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => nudge(-1)}
                className="flex items-center gap-1 text-sm font-bold text-slate-500 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-rose-50/60"
              >
                <CaretLeftIcon weight="bold" className="w-3.5 h-3.5 shrink-0" />
                {`${DEPARTURE_SLOT_MINUTES} mnt awal`}
              </button>
              <button
                type="button"
                onClick={useNow}
                className="text-sm font-bold text-[#F55875] rounded-lg px-2 py-1.5 cursor-pointer hover:bg-rose-50/60"
              >
                Sekarang
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                className="flex items-center gap-1 text-sm font-bold text-slate-500 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-rose-50/60"
              >
                {`${DEPARTURE_SLOT_MINUTES} mnt lagi`}
                <CaretRightIcon weight="bold" className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>

            <button
              type="button"
              onClick={commit}
              className="mt-4 mb-8 w-full rounded-xl bg-[#F55875] text-white font-bold py-3.5 cursor-pointer"
            >
              Atur
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
