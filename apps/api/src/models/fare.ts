export interface FareResultStation {
  id: string
  name: string
}

export interface FareResultLineRef {
  /** Operator-qualified line key, e.g. `KCI:C`. */
  line: string
  // Terminus this specific service heads toward (each interlining line forks to
  // its own terminus); null when not determinable.
  headsign: string | null
}

export interface FareResultRideLeg {
  type: 'RIDE'
  /** Operator-qualified line key, e.g. `KCI:C`. */
  line: string
  operator: string
  from: FareResultStation
  to: FareResultStation
  stationCount: number
  // Full ordered station list, boarding → alighting (endpoints included).
  stops: FareResultStation[]
  // Terminus the train heads toward; null when not determinable (off-topology
  // lines, loop-ambiguous directions).
  headsign: string | null
  distanceM: number
  // Set (length ≥ 2) only when the leg runs on interlined/shared track served
  // by several service lines (e.g. the LRT Jabodebek DKA..CWG trunk); any of
  // them gets the rider there. Includes the primary line (first). Omitted for
  // ordinary single-line legs.
  serviceLines?: FareResultLineRef[]
}

export interface FareResultTransferLeg {
  type: 'TRANSFER'
  from: FareResultStation
  to: FareResultStation
  distanceM: number
  // Set only for paid corridors (e.g. Dukuh Atas via KCI Sudirman); ordinary
  // walking transfers are free and omit both.
  fare?: number
  corridorLabel?: string
}

export type FareResultLeg = FareResultRideLeg | FareResultTransferLeg

export interface FareResultSegment {
  operator: string
  from: FareResultStation
  to: FareResultStation
  fare: number | null
}

/**
 * What a journey uniquely wins against the others in the same response.
 *
 * Mirrors @commute/tsundere's JourneyLabel. Uniqueness-based: a tie earns
 * nobody the label, and a lone journey earns none at all — a badge is a
 * comparison, and there is nothing to compare a single answer against.
 */
export type FareJourneyLabel = 'FEWEST_CHANGES' | 'LEAST_WALKING' | 'CHEAPEST' | 'SHORTEST_WAIT'

export interface FareJourney {
  legs: FareResultLeg[]
  segments: FareResultSegment[]
  totalFare: number | null
  totalDistanceM: number
  transferCount: number
  labels: FareJourneyLabel[]
  /*
   * Vehicle boardings. Deliberately NOT transferCount, which counts visible
   * interchanges after corridor folding — a same-station line change is a
   * boarding but not an interchange. FEWEST_CHANGES is decided on this number,
   * so rendering transferCount beside that badge would occasionally show two
   * journeys with equal counts and only one badge.
   */
  boardings: number
  walkDistanceM: number
  /*
   * No waitS, on purpose. It exists in the engine's Criteria and it decides
   * SHORTEST_WAIT, but it is derived from average headways rather than a
   * timetable. A number in seconds invites the UI to render "tunggu ±7 menit",
   * which is a departure-time promise this engine cannot keep. The label
   * carries the comparison; the figure would carry a lie.
   */
}

export interface FareResult {
  from: FareResultStation
  to: FareResultStation
  legs: FareResultLeg[]
  segments: FareResultSegment[]
  totalFare: number | null
  totalDistanceM: number
  transferCount: number
}

/*
 * The multi-journey answer, served from `/_internal/trips/:from/:to`.
 *
 * Separate from FareResult rather than an optional field on it, because the two
 * endpoints genuinely answer different questions: `/fares` returns the one route
 * it has always returned, and this returns everything worth choosing between.
 * Keeping `journeys` off FareResult means the public shape cannot quietly change
 * under the OG worker or the TransportForJakarta embed while this is unreleased.
 */
export interface TripResult {
  from: FareResultStation
  to: FareResultStation
  /** Best first, never empty when the route resolved. */
  journeys: FareJourney[]
}
