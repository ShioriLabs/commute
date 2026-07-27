import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import SheetButton, { type SheetButtonSize } from './sheet-button'
import SearchSheet from '../search-sheet'

interface Props {
  className?: string
  size?: SheetButtonSize
}

export default function SearchStationsButton({ className, size = 'card' }: Props) {
  const iconSize = size === 'compact' ? 'w-5 h-5' : 'w-12 h-12'
  return (
    <SheetButton
      url="/search"
      ariaLabel="Cari stasiun"
      title="Temukan"
      compactLabel="Cari"
      subtitle={(
        <>
          Stasiun
          <br />
          & Lainnya
        </>
      )}
      icon={<MagnifyingGlassIcon weight="bold" className={`${iconSize} text-slate-700`} />}
      size={size}
      className={className}
    >
      <SearchSheet />
    </SheetButton>
  )
}
