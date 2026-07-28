import type { Hub } from '@commute/schemas'
import { HUB_KIND_LABEL } from '@commute/constants'
import type { Line } from '@commute/schemas'
import type { Operator } from '@commute/schemas'
import type { Searchable } from '@commute/schemas'

// Map a hub to a Searchable. Keywords include every member's name & code so a
// search for any member (e.g. "sudirman") surfaces the hub. Body carries the
// deduped Line[] so it renders the same line badges as a station result.
export function hubToSearchable(hub: Hub): Searchable<Line[]> {
  const memberKeywords = hub.members.flatMap(member => [
    member.name.toLowerCase(),
    member.code.toLowerCase(),
    ...(member.formattedName ? [member.formattedName.toLowerCase()] : [])
  ])

  return {
    type: 'HUB',
    title: hub.name,
    subtitle: HUB_KIND_LABEL[hub.kind ?? 'integrated'],
    to: `/hubs/${hub.slug}`,
    keywords: [hub.name.toLowerCase(), ...memberKeywords],
    body: hub.lines,
    data: {
      'hub-id': hub.slug
    },
    score: hub.score
  }
}

// Map a line to a Searchable. Score is 0 (no popularity data), so lines rank
// below equally-matching popular stations. Body carries the Line itself for
// the colored pill rendering.
export function lineToSearchable(operator: Operator, line: Line): Searchable<Line> {
  const name = line.name.toLowerCase()
  return {
    type: 'LINE',
    title: line.name,
    subtitle: operator.name,
    to: `/lines/${operator.code}/${line.lineCode}`,
    keywords: [
      name,
      ...(name.startsWith('lin ') ? [name.slice(4)] : []),
      line.lineCode.toLowerCase()
    ],
    body: line,
    score: 0
  }
}
