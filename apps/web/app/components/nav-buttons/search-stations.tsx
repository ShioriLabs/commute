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
      ariaLabel="Cari stasiun, rute, dan tarif"
      title="Mau ke mana?"
      subtitle={(
        <>
          Cari stasiun
          <br />
          & rute
        </>
      )}
      icon={<MagnifyingGlassIcon weight="bold" className="w-12 h-12 text-white" />}
      className={className}
      accent
    >
      <SearchSheet />
    </SheetButton>
  )
}
