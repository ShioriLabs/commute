import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useEffect } from 'react'
import SheetButton from './sheet-button'
import SearchSheet from '../search-sheet'
import { prefetchSearchables } from '~/hooks/use-searchables'

interface Props {
  className?: string
}

export default function SearchStationsButton({ className }: Props) {
  // The index the sheet searches is only requested once the sheet mounts, which
  // is the tap that opens it — the fetch then lands ~250ms in, alongside the
  // open commit, and the sheet shows its loading state on the way. Warm it at
  // idle instead, the same way the map card warms its morph chunk.
  //
  // Deliberately here and not in the sheet: SearchSheet does not render until
  // the dialog opens, so a prefetch inside it would run no earlier than the
  // fetch it is meant to replace.
  useEffect(() => {
    if (typeof requestIdleCallback !== 'function') {
      const timer = setTimeout(prefetchSearchables, 2000)
      return () => clearTimeout(timer)
    }
    const idle = requestIdleCallback(prefetchSearchables)
    return () => cancelIdleCallback(idle)
  }, [])

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
