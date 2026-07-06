import { XIcon, ArrowSquareOutIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import BottomSheet from './bottom-sheet'
import StationContent, { useStationHeader } from './station-content'

interface StationSheetProps {
  operator: string | null
  code: string | null
  onClose: () => void
  onDismissStart?: () => void
}

export default function StationSheet({ operator, code, onClose, onDismissStart }: StationSheetProps) {
  const open = !!(operator && code)

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      onDismissStart={onDismissStart}
      ariaLabel="Detail stasiun"
      header={close => (operator && code
        ? <SheetHeader operator={operator} code={code} onClose={close} />
        : null)}
    >
      {ready => (ready && operator && code
        ? <StationContent operator={operator} code={code} />
        : (
            <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          ))}
    </BottomSheet>
  )
}

function SheetHeader({ operator, code, onClose }: { operator: string, code: string, onClose: () => void }) {
  const { header } = useStationHeader(operator, code)
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        {header.isLoading
          ? (
              <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
            )
          : (
              <h2 className="font-bold text-xl truncate">{header.formattedName}</h2>
            )}
      </div>
      <Link
        to={`/stations/${operator}/${code}`}
        aria-label="Buka halaman stasiun lengkap"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100"
      >
        <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
      </Link>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup detail stasiun"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
      >
        <XIcon weight="bold" className="w-5 h-5" />
      </button>
    </div>
  )
}
