import * as v from 'valibot'

/*
 * The prebaked hop shapes served by GET /_internal/track-shapes, for the
 * Android trip mode (docs/track-shapes.md). Internal like /_internal/searchables:
 * no compatibility promise, but one definition shared by producer and consumer.
 */
export const TrackShapesSchema = v.pipe(
  v.object({
    version: v.pipe(
      v.string(),
      v.description('Berubah setiap kali ada bentuk jalur yang berubah. Bandingkan saja, jangan diurai.'),
      v.metadata({ examples: ['3f9a1c07'] })
    ),
    attribution: v.pipe(
      v.string(),
      v.description('Atribusi sumber data yang wajib ikut ditampilkan.')
    ),
    shapes: v.pipe(
      v.record(v.string(), v.string()),
      v.description('Bentuk jalur tiap pasangan stasiun berurutan, dengan key `{dari}>{ke}` pakai id stasiun. Nilainya encoded polyline Google, presisi 5. Pasangan yang tidak ada berarti bentuknya belum kami punya, jadi pakai garis lurus.'),
      v.metadata({ examples: [{ 'KCI-MRI>KCI-TEB': 'v_ve@yfmjS...' }] })
    )
  }),
  v.title('TrackShapes'),
  v.description('Bentuk jalur fisik antarstasiun untuk semua tahap perjalanan naik kendaraan.'),
  v.metadata({ ref: 'TrackShapes' })
)

export type TrackShapes = v.InferOutput<typeof TrackShapesSchema>
