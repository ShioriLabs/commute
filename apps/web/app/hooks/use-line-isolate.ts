import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_LINE_ISOLATE,
  readLineIsolate,
  writeLineIsolate,
  type LineIsolate
} from 'utils/line-isolate'

/**
 * Whether line isolation is switched on, and whether that choice has been read.
 *
 * `ready` exists for the same reason useFareRouter's does: the stored value
 * cannot be read during render — this module is bundled for a tree that also
 * prerenders, where localStorage does not exist — so the first paint always says
 * off. Callers that would otherwise fetch or render on the strength of that
 * should wait for `ready` rather than acting on the default.
 */
export function useLineIsolate() {
  const [isolate, setIsolateState] = useState<LineIsolate>(DEFAULT_LINE_ISOLATE)
  const [ready, setReady] = useState(false)

  // Read after mount rather than in the initial state, and once, like the
  // router hook beside it.
  useEffect(() => {
    setIsolateState(readLineIsolate())
    setReady(true)
  }, [])

  const setIsolate = useCallback((next: LineIsolate) => {
    writeLineIsolate(next)
    setIsolateState(next)
  }, [])

  return { enabled: isolate === 'on', ready, setIsolate }
}
