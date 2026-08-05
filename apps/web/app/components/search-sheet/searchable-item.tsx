import type { Line } from '@commute/schemas'
import type { Searchable } from '@commute/schemas'
import { memo, useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { getForegroundColor } from 'utils/colors'
import { LIST_STAGGER, staggerDelay } from 'utils/stagger'
import HighlightMatch from '~/components/highlight-match'
import LineRoundel from '~/components/line-roundel'

interface Props {
  // Always the rehydrated shape: useSearchables resolves the wire's line keys
  // into Line[] for every item type before anything renders.
  searchable: Searchable<Line[]>
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  // Query text to highlight inside the title (substring hits only; pure-fuzzy
  // matches render plain).
  query?: string
  // Position in the result list, drives the staggered entrance delay.
  index?: number
}

/*
 * The single Line a LINE result renders as a chip, or undefined for any other
 * type.
 *
 * `body` is a Line[] for EVERY type — useSearchables rehydrates the wire's line
 * keys into one before anything renders — and a LINE simply carries exactly
 * one. Reading `body.colorCode` directly (as this component used to, via a
 * `Searchable<Line>` cast) yields undefined and crashes getForegroundColor on
 * any query that surfaces a line, e.g. "si" -> "Lin Bekasi".
 */
export function lineOf(searchable: Searchable<Line[]>): Line | undefined {
  return searchable.type === 'LINE' ? searchable.body?.[0] : undefined
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

  const lineBody = lineOf(searchable)

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
        { (searchable.type === 'STATION' || searchable.type === 'HUB') && searchable.body?.length
          ? (
              <ul className="flex flex-row gap-1 flex-wrap">
                {searchable.body.map(line => (
                  <li key={line.lineCode}>
                    {/* Drives TJ roundel style. Absent on hubs, which span operators. */}
                    <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={searchable.operator} />
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
