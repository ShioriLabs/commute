import type { Line } from 'models/line'
import type { Station } from 'models/stations'

/*
 * TransJakarta splits some haltes into two `stations` rows, one per direction of
 * travel — "Kali Grogol Arah Utara" / "Kali Grogol Arah Selatan". They are one
 * physical stop (the 15 pairs sit 32–168 m apart, on opposite sides of a road),
 * so showing both is noise: a rider searching "kali grogol" wants one result.
 *
 * This groups a pair back into a single presentational entry. It is deliberately
 * a WEB-SIDE concern — the API keeps both rows, because each direction really is
 * a distinct boarding point with its own platform and its own code.
 *
 * NOTE the two directions do NOT always serve the same lines: 12 of the 15 pairs
 * differ (7R stops at Kali Grogol only northbound; 7T at only one Walikota
 * platform). The joined entry therefore carries the UNION of both sides, so no
 * route is hidden — a search for "7R" still finds Kali Grogol. Which platform a
 * given line uses is resolved on the station page, not here.
 */

const ARAH_SUFFIX = /\s+Arah\s+(Utara|Selatan|Timur|Barat)$/i

/** "Kali Grogol Arah Utara" -> "Kali Grogol"; other names pass through. */
export function directionalBaseName(name: string): string {
  return name.replace(ARAH_SUFFIX, '')
}

/** True when this station is one direction of a split halte. */
export function isDirectionalStation(station: Station): boolean {
  return ARAH_SUFFIX.test(station.name)
}

/** "Kali Grogol Arah Utara" -> "Utara"; null when not a directional row. */
export function directionOf(name: string): string | null {
  return name.match(ARAH_SUFFIX)?.[1] ?? null
}

export interface JoinedStation {
  /** The station that represents the group (lowest code, for a stable URL). */
  primary: Station
  /** Every row in the group, in code order. Length 1 when nothing was joined. */
  members: Station[]
  /** Display name with the "Arah …" suffix stripped. */
  name: string
  /** Union of every member's lines, deduped by lineCode. */
  lines: Line[]
  /** True when two or more rows were folded together. */
  joined: boolean
}

/*
 * Fold directional pairs into one entry, leaving every other station untouched.
 * Grouping is by operator + base name, so an unrelated same-named stop on
 * another operator is never merged in. Order of the input is preserved by the
 * position of each group's primary.
 */
export function joinDirectionalStations(stations: Station[]): JoinedStation[] {
  const groups = new Map<string, Station[]>()
  const order: string[] = []

  for (const station of stations) {
    const key = isDirectionalStation(station)
      ? `${station.operator.code}:${directionalBaseName(station.name)}`
      : `id:${station.id}`
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(station)
  }

  return order.map((key) => {
    const members = groups.get(key)!.slice().sort((a, b) => a.code.localeCompare(b.code))
    const primary = members[0]!
    const lines: Line[] = []
    const seen = new Set<string>()
    for (const member of members) {
      for (const line of member.lines) {
        if (seen.has(line.lineCode)) continue
        seen.add(line.lineCode)
        lines.push(line)
      }
    }
    return {
      primary,
      members,
      name: directionalBaseName(primary.formattedName || primary.name),
      lines,
      joined: members.length > 1
    }
  })
}
