import clsx from 'clsx'
import { getForegroundColor } from 'utils/colors'
import { splitStationNumber } from 'utils/station-number'

export { splitStationNumber } from 'utils/station-number'

// SM is the MD metrics at ~2/3, keeping the ring at ≈13.5% of the diameter.
const SIZES = {
  MD: { circle: 'w-9 h-9', ring: 'border-[5px]', prefix: 'text-[8px]', num: 'text-[16px]', numCompact: 'text-[14px]' },
  SM: { circle: 'w-6 h-6', ring: 'border-[3px]', prefix: 'text-[6px]', num: 'text-[11px]', numCompact: 'text-[9px]' }
}

interface Props {
  code: string
  color: `#${string}`
  // Rendering style. Usually inferred from `operator` (TJ → filled corridor
  // roundel); pass `mode` directly only when no operator is in scope.
  mode?: 'RAIL' | 'TJ'
  // Operator code for the line; when 'TJ', renders the filled TJ corridor style.
  operator?: string
  size?: keyof typeof SIZES
  station?: boolean
  dimmed?: boolean
}

export default function LineRoundel({ code, color, mode, operator, size = 'MD', station = false, dimmed = false }: Props) {
  const resolvedMode = mode ?? (operator === 'TJ' ? 'TJ' : 'RAIL')
  const filled = resolvedMode === 'TJ'
  const lightText = filled && getForegroundColor(color) === 'LIGHT'
  const compact = station || code.length >= 2
  const { prefix, num } = station ? splitStationNumber(code) : { prefix: '', num: code }
  const sizes = SIZES[size]

  return (
    <span
      className={clsx(
        'inline-flex flex-col items-center justify-center rounded-full font-bold tabular-nums leading-none shrink-0',
        sizes.circle,
        lightText ? 'text-white' : 'text-slate-900',
        !filled && clsx('bg-white', sizes.ring),
        dimmed && 'opacity-30'
      )}
      style={filled ? { backgroundColor: color } : { borderColor: color }}
      aria-hidden="true"
    >
      {prefix && <span className={sizes.prefix}>{prefix}</span>}
      <span className={clsx('leading-0', compact ? sizes.numCompact : sizes.num)}>
        {num}
      </span>
    </span>
  )
}
