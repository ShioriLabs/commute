import type { Route } from './+types/line'
import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { XIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import type { StandardResponse } from '@schema/response'
import type { LineDetail } from '@commute/schemas'
import { fetcher } from 'utils/fetcher'
import LineStrip from '~/components/line-strip'
import LineRoundel from '~/components/line-roundel'
import EmptyState from '~/components/empty-state'
import { useNetworkStatus } from '~/hooks/network'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

export function meta() {
  return [
    { title: 'Memuat... - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

export default function LinePage({ params }: Route.ComponentProps) {
  const url = useMemo(
    () => new URL(`/lines/${params.operator}/${params.lineCode}`, import.meta.env.VITE_API_BASE_URL).href,
    [params.operator, params.lineCode]
  )
  const { data, error, isLoading, mutate } = useSWR<StandardResponse<LineDetail>>(url, fetcher, swrConfig)
  const networkStatus = useNetworkStatus()
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  const detail = data?.data

  useEffect(() => {
    if (detail) document.title = `${detail.line.name} - Commute`
  }, [detail])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    } else {
      history.back()
    }
  }, [navigationType, navigate])

  return (
    <div className="bg-white w-full min-h-screen">
      <div className="w-full bg-white/50 backdrop-blur sticky top-0 z-10 border-b-2 border-b-gray-50/20">
        <div className="p-8 pb-4 max-w-3xl mx-auto pointer-events-auto flex gap-4 justify-between">
          <div className="flex flex-col min-w-0">
            {detail
              ? (
                  <>
                    <div className="flex items-start gap-2 min-w-0">
                      <LineRoundel code={detail.line.lineCode} color={detail.line.colorCode} operator={detail.operator.code} />
                      <div className="flex flex-col items-start">
                        <h1 className="font-bold text-xl truncate">{detail.line.name}</h1>
                        <span className="text-sm font-semibold text-gray-600">{detail.operator.name}</span>
                      </div>
                    </div>
                  </>
                )
              : (
                  <div className="animate-pulse w-64 h-6 bg-slate-200 rounded-lg" />
                )}
          </div>
          <button
            onClick={handleBackButton}
            aria-label="Tutup halaman lin"
            className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 cursor-pointer shrink-0"
          >
            <XIcon weight="bold" className="w-6 h-6" />
          </button>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-6 pb-12">
        {isLoading && (
          <div className="max-w-md mx-auto flex flex-col gap-3" aria-hidden>
            <div className="animate-pulse w-40 h-7 bg-slate-200 rounded-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse w-full h-10 bg-slate-200 rounded-lg" />
            ))}
          </div>
        )}
        {!isLoading && (error || !detail) && (
          <EmptyState
            mode={networkStatus === 'OFFLINE' ? 'OFFLINE' : 'ERROR'}
            onRetry={() => void mutate()}
          />
        )}
        {/* Keyed per line so branch-view state resets when navigating between lines. */}
        {!isLoading && detail && <LineStrip key={`${params.operator}-${params.lineCode}`} detail={detail} />}
      </div>
    </div>
  )
}
