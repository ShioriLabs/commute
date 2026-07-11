import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import SheetButton from './sheet-button'
import SearchSheet from '../search-sheet'

interface Props {
  className?: string
}

export default function SearchStationsButton({ className }: Props) {
  return (
    <SheetButton
      url="/search"
      ariaLabel="Cari stasiun"
      title="Temukan"
      subtitle={(
        <>
          Stasiun
          <br />
          & Lainnya
        </>
      )}
      icon={<MagnifyingGlassIcon weight="bold" className="w-12 h-12 text-slate-700" />}
      className={className}
    >
      <SearchSheet />
    </SheetButton>
  )
}
