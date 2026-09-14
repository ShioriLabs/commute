import type { ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useIsEmbed } from '~/hooks/use-is-embed'

interface Props {
  open: boolean
  /** Heading, and the stem of the close button's accessible name. */
  title: string
  onClose: () => void
  children: ReactNode
}

/*
 * The surface every criteria sheet slides up on.
 *
 * The three sheets under this directory — the settings list, the single-select
 * criterion, and the departure wheels — carried this same block verbatim: same
 * scrim, panel, radius, spring, max-height and padded header with an X. That
 * sameness is deliberate and load-bearing, not incidental: a rider tapping from
 * the settings list into one criterion should see the same kind of object
 * arrive, not a second visual language. Three copies made it a convention held
 * by hand, where one shell makes it structural.
 *
 * Headless UI Dialog rather than components/bottom-sheet.tsx, deliberately.
 * BottomSheet sits on z-detail-surface, below this Dialog's z-modal; it is
 * non-modal on purpose (the map stays interactive beneath it), and it drives
 * scrollTop by hand under touch-action: none, which would fight the search
 * sheet's own overflow-y-auto. StationPickerDialog already proves this Dialog
 * idiom nests correctly inside the search sheet, which is the case that matters
 * most — FarePanel renders on /fare, in the home search sheet, and on bare
 * /search with no Dialog at all, so this has to stand on its own in all three.
 *
 * Content-sized rather than full-height: these are short lists and a set of
 * wheels, and a full-screen panel for three rows would read as a navigation
 * rather than a setting. dvh vs vh: see fare.tsx / use-is-embed.ts.
 *
 * The scrim keeps ease-out while the panel springs — a fade has no travel to
 * give weight to, and the spring's fast front-load would land it ahead of the
 * panel it belongs to.
 *
 * Body only: no autofocus here. The primary action is tapping a row, and
 * stealing focus onto the first control serves nobody. It also keeps these
 * clear of the search sheet's refocus effect, which only runs in STATION mode.
 */
export default function CriteriaSheetShell({ open, title, onClose, children }: Props) {
  const isEmbed = useIsEmbed()

  return (
    <Dialog open={open} onClose={onClose} className="relative z-modal">
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/25 duration-300 ease-out data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen items-end">
        <DialogPanel
          transition
          className={clsx(
            'bg-white w-screen overflow-y-auto rounded-t-2xl will-change-transform transition duration-300 ease-ios-spring data-closed:translate-y-full',
            isEmbed ? 'max-h-[85vh]' : 'max-h-[85dvh]'
          )}
        >
          <div className="p-8 pb-4 max-w-3xl mx-auto">
            <div className="flex gap-4 items-center justify-between">
              <h2 className="font-bold text-2xl">{ title }</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={`Tutup ${title.toLowerCase()}`}
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                <XIcon weight="bold" className="w-6 h-6" />
              </button>
            </div>
          </div>
          { children }
        </DialogPanel>
      </div>
    </Dialog>
  )
}
