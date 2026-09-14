import { CheckCircleIcon } from '@phosphor-icons/react'
import { haptic } from 'utils/haptics'
import CriteriaSheetShell from './criteria-sheet-shell'

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
 * The surface itself is CriteriaSheetShell's — see there for why all three
 * criteria sheets must look identical, and for the Dialog choice.
 */
export default function CriterionSheet<T extends string>({
  open,
  title,
  options,
  selected,
  onSelect,
  onClose
}: Props<T>) {
  const choose = (value: T) => {
    haptic()
    onSelect(value)
    onClose()
  }

  return (
    <CriteriaSheetShell open={open} title={title} onClose={onClose}>
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
                ? <CheckCircleIcon weight="fill" className="w-6 h-6 shrink-0 text-brand" aria-hidden="true" />
                : null}
            </button>
          )
        })}
      </div>
    </CriteriaSheetShell>
  )
}
