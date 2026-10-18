import type { WalkingPreference } from '@commute/tsundere'

/*
 * Real journeys whose answer someone has checked, for the route regression
 * suite (trips.regression.test.ts).
 *
 * Every case says WHY its expectation is right — a rider's report, a decision,
 * a data fact — because a case without a reason is just a recording of today's
 * output, and re-recording it when it fails teaches nothing. When one fails,
 * read the reason before touching the expectation: either the data changed and
 * the case needs a new answer, or the router regressed and the case did its job.
 *
 * Shapes are deliberately partial. Assert what makes the route right or wrong
 * (where the walk is, how many vehicles), not every line code: TJ's sibling
 * corridors (9 / 9A, 13 / L13E) trade places on the same stops whenever a
 * headway moves, and pinning them would fail on changes nobody cares about.
 */

/** Part of a journey to look for. Every field given must hold; omitted fields are not checked. */
export interface RouteShape {
  /**
   * Lines ridden, in order, after merging consecutive hops on one line. An
   * entry may list alternatives as `9|9A`.
   */
  rides?: string[]
  /** A line ridden anywhere in the journey. */
  usesLine?: string
  /**
   * Every walk in the journey, in order, each as the stations it passes:
   * `[from, to]`, or `[from, via, to]` for a chain of walk hops through a stop.
   * `[]` means the journey does not walk at all.
   */
  walks?: string[][]
  /** One walk the journey must contain, as in `walks`. */
  hasWalk?: string[]
  maxBoardings?: number
}

export interface RouteCase {
  name: string
  /** Where the expectation comes from. Required: see the note above. */
  why: string
  from: string
  to: string
  /** ISO time with offset. Defaults to a weekday mid-morning, see DEFAULT_AT. */
  at?: string
  walking?: WalkingPreference
  modes?: 'rail'
  /** The top journey matches this. */
  first?: RouteShape
  /** The top journey matches none of these. */
  firstNot?: RouteShape[]
  /** Each of these matches some journey offered, at any rank. */
  offers?: RouteShape[]
  /** No journey offered matches any of these. */
  never?: RouteShape[]
}

/*
 * Wednesday 10:00 WIB: every daytime line running, past the morning peak so
 * headways are ordinary. A case about night service or a weekend sets its own.
 */
export const DEFAULT_AT = '2026-10-14T10:00:00+07:00'

export const ROUTE_CASES: RouteCase[] = [
  {
    name: 'Kuningan Madya to Tanjung Duren rides 6, walks Underpass to Simpang Kuningan, rides 9',
    why: 'Owner rides this daily (2026-07-22). The 304m busway walk beats an extra bus change; two wrong router fixes were shipped against it before.',
    from: 'TJ-H00114P',
    to: 'TJ-H00210S',
    first: { walks: [['TJ-H00115P', 'TJ-H00113P']], maxBoardings: 2 }
  },
  {
    name: 'Dukuh Atas MRT to Masjid Agung does not lead with the Bendungan Hilir walk',
    why: 'Owner decision 2026-10-18: the 500m MRT Bendungan Hilir <-> Koridor 1 link is correct data, and routing riders off the MRT early to walk it is the router being wrong.',
    from: 'MRTJ-DKA',
    to: 'TJ-H00127P',
    firstNot: [{ hasWalk: ['MRTJ-BNH', 'TJ-H00010P'] }]
  },
  {
    name: 'Ancol to Lebak Bulus never walks through Stasiun Jatinegara halte as two hops',
    why: 'Passing through a halte costs nothing, so Bali Mester -> halte -> KCI Jatinegara (410m) undercut the measured direct 460m walk, which is the true one (2026-08-04).',
    from: 'TJ-H00003P',
    to: 'MRTJ-LBB',
    never: [{ hasWalk: ['TJ-H00148P', 'TJ-H00225P', 'KCI-JNG'] }]
  },
  {
    name: 'Mayestik to Mangga Dua Raya never chains walks through KCI Jakarta Kota',
    why: 'Same flaw as Jatinegara: Kota halte -> KCI Jakarta Kota -> Mangga Dua Raya (210m) undercounts the measured direct 530m walk.',
    from: 'TJ-H00130P',
    to: 'TJ-H00140P',
    never: [{ hasWalk: ['TJ-H00275P', 'KCI-JAKK', 'TJ-H00140P'] }]
  },
  {
    name: 'LRT Dukuh Atas to Jatimulya is one ride with no walk',
    why: 'Both on the Bekasi line of LRT Jabodebek: a one-seat ride is the only sensible answer.',
    from: 'LRTJBDB-DKA',
    to: 'LRTJBDB-JTM',
    first: { walks: [], maxBoardings: 1 }
  },
  {
    name: 'Sudirman Baru to the airport offers the one-seat KA Bandara',
    why: 'Line A is offered for airport journeys (decided 2026-09-28). Offered, not first: C to Duri then A ranks above it on wait and fare (Rp73,000 vs Rp85,000), which is a fair trade.',
    from: 'KCI-SUDB',
    to: 'KCI-BST',
    offers: [{ rides: ['A'], walks: [] }]
  },
  {
    name: 'Sudirman to Rawa Buaya never rides KA Bandara',
    why: 'Line A is premium-fare and only routable when a journey touches the airport (decided 2026-09-28); Rawa Buaya is on it but is not the airport.',
    from: 'KCI-SUD',
    to: 'KCI-RW',
    never: [{ usesLine: 'A' }]
  },
  {
    name: 'Arriving at LRT Rasuna Said never adds the walk from the TJ halte stacked on it',
    why: 'LRT and TJ Rasuna Said are one integrated place (2026-09-28): a rider who reaches either has arrived, so the walk between them is padding.',
    from: 'TJ-H00047P',
    to: 'LRTJBDB-RAS',
    never: [{ hasWalk: ['TJ-H00069P', 'LRTJBDB-RAS'] }]
  }
]
