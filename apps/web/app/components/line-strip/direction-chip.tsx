import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react'
import { getTintFromColor } from 'utils/colors'

interface DirectionChipProps {
  name: string
  color: string
  pointing: 'UP' | 'DOWN'
  className?: string
}

export default function DirectionChip({ name, color, pointing, className = '' }: DirectionChipProps) {
  const Icon = pointing === 'UP' ? ArrowUpIcon : ArrowDownIcon
  return (
    <div className={className}>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-slate-900"
        style={{ backgroundColor: getTintFromColor(color, 0.15) }}
      >
        <Icon weight="bold" className="w-3.5 h-3.5" />
        {'arah '}
        {name}
      </span>
    </div>
  )
}
