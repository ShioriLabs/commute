import type { CompactLineGroupedTimetable, CompactLineTimetable } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { nextServiceDayOf, serviceDayOf } from 'utils/service-day'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

/**
 * The next service day's version of a line, for "mulai lagi 04.24".
 *
 * Once a line has finished, the train that restarts it runs off TOMORROW's
 * board, and on a Friday night that is Saturday's, which can start later. Only
 * fetched when the two days' boards actually differ (Friday to Sunday
 * evenings, and around holidays); the rest of the week today's board already
 * has tomorrow's first trains, so the lookup hands back `today` untouched.
 */
export function useNextDayTimetable(operator: string, code: string) {
  const now = new Date()
  const day = serviceDayOf(now)
  const nextDay = nextServiceDayOf(now)
  const differs = nextDay !== day

  const next = useSWR<StandardResponse<CompactLineGroupedTimetable>>(
    differs
      ? new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1&day=${nextDay}`, import.meta.env.VITE_API_BASE_URL).href
      : null,
    fetcher,
    swrConfig
  )
  const byLine = useMemo(() => {
    const lines = normalizeGroupedTimetable(next.data?.data)
    return new Map(lines?.map(line => [line.line, line]))
  }, [next.data])

  // Undefined while the next board loads, or when the line does not run then.
  return useCallback(
    (today: CompactLineTimetable): CompactLineTimetable | undefined => differs ? byLine.get(today.line) : today,
    [differs, byLine]
  )
}
