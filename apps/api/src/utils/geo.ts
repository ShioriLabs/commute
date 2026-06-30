const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number): number => (deg * Math.PI) / 180

/**
 * Great-circle distance between two lat/lng points, in metres. Used as a
 * fallback edge weight where no published track distance exists. Note this is a
 * straight-line lower bound — real track is longer, especially on curves/loops.
 */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h
    = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}
