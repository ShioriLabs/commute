/*
 * KA Bandara (KCI line A) fares, rupiah, keyed by the city-side station code.
 * Every entry is a trip to or from BST: the service is priced per station pair
 * like MRTJ, not by KCI's commuter distance formula, and it sits behind its own
 * gates (see SEPARATELY_GATED_LINES in @commute/constants).
 *
 * Intra-city pairs are sold too (MRI->DU is Rp10.000) but deliberately absent:
 * the router only uses line A for airport journeys, so a pair without BST is
 * unpriced rather than quietly routed onto a premium train.
 *
 * Source: airport-train.kci.id `getServices` server action, queried both
 * directions for tripdate 2026-09-30 on 2026-09-28. Every trip on a pair
 * returned the same fare, and each direction matched its reverse.
 */
export const AIRPORT_TERMINUS_CODE = 'BST'

export const AIRPORT_FARES: Record<string, number> = {
  MRI: 85000,
  SUDB: 85000,
  DU: 70000,
  RW: 40000,
  BPR: 35000
}

export function getAirportFare(fromCode: string, toCode: string): number | null {
  if (fromCode === AIRPORT_TERMINUS_CODE) return AIRPORT_FARES[toCode] ?? null
  if (toCode === AIRPORT_TERMINUS_CODE) return AIRPORT_FARES[fromCode] ?? null
  return null
}
