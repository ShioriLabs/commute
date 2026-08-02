import type { PickableStation } from './pickable-station'

interface Props {
  label: string
  station: PickableStation | null
  onClick: () => void
}

// One end of a fare query — the tappable "Dari"/"Ke" field that opens the
// station picker. Purely presentational: the parent owns the selection and
// decides what tapping does.
export default function StationField({ label, station, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 w-full text-left px-4 py-3 pr-16 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 cursor-pointer"
    >
      <span className="text-sm font-semibold text-slate-500">{ label }</span>
      {station
        ? <b className="truncate w-full">{ station.name }</b>
        : <span className="text-slate-400">Pilih stasiun</span>}
    </button>
  )
}
