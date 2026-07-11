import type { Line } from './line'
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
