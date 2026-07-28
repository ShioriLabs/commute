import type { Line } from '@commute/schemas'
import type { Searchable } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { useMemo } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'

/*
 * The search index, prebuilt by GET /_internal/searchables.
 *
 * This replaces the /stations + /hubs + /operators fan-out the search sheet used
 * to do: three round trips and ~257 KB of station columns, most of which search
 * never read, followed by rebuilding the same index client-side on every mount.
 * The server now emits `Searchable` directly, with directional halte pairs
 * already folded.
 *
 * Line names and colours arrive once in a dictionary rather than repeated across
 * every entry, so `body` is rehydrated from keys here — the only client-side
 * shaping left.
 */

interface SearchableLine {
  name: string
  lineCode: string
  colorCode: `#${string}`
  operator: string
}

// On the wire `body` is a list of keys into `lines`; the client hands
// components a Line[].
interface RawSearchable extends Omit<Searchable, 'body'> {
  body?: string[]
}

interface SearchableIndex {
  lines: Record<string, SearchableLine>
  items: RawSearchable[]
}

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

export interface UseSearchablesResult {
  searchables: Searchable<Line[]>[]
  isLoading: boolean
}

export function useSearchables(): UseSearchablesResult {
  const { data, isLoading } = useSWR<StandardResponse<SearchableIndex>>(
    new URL('/_internal/searchables', import.meta.env.VITE_API_BASE_URL).href,
    fetcher,
    swrConfig
  )

  const searchables = useMemo<Searchable<Line[]>[]>(() => {
    const index = data?.data
    if (!index) return []

    return index.items.map((item) => {
      const lines: Line[] = []
      for (const key of item.body ?? []) {
        // Keys are operator-qualified ("KCI:C"), so a hub spanning operators
        // resolves unambiguously. A miss would render a colourless roundel; the
        // API guarantees against it, and an API test enforces that.
        const entry = index.lines[key]
        if (!entry) continue
        lines.push({
          name: entry.name,
          lineCode: entry.lineCode,
          colorCode: entry.colorCode
        })
      }

      return { ...item, body: lines }
    })
  }, [data])

  return { searchables, isLoading }
}
