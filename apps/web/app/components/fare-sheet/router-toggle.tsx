import clsx from 'clsx'
import { haptic } from 'utils/haptics'
import type { FareRouter } from 'utils/fare-router'

interface Props {
  router: FareRouter
  onChange: (router: FareRouter) => void
}

const OPTIONS: { value: FareRouter, label: string }[] = [
  { value: 'standard', label: 'Standar' },
  { value: 'beta', label: 'Beta' }
]

const CAPTION_ID = 'fare-router-caption'

/*
 * Picks which router answers the query.
 *
 * A radiogroup rather than a tablist, which is where this parts company with
 * search-sheet/mode-toggle.tsx despite borrowing its shape. That one is
 * correctly a tablist because each option swaps the panel below it; this one
 * re-parameterises the same result region, and "pick one of two settings" is
 * what radiogroup describes to a screen reader.
 *
 * The caption says what changes rather than naming the engine: "router" is our
 * word, not a rider's. It also does not promise a better or faster route, only
 * more of them — the same restraint journey-labels.ts keeps when it declines to
 * read SHORTEST_WAIT as "you will arrive sooner".
 */
export default function RouterToggle({ router, onChange }: Props) {
  return (
    <div className="mt-3">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Pilihan rute
      </span>
      <div
        role="radiogroup"
        aria-label="Mode pencarian rute"
        aria-describedby={CAPTION_ID}
        className="mt-1.5 inline-flex gap-0.5 p-1 rounded-full bg-stone-100/80 border-2 border-stone-200/40"
      >
        {OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={router === option.value}
            onClick={() => {
              if (router === option.value) return
              haptic()
              onChange(option.value)
            }}
            className={clsx(
              'text-sm font-bold px-4 py-1.5 rounded-full cursor-pointer transition-colors',
              router === option.value ? 'bg-[#F55875] text-white' : 'text-slate-500'
            )}
          >
            { option.label }
          </button>
        ))}
      </div>
      <p id={CAPTION_ID} className="mt-1.5 text-xs text-slate-500">
        Cobain mode beta: lebih mantul, lebih fleksibel, lebih ngasih pilihan
      </p>
    </div>
  )
}
