import type { Line } from './line'
import type { Station } from './stations'

/*
 * `hub` — several distinct, differently-named stations under one complex.
 * `integrated` — one place to a rider, split across operators only in the data.
 */
export type HubKind = 'hub' | 'integrated'

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
