import { useState } from 'react'
import { CloseButton, DialogTitle } from '@headlessui/react'
import { XIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useSearchParams } from 'react-router'
import { buildFareShareUrl } from 'utils/fare-url'
import FarePanel from './fare-panel'
import { useFareQuery } from './use-fare-query'

// Rendered inside a headlessui Dialog in both contexts: the homepage
// SheetButton morph and the standalone /fare route (which wraps it in an
// always-open Dialog, same as the /settings route) — so CloseButton works.
//
// This is the canonical home of fare deep links: functions/_middleware.ts only
// SEO-decorates `/fare`, the OG image worker is keyed on it, and the sitemap
// lists it. The search sheet renders the same FarePanel but never writes these
// URLs — see use-fare-query.ts.
export default function FareSheet() {
  const [searchParams] = useSearchParams()
  const [copied, setCopied] = useState(false)

  // On the homepage the sheet lives behind a faked URL (SheetButton pushStates
  // '/fare' while the router still thinks it's on '/'), so setSearchParams
  // would resolve against '/' and stomp the pathname. Write the query string
  // directly instead; window.location.pathname is '/fare' in both contexts,
  // and keeping history.state intact preserves SheetButton's modalOpen flag.
  const updateUrlParams = (fromId: string, toId: string) => {
    const params = new URLSearchParams({ from: fromId, to: toId })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`)
  }

  const query = useFareQuery({
    initialPair: { fromId: searchParams.get('from'), toId: searchParams.get('to') },
    onPairChange: updateUrlParams,
    syncDocumentTitle: true
  })
  const { origin, destination } = query

  const handleShare = async () => {
    // Built from the pair rather than read from window.location.href: the same
    // helper serves the search sheet, where the address bar says /search.
    const url = buildFareShareUrl(origin?.id, destination?.id, window.location.origin)
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
    <section className="bg-white w-screen h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className="p-8 pb-4 max-w-3xl mx-auto">
        <div className="flex gap-4 items-center justify-between">
          <DialogTitle className="font-bold text-2xl">Cek Tarif</DialogTitle>
          <div className="flex gap-4">
            {origin && destination && (
              <button
                type="button"
                onClick={handleShare}
                aria-label="Bagikan rute ini"
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                {copied ? <span className="text-[10px] font-bold text-green-600">✓</span> : <ShareNetworkIcon weight="bold" className="w-6 h-6" />}
              </button>
            )}
            <CloseButton
              aria-label="Tutup halaman cek tarif"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </CloseButton>
          </div>
        </div>

        <FarePanel query={query} />
      </div>
    </section>
  )
}
