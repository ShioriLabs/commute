import type { PickableStation } from './pickable-station'

interface Props {
  label: string
  station: PickableStation | null
  onClick: () => void
}

// One end of a fare query — the tappable "Dari"/"Ke" field that opens the
// station picker. Purely presentational: the parent owns the selection,
// decides what tapping does, and — since Dari and Ke sit in one shared card —
// owns the rounded/bordered surface and the divider between the two fields.
export default function StationField({ label, station, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left px-4 py-2.5 pr-16 bg-stone-100/80 cursor-pointer"
    >
      <span className="shrink-0 text-sm font-semibold text-slate-500">{ label }</span>
      {station
        ? <b className="truncate">{ station.name }</b>
        : <span className="text-slate-400">Pilih stasiun</span>}
    </button>
  )
}
