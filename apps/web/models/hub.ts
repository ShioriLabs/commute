import type { Line } from './line'
import type { Searchable } from './searchable'
import type { Station } from './stations'

export interface Hub {
  id: string
  slug: string
  name: string
  description: string | null
  heroImage: string | null
  latitude: number | null
  longitude: number | null
  score: number
  lines: Line[]
  members: Station[]
}

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
    subtitle: 'Stasiun Terintegrasi',
    to: `/hubs/${hub.slug}`,
    keywords: [hub.name.toLowerCase(), ...memberKeywords],
    body: hub.lines,
    data: {
      'hub-id': hub.slug
    },
    score: hub.score
  }
}
