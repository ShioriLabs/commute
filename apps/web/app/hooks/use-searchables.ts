import type {
  RawSearchable,
  RawSearchableHub,
  RawSearchableLine,
  RawSearchableStation,
  Searchable,
  SearchableIndex,
  SearchableLine
} from '@commute/schemas'
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
 * every entry, so the keys each entry carries are resolved here — the only
 * client-side shaping left.
 */

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

export interface UseSearchablesResult {
  searchables: Searchable[]
  isLoading: boolean
}

/*
 * Entries as they were shaped before the discriminated union: one `body` field
 * holding line keys, meaning "the lines here" on a station or hub and "the line
 * this IS" (array-wrapped) on a line.
 *
 * Still reachable — a service-worker or SWR cache outlives a deploy — so the
 * old shape is migrated on read rather than left to reach components that no
 * longer expect it.
 */
type LegacySearchable =
  | (Omit<RawSearchableStation, 'lineKeys'> & { body?: string[] })
  | (Omit<RawSearchableHub, 'lineKeys'> & { body?: string[] })
  | (Omit<RawSearchableLine, 'lineKey'> & { body?: string[] })

export function migrateLegacy(item: RawSearchable | LegacySearchable): RawSearchable | null {
  if (!('body' in item) || item.body === undefined) return item as RawSearchable

  const { body, ...rest } = item
  if (rest.type === 'LINE') {
    const [lineKey] = body
    // A line entry with no key can't be rendered — `line` is not optional.
    return lineKey ? { ...rest, lineKey } : null
  }
  return { ...rest, lineKeys: body }
}

export function useSearchables(): UseSearchablesResult {
  const { data, isLoading } = useSWR<StandardResponse<SearchableIndex>>(
    new URL('/_internal/searchables', import.meta.env.VITE_API_BASE_URL).href,
    fetcher,
    swrConfig
  )

  const searchables = useMemo<Searchable[]>(() => {
    const index = data?.data
    if (!index) return []

    /*
     * Keys are operator-qualified ("KCI:C"), so a hub spanning operators
     * resolves unambiguously. A miss would render a colourless roundel; the
     * API guarantees against it, and an API test enforces that.
     */
    const resolve = (key: string): SearchableLine | undefined => index.lines[key]

    const resolved: Searchable[] = []
    for (const raw of index.items) {
      const item = migrateLegacy(raw)
      if (!item) continue

      if (item.type === 'LINE') {
        const { lineKey, ...rest } = item
        const line = resolve(lineKey)
        // Dropped rather than half-built: every consumer may assume `line`.
        if (!line) continue
        resolved.push({ ...rest, line })
        continue
      }

      const { lineKeys, ...rest } = item
      const lines: SearchableLine[] = []
      for (const key of lineKeys) {
        const line = resolve(key)
        if (line) lines.push(line)
      }
      resolved.push({ ...rest, lines })
    }

    return resolved
  }, [data])

  return { searchables, isLoading }
}
