import { DAY_S } from '@commute/tsundere'

/*
 * The last stop a timetable never lists.
 *
 * Every feed here is a departure board, and a train that terminates at a
 * station does not depart from it. So a trip built from board rows ends one
 * stop short of where it actually goes, and a rider heading TO a terminus
 * (Bogor, Jakarta Kota, Lebak Bulus, Dukuh Atas) finds no trip that reaches it
 * and gets no times. generateTrips appends that stop back, from the helpers
 * below.
 */

/*
 * Longest believable final hop. Anything longer is not one hop past the last
 * row, and appending it would describe a train we do not understand.
 */
export const MAX_TERMINUS_HOP_S = 30 * 60

const normalise = (name: string) => name.trim().toLowerCase().replace(/^stasiun\s+/, '').replace(/-/g, ' ')

/*
 * The station a train signed `boundFor` is heading to, among a line's
 * stations, or null.
 *
 * The feeds and the stations table spell names differently: KCI writes
 * "Bogor" against a station named "BOGOR", MRTJ signs "Lebak Bulus Bank
 * Syariah Indonesia" for "Stasiun Lebak Bulus", and the airport line signs
 * "Bandara Soekarno-Hatta" for "BANDARA SOEKARNO HATTA". Case, a "Stasiun "
 * prefix and hyphens are dropped, and a sponsor suffix is allowed after a whole
 * word. A suffix looks
 * just like a longer station name, though — "Bekasi Timur" starts with
 * "Bekasi" — so an exact match wins, then the longest matching name.
 */
export function signedStation(boundFor: string, stations: readonly { id: string, name: string }[]): string | null {
  const sign = normalise(boundFor)
  let best: { id: string, length: number } | null = null
  for (const station of stations) {
    const name = normalise(station.name)
    if (sign === name) return station.id
    if (sign.startsWith(`${name} `) && (best === null || name.length > best.length)) best = { id: station.id, length: name.length }
  }
  return best?.id ?? null
}

/*
 * KCI's own terminus arrival, as seconds on the trip's clock.
 *
 * KCI repeats the terminus arrival on every row of a trip (generateTrips trap
 * 1), so this is a measured time, not an inferred one. It is a bare clock time,
 * though, so it is lifted past midnight to sit after the last departure — and
 * refused when that puts it further away than one hop could be.
 */
export function feedTerminusArrivalS(lastDepartureS: number, estimatedArrival: string): number | null {
  const [h, m, s] = estimatedArrival.split(':').map(Number)
  let arrivalS = (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)
  while (arrivalS < lastDepartureS) arrivalS += DAY_S
  return arrivalS - lastDepartureS <= MAX_TERMINUS_HOP_S ? arrivalS : null
}

/*
 * Measured running time per directed hop, as the median gap between
 * consecutive departures across every trip that rides it.
 *
 * For operators with no terminus arrival in the feed (MRTJ, LRT Jabodebek),
 * the final hop INTO a terminus is priced from the same track run the other
 * way: Lebak Bulus -> Fatmawati stands in for Fatmawati -> Lebak Bulus. That
 * is an inference, and it includes the dwell at the far stop, so it errs a few
 * tens of seconds late — the safe side for a rider judging a connection.
 */
export function hopRunTimesS(
  trips: readonly { lineCode: string, stops: readonly { stationId: string, departureS: number }[] }[]
): Map<string, number> {
  const samples = new Map<string, number[]>()
  for (const trip of trips) {
    for (let i = 1; i < trip.stops.length; i++) {
      const key = `${trip.lineCode}|${trip.stops[i - 1]!.stationId}|${trip.stops[i]!.stationId}`
      const gap = trip.stops[i]!.departureS - trip.stops[i - 1]!.departureS
      const bucket = samples.get(key)
      if (bucket) bucket.push(gap)
      else samples.set(key, [gap])
    }
  }
  const medians = new Map<string, number>()
  for (const [key, gaps] of samples) {
    const sorted = [...gaps].sort((a, b) => a - b)
    medians.set(key, sorted[Math.floor(sorted.length / 2)]!)
  }
  return medians
}
