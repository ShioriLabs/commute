import { MapTrifoldIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { useEffect, useRef, type MouseEvent } from 'react'
import clsx from 'clsx'
import { useMapMorph } from '~/components/map-morph'
import { MAP_MANIFEST_URL, MAP_PREVIEW_URL } from '~/lib/map-assets'

interface Props {
  className?: string
}

export default function MapButton({ className }: Props) {
  const morph = useMapMorph()

  // The manifest is max-age=300 (public/_headers), so a throwaway fetch warms
  // the HTTP cache and the map route's SWR resolves without a round-trip.
  // The preview warms the no-service-worker/dev path.
  const warmedRef = useRef(false)
  const warmUp = () => {
    if (warmedRef.current) return
    warmedRef.current = true
    void fetch(MAP_MANIFEST_URL).catch(() => {})
    // Must be the identical URL MapPreviewBackdrop's <img> asks for. Both were
    // bare until now, which was accidentally coherent; the moment one is
    // stamped and the other isn't, this warms a URL nothing reads *and* keeps
    // the unversioned year-long immutable HTTP entry alive. Sharing one
    // constant makes drifting apart impossible.
    void fetch(MAP_PREVIEW_URL).catch(() => {})
    // The skeleton is a separate JS chunk, so it has to be in memory before the
    // morph lands or the draw is skipped for that visit.
    morph.prefetch()
  }

  // Touch has no hover, and touchstart→click is far too short a window for the
  // module work below to finish — so warm the JS at idle once the card is on
  // screen. Only morph.prefetch, not the full warmUp: the module evaluations are
  // the expensive main-thread tasks that otherwise land mid-draw, while the two
  // fetches are cheap on intent and the manifest's max-age=300 could lapse
  // between an idle warm and a much later tap.
  const morphPrefetch = morph.prefetch
  useEffect(() => {
    if (typeof requestIdleCallback !== 'function') {
      const timer = setTimeout(morphPrefetch, 2000)
      return () => clearTimeout(timer)
    }
    const idle = requestIdleCallback(morphPrefetch)
    return () => cancelIdleCallback(idle)
  }, [morphPrefetch])

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Plain left-click only: cmd/ctrl/shift/alt-click and non-primary buttons
    // must keep stock Link behavior (new tab etc.) with no overlay hijack.
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    ) return
    // No preventDefault and no manual navigate: the Link runs this handler
    // first and navigates in the same event, and the overlay lives in the
    // persistent layout, so home unmounting can't kill it mid-morph.
    morph.start(event.currentTarget)
  }

  return (
    <Link
      to="/map"
      prefetch="intent"
      onPointerEnter={warmUp}
      onFocus={warmUp}
      onTouchStart={warmUp}
      onClick={handleClick}
      className={clsx('bg-white p-4 rounded-xl shadow-2xs w-screen h-screen max-w-42 max-h-32 border-2 border-rose-50 flex flex-col relative overflow-clip select-none text-left cursor-pointer scale-100 lg:hover:scale-105 transition-transform transform-gpu ease-in-out shrink-0', className)}
      aria-label="Lihat peta integrasi"
    >
      <div className="absolute -bottom-5 -right-5 rounded-full bg-slate-100 p-4 z-[1]">
        <MapTrifoldIcon weight="fill" className="w-12 h-12 text-slate-700" />
      </div>
      <b className="z-[2]">
        Lihat
      </b>
      <span className="leading-tight z-[2]">
        Peta
        <br />
        Integrasi
      </span>
    </Link>
  )
}
