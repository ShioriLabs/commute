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
import useSWR, { preload } from 'swr'
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

// One definition of the key, shared by the hook and the prefetch below — a
// second literal here would silently prefetch into a different cache entry.
const searchablesUrl = () =>
  new URL('/_internal/searchables', import.meta.env.VITE_API_BASE_URL).href

/**
 * Warm the index before anything renders it.
 *
 * The search sheet is behind a card on the homepage, so this request used to
 * start on the tap that opens it — measured landing ~250ms in, competing with
 * the open commit for the main thread and leaving the sheet briefly empty.
 * Nothing on the homepage reads the index, so it is fetched here instead,
 * during idle time the page already has.
 *
 * `preload` populates the same SWR cache `useSearchables` reads, so the hook
 * finds it resolved rather than firing a second request. Safe to call more than
 * once: SWR dedupes on the key.
 */
export function prefetchSearchables(): void {
  void preload(searchablesUrl(), fetcher)
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
    searchablesUrl(),
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
