import { useState } from 'react'
import { ShareNetworkIcon } from '@phosphor-icons/react'
import { buildFareShareUrl } from 'utils/fare-url'
import type { FareCriteria } from 'utils/fare-criteria'

interface Props {
  fromId: string | null | undefined
  toId: string | null | undefined
  criteria: FareCriteria
}

/*
 * Share the current pair as a /fare deep link.
 *
 * Built from the ids rather than read from window.location.href because the
 * surfaces this renders on do not all live at /fare: the search sheet's address
 * bar says /search, and the map's says /map.
 *
 * Renders nothing until both ends are set — there is no route to share yet, and
 * a disabled control would only ask the rider to wonder why.
 */
export default function FareShareButton({ fromId, toId, criteria }: Props) {
  const [copied, setCopied] = useState(false)

  if (!fromId || !toId) return null

  const handleShare = async () => {
    const url = buildFareShareUrl(fromId, toId, window.location.origin, criteria)
    if (!url) return

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Cek Tarif Commute',
          url
        })
        return
      } catch {
        // User cancelled or share failed, fall back to clipboard.
      }
    }

    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label="Bagikan rute ini"
      className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
    >
      {copied
        ? <span className="text-[10px] font-bold text-green-600">✓</span>
        : <ShareNetworkIcon weight="bold" className="w-6 h-6" />}
    </button>
  )
}
