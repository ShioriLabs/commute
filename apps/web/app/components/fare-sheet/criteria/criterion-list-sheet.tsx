import type { ReactNode } from 'react'
import CriteriaSheetShell from './criteria-sheet-shell'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
}

/*
 * The settings list behind the criteria chip: every criterion in one sheet.
 *
 * A shell around a shell, and almost nothing else — it owns the surface's title
 * and its content padding, because each row opens its own CriterionSheet and
 * the rows themselves are built in criteria-bar.tsx where the labels and the
 * current values already live.
 *
 * See CriteriaSheetShell for why this looks identical to the sheets it opens.
 */
export default function CriterionListSheet({ open, onClose, children }: Props) {
  return (
    <CriteriaSheetShell open={open} title="Pengaturan" onClose={onClose}>
      <div className="pb-8 max-w-3xl mx-auto">
        { children }
      </div>
    </CriteriaSheetShell>
  )
}
