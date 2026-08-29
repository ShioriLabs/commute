import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { CheckCircleIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { haptic } from 'utils/haptics'
import { useIsEmbed } from '~/hooks/use-is-embed'

export interface CriterionOption<T extends string> {
  value: T
  label: string
  /**
   * The reason this sheet exists rather than an inline toggle: a chip has room
   * for a value, not for what the value means.
   */
  description?: string
}

interface Props<T extends string> {
  open: boolean
  title: string
  options: CriterionOption<T>[]
  selected: T
  onSelect: (value: T) => void
  onClose: () => void
}

/*
 * One generic single-select sheet for every criterion.
 *
 * Headless UI Dialog rather than components/bottom-sheet.tsx, deliberately.
 * BottomSheet sits on z-detail-surface, below this Dialog's z-modal; it is non-modal on
 * purpose (the map stays interactive beneath it), and it drives scrollTop by
 * hand under touch-action: none, which would fight the search sheet's own
 * overflow-y-auto. StationPickerDialog already proves this Dialog idiom nests
 * correctly inside the search sheet, which is the case that matters most.
 *
 * FarePanel renders in three places — /fare, the home search sheet, and bare
 * /search with no Dialog at all — so this has to stand on its own in all three.
 */
export default function CriterionSheet<T extends string>({
  open,
  title,
  options,
  selected,
  onSelect,
  onClose
}: Props<T>) {
  const isEmbed = useIsEmbed()

  const choose = (value: T) => {
    haptic()
    onSelect(value)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-modal">
      {/* Matches the station picker's dark scrim so the two sheets read as the
          same surface rather than two different affordances. The scrim keeps
          ease-out while the panel springs: a fade has no travel to give weight
          to, and the spring's fast front-load would land it ahead of the panel
          it belongs to. */}
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/25 duration-300 ease-out data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen items-end">
        <DialogPanel
          transition
          // Content-sized, unlike the picker's full-height panel: this is a
          // short radio list, and a full-screen sheet for three rows would feel
          // like a navigation rather than a setting.
          //
          // dvh vs vh: see fare.tsx / use-is-embed.ts.
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
                aria-label={`Tutup pilihan ${title.toLowerCase()}`}
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                <XIcon weight="bold" className="w-6 h-6" />
              </button>
            </div>
          </div>
          {/* No autofocus: the primary action is tapping a row, and stealing
              focus onto a radio serves nobody. It also keeps this clear of the
              search sheet's refocus effect, which only runs in STATION mode. */}
          <div role="radiogroup" aria-label={title} className="pb-8 max-w-3xl mx-auto">
            {options.map((option) => {
              const isSelected = option.value === selected
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => choose(option.value)}
                  className={`px-8 py-3 flex items-center gap-3 w-full text-left cursor-pointer ${isSelected ? 'bg-rose-50' : 'hover:bg-rose-50/60'}`}
                >
                  <span className="flex flex-col gap-1 flex-1 min-w-0">
                    <b className="text-lg">{ option.label }</b>
                    {option.description
                      ? <span className="text-sm text-slate-500">{ option.description }</span>
                      : null}
                  </span>
                  {isSelected
                    ? <CheckCircleIcon weight="fill" className="w-6 h-6 shrink-0 text-[#F55875]" aria-hidden="true" />
                    : null}
                </button>
              )
            })}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
