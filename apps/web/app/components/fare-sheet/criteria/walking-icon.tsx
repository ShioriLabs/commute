import { PersonSimpleRunIcon, PersonSimpleWalkIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { WalkingPreference } from 'utils/fare-criteria'

/*
 * Speed lines trailing the figure, three at the top tier down to none at the
 * bottom. Lifted from JR East's 歩く速度 sheet, where the count is what tells
 * four near-identical walkers apart at a glance.
 */
const SPEED_LINES: Record<WalkingPreference, number> = {
  BRISK: 3,
  AVERAGE: 2,
  SLOW: 1,
  SLOWEST: 0
}

/*
 * Lines on the left because Phosphor's walker faces right, so they trail
 * behind. In a list the line slot is always reserved, even empty, so the
 * figures stand in one column; alone in a chip an empty slot would read as
 * stray padding, so it collapses.
 */
export default function WalkingIcon({ level, className, reserve = true }: {
  level: WalkingPreference
  className?: string
  reserve?: boolean
}) {
  const lines = SPEED_LINES[level]
  const Figure = level === 'BRISK' ? PersonSimpleRunIcon : PersonSimpleWalkIcon
  return (
    <span className={clsx('inline-flex items-center shrink-0', className)} aria-hidden="true">
      {lines === 0 && !reserve
        ? null
        : (
            <svg viewBox="0 0 8 16" className="h-full w-auto" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
              {[5, 8, 11].slice(0, lines).map((y, i) => (
                <line key={y} x1={1 + i} y1={y} x2={7} y2={y} />
              ))}
            </svg>
          )}
      <Figure weight="bold" className="h-full w-auto" />
    </span>
  )
}
