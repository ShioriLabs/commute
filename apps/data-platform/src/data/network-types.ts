// Response subsets for the fare and station-detail beats. Only the fields the
// page actually renders are typed — the real payloads are larger.
//
// Verified against GET /fares/MRTJ-LBB/MRTJ-BHI and GET /stations/LRTJBDB/RAS.

export interface FareStationRef {
  id: string
  name: string
}

// Legs are a tagged union: a TRANSFER is a walk between stations and carries
// none of the line fields. Modelling them as one flat shape (the earlier version
// of this file) makes `leg.lineColor` look safe to read on a walk, where it is
// undefined at runtime — which is exactly the leg the rute beat is about.
export interface FareRideLeg {
  type: 'RIDE'
  lineCode: string
  lineName: string
  lineColor: string
  operator: string
  from: FareStationRef
  to: FareStationRef
  stationCount: number
  /** Full ordered stop list, boarding -> alighting, endpoints included. */
  stops?: FareStationRef[]
  /** Terminus the train heads toward. */
  headsign?: string | null
  distanceM: number
}

export interface FareTransferLeg {
  type: 'TRANSFER'
  from: FareStationRef
  to: FareStationRef
  distanceM: number
  /** Set only on a paid corridor crossing (e.g. the Sudirman footbridge). */
  fare?: number
  corridorLabel?: string
}

export type FareLeg = FareRideLeg | FareTransferLeg

export interface FareResult {
  from: FareStationRef
  to: FareStationRef
  legs: FareLeg[]
  totalFare: number
  totalDistanceM: number
  transferCount: number
}

export interface StationLine {
  name: string
  colorCode: string
  lineCode: string
}

/** GET /operators — every operator with its lines. Shared with the cakupan beat. */
export interface OperatorSummary {
  code: string
  name: string
  lines: StationLine[]
}

export interface StationAmenity {
  type: string
}

export interface StationDetail {
  id: string
  name: string
  code: string
  formattedName: string
  region: string
  operator: { code: string, name: string }
  amenities: StationAmenity[]
  latitude: number
  longitude: number
  searchable: boolean
  lines: StationLine[]
}

export interface StationTransfer {
  id: string
  toStation: {
    stationId: string
    name: string
    operatorName: string
    lines: StationLine[]
  }
  distance: number
  notes: string | null
}
