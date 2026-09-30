import type { Searchable } from '@commute/schemas'
import { memo, useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { PushPinIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { getForegroundColor } from 'utils/colors'
import { LIST_STAGGER, staggerDelay } from 'utils/stagger'
import HighlightMatch from '~/components/highlight-match'
import LineRoundel from '~/components/line-roundel'

interface Props {
  // The resolved union: useSearchables swaps each entry's line keys for the
  // lines themselves before anything renders.
  searchable: Searchable
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  // Query text to highlight inside the title (substring hits only; pure-fuzzy
  // matches render plain).
  query?: string
  // Position in the result list, drives the staggered entrance delay.
  index?: number
  /*
   * Pin state, for STATION rows only: saved-stations holds station ids, so a
   * hub or a line has nothing to pin. The toggle reads the id back off the
   * button's dataset (like onClick does off the link) so one stable callback
   * serves every row and memo() still bails out per keystroke.
   */
  saved?: boolean
  onToggleSave?: (e: MouseEvent<HTMLButtonElement>) => void
}

// Memoized: rendered from the deferred filter pass, so the urgent keystroke
// render must bail out here — otherwise every result re-renders per keystroke
// and blocks the input.
export default memo(function SearchableItem({ searchable, onClick, query, index = 0, saved = false, onToggleSave }: Props) {
  const dataset = useMemo(() => {
    if (!searchable.data) return {}
    return Object.fromEntries(
      Object.entries(searchable.data).map(([key, value]) => [`data-${key}`, value.toString()])
    )
  }, [searchable.data])

  // Narrowing proves the shape: a LINE carries exactly one line, a station or
  // hub carries a list. Neither can be read as the other.
  const lineBody = searchable.type === 'LINE' ? searchable.line : undefined
  const lines = searchable.type === 'LINE' ? [] : searchable.lines
  const stationId = searchable.type === 'STATION' ? searchable.data?.['station-id'] : undefined

  // Unlike the fare picker, every row animates — this list is short enough that
  // rows past the cap sharing the maximum delay reads fine.
  //
  // The hairline starts at the text edge and runs off the right, the way JR
  // East's history list separates rows without boxing them in.
  return (
    <li
      className="search-result-enter relative flex items-center ps-8 pe-4 after:absolute after:bottom-0 after:left-8 after:right-0 after:h-px after:bg-stone-200/70 last:after:hidden"
      style={{ animationDelay: staggerDelay(index, LIST_STAGGER) }}
    >
      <Link
        to={searchable.to}
        className="flex flex-1 min-w-0 items-center py-3 min-h-16"
        onClick={onClick}
        replace
        {...dataset}
      >
        {/* Marks sit under the name rather than beside it: a hub can carry a
            dozen lines, which a right-aligned column cannot hold. */}
        <span className="flex flex-col gap-1 min-w-0">
          <span className="font-bold text-lg leading-tight">
            <HighlightMatch text={searchable.title} query={query} />
            {searchable.subtitle
              ? <span className="ms-2 text-sm font-semibold text-slate-500">{searchable.subtitle}</span>
              : null}
          </span>
          { lines.length > 0
            ? (
                <ul className="flex flex-row gap-1 flex-wrap">
                  {lines.map(line => (
                    <li key={line.lineCode}>
                      {/* Drives TJ roundel style. Read off the line itself, not
                          the entry: a hub spans operators and carries none. */}
                      <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={line.operator} />
                      <span className="sr-only">{line.name}</span>
                    </li>
                  ))}
                </ul>
              )
            : null}
          { lineBody
            ? (
                <span
                  className={`w-fit text-sm font-semibold px-3 py-0.5 rounded-full ${getForegroundColor(lineBody.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                  style={{ backgroundColor: lineBody.colorCode }}
                >
                  {lineBody.name.replace(/^Lin /, '')}
                </span>
              )
            : null}
        </span>
      </Link>
      {stationId && onToggleSave
        ? (
            <button
              type="button"
              onClick={onToggleSave}
              data-station-id={stationId}
              aria-pressed={saved}
              aria-label={saved ? `Lepas pin ${searchable.title}` : `Pin ${searchable.title}`}
              className={clsx(
                'shrink-0 w-11 h-11 rounded-full flex items-center justify-center cursor-pointer transition-colors duration-150 ease',
                saved ? 'text-[#F55875]' : 'text-slate-300 hover:text-slate-400'
              )}
            >
              <PushPinIcon weight={saved ? 'fill' : 'bold'} className="w-6 h-6" />
            </button>
          )
        : null}
    </li>
  )
})
