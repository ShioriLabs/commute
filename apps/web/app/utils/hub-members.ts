import type { Hub, HubKind } from '@commute/schemas'
import { directionOf as directionWord } from 'utils/directional-stations'

/*
 * The model behind the hub sheet's tile switcher, kept free of React so it can
 * be unit tested.
 *
 * A PLACE hub (`integrated` or `directional`) is one place to a rider: the sheet
 * shows one tile per operator and, when that operator's halte is split by
 * direction of travel, a pill per side. A `hub`-kind complex (Dukuh Atas, CSW)
 * is several places and keeps its plain member list.
 */

export type HubMember = Hub['members'][number]

export function isPlaceHub(kind: HubKind | null | undefined): boolean {
  return kind === 'integrated' || kind === 'directional'
}

export interface OperatorGroup {
  operator: string
  members: HubMember[]
}

/** Members grouped by operator, both in API order (hubStations.position). */
export function groupByOperator(members: readonly HubMember[]): OperatorGroup[] {
  const groups: OperatorGroup[] = []
  for (const member of members) {
    const group = groups.find(g => g.operator === member.operator)
    if (group) group.members.push(member)
    else groups.push({ operator: member.operator, members: [member] })
  }
  return groups
}

/** "Kali Grogol Arah Utara" -> "Arah Utara"; null for an unsplit stop. */
export function directionLabel(member: HubMember): string | null {
  const word = directionWord(member.officialName)
  return word ? `Arah ${word}` : null
}

export type Heading = 'up' | 'down' | 'left' | 'right'

const HEADINGS: Record<string, Heading> = { utara: 'up', selatan: 'down', timur: 'right', barat: 'left' }

/** Which way the side's arrow points: north up, east right, as on a map. */
export function headingOf(member: HubMember): Heading | null {
  const word = directionWord(member.officialName)
  return word ? HEADINGS[word.toLowerCase()] ?? null : null
}

/*
 * The sides of one operator, in the order their pills are drawn. Signage rule:
 * a right-pointing arrow trails its text, so that pill goes LAST, its arrow
 * pointing off the end of the row. Everything else keeps API order.
 */
export function orderDirections(members: readonly HubMember[]): HubMember[] {
  return members
    .filter(member => headingOf(member) !== null)
    .sort((a, b) => Number(headingOf(a) === 'right') - Number(headingOf(b) === 'right'))
}

/*
 * KCI's airport line is its own product to riders (ARL), not KRL. A KCI member
 * counts only when EVERY line it serves is line A: Batu Ceper or Manggarai also
 * carry commuter lines and stay KRL.
 */
export function isAirportRail(member: HubMember): boolean {
  return member.operator === 'KCI' && member.lines.length > 0 && member.lines.every(line => line === 'KCI:A')
}

const SHORT_LABEL: Record<string, string> = {
  KCI: 'KRL',
  MRTJ: 'MRT',
  LRTJ: 'LRT',
  LRTJBDB: 'LRT',
  TJ: 'BRT',
  APCGK: 'APM'
}

/** The tile's short label. No operator logos, so this carries the identity. */
export function tileLabel(member: HubMember): string {
  if (isAirportRail(member)) return 'ARL'
  return SHORT_LABEL[member.operator] ?? member.operator
}

/*
 * Phrases a title must never wrap inside. Next to the tiles, "Bandara
 * Soekarno-Hatta" otherwise breaks at the hyphen and leaves "Soekarno-"
 * dangling.
 */
const KEEP_TOGETHER = ['Soekarno-Hatta']

export function splitKeepTogether(name: string): { before: string, phrase: string, after: string } | null {
  const phrase = KEEP_TOGETHER.find(p => name.includes(p))
  if (!phrase) return null
  const index = name.indexOf(phrase)
  return { before: name.slice(0, index), phrase, after: name.slice(index + phrase.length) }
}

/** The member a `?m=` value or a map tap names, falling back to the first. */
export function resolveMember(members: readonly HubMember[], id: string | null | undefined): HubMember | null {
  return members.find(member => member.id === id) ?? members[0] ?? null
}
