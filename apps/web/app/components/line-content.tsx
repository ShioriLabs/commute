import { memo, useMemo } from 'react'
import useSWR from 'swr'
import type { StandardResponse } from '@schema/response'
import type { LineDetail } from '@commute/schemas'
import { fetcher } from 'utils/fetcher'
import EmptyState from '~/components/empty-state'
import LineStrip from '~/components/line-strip'
import { useNetworkStatus } from '~/hooks/network'

/*
 * A line's stop list, rendered inside a surface rather than on its own page.
 *
 * Shares LineStrip with routes/line.tsx so the map sheet and the standalone page
 * cannot drift on how a line reads — the branch switcher, the loop lollipop and
 * the station rows are all one component. Only the chrome around it differs.
 */

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

const lineUrl = (operator: string, code: string) =>
  new URL(`/lines/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href

export interface LineHeader {
  isLoading: boolean
  name: string | null
  colorCode: string | null
  lineCode: string | null
  operator: string | null
}

/*
 * The header's own read of the line.
 *
 * Split from the body for the same reason the station and hub sheets split
 * theirs: DetailSurface renders its header outside the scrolling region, so the
 * two cannot share a local. SWR dedupes the request, so this costs a cache hit
 * rather than a second fetch.
 */
export function useLineHeader(operator: string, code: string): { header: LineHeader } {
  const url = useMemo(() => lineUrl(operator, code), [operator, code])
  const line = useSWR<StandardResponse<LineDetail>>(url, fetcher, swrConfig)
  const detail = line.data?.data
  return {
    header: {
      isLoading: line.isLoading,
      name: detail?.line.name ?? null,
      colorCode: detail?.line.colorCode ?? null,
      lineCode: detail?.line.lineCode ?? null,
      operator: detail?.operator.code ?? null
    }
  }
}

interface LineContentProps {
  operator: string
  code: string
}

const LineContent = memo(function LineContent({ operator, code }: LineContentProps) {
  const url = useMemo(() => lineUrl(operator, code), [operator, code])
  const { data, error, isLoading, mutate } = useSWR<StandardResponse<LineDetail>>(url, fetcher, swrConfig)
  const networkStatus = useNetworkStatus()
  const detail = data?.data

  if (isLoading) {
    return (
      <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
        <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <EmptyState
        mode={networkStatus === 'OFFLINE' ? 'OFFLINE' : 'ERROR'}
        onRetry={() => void mutate()}
      />
    )
  }

  // Keyed per line so the branch view resets when the sheet swaps lines rather
  // than carrying the previous line's active tail across.
  return <LineStrip key={`${operator}-${code}`} detail={detail} />
})

export default LineContent
