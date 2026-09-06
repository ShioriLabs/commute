import { describe, expect, it } from 'vitest'
import { isClosed, type ClosedOutcome, type JourneyOutcome } from 'utils/journey-endpoint'

describe('isClosed', () => {
  const closed: ClosedOutcome = { outcome: 'CLOSED', nextServiceAt: '2026-09-06T05:00:00+07:00' }

  it('recognises a closed outcome', () => {
    expect(isClosed(closed)).toBe(true)
  })

  /*
   * The three shapes a build can return have to stay distinguishable: a real
   * body means 200, null means NO_ROUTE, and CLOSED means "not right now, come
   * back at". Confusing the first with the last would serve `{outcome:
   * 'CLOSED'}` to a caller parsing a journey list.
   */
  it('does not mistake a real body or a no-route for closed', () => {
    expect(isClosed(null)).toBe(false)
    expect(isClosed({ journeys: [] } as unknown as JourneyOutcome<object>)).toBe(false)
    expect(isClosed({ outcome: 'OK' } as unknown as JourneyOutcome<object>)).toBe(false)
  })
})
