import { XIcon, ArrowSquareOutIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import BottomSheet from './bottom-sheet'
import HubContent, { useHubHeader } from './hub-content'

interface HubSheetProps {
  slug: string | null
  onClose: () => void
}

export default function HubSheet({ slug, onClose }: HubSheetProps) {
  const open = !!slug

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="Detail stasiun terintegrasi"
      header={close => (slug
        ? <SheetHeader slug={slug} onClose={close} />
        : null)}
    >
      {ready => (ready && slug
        ? <HubContent slug={slug} />
        : (
            <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          ))}
    </BottomSheet>
  )
}

function SheetHeader({ slug, onClose }: { slug: string, onClose: () => void }) {
  const { header } = useHubHeader(slug)
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        {header.isLoading
          ? (
              <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
            )
          : (
              <>
                <h2 className="font-bold text-xl truncate">{header.name}</h2>
                <span className="text-sm font-semibold text-gray-600">Stasiun Terintegrasi</span>
              </>
            )}
      </div>
      <Link
        to={`/hubs/${slug}`}
        aria-label="Buka halaman stasiun terintegrasi lengkap"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100"
      >
        <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
      </Link>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup detail stasiun terintegrasi"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
      >
        <XIcon weight="bold" className="w-5 h-5" />
      </button>
    </div>
  )
}
