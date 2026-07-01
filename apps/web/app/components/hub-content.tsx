import { memo, useMemo } from 'react'
import { Link } from 'react-router'
import { CaretRightIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import type { StandardResponse } from '@schema/response'
import type { Hub } from 'models/hub'
import { fetcher } from 'utils/fetcher'
import { getForegroundColor } from 'utils/colors'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

interface HubContentProps {
  slug: string
}

export interface HubHeader {
  isLoading: boolean
  name: string | null
  hubId: string | null
}

interface UseHubDataResult {
  header: HubHeader
}

export function useHubHeader(slug: string): UseHubDataResult {
  const hubUrl = useMemo(() =>
    new URL(`/hubs/${slug}`, import.meta.env.VITE_API_BASE_URL).href,
  [slug]
  )
  const hub = useSWR<StandardResponse<Hub>>(hubUrl, fetcher, swrConfig)
  return {
    header: {
      isLoading: hub.isLoading,
      name: hub.data?.data?.name ?? null,
      hubId: hub.data?.data?.id ?? null
    }
  }
}

// Renders a hub as a compact list of its member stations, each linking to that
// station's own page. Members are ordered by the API (hubStations.position).
const HubContent = memo(function HubContent({ slug }: HubContentProps) {
  const hubUrl = useMemo(() =>
    new URL(`/hubs/${slug}`, import.meta.env.VITE_API_BASE_URL).href,
  [slug]
  )
  const hub = useSWR<StandardResponse<Hub>>(hubUrl, fetcher, swrConfig)

  if (hub.isLoading) {
    return (
      <ul className="max-w-3xl mx-auto animate-pulse">
        {[0, 1, 2].map(i => (
          <li key={i} className="px-8 py-4">
            <div className="h-4 w-40 bg-slate-200 rounded" />
            <div className="mt-2 h-3 w-24 bg-slate-200 rounded" />
          </li>
        ))}
      </ul>
    )
  }

  const members = hub.data?.data?.members ?? []

  return (
    <ul className="max-w-3xl mx-auto">
      {members.map(member => (
        <li key={member.id}>
          <Link
            to={`/stations/${member.operator.code}/${member.code}`}
            className="px-8 py-4 flex items-center gap-4 border-b border-b-stone-100 last:border-b-0"
          >
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <b className="text-lg">
                {member.formattedName || member.name}
                <span className="text-sm font-semibold text-gray-600">
                  &nbsp;&nbsp;
                  {member.operator.name}
                </span>
              </b>
              {member.lines.length > 0
                ? (
                    <ul className="flex flex-row gap-1 flex-wrap">
                      {member.lines.map(line => (
                        <li
                          key={line.lineCode}
                          className={`text-sm font-semibold px-2.5 py-1 rounded-full ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                          style={{ backgroundColor: line.colorCode }}
                        >
                          {line.name.replace(/Lin /g, '')}
                        </li>
                      ))}
                    </ul>
                  )
                : null}
            </div>
            <CaretRightIcon weight="bold" className="w-5 h-5 text-slate-400 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  )
})

export default HubContent
