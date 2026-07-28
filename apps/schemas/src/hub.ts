import * as v from 'valibot'
import { LineKeySchema } from './common'
import { StationRefSchema } from './station'

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
    heroImage: v.pipe(
      v.nullable(v.string()),
      v.description('Photo of the complex, for social cards and page headers.')
    ),
    lines: v.pipe(
      v.array(LineKeySchema),
      v.description('Every line reachable from the hub, deduped across its members.')
    ),
    // References rather than embedded stations: the full objects were most of
    // this payload, and each member's own endpoint is one hop away.
    members: v.pipe(
      v.array(StationRefSchema),
      v.description('The stations making up this hub, in display order.')
    )
  }),
  v.title('Hub'),
  v.description('An interchange complex grouping several stations under one name. A hub carries no coordinates of its own — its members have those.')
)

export type Hub = v.InferOutput<typeof HubSchema>
export type HubKind = Hub['kind']
