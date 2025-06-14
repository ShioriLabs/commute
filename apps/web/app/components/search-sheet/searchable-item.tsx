import type { Line } from 'models/line'
import type { Searchable } from 'models/searchable'
import { useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { getForegroundColor } from 'utils/colors'

interface Props {
  searchable: Searchable
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
}

export default function SearchableItem({ searchable, onClick }: Props) {
  const dataset = useMemo(() => {
    if (!searchable.data) return {}
    return Object.fromEntries(
      Object.entries(searchable.data).map(([key, value]) => [`data-${key}`, value.toString()])
    )
  }, [searchable.data])

  return (
    <li>
      <Link
        to={searchable.to}
        className="px-8 py-4 flex flex-col gap-1 min-h-24 text-lg"
        onClick={onClick}
        replace
        {...dataset}
      >
        <b>
          {searchable.title}
          {searchable.subtitle
            ? (
                <>
              &nbsp;&nbsp;
                  <span className="text-sm font-semibold text-gray-600">{searchable.subtitle}</span>
                </>
              )
            : null}
        </b>
        { searchable.type === 'STATION' && (searchable as Searchable<Line[]>).body?.length
          ? (
              <ul className="flex flex-row gap-1 flex-wrap">
                {(searchable as Searchable<Line[]>).body!.map(line => (
                  <li
                    key={line.lineCode}
                    className={`text-sm font-semibold px-2.5 py-1 rounded-full text-stone-800 ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                    style={{ backgroundColor: line.colorCode }}
                  >
                    {line.name.replace(/Lin /g, '')}
                  </li>
                ))}
              </ul>
            )
          : null}
      </Link>
    </li>
  )
}
