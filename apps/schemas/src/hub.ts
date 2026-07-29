import * as v from 'valibot'
import { LineKeySchema } from './common'
import { StationRefSchema } from './station'

export const HubSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['HUB-DKA'] })),
    slug: v.pipe(
      v.string(),
      v.description('Kunci buat URL-nya. Bisa berubah sewaktu-waktu, jadi pakai `id` kalau butuh yang stabil.'),
      v.metadata({ examples: ['dukuh-atas'] })
    ),
    name: v.pipe(v.string(), v.metadata({ examples: ['Dukuh Atas'] })),
    kind: v.pipe(
      v.picklist(['hub', 'integrated']),
      v.description('`hub`: beberapa stasiun yang namanya berbeda tapi ada di satu kompleks, jadi pengelompokannya membawa informasi. `integrated`: buat penumpang ini satu tempat yang sama, terpisahnya cuma di data antar operator.'),
      v.metadata({ examples: ['hub'] })
    ),
    heroImage: v.pipe(
      v.nullable(v.string()),
      v.description('Foto kompleksnya, buat social card dan header halaman.')
    ),
    lines: v.pipe(
      v.array(LineKeySchema),
      v.description('Semua lin yang bisa dinaiki dari sini, sudah digabung dari seluruh stasiun anggotanya.')
    ),
    // References rather than embedded stations: the full objects were most of
    // this payload, and each member's own endpoint is one hop away.
    members: v.pipe(
      v.array(StationRefSchema),
      v.description('Stasiun-stasiun yang ada di dalamnya, urut sesuai tampilan.')
    )
  }),
  v.title('Hub'),
  v.description('Beberapa stasiun yang dianggap satu tempat karena saling terhubung. Pumpunan moda sendiri tidak punya koordinat, yang punya stasiun-stasiun di dalamnya.'),
  v.metadata({ ref: 'Hub' })
)

export type Hub = v.InferOutput<typeof HubSchema>
export type HubKind = Hub['kind']
