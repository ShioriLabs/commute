import clsx from 'clsx'

/*
 * Four people, one per level, filled up to `level` in that level's status
 * colour; the rest stay grey. Status colours, never line colours, so it can't
 * be mistaken for a LineRoundel.
 */
const LEVEL_FILLS = ['fill-emerald-500', 'fill-amber-400', 'fill-orange-500', 'fill-rose-600'] as const

/** Left edge of each person in the 24-unit box: 4 wide, 2 apart, 1 of margin each side. */
const PEOPLE_X = [1, 7, 13, 19] as const

export default function CrowdIcon({ level, className }: { level: number, className?: string }) {
  const fill = LEVEL_FILLS[Math.min(Math.max(level, 0), LEVEL_FILLS.length - 1)]
  return (
    <svg viewBox="0 0 24 24" className={clsx('shrink-0', className)} aria-hidden>
      {PEOPLE_X.map((x, person) => (
        <g key={x} className={person <= level ? fill : 'fill-slate-300'}>
          <circle cx={x + 2} cy={4} r={2} />
          <rect x={x} y={7} width={4} height={15} rx={2} />
        </g>
      ))}
    </svg>
  )
}
