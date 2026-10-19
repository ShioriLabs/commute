import { isSeparatelyGated, type Operator } from '@commute/constants'
import { TOPOLOGY } from 'db/data/topology'
import type { RouteLeg } from '@commute/tsundere'
import { stationCodeOf } from 'utils/ids'

/*
 * Operators that run interlined services — distinct service lines sharing a
 * physical trunk (LRT Jabodebek: Bekasi + Cibubur share the DKA..CWG trunk and
 * fork at Cawang). A leg lying entirely on such a trunk can be boarded on any
 * of the sharing lines, so the fare UI surfaces all of them rather than the one
 * the router happened to pick. Gated so ordinary networks are untouched.
 */
export const INTERLINING_OPERATORS = new Set<Operator>(['LRTJBDB', 'TJ'])

// True when `needle` appears as a contiguous run inside `haystack`.
function containsContiguous(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((code, j) => haystack[i + j] === code)) return true
  }
  return false
}

/*
 * Every lineCode of `operator` that calls at `stationCodes` as a contiguous run,
 * in that travel order. When it returns ≥ 2 codes the leg runs on
 * shared/interlined track and can be served by any of them. Returns [] for
 * operators that don't interline, keeping the behaviour scoped.
 */
export function findInterliningLineCodes(operator: Operator, stationCodes: string[]): string[] {
  if (!INTERLINING_OPERATORS.has(operator)) return []
  const reversed = [...stationCodes].reverse()
  const codesOf = (seq: { station: string }[]) => seq.map(stop => stop.station)
  /*
   * Direction matters on an asymmetric corridor, as generateEdgesSQL reads it:
   * `path` runs one way and `pathReverse` the other, each in travel order. So
   * the run must appear forwards in one of them. Reading `path` backwards
   * would claim 4D for Karet Kuningan → Kuningan Madya → Setiabudi Integritas,
   * which its outbound path passes the other way while its return skips
   * Integritas for Halimun. A symmetric line's `path` serves both ways.
   */
  const serves = (topology: (typeof TOPOLOGY)[number]): boolean => topology.pathReverse
    ? containsContiguous(codesOf(topology.path), stationCodes) || containsContiguous(codesOf(topology.pathReverse), stationCodes)
    : containsContiguous(codesOf(topology.path), stationCodes) || containsContiguous(codesOf(topology.path), reversed)
  return TOPOLOGY
    .filter(topology => topology.operator === operator && serves(topology))
    .map(topology => topology.lineCode)
}

/*
 * The router splits legs on every lineCode change, even at a shared trunk node
 * with no walk — so a one-seat ride whose train runs across the fork looks like
 * a change of trains (LRT Jabodebek Dukuh Atas→Harjamukti rides the trunk on a
 * Cibubur train, but the router picks Bekasi edges for the trunk then switches
 * to Cibubur at Cawang). When a single service line runs the whole combined
 * path, collapse the pair into one leg on that line. Fare-neutral: the merged
 * legs were already one contiguous RIDE run at the same operator and distance.
 */
export function mergeInterlinedLegs(legs: RouteLeg[]): RouteLeg[] {
  const merged: RouteLeg[] = []
  for (const leg of legs) {
    const last = merged[merged.length - 1]
    if (
      last?.type === 'RIDE' && leg.type === 'RIDE'
      && last.operator === leg.operator
      && last.lineCode !== leg.lineCode
      && last.toStationId === leg.fromStationId
      // A gated line is a separate paid journey, never one seat with its neighbour.
      && !isSeparatelyGated(last.operator, last.lineCode)
      && !isSeparatelyGated(leg.operator, leg.lineCode)
    ) {
      const combinedIds = [...last.stationIds, ...leg.stationIds.slice(1)]
      const operator = last.operator as Operator
      const codes = combinedIds.map(id => stationCodeOf(operator, id))
      const [throughLine] = findInterliningLineCodes(operator, codes)
      if (throughLine) {
        merged[merged.length - 1] = {
          ...last,
          lineCode: throughLine,
          toStationId: leg.toStationId,
          stationIds: combinedIds,
          distanceM: last.distanceM + leg.distanceM
        }
        continue
      }
    }
    merged.push(leg)
  }
  return merged
}
