import { HUB_KIND_LABEL, Operator, OPERATORS } from '@commute/constants'
import { Line } from 'models/line'
import { ALL_LINES } from 'utils/line'

/*
 * The prebuilt search index behind GET /_internal/searchables.
 *
 * This endpoint exists to serve commute.shiorilabs.id's search sheet and nothing
 * else — it emits the web app's own `Searchable` shape so the client can render
 * straight from the response instead of downloading /stations + /hubs +
 * /operators and re-deriving the same index on every mount.
 *
 * Everything here is pure: the route supplies already-fetched stations and hubs,
 * so the whole builder is unit-testable without D1.
 */

export type SearchableType = 'STATION' | 'LINE' | 'HUB' | 'OPERATOR'

export interface Searchable {
  type: SearchableType
  title: string
  to: string
  // Lowercased match targets. Built server-side because several are impossible
  // to derive from `title` alone: hub member codes, and the folded-away names of
  // directional halte pairs.
  keywords: string[]
  subtitle?: string
  // Keys into the response's `lines` dictionary, operator-qualified ("KCI:C").
  // Line names and colours are sent once there rather than repeated across ~375
  // entries. Qualified because line codes are only unique per operator, and a
  // hub's lines span several operators.
  body?: string[]
  data?: Record<string, string>
  // Operator code. Explicit so the client never has to parse it back out of
  // `to`, which is what it used to do for TJ roundel styling and rank nudging.
  operator?: Operator
  // Popularity. Omitted when 0 — the client already reads it as `?? 0`.
  score?: number
}

export interface SearchableLine {
  name: string
  // Bare code, for the roundel glyph — the dictionary key is qualified.
  lineCode: string
  colorCode: string
  operator: Operator
}

export interface SearchableIndex {
  lines: Record<string, SearchableLine>
  items: Searchable[]
}

// The minimal station shape the builder needs. Structural, so StationRepository
// rows satisfy it without the builder depending on the repository.
export interface IndexableStation {
  id: string
  /** Display name. */
  name: string
  /** The operator's own spelling; a search alias, often differing from `name`. */
  officialName: string
  code: string
  regionCode: string
  searchable: boolean
  score: number
  operator: Operator
  /** Operator-qualified line keys. */
  lines: readonly string[]
}

export interface IndexableHub {
  slug: string
  name: string
  kind: 'hub' | 'integrated'
  score: number
  // Read off the members: each already carries operator-qualified line keys, so
  // a hub spanning operators stays unambiguous.
  members: readonly {
    name: string
    officialName: string
    code: string
    operator: Operator
    lines: readonly string[]
  }[]
}

/*
 * TransJakarta splits some haltes into two `stations` rows, one per direction of
 * travel — "Kali Grogol Arah Utara" / "Kali Grogol Arah Selatan". They are one
 * physical stop (the 15 pairs sit 32–168 m apart, on opposite sides of a road),
 * so showing both in search is noise: a rider searching "kali grogol" wants one
 * result.
 *
 * The public /stations deliberately keeps both rows — each direction really is a
 * distinct boarding point with its own platform and code. Only this index folds
 * them, because only search needs them folded.
 *
 * NOTE the two directions do NOT always serve the same lines: 12 of the 15 pairs
 * differ (7R stops at Kali Grogol only northbound; 7T at only one Walikota
 * platform). The folded entry therefore carries the UNION of both sides, so no
 * route is hidden — a search for "7R" still finds Kali Grogol.
 */
const ARAH_SUFFIX = /\s+Arah\s+(Utara|Selatan|Timur|Barat)$/i

/** "Kali Grogol Arah Utara" -> "Kali Grogol"; other names pass through. */
export function directionalBaseName(name: string): string {
  return name.replace(ARAH_SUFFIX, '')
}

/*
 * Dictionary key for a line. Operator-qualified because line codes are only
 * unique per operator — KCI's "C" and a TJ corridor could collide, and a hub's
 * lines span operators by definition.
 */
export function lineKey(operator: Operator, lineCode: string): string {
  return `${operator}:${lineCode}`
}

function lowercasedKeywords(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value) continue
    seen.add(value.toLowerCase())
  }
  return Array.from(seen)
}

/*
 * Fold directional pairs into one group, leaving every other station untouched.
 * Grouping is by operator + base name, so an unrelated same-named stop on
 * another operator is never merged in. Input order is preserved by the position
 * of each group's first-seen member.
 */
function groupDirectionalStations(stations: IndexableStation[]): IndexableStation[][] {
  const groups = new Map<string, IndexableStation[]>()
  const order: string[] = []

  for (const station of stations) {
    const key = ARAH_SUFFIX.test(station.officialName)
      ? `${station.operator}:${directionalBaseName(station.officialName)}`
      : `id:${station.id}`

    let group = groups.get(key)
    if (!group) {
      group = []
      groups.set(key, group)
      order.push(key)
    }
    group.push(station)
  }

  return order
    .map(key => groups.get(key) ?? [])
    .filter(group => group.length > 0)
}

function stationToSearchable(group: IndexableStation[]): Searchable | null {
  // Lowest code wins, so the folded entry keeps a stable URL regardless of the
  // order D1 returned the rows in.
  const members = group.slice().sort((a, b) => a.code.localeCompare(b.code))
  const primary = members[0]
  if (!primary) return null

  const lineKeys: string[] = []
  const seenLines = new Set<string>()
  for (const member of members) {
    for (const key of member.lines) {
      if (seenLines.has(key)) continue
      seenLines.add(key)
      lineKeys.push(key)
    }
  }

  const title = directionalBaseName(primary.name)
  // Every member's name/code stays searchable, so "arah selatan" or the
  // folded-away code still finds the joined entry.
  const keywords = lowercasedKeywords([
    ...members.flatMap(member => [member.name, member.officialName, member.code]),
    title
  ])

  const score = Math.max(...members.map(member => member.score ?? 0))

  return {
    type: 'STATION',
    title,
    subtitle: OPERATORS[primary.operator].name,
    to: `/stations/${primary.operator}/${primary.code}`,
    keywords,
    body: lineKeys,
    data: {
      'station-id': primary.id,
      /*
       * Every member of a folded group, primary first, comma-separated.
       *
       * Folding is right for search — one physical stop should be one result —
       * but it makes the sibling's id unreachable, and not every consumer of
       * this index is search. A fare is computed between two specific boarding
       * points, so the fare picker needs the real station behind each half of
       * an "Arah …" pair; without this it had to keep loading /stations
       * separately, and the two directions of 15 TJ stops could not be priced
       * at all.
       *
       * Only emitted when something was actually folded, so the ~360 unfolded
       * entries do not each carry a duplicate of their own id.
       */
      ...(members.length > 1
        ? { 'station-ids': members.map(member => member.id).join(',') }
        : {})
    },
    operator: primary.operator,
    ...(score > 0 ? { score } : {})
  }
}

/*
 * Keywords include every member's name & code so a search for any member
 * (e.g. "sudirman") surfaces the hub.
 */
function hubToSearchable(hub: IndexableHub): Searchable {
  const keywords = lowercasedKeywords([
    hub.name,
    ...hub.members.flatMap(member => [member.name, member.officialName, member.code])
  ])

  // Deduped across members, in member order — a hub's badges read the same as
  // the union of its stations'.
  const lineKeys: string[] = []
  const seenLines = new Set<string>()
  for (const member of hub.members) {
    for (const key of member.lines) {
      if (seenLines.has(key)) continue
      seenLines.add(key)
      lineKeys.push(key)
    }
  }

  return {
    type: 'HUB',
    title: hub.name,
    subtitle: HUB_KIND_LABEL[hub.kind],
    to: `/hubs/${hub.slug}`,
    keywords,
    body: lineKeys,
    data: { 'hub-id': hub.slug },
    ...(hub.score > 0 ? { score: hub.score } : {})
  }
}

/*
 * Score is always 0 (no popularity data), so lines rank below equally-matching
 * popular stations — the field is therefore omitted entirely.
 */
function lineToSearchable(operator: { code: Operator, name: string }, line: Line): Searchable {
  const name = line.name.toLowerCase()

  return {
    type: 'LINE',
    title: line.name,
    subtitle: operator.name,
    to: `/lines/${operator.code}/${line.lineCode}`,
    keywords: lowercasedKeywords([
      name,
      // "Lin Cikarang" is also findable as just "cikarang".
      name.startsWith('lin ') ? name.slice(4) : null,
      line.lineCode
    ]),
    body: [lineKey(operator.code, line.lineCode)],
    operator: operator.code
  }
}

/*
 * Every line referenced by any item, sent once. Built from the full line
 * registry rather than from the items, so `body` codes can never dangle.
 */
function buildLineDictionary(): Record<string, SearchableLine> {
  const dictionary: Record<string, SearchableLine> = {}

  for (const [operatorCode, lines] of Object.entries(ALL_LINES)) {
    const operator = operatorCode as Operator
    if (operator === 'NUL') continue

    for (const line of lines) {
      dictionary[lineKey(operator, line.lineCode)] = {
        name: line.name,
        lineCode: line.lineCode,
        colorCode: line.colorCode,
        operator
      }
    }
  }

  return dictionary
}

/*
 * Build the whole index. Stations are filtered here rather than in SQL so the
 * public /stations keeps returning everything it always has.
 */
export function buildSearchableIndex(
  stations: IndexableStation[],
  hubs: IndexableHub[]
): SearchableIndex {
  const items: Searchable[] = []

  const eligible = stations.filter(station =>
    // Jakarta area only, matching what the search sheet has always shown.
    station.regionCode === 'CGK'
    // Topology-only stops (TJ feeders) are routable but never listed.
    && station.searchable
  )

  for (const group of groupDirectionalStations(eligible)) {
    const searchable = stationToSearchable(group)
    if (searchable) items.push(searchable)
  }

  for (const hub of hubs) {
    items.push(hubToSearchable(hub))
  }

  for (const operator of Object.values(OPERATORS)) {
    if (operator.code === 'NUL') continue
    // TJ excluded: its line-detail pages aren't built yet (no topology).
    if (operator.code === 'TJ') continue

    for (const line of ALL_LINES[operator.code]) {
      items.push(lineToSearchable(operator, line))
    }
  }

  return { lines: buildLineDictionary(), items }
}
