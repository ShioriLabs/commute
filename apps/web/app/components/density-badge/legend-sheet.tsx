import { createPortal } from 'react-dom'
import { XIcon } from '@phosphor-icons/react'
import BottomSheet from '~/components/bottom-sheet'
import CrowdIcon from './crowd-icon'
import { DENSITY_LEGEND } from './format'

/*
 * What the crowd icons mean.
 *
 * Portalled to <body>: the station page is often itself inside a sheet, and
 * that sheet's transform would turn this one's `position: fixed` into
 * "fixed to the parent sheet". Appended last, it also stacks above the station
 * sheet at the same z-index.
 */
export default function DensityLegendSheet({ open, onClose }: { open: boolean, onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="Arti ikon keramaian"
      // Opens tall: at peek height the last level is cut off, and a legend
      // missing "Sangat padat" explains the wrong half of the scale.
      initialSnap="full"
      header={close => (
        <div className="flex flex-row items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Perkiraan Keramaian</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Tutup arti ikon keramaian"
            className="shrink-0 -mr-2 rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <XIcon weight="bold" className="w-5 h-5" />
          </button>
        </div>
      )}
    >
      {/*
        Ignores `ready`: the deferral is for heavy bodies that would drop frames
        during the slide. Four static rows don't, and waiting for it showed an
        empty sheet sliding up before the legend appeared. px-6 matches the
        gutter BottomSheet gives the header above.
      */}
      {() => (
        <div className="flex flex-col gap-5 px-6 pt-4 pb-8">
          <ul className="flex flex-col gap-3">
            {DENSITY_LEGEND.map(row => (
              <li key={row.level} className="flex flex-row items-center gap-3">
                <CrowdIcon level={row.level} className="w-7 h-7" />
                <span className="text-sm font-bold text-slate-900">{row.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600">
            Dua ikon dengan tanda ~ menandakan keramaiannya bisa di antara 2 ikon tersebut. Perkiraan keramaian berdasarkan data
            {' '}
            <em>historical</em>
          </p>
        </div>
      )}
    </BottomSheet>,
    document.body
  )
}
