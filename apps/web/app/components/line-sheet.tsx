import { XIcon, ArrowSquareOutIcon } from '@phosphor-icons/react'
import DetailSurface from './detail-surface'
import ExitLink from './exit-link'
import LineRoundel from './line-roundel'
import LineContent, { useLineHeader } from './line-content'

/*
 * The line a rider tapped on the map, as a surface over it.
 *
 * Same shape as the station and hub sheets — DetailSurface handles the sidebar
 * on a wide viewport and the bottom sheet on a phone — so a tapped line reads
 * like every other thing the map opens.
 */

interface LineSheetProps {
  // `operator:code`, the key the map isolates by. Null when nothing is open.
  lineKey: string | null
  onClose: () => void
  onDismissStart?: () => void
}

export default function LineSheet({ lineKey, onClose, onDismissStart }: LineSheetProps) {
  const [operator, code] = lineKey ? lineKey.split(':') : [null, null]
  const open = !!(operator && code)

  return (
    <DetailSurface
      open={open}
      onClose={onClose}
      onDismissStart={onDismissStart}
      ariaLabel="Detail lin"
      header={close => (operator && code
        ? <SheetHeader operator={operator} code={code} onClose={close} />
        : null)}
    >
      {ready => (ready && operator && code
        ? <LineContent operator={operator} code={code} />
        : (
            <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          ))}
    </DetailSurface>
  )
}

function SheetHeader({ operator, code, onClose }: { operator: string, code: string, onClose: () => void }) {
  const { header } = useLineHeader(operator, code)
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {header.isLoading
          ? (
              <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
            )
          : (
              <>
                {header.colorCode && (
                  <LineRoundel
                    size="SM"
                    code={header.lineCode ?? code}
                    color={header.colorCode as `#${string}`}
                    operator={header.operator ?? operator}
                  />
                )}
                <h2 className="font-bold text-xl truncate">{header.name}</h2>
              </>
            )}
      </div>
      {/*
        TJ has no line-detail page, so the same rule the line cards use applies
        here: link out only where there is something to link to.
      */}
      {operator !== 'TJ' && (
        <ExitLink
          to={`/lines/${operator}/${code}`}
          aria-label="Buka halaman lin lengkap"
          className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100"
        >
          <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
        </ExitLink>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup detail lin"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
      >
        <XIcon weight="bold" className="w-5 h-5" />
      </button>
    </div>
  )
}
