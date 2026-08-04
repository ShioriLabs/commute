/*
 * Station numbers are drawn as the line's prefix stacked over the stop's
 * position, the way the FDTJ map prints them. Splitting the two halves is the
 * only logic involved, so it lives here rather than in the roundel components
 * that render it (line-roundel.tsx and line-strip/station-row.tsx both use it).
 */

// Rail: 'C13' -> { prefix: 'C', num: '13' }; 'b23' -> { prefix: 'b', num: '23' }.
// TransJakarta numbers are corridor-sequence with no letter, so they split on
// the hyphen instead: '13-4' -> { prefix: '13', num: '4' }. Without that branch
// the whole string lands in `num` and overflows the roundel.
export function splitStationNumber(stationNumber: string): { prefix: string, num: string } {
  const brt = stationNumber.match(/^(\d+)-(.+)$/)
  if (brt) return { prefix: brt[1]!, num: brt[2]! }
  const match = stationNumber.match(/^([A-Za-z]+)(.*)$/)
  if (!match || !match[2]) return { prefix: '', num: stationNumber }
  return { prefix: match[1], num: match[2] }
}
