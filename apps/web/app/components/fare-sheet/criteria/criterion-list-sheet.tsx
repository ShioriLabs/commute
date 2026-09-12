import type { ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useIsEmbed } from '~/hooks/use-is-embed'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
}

/*
 * The settings list behind the "Atur" button: every criterion in one sheet.
 *
 * A shell, not a control. It owns the surface and nothing else, because each
 * row opens its own CriterionSheet and the rows themselves are built in
 * criteria-bar.tsx where the labels and the current values already live.
 *
 * Deliberately the same scrim, panel, radius, spring and header as
 * criterion-sheet.tsx — a rider tapping from this list into one criterion
 * should see the same kind of object slide up, not a second visual language.
 * Content-sized for the same reason too: four rows in a full-height panel would
 * read as a navigation rather than a setting.
 */
export default function CriterionListSheet({ open, onClose, children }: Props) {
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
              <h2 className="font-bold text-2xl">Pengaturan</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup pengaturan"
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                <XIcon weight="bold" className="w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="pb-8 max-w-3xl mx-auto">
            { children }
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
