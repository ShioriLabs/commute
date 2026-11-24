import { OPERATORS } from '@commute/constants'
import { memo, useMemo } from 'react'
import { CaretRightIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import type { StandardResponse } from '@schema/response'
import type { Hub } from '@commute/schemas'
import { fetcher } from 'utils/fetcher'
import LineRoundel from '~/components/line-roundel'
import StationContent from '~/components/station-content'
import { sortLineKeysForDisplay } from '~/utils/lines'
import { useLines } from '~/hooks/use-lines'
import PaneLink from '~/components/pane-stack/pane-link'
import type { HubSelection } from './hub-switcher'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

/*
 * One fetch shared by a hub's header and body: the tile switcher in the header
 * and the member content below it must agree on the same member list.
 */
export function useHub(slug: string | null): { hub: Hub | null, isLoading: boolean } {
  const hubUrl = useMemo(() => (slug
    ? new URL(`/hubs/${slug}`, import.meta.env.VITE_API_BASE_URL).href
    : null),
  [slug]
  )
  const response = useSWR<StandardResponse<Hub>>(hubUrl, fetcher, swrConfig)
  return { hub: response.data?.data ?? null, isLoading: response.isLoading }
}

export function HubContentSkeleton() {
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

/*
 * A place hub's body: the selected member's own station content. Keyed by
 * member so switching side or operator starts that station fresh instead of
 * carrying the previous one's expanded cards along.
 */
export function HubPlaceContent({ selection, onSelectDeparture, onIsolateLine }: {
  selection: HubSelection
  onSelectDeparture?: () => void
  onIsolateLine?: (key: string) => void
}) {
  const { member } = selection
  return (
    <StationContent
      key={member.id}
      operator={member.operator}
      code={member.code}
      onSelectDeparture={onSelectDeparture}
      onIsolateLine={onIsolateLine}
    />
  )
}

// A `hub`-kind complex (Dukuh Atas, CSW) as a compact list of its member
// stations, each linking to that station's own page. Members are ordered by the
// API (hubStations.position).
const HubContent = memo(function HubContent({ hub }: { hub: Hub }) {
  const { lines: resolveLines } = useLines()

  return (
    <ul className="max-w-3xl mx-auto">
      {hub.members.map(member => (
        <li key={member.id}>
          <PaneLink
            pane={{ kind: 'station', operator: member.operator, code: member.code }}
            className="px-8 py-4 flex items-center gap-4 border-b border-b-stone-100 last:border-b-0"
          >
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <b className="text-lg">
                {member.name}
                <span className="text-sm font-semibold text-gray-600">
                  &nbsp;&nbsp;
                  {OPERATORS[member.operator]?.name ?? member.operator}
                </span>
              </b>
              {member.lines.length > 0
                ? (
                    <ul className="flex flex-row gap-1 flex-wrap">
                      {resolveLines(sortLineKeysForDisplay(member.lines, member.operator)).map(line => (
                        <li key={line.lineCode}>
                          <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={member.operator} />
                          <span className="sr-only">{line.name}</span>
                        </li>
                      ))}
                    </ul>
                  )
                : null}
            </div>
            <CaretRightIcon weight="bold" className="w-5 h-5 text-slate-400 shrink-0" />
          </PaneLink>
        </li>
      ))}
    </ul>
  )
})

export default HubContent
