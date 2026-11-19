import { describe, expect, it } from 'vitest'
import { buildLineMembershipCount } from 'utils/directions'
import { getAirportFare } from './airportFares'

describe('Bogor on KA Bandara (GAPEKA 2026)', () => {
  it('prices Bogor <-> Bandara at the promotional Rp85.000, both ways', () => {
    expect(getAirportFare('BOO', 'BST')).toBe(85000)
    expect(getAirportFare('BST', 'BOO')).toBe(85000)
  })

  it('leaves Depok Baru unpriced until a fare is published', () => {
    expect(getAirportFare('DPB', 'BST')).toBeNull()
  })

  it('does not make Bogor or Depok Baru read as interchanges', () => {
    const membership = buildLineMembershipCount('KCI')
    expect(membership.get('DPB')).toBe(1)
    expect(membership.get('BOO')).toBe(1)
    expect(membership.get('MRI')).toBeGreaterThan(1)
  })
})
