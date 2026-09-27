import { describe, expect, it } from 'vitest'
import type { FareJourney } from '@commute/schemas'
import { byArrival } from './journey-times'

/*
 * Only the fields the ordering reads. A real FareJourney carries legs, fares
 * and labels too, and none of them decide where a card lands.
 */
const journey = (id: string, arrivalAt?: string): FareJourney =>
  ({ id, ...(arrivalAt ? { arrivalAt } : {}) } as unknown as FareJourney)

const idsOf = (journeys: FareJourney[]) => journeys.map(j => (j as unknown as { id: string }).id)

const at = (hhmm: string) => `2026-09-07T${hhmm}:00+07:00`

describe('byArrival', () => {
  it('puts the earliest arrival first', () => {
    const sorted = byArrival([journey('late', at('09:10')), journey('early', at('09:00'))])
    expect(idsOf(sorted)).toEqual(['early', 'late'])
  })

  /*
   * The measured case this exists for: MRTJ-STB -> KCI-CSK returns two journeys
   * on the same lines leaving at the same minute, and the one arriving ten
   * minutes earlier was ranked second because the engine cannot see arrivals.
   */
  it('reorders two journeys that differ only in arrival', () => {
    const sorted = byArrival([journey('0910', at('09:10')), journey('0900', at('09:00'))])
    expect(idsOf(sorted)[0]).toBe('0900')
  })

  /*
   * A mixed list is the normal case, not the exception: a TransJakarta route has
   * no arrival to sort on while the rail route beside it does. Timed rows sort
   * among themselves and untimed ones keep the engine's ranking behind them, so
   * neither half's position is decided by the other half's rule.
   */
  it('sorts the timed rows and keeps the untimed ones behind, in engine order', () => {
    const sorted = byArrival([
      journey('late', at('09:10')), journey('u1'), journey('early', at('09:00')), journey('u2')
    ])
    expect(idsOf(sorted)).toEqual(['early', 'late', 'u1', 'u2'])
  })

  it('leaves the list alone when only one row is timed', () => {
    const sorted = byArrival([journey('u1'), journey('only', at('09:00'))])
    expect(idsOf(sorted)).toEqual(['u1', 'only'])
  })

  it('keeps the engine order when nothing is timed at all', () => {
    const sorted = byArrival([journey('a'), journey('b')])
    expect(idsOf(sorted)).toEqual(['a', 'b'])
  })

  /*
   * Stable on a tie, so journeys arriving the same minute keep the engine's
   * ranking between them — still the better tie-break, and it keeps the order
   * deterministic for the `selectedIndex` the map holds across a render.
   */
  it('leaves equal arrivals in the engine order', () => {
    const sorted = byArrival([journey('first', at('09:00')), journey('second', at('09:00'))])
    expect(idsOf(sorted)).toEqual(['first', 'second'])
  })

  it('does not disturb a single journey', () => {
    expect(idsOf(byArrival([journey('only', at('09:00'))]))).toEqual(['only'])
  })
})
