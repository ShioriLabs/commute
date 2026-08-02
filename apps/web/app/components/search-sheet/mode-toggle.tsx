import clsx from 'clsx'
import { haptic } from 'utils/haptics'
import type { SearchMode } from 'utils/search-mode'

interface Props {
  mode: SearchMode
  onChange: (mode: SearchMode) => void
}

const OPTIONS: { value: SearchMode, label: string }[] = [
  { value: 'STATION', label: 'Satu stasiun' },
  { value: 'FARE', label: 'Rute & tarif' }
]

// Switches the sheet between looking up one station and routing between two.
// A tablist rather than a radiogroup: each option swaps the panel below it,
// which is what `tab`/`tabpanel` semantics describe to a screen reader.
export default function SearchModeToggle({ mode, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Mode pencarian"
      className="mt-4 inline-flex gap-0.5 p-1 rounded-full bg-stone-100/80 border-2 border-stone-200/40"
    >
      {OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={`search-mode-tab-${option.value}`}
          aria-selected={mode === option.value}
          aria-controls={`search-mode-panel-${option.value}`}
          onClick={() => {
            if (mode === option.value) return
            haptic()
            onChange(option.value)
          }}
          className={clsx(
            'text-sm font-bold px-4 py-1.5 rounded-full cursor-pointer transition-colors',
            mode === option.value ? 'bg-[#F55875] text-white' : 'text-slate-500'
          )}
        >
          { option.label }
        </button>
      ))}
    </div>
  )
}
