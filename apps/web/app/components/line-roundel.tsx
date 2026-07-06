import clsx from 'clsx'
import { getForegroundColor } from 'utils/colors'

// 'C13' -> { prefix: 'C', num: '13' }; 'b23' -> { prefix: 'b', num: '23' }.
export function splitStationNumber(stationNumber: string): { prefix: string, num: string } {
  const match = stationNumber.match(/^([A-Za-z]+)(.*)$/)
  if (!match || !match[2]) return { prefix: '', num: stationNumber }
  return { prefix: match[1], num: match[2] }
}

interface Props {
  code: string
  color: `#${string}`
  mode?: 'RAIL' | 'TJ'
  station?: boolean
  dimmed?: boolean
}

export default function LineRoundel({ code, color, mode = 'RAIL', station = false, dimmed = false }: Props) {
  const filled = mode === 'TJ'
  const lightText = filled && getForegroundColor(color) === 'LIGHT'
  const { prefix, num } = station ? splitStationNumber(code) : { prefix: '', num: code }

  return (
    <span
      className={clsx(
        'inline-flex flex-col items-center justify-center w-9 h-9 rounded-full font-bold tabular-nums leading-none shrink-0',
        lightText ? 'text-white' : 'text-slate-900',
        !filled && 'bg-white border-[5px]',
        dimmed && 'opacity-30'
      )}
      style={filled ? { backgroundColor: color } : { borderColor: color }}
      aria-hidden="true"
    >
      {prefix && <span className="text-[8px]">{prefix}</span>}
      <span
        className={clsx(
          'leading-0',
          station || code.length >= 2 ? 'text-[14px]' : 'text-[16px]'
        )}
      >
        {num}
      </span>
    </span>
  )
}
