import type { Line } from './line'
import type { Station } from './stations'

/*
 * `hub` — several distinct, differently-named stations under one complex.
 * `integrated` — one place to a rider, split across operators only in the data.
 */
export type HubKind = 'hub' | 'integrated'

/*
 * What we call each kind in the UI. "Pumpunan moda" is the operators' own term
 * for a multi-mode interchange building (CSW is officially Pumpunan Moda Cakra
 * Selaras Wahana), so a real complex gets that name; an `integrated` grouping is
 * one station to a rider and keeps the plainer label.
 */
export const HUB_KIND_LABEL: Record<HubKind, string> = {
  hub: 'Pumpunan Moda',
  integrated: 'Stasiun Terintegrasi'
}

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
