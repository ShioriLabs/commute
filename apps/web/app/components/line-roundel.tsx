import clsx from 'clsx'
import { AirplaneIcon } from '@phosphor-icons/react'
import { getForegroundColor } from 'utils/colors'
import { splitStationNumber } from 'utils/station-number'

export { splitStationNumber } from 'utils/station-number'

// SM is the MD metrics at ~2/3, keeping the ring at ≈13.5% of the diameter.
const SIZES = {
  MD: { circle: 'w-9 h-9', ring: 'border-[5px]', prefix: 'text-[8px]', num: 'text-[16px]', numCompact: 'text-[14px]', icon: 'w-[18px] h-[18px]', prefixIcon: 'w-[9px] h-[9px]' },
  SM: { circle: 'w-6 h-6', ring: 'border-[3px]', prefix: 'text-[6px]', num: 'text-[11px]', numCompact: 'text-[9px]', icon: 'w-[12px] h-[12px]', prefixIcon: 'w-[7px] h-[7px]' }
}

interface Props {
  code: string
  color: `#${string}`
  // Rendering style. Usually inferred from `operator` (TJ → filled corridor
  // roundel); pass `mode` directly only when no operator is in scope.
  mode?: 'RAIL' | 'TJ'
  // Operator code for the line; when 'TJ', renders the filled TJ corridor style;
  // when 'APCGK', the airport Kalayang's aircraft glyph replaces the code.
  operator?: string
  size?: keyof typeof SIZES
  station?: boolean
  dimmed?: boolean
}

export default function LineRoundel({ code, color, mode, operator, size = 'MD', station = false, dimmed = false }: Props) {
  const resolvedMode = mode ?? (operator === 'TJ' ? 'TJ' : 'RAIL')
  const filled = resolvedMode === 'TJ'
  /*
   * The Kalayang is signed with an aircraft rather than a letter, the way FDTJ
   * drew it: the line roundel is the plane alone (one line, so a code would be
   * noise), and a station number stacks the plane over the stop position in
   * place of the usual prefix letter — K01 reads as ✈/01.
   */
  const pictogram = operator === 'APCGK'
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
      {/* Dark glyph on the white face, not the line colour: FDTJ's roundel puts a
          near-black aircraft inside the grey ring, and grey-on-white would
          barely read at SM. Sized to the prefix slot when it stands in for the
          prefix letter, full size when the plane is the whole roundel. */}
      {pictogram
        ? (
            <AirplaneIcon
              weight="fill"
              className={clsx(station ? sizes.prefixIcon : sizes.icon, lightText ? 'text-white' : 'text-slate-900')}
            />
          )
        : prefix && <span className={sizes.prefix}>{prefix}</span>}
      {/* A line roundel is the plane alone; a station number keeps its digits. */}
      {(station || !pictogram) && (
        <span className={clsx('leading-0', compact ? sizes.numCompact : sizes.num)}>
          {num}
        </span>
      )}
    </span>
  )
}
