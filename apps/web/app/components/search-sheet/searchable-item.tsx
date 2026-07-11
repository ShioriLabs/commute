import type { Line } from 'models/line'
import type { Searchable } from 'models/searchable'
import { useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { getForegroundColor } from 'utils/colors'
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

function HighlightMatch({ text, query }: { text: string, query?: string }) {
  if (!query) return <>{text}</>
  const matchIndex = text.toLowerCase().indexOf(query.toLowerCase())
  if (matchIndex === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, matchIndex)}
      <span className="text-[#F55875]">{text.slice(matchIndex, matchIndex + query.length)}</span>
      {text.slice(matchIndex + query.length)}
    </>
  )
}

export default function SearchableItem({ searchable, onClick, query, index = 0 }: Props) {
  const dataset = useMemo(() => {
    if (!searchable.data) return {}
    return Object.fromEntries(
      Object.entries(searchable.data).map(([key, value]) => [`data-${key}`, value.toString()])
    )
  }, [searchable.data])

  return (
    <li className="search-result-enter" style={{ animationDelay: `${index * 30}ms` }}>
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
                    <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} />
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
}
