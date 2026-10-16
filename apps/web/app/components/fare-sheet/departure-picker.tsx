import clsx from 'clsx'
import { type CSSProperties } from 'react'
import { getForegroundColor } from 'utils/colors'
import { formatClock } from 'utils/format'
import { CHIP_ROW_MAX, type LegOption } from './leg-departures'

const minutesOf = (gapS: number) => Math.round(gapS / 60)

/*
 * The change between two trains, as the timeline rows between rides print it.
 * Only a tight one is named: "tight" is judged on the spare time beyond the
 * engine's own change allowance, so a long walk with a minute to spare is
 * flagged even though the gap itself looks generous.
 */
export function ConnectionNote({ gapS, tight }: { gapS: number, tight: boolean }) {
  return (
    <span className={clsx('figure text-xs', tight ? 'text-amber-700 font-bold' : 'text-slate-500')}>
      {tight ? `${minutesOf(gapS)} mnt · mepet` : `${minutesOf(gapS)} mnt`}
    </span>
  )
}

/*
 * What a departure leads to, in as few words as it takes.
 *
 * The change's length is the number a rider compares across chips; the verdict
 * word only earns its place when something is wrong. "longgar" and "pas" are
 * both fine to ride, and spelling them out on every chip made a row of long,
 * differently coloured captions that read louder than the times above them. A
 * tight change is the exception, so it alone is named, in amber. The same rule
 * holds on the transfer row under the ride.
 *
 * The last leg has no change to make, so it says when it arrives instead.
 */
function optionNote(option: LegOption): { text: string, tight: boolean } {
  if (option.blocked === 'MISSED') return { text: 'tak terkejar', tight: false }
  if (option.blocked === 'NO_ONWARD') return { text: 'tak tersambung', tight: false }
  if (option.gapToNextS === null) return { text: `tiba ${formatClock(option.departure.arrivalAt)}`, tight: false }
  const minutes = minutesOf(option.gapToNextS)
  return { text: option.tight ? `mepet ${minutes} mnt` : `pindah ${minutes} mnt`, tight: option.tight }
}

/*
 * Selection is the line's own colour, filled.
 *
 * The same rule the route bar and the line pill follow: colour is data, so the
 * train you have chosen is drawn in the line you will be riding. Unchosen
 * trains are quiet stone plates — the journey plates' own ground — with no
 * border, because a hairline box around each made the row look like a form
 * control rather than a part of the timeline.
 */
function toneOf(selected: boolean, color: string): { className: string, style?: CSSProperties } {
  if (!selected) return { className: 'bg-stone-100 text-slate-900' }
  const onLight = getForegroundColor(color) === 'LIGHT'
  return { className: onLight ? 'text-white' : 'text-slate-900', style: { backgroundColor: color } }
}

/*
 * The trains on one leg, to choose between.
 *
 * Up to CHIP_ROW_MAX they are chips in a row, which is what a rider glances
 * along when about to miss one. Past that a row scrolls off screen and hides
 * the options, so it becomes a ladder: one line per train, arrival beside it.
 *
 * A train that can no longer be reached after an earlier pick, or that no later
 * train connects from, stays in the list but disabled, with which of the two it
 * is, so the rider sees why the choice narrowed instead of finding options gone.
 */
export default function DeparturePicker({ options, color, onPick }: {
  options: LegOption[]
  color: string
  onPick: (tripId: string) => void
}) {
  if (options.length < 2) return null

  if (options.length > CHIP_ROW_MAX) {
    return (
      <ul className="w-full flex flex-col gap-px overflow-hidden rounded-xl">
        {options.map((option) => {
          const tone = toneOf(option.selected, color)
          const note = optionNote(option)
          return (
            <li key={option.departure.tripId}>
              <button
                type="button"
                disabled={option.blocked !== null}
                aria-pressed={option.selected}
                onClick={() => onPick(option.departure.tripId)}
                className={clsx(
                  'w-full grid grid-cols-[3.25rem_1fr] items-baseline gap-2 px-3 py-2 text-left',
                  tone.className,
                  option.blocked === null ? 'cursor-pointer' : 'cursor-default opacity-50'
                )}
                style={tone.style}
              >
                <b className={clsx('figure text-base tabular-nums', option.blocked !== null && 'line-through')}>{ formatClock(option.departure.departureAt) }</b>
                <span className={clsx('figure text-xs truncate', option.selected ? 'opacity-80' : 'text-slate-500', note.tight && !option.selected && 'text-amber-700 font-bold')}>{ note.text }</span>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <ul className="flex gap-1.5 overflow-x-auto max-w-full pb-0.5">
      {options.map((option) => {
        const tone = toneOf(option.selected, color)
        const note = optionNote(option)
        return (
          <li key={option.departure.tripId} className="shrink-0">
            <button
              type="button"
              disabled={option.blocked !== null}
              aria-pressed={option.selected}
              onClick={() => onPick(option.departure.tripId)}
              className={clsx(
                'flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left',
                tone.className,
                option.blocked === null ? 'cursor-pointer' : 'cursor-default opacity-50'
              )}
              style={tone.style}
            >
              <b className={clsx('figure text-base leading-none tabular-nums', option.blocked !== null && 'line-through')}>{ formatClock(option.departure.departureAt) }</b>
              <span className={clsx('figure text-[11px] leading-none whitespace-nowrap', option.selected ? 'opacity-80' : 'text-slate-500', note.tight && !option.selected && 'text-amber-700 font-bold')}>
                { note.text }
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
