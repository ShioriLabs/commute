import { useEffect, useState } from 'react'
import { PushPinIcon } from '@phosphor-icons/react'
import { isRouteSaved, toggleSavedRoute } from 'utils/saved-stations'

interface Props {
  fromId: string | null | undefined
  toId: string | null | undefined
  // Replaces the default round icon-button styling, for hosts with their own.
  className?: string
}

/*
 * Pin the current pair to home, where it shows as its next few boardings.
 *
 * Sits beside FareShareButton on every fare surface and follows its rule:
 * nothing until both ends are set. Directional on purpose, so after a swap the
 * pin reads unsaved until the return trip is pinned too.
 *
 * Read in an effect rather than during render because the pair changes under
 * the button (picks, swaps, map taps) and storage is not reactive.
 */
export default function SaveRouteButton({ fromId, toId, className }: Props) {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSaved(!!fromId && !!toId && fromId !== toId && isRouteSaved(fromId, toId))
  }, [fromId, toId])

  if (!fromId || !toId || fromId === toId) return null

  return (
    <button
      type="button"
      onClick={() => setSaved(toggleSavedRoute(fromId, toId))}
      aria-label={saved ? 'Hapus rute ini dari beranda' : 'Simpan rute ini ke beranda'}
      aria-pressed={saved}
      className={className ?? 'rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer'}
    >
      <PushPinIcon weight={saved ? 'fill' : 'bold'} className="w-6 h-6" />
    </button>
  )
}
