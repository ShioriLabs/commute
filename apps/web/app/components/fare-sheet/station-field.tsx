import type { PickableStation } from './pickable-station'
import EndpointMark from './endpoint-mark'
import { endpointRoundelLines } from './journeys'

/*
 * How deep this field stacks a stop's lines.
 *
 * Two, where the map rail takes three: the stack grows leftward out of the mark
 * column, and this field has only its card's `px-4` to grow into before the
 * wrapper's `overflow-hidden` slices the third roundel against a rounded corner
 * — which reads as a rendering fault rather than as a deck. The rail sits in a
 * card with room to spare, so it keeps the deeper stack.
 */
const FIELD_ROUNDEL_MAX = 2

interface Props {
  label: string
  station: PickableStation | null
  onClick: () => void
}

/*
 * One end of a fare query — the tappable "Dari"/"Ke" field that opens the
 * station picker. Purely presentational: the parent owns the selection, decides
 * what tapping does, and — since Dari and Ke sit in one shared card — owns the
 * rounded/bordered surface and the divider between the two fields.
 *
 * Signed with the stop's own lines, never a ridden one. There is no journey in
 * scope at an input: the answer renders below it, and this is where a rider
 * comes to CHANGE the query, so a roundel naming the line of a route they are
 * about to discard would be describing the wrong thing. The rail card can sign
 * a ride because the rail card is the summary of one.
 *
 * The label stays beside the mark rather than giving up its slot. It is the
 * button's only accessible name, and "Dari"/"Ke" is what says which end this is
 * before a station has been picked at all.
 */
export default function StationField({ label, station, onClick }: Props) {
  const marks = endpointRoundelLines(station, null, FIELD_ROUNDEL_MAX)

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left px-4 py-2.5 pr-16 bg-stone-100/80 cursor-pointer"
    >
      {/*
        * A fixed width, not an intrinsic one: "Dari" is wider than "Ke", so
        * letting each label size itself started the two rows' marks and names on
        * different x and left the card looking ragged down its left edge. Sized
        * to the longer of the two, which is what the column has to hold anyway.
        */}
      <span className="w-8 shrink-0 text-sm font-semibold text-slate-500">{ label }</span>
      <EndpointMark marks={marks} />
      {station
        ? <b className="truncate">{ station.name }</b>
        : <span className="text-slate-400">Pilih stasiun</span>}
    </button>
  )
}
