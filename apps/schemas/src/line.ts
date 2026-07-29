import * as v from 'valibot'
import type { HexColored } from './common'
import { LineKeySchema, LineSchema, OperatorCodeSchema, OperatorSchema } from './common'

export const LineStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-SUD'] })),
    code: v.string(),
    name: v.pipe(v.string(), v.description('Nama tampilan.')),
    stationNumber: v.pipe(
      v.string(),
      v.description('Label posisi di sepanjang lin, misalnya `C13`.'),
      v.metadata({ examples: ['C12'] })
    ),
    isInterchange: v.pipe(
      v.boolean(),
      v.description('True kalau stasiun ini titik pindah ke lin lain.')
    ),
    otherLines: v.pipe(
      v.array(LineKeySchema),
      v.description('Lin lain dari operator yang SAMA yang berhenti di sini, berupa line key. Lin yang sedang dibuka tidak termasuk. Sambungan lintas operator ada di transfer stasiunnya.')
    )
  }),
  v.title('LineStation'),
  v.description('Satu stasiun di sepanjang lin, urut dari stasiun awal.'),
  v.metadata({ ref: 'LineStation' })
)

export const LineSegmentSchema = v.pipe(
  v.object({
    kind: v.pipe(
      v.picklist(['TRUNK', 'CONTINUATION', 'RAMP', 'LOOP']),
      v.description('`TRUNK`: jalur utama. `CONTINUATION`: cabang yang meneruskan jalur utama dan terbaca sebagai mainline. `RAMP`: cabang samping yang memisah. `LOOP`: cabang yang menyatu kembali ke jalur utama.'),
      v.metadata({ examples: ['TRUNK'] })
    ),
    joinsAtCode: v.pipe(
      v.nullable(v.string()),
      v.description('Kode stasiun tempat cabang ini berpisah dari jalur utama; null buat `TRUNK`.')
    ),
    stations: v.array(LineStationSchema)
  }),
  v.title('LineSegment'),
  v.description('Satu ruas lin. Lin lurus cuma punya satu ruas `TRUNK`; lin bercabang punya beberapa.'),
  v.metadata({ ref: 'LineSegment' })
)

export const LineDetailSchema = v.pipe(
  v.object({
    operator: OperatorSchema,
    // The line itself is spelled out rather than keyed: this response IS the
    // line, so making the reader resolve a key would be perverse.
    line: LineSchema,
    segments: v.pipe(
      v.array(LineSegmentSchema),
      v.description('Struktur lin secara urut. Lin sederhana cuma punya satu `TRUNK`; lin bercabang menambah segmen lain.')
    )
  }),
  v.title('LineDetail'),
  v.description('Struktur lengkap satu lin: segmen-segmennya, plus stasiun yang dilewati tiap segmen.'),
  v.metadata({ ref: 'LineDetail' })
)

/*
 * The line dictionary. Everything else in the API refers to lines by key
 * (`KCI:C`); this is where those keys resolve to a name and colour, so the full
 * Line objects belong here.
 */
export const OperatorWithLinesSchema = v.pipe(
  v.object({
    code: OperatorCodeSchema,
    name: v.string(),
    lines: v.array(LineSchema)
  }),
  v.title('OperatorWithLines'),
  v.description('Operator beserta seluruh lin yang dijalankannya. Ini yang dikembalikan `/operators`.'),
  v.metadata({ ref: 'OperatorWithLines' })
)

export type LineStation = v.InferOutput<typeof LineStationSchema>
export type LineSegment = v.InferOutput<typeof LineSegmentSchema>
export type LineSegmentKind = LineSegment['kind']
export type LineDetail = HexColored<v.InferOutput<typeof LineDetailSchema>>
export type OperatorWithLines = HexColored<v.InferOutput<typeof OperatorWithLinesSchema>>

/*
 * Aliases matching the names the web app has always used for these shapes.
 * Kept so the migration to this package didn't have to rename call sites.
 */
export type LineDetailStation = LineStation
export type LineDetailSegment = LineSegment
