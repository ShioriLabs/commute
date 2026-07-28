import * as v from 'valibot'
import type { HexColored } from './common'
import { LineSchema } from './common'
import { StationSchema } from './station'

export const HubSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['HUB-DKA'] })),
    slug: v.pipe(
      v.string(),
      v.description('URL key. Mutable — identify a hub by `id` if you need stability.'),
      v.metadata({ examples: ['dukuh-atas'] })
    ),
    name: v.pipe(v.string(), v.metadata({ examples: ['Dukuh Atas'] })),
    kind: v.pipe(
      v.picklist(['hub', 'integrated']),
      v.description('`hub` — several differently-named stations in one complex, where the grouping carries information. `integrated` — one place to a rider, split across operators only in the data.'),
      v.metadata({ examples: ['hub'] })
    ),
    description: v.nullable(v.string()),
    heroImage: v.nullable(v.string()),
    latitude: v.nullable(v.number()),
    longitude: v.nullable(v.number()),
    score: v.pipe(v.number(), v.description('Relative prominence, used for ranking.')),
    lines: v.pipe(
      v.array(LineSchema),
      v.description('Every line reachable from the hub, deduped across its members.')
    ),
    members: v.pipe(
      v.array(StationSchema),
      v.description('The stations making up this hub, in display order.')
    ),
    createdAt: v.string(),
    updatedAt: v.string()
  }),
  v.title('Hub')
)

export type Hub = HexColored<v.InferOutput<typeof HubSchema>>
export type HubKind = Hub['kind']
