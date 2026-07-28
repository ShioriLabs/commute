import type { Line, OperatorWithLines, StandardResponse } from '@commute/schemas'
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'

/*
 * The line dictionary.
 *
 * API responses refer to lines by key (`KCI:C`) rather than repeating each
 * line's name and colour everywhere it appears — a station carrying full Line
 * objects made `/stations` mostly duplication. `/operators` is where those keys
 * resolve, and it is small, static and cached, so every surface that renders a
 * roundel reads it from here.
 */

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

export interface LineLookup {
  /** Resolve one key. Undefined when the dictionary hasn't loaded yet. */
  line: (key: string | undefined) => Line | undefined
  /** Resolve a list of keys, dropping any that don't resolve. */
  lines: (keys: readonly string[] | undefined) => Line[]
  /** The operator a key belongs to, without a dictionary round trip. */
  operatorOf: (key: string) => string | undefined
  isLoading: boolean
}

/** `KCI:C` -> `KCI`. Cheap enough to do inline; no dictionary needed. */
export function operatorOfLineKey(key: string): string | undefined {
  const [operator] = key.split(':')
  return operator || undefined
}

/** `KCI:C` -> `C`, the bare code a roundel displays. */
export function codeOfLineKey(key: string): string {
  const [, code] = key.split(':')
  return code ?? key
}

export function useLines(): LineLookup {
  const { data, isLoading } = useSWR<StandardResponse<OperatorWithLines[]>>(
    new URL('/operators', import.meta.env.VITE_API_BASE_URL).href,
    fetcher,
    swrConfig
  )

  const dictionary = useMemo(() => {
    const index = new Map<string, Line>()
    for (const operator of data?.data ?? []) {
      for (const line of operator.lines) {
        index.set(`${operator.code}:${line.lineCode}`, line)
      }
    }
    return index
  }, [data])

  const line = useCallback((key: string | undefined) => (key ? dictionary.get(key) : undefined), [dictionary])

  const lines = useCallback(
    (keys: readonly string[] | undefined) =>
      (keys ?? []).map(key => dictionary.get(key)).filter((entry): entry is Line => entry !== undefined),
    [dictionary]
  )

  return { line, lines, operatorOf: operatorOfLineKey, isLoading }
}
