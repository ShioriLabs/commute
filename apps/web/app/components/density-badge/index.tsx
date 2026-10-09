import { useState } from 'react'
import type { DensityRange } from '@commute/schemas'
import CrowdIcon from './crowd-icon'
import DensityLegendSheet from './legend-sheet'
import { densityLabel } from './format'

/*
 * The forecast crowding for this hour: "Perkiraan Keramaian" then icons, one
 * when the model is sure (`min === max`), `min ~ max` when it isn't. Plain text
 * on the page, right-aligned, so it reads as a hint rather than a headline.
 *
 * The words ("Biasanya padat jam segini") are the tooltip on hover and the
 * button's accessible name, so a screen reader and a mouse get them without
 * the badge spending a row on them. Tapping opens the legend, which is how a
 * touch rider learns what the icons mean.
 */
export default function DensityBadge({ range }: { range: DensityRange | null }) {
  // Bumped per opening and used as the sheet's key: re-opening during the close
  // animation is otherwise a silent no-op (memory: bottom-sheet-reopen-race).
  const [opening, setOpening] = useState(0)
  const [open, setOpen] = useState(false)
  const label = densityLabel(range)
  if (!range || !label) return null
  return (
    <div className="flex flex-row justify-end mb-4">
      <button
        type="button"
        // Starts with the visible words, so a voice-control rider can say what they see.
        aria-label={`Perkiraan Keramaian: ${label}`}
        onClick={() => {
          setOpening(n => n + 1)
          setOpen(true)
        }}
        className="group relative flex flex-row items-center gap-1.5 text-slate-500 cursor-pointer"
      >
        <span className="text-sm font-semibold mr-0.5">Perkiraan Keramaian</span>
        <CrowdIcon level={range.min} className="w-5 h-5" />
        {range.min !== range.max && (
          <>
            <span className="text-sm font-semibold" aria-hidden>~</span>
            <CrowdIcon level={range.max} className="w-5 h-5" />
          </>
        )}
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full mt-2 z-10 hidden whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white group-hover:block group-focus-visible:block"
        >
          {label}
        </span>
      </button>
      <DensityLegendSheet key={opening} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
