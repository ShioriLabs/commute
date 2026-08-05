import type { Searchable } from '@commute/schemas'
import { memo, useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router'
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
}

// Memoized: rendered from the deferred filter pass, so the urgent keystroke
// render must bail out here — otherwise every result re-renders per keystroke
// and blocks the input.
export default memo(function SearchableItem({ searchable, onClick, query, index = 0 }: Props) {
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

  // Unlike the fare picker, every row animates — this list is short enough that
  // rows past the cap sharing the maximum delay reads fine.
  return (
    <li className="search-result-enter" style={{ animationDelay: staggerDelay(index, LIST_STAGGER) }}>
      <Link
        to={searchable.to}
        className="px-8 py-4 flex flex-col gap-1 min-h-24 text-lg"
        onClick={onClick}
        replace
        {...dataset}
      >
        <b>
          <HighlightMatch text={searchable.title} query={query} />
          {searchable.subtitle
            ? (
                <>
              &nbsp;&nbsp;
                  <span className="text-sm font-semibold text-gray-600">{searchable.subtitle}</span>
                </>
              )
            : null}
        </b>
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
                className={`w-fit text-sm font-semibold px-3 py-1 rounded-full ${getForegroundColor(lineBody.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                style={{ backgroundColor: lineBody.colorCode }}
              >
                {lineBody.name.replace(/^Lin /, '')}
              </span>
            )
          : null}
      </Link>
    </li>
  )
})
