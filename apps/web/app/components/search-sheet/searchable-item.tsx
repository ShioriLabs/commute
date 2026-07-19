import type { Line } from 'models/line'
import type { Searchable } from 'models/searchable'
import { memo, useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { getForegroundColor } from 'utils/colors'
import HighlightMatch from '~/components/highlight-match'
import LineRoundel from '~/components/line-roundel'

interface Props {
  searchable: Searchable
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  // Query text to highlight inside the title (substring hits only; pure-fuzzy
  // matches render plain).
  query?: string
  // Position in the result list, drives the staggered entrance delay.
  index?: number
}

// Cap the entrance stagger so long lists don't tail off forever (rows sit at
// opacity 0 until their delay elapses). Mirrors the fare picker.
const STAGGER_MAX_INDEX = 12

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

  return (
    <li className="search-result-enter" style={{ animationDelay: `${Math.min(index, STAGGER_MAX_INDEX) * 30}ms` }}>
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
        { (searchable.type === 'STATION' || searchable.type === 'HUB') && (searchable as Searchable<Line[]>).body?.length
          ? (
              <ul className="flex flex-row gap-1 flex-wrap">
                {(searchable as Searchable<Line[]>).body!.map(line => (
                  <li key={line.lineCode}>
                    {/* STATION `to` is /stations/{operator}/{code}; drives TJ roundel style. */}
                    <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={searchable.type === 'STATION' ? searchable.to.split('/')[2] : undefined} />
                    <span className="sr-only">{line.name}</span>
                  </li>
                ))}
              </ul>
            )
          : null}
        { searchable.type === 'LINE' && (searchable as Searchable<Line>).body
          ? (
              <span
                className={`w-fit text-sm font-semibold px-3 py-1 rounded-full ${getForegroundColor((searchable as Searchable<Line>).body!.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                style={{ backgroundColor: (searchable as Searchable<Line>).body!.colorCode }}
              >
                {(searchable as Searchable<Line>).body!.name.replace(/^Lin /, '')}
              </span>
            )
          : null}
      </Link>
    </li>
  )
})
