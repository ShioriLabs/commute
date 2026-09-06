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

function FrequencyRow({ row }: { row: HeadwayRow }) {
  const { line: lookupLine } = useLines()
  const resolved = lookupLine(row.line)
  const lineCode = codeOfLineKey(row.line)
  const operator = operatorOfLineKey(row.line)
  // Same fallback as LineCard: render the bare code in neutral grey rather than
  // blanking while /operators is still in flight.
  const lineName = resolved?.name ?? (lineCode || 'Lin lain')
  const lineColor = resolved?.colorCode ?? '#94a3b8'

  const frequency = row.weekendOnly || row.headwayS === null
    ? 'Akhir pekan saja'
    : formatHeadway(row.headwayS)

  return (
    <li
      /*
       * items-start, not items-center: a two-line corridor name would otherwise
       * push the roundel to the middle of the pair, leaving it hanging between
       * the lines. The roundel belongs to the name's FIRST line — that is where
       * the eye enters the row — so it is pinned there and centred against that
       * line's box rather than the whole cell.
       */
      className="flex flex-row items-start gap-3 px-4 py-3 border-b-2 border-white last:border-b-0"
      style={{ backgroundColor: getTintFromColor(lineColor, 0.1) }}
    >
      {/* Roundel is 36px (MD), the text line-box 24px: -6px centres it on that line. */}
      <span className="shrink-0 -my-1.5">
        <LineRoundel code={lineCode} color={lineColor as `#${string}`} operator={operator} />
      </span>
      {/*
        * The name yields and the frequency does not: the frequency is a short
        * fixed phrase and the whole reason the row exists, so it keeps one line
        * while a long corridor name wraps around it.
        */}
      <span className="font-bold text-base min-w-0">{lineName}</span>
      <span className="ml-auto shrink-0 text-sm font-semibold text-slate-700 whitespace-nowrap">{frequency}</span>
    </li>
  )
}

interface Props {
  rows: readonly HeadwayRow[]
}

export default function FrequencyList({ rows }: Props) {
  if (rows.length === 0) return null

  return (
    <section aria-label="Frekuensi kendaraan di halte ini">
      <ul className="rounded-xl overflow-hidden shadow-lg">
        {rows.map(row => <FrequencyRow key={row.line} row={row} />)}
      </ul>
      <p className="mt-3 px-1 text-sm text-gray-600">
        Hanya perkiraan. Harap cek layar halte atau tanyakan pramusapa
      </p>
    </section>
  )
}
