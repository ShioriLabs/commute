import type { HeadwayRow } from '@commute/schemas'
import LineRoundel from '~/components/line-roundel'
import { getTintFromColor } from 'utils/colors'
import { codeOfLineKey, operatorOfLineKey, useLines } from '~/hooks/use-lines'

/*
 * How often each corridor passes this halte.
 *
 * One list, not a card per corridor. LineCard earns its card because it wraps a
 * whole departure board — direction headers, platform badges, several rows of
 * times. A headway is a single short phrase, so the same treatment gave four
 * corridors four pieces of chrome around four lines of text.
 *
 * But the row still has to be a LINE first and a list item second. Every
 * line-bearing surface in this app is tinted from its own line colour —
 * LineCard, the search cards, the line strip all run through getTintFromColor —
 * because the colour is how a rider picks their corridor out before reading a
 * word of it. A flat grey list reads as generic UI; this tints per row instead
 * of per card, so four corridors stay four colours inside one panel.
 *
 * TransJakarta publishes no timetable, so this is the honest floor under one: a
 * frequency, never an arrival. The copy has to keep saying so.
 */

/*
 * Seconds to the phrase a rider reads.
 *
 * The tilde is load-bearing. Values are combined averages across a corridor's
 * route variants, clamped at a two-minute floor, so a bare "2 menit" would claim
 * precision the model does not have. `~` carries the approximation at both ends
 * of the range without a second form for the clamped case.
 */
export function formatHeadway(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `Setiap ~${minutes} menit`
}

function directionLabel(row: HeadwayRow): string | null {
  return row.boundFor ? `arah ${row.boundFor}` : null
}

/*
 * Which days this corridor runs, as a rider would say it.
 *
 * Absent `days` means every day, and that gets no label at all — most corridors
 * run all week, and printing "tiap hari" on all of them would bury the handful
 * that genuinely differ. Only the exceptions are worth the words.
 *
 * Sunday-only is its own phrase rather than being folded into "akhir pekan":
 * two TransJakarta corridors really do run on Sundays and not Saturdays, and
 * telling a Saturday rider "akhir pekan" would send them to a halte for a bus
 * that is not coming.
 */
export function dayLabel(days: HeadwayRow['days']): string | null {
  if (!days || days.length === 3) return null
  const set = new Set(days)
  const weekend = set.has('SAT') && set.has('SUN')
  if (set.has('WD')) return weekend ? null : 'hari kerja'
  if (weekend) return 'akhir pekan'
  if (set.has('SAT')) return 'Sabtu'
  if (set.has('SUN')) return 'Minggu'
  return null
}

/*
 * One corridor, one or two rows.
 *
 * Two when its directions genuinely differ — the API only labels those — and the
 * halte page cannot pick one for the rider, who has not chosen a destination yet.
 * The roundel is drawn ONCE for the corridor rather than per row: repeating it
 * would read as two different lines rather than two directions of one.
 *
 * "arah <terminus>" matches the wording on the halte's own PIDS ("Karet Kuningan
 * arah Galunggung"), so the app and the board agree. The station's own name is
 * deliberately absent — the page header carries it, and 30 haltes have a compass
 * "Arah" in their NAME already (`Kota Bambu Arah Utara`), a different sense of
 * the word that would collide if both appeared in one line.
 */
function CorridorRows({ rows }: { rows: readonly HeadwayRow[] }) {
  const { line: lookupLine } = useLines()
  const first = rows[0]!
  const resolved = lookupLine(first.line)
  const lineCode = codeOfLineKey(first.line)
  const operator = operatorOfLineKey(first.line)
  // Same fallback as LineCard: render the bare code in neutral grey rather than
  // blanking while /operators is still in flight.
  const lineName = resolved?.name ?? (lineCode || 'Lin lain')
  const lineColor = resolved?.colorCode ?? '#94a3b8'

  // One unlabelled row sits inline beside the corridor name; anything with a
  // direction label needs its own line under it.
  const inline = rows.length === 1 && !rows[0]!.boundFor

  /*
   * A corridor that does not run on the day being shown has no frequency to
   * report, so it says WHEN it runs instead. Everything else reports its
   * frequency, with the day qualifier carried separately below.
   */
  const frequencyOf = (row: HeadwayRow) => {
    if (row.headwayS !== null) return formatHeadway(row.headwayS)
    const label = dayLabel(row.days)
    return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)} saja` : 'Tidak beroperasi'
  }

  /*
   * The qualifier only appears beside a real figure. When the row is already
   * saying "Akhir pekan saja" the days ARE the message, and repeating them
   * would read as a stutter.
   */
  const qualifierOf = (row: HeadwayRow) => (row.headwayS === null ? null : dayLabel(row.days))

  return (
    <li
      className="border-b-2 border-white last:border-b-0"
      style={{ backgroundColor: getTintFromColor(lineColor, 0.1) }}
    >
      {/*
        * items-start, never items-center: the roundel and the frequency belong to
        * the name's FIRST line — that is where the eye enters the row — and a name
        * that wraps to two lines would otherwise leave them floating in the middle
        * of the pair. Vertical centring on a one-line row comes from equal padding
        * instead, which holds however the name wraps.
        *
        * The padding closes up when a direction list follows, since that list
        * supplies the space below.
        */}
      <div className={`flex flex-row items-start gap-3 px-4 ${inline ? 'py-3' : 'pt-3 pb-1'}`}>
        {/* SM is 24px, matching the 16px name's line-box, so it needs no vertical
            nudge to sit on that first line. */}
        <span className="shrink-0">
          <LineRoundel code={lineCode} color={lineColor as `#${string}`} operator={operator} size="SM" />
        </span>
        <span className="font-bold text-base min-w-0">{lineName}</span>
        {inline && (
          /*
           * The name yields and the frequency does not: the frequency is a short
           * fixed phrase and the whole reason the row exists, so it keeps one line
           * while a long corridor name wraps around it.
           */
          <span className="ml-auto shrink-0 text-right leading-6">
            <span className="block text-sm font-semibold text-slate-700 whitespace-nowrap">
              {frequencyOf(first)}
            </span>
            {qualifierOf(first) && (
              /* Muted and under the figure: the frequency is what the rider came
                 for, the day is the caveat on it. */
              <span className="block text-xs text-slate-500 whitespace-nowrap">{qualifierOf(first)}</span>
            )}
          </span>
        )}
      </div>
      {/*
        * Directions indent to the name column, under the roundel that owns them.
        * Rendered whenever a row carries a label — including a SINGLE labelled row,
        * which is a halte the corridor only passes one way. Keying this on the label
        * rather than the row count is what stops a one-way stop from silently
        * reporting its frequency as though it applied in both directions.
        */}
      <ul className={inline ? 'hidden' : 'pb-2'}>
        {rows.map(row => (
          <li key={row.boundFor ?? row.line} className="flex flex-row items-baseline gap-3 pl-13 pr-4 py-0.5">
            <span className="text-sm text-slate-700 min-w-0">{directionLabel(row)}</span>
            <span className="ml-auto shrink-0 text-right">
              <span className="block text-sm font-semibold text-slate-700 whitespace-nowrap">
                {frequencyOf(row)}
              </span>
              {qualifierOf(row) && (
                <span className="block text-xs text-slate-500 whitespace-nowrap">{qualifierOf(row)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}

interface Props {
  rows: readonly HeadwayRow[]
}

export default function FrequencyList({ rows }: Props) {
  if (rows.length === 0) return null

  // Two rows of one corridor arrive adjacent and share a `line`; group them so the
  // roundel and name are drawn once.
  const byLine: HeadwayRow[][] = []
  for (const row of rows) {
    const last = byLine[byLine.length - 1]
    if (last && last[0]!.line === row.line) last.push(row)
    else byLine.push([row])
  }

  return (
    <section aria-label="Frekuensi kendaraan di halte ini">
      <ul className="rounded-xl overflow-hidden shadow-lg">
        {byLine.map(group => <CorridorRows key={group[0]!.line} rows={group} />)}
      </ul>
      <p className="mt-3 px-1 text-sm text-gray-600">
        Hanya perkiraan. Harap cek layar halte atau tanyakan pramusapa
      </p>
    </section>
  )
}
