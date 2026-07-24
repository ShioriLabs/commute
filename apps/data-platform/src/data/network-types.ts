// Response subsets for the fare and station-detail beats. Only the fields the
// page actually renders are typed — the real payloads are larger.
//
// Verified against GET /fares/MRTJ-LBB/MRTJ-BHI and GET /stations/LRTJBDB/RAS.

export interface FareStationRef {
  id: string
  name: string
}

export interface FareLeg {
  type: string
  lineCode: string
  lineName: string
  lineColor: string
  operator: string
  from: FareStationRef
  to: FareStationRef
  stationCount: number
  distanceM: number
}

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
