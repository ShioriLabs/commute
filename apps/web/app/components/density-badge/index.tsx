import clsx from 'clsx'
import { UsersThreeIcon } from '@phosphor-icons/react'
import type { DensityRange } from '@commute/schemas'
import { densityLabel } from './format'

/*
 * "Biasanya padat jam segini": the forecast crowding for this hour.
 *
 * A four-step meter, one step per level. Steps up to `min` are solid; steps
 * from there to `max` are faint, because that is the part the model is unsure
 * of. Status colours, never line colours, so it can't be mistaken for a
 * LineRoundel; and the label is always there, so nothing rests on colour alone.
 */
const STEP_COLORS = ['bg-emerald-500', 'bg-amber-400', 'bg-orange-500', 'bg-rose-600'] as const

export default function DensityBadge({ range }: { range: DensityRange | null }) {
  const label = densityLabel(range)
  if (!range || !label) return null
  return (
    <div className="flex flex-row items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 mb-4 text-slate-700">
      <UsersThreeIcon weight="duotone" className="w-5 h-5 shrink-0" aria-hidden />
      <span className="flex flex-row items-end gap-0.5 shrink-0" aria-hidden>
        {STEP_COLORS.map((color, level) => (
          <span
            key={color}
            className={clsx(
              'w-1.5 rounded-sm',
              ['h-2', 'h-3', 'h-4', 'h-5'][level],
              level <= range.max ? color : 'bg-slate-300',
              level > range.min && level <= range.max && 'opacity-40'
            )}
          />
        ))}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  )
}
