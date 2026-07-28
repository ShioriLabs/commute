import type { HubKind } from '@commute/constants'
import type { Line } from './line'
import type { Station } from './stations'

/*
 * Both now live in @commute/constants: the API needs them to build hub
 * subtitles for /_internal/searchables, and duplicating the label strings
 * across apps would let the two drift.
 */
export type { HubKind } from '@commute/constants'
export { HUB_KIND_LABEL } from '@commute/constants'

export interface Hub {
  id: string
  slug: string
  name: string
  kind: HubKind
  description: string | null
  heroImage: string | null
  latitude: number | null
  longitude: number | null
  score: number
  lines: Line[]
  members: Station[]
}
