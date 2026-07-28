import * as v from 'valibot'
import { LineKeySchema } from './common'
import { StationRefSchema } from './station'

export const HubSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['HUB-DKA'] })),
    slug: v.pipe(
      v.string(),
      v.description('Kunci URL. Bisa berubah, jadi pakai `id` kalau butuh yang stabil.'),
      v.metadata({ examples: ['dukuh-atas'] })
    ),
    name: v.pipe(v.string(), v.metadata({ examples: ['Dukuh Atas'] })),
    kind: v.pipe(
      v.picklist(['hub', 'integrated']),
      v.description('`hub`: beberapa stasiun dengan nama berbeda dalam satu kompleks, di mana pengelompokannya membawa informasi. `integrated`: satu tempat yang sama buat penumpang, terpisah antar operator cuma di datanya.'),
      v.metadata({ examples: ['hub'] })
    ),
    heroImage: v.pipe(
      v.nullable(v.string()),
      v.description('Foto kompleksnya, buat social card dan header halaman.')
    ),
    lines: v.pipe(
      v.array(LineKeySchema),
      v.description('Semua lin yang bisa diakses dari pumpunan moda ini, sudah digabung dari seluruh anggotanya.')
    ),
    // References rather than embedded stations: the full objects were most of
    // this payload, and each member's own endpoint is one hop away.
    members: v.pipe(
      v.array(StationRefSchema),
      v.description('Stasiun-stasiun yang membentuk pumpunan moda ini, urut sesuai tampilan.')
    )
  }),
  v.title('Hub'),
  v.description('Kompleks interchange yang menggabungkan beberapa stasiun dalam satu nama. Pumpunan moda nggak punya koordinat sendiri; yang punya itu stasiun anggotanya.')
)

export type Hub = v.InferOutput<typeof HubSchema>
export type HubKind = Hub['kind']
