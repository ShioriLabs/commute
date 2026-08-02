import { describeRoute, resolver } from 'hono-openapi'
import * as v from 'valibot'
import { Envelope, ErrorResponseSchema } from '@commute/schemas'

/*
 * Helpers so each route annotation stays a few readable lines instead of a
 * nested wall of OpenAPI boilerplate.
 */

type Tag = 'Stasiun' | 'Pumpunan Moda' | 'Lin' | 'Tarif' | 'Operator'

/*
 * `target` matters: the converter defaults to draft-07, which encodes a tuple as
 * `items: [...]`. That is invalid in OpenAPI 3.1 (which follows JSON Schema
 * 2020-12 and expects `prefixItems`), and it is exactly the shape
 * CompactSchedule produces. Without this the document fails spec validation.
 */
const json = (schema: v.GenericSchema) => ({
  'application/json': { schema: resolver(schema, { target: 'draft-2020-12' }) }
})

interface DocOptions {
  summary: string
  description?: string
  tag: Tag
  /** Response body inside `data`. */
  data: v.GenericSchema
  /** Error statuses this route can return, with what they mean. */
  errors?: Partial<Record<400 | 404 | 500, string>>
  parameters?: unknown[]
}

export function doc({ summary, description, tag, data, errors, parameters }: DocOptions) {
  const responses = {
    200: { description: 'Berhasil.', content: json(Envelope(data)) },
    ...Object.fromEntries(
      Object.entries(errors ?? {}).map(([status, message]) => [
        status,
        { description: message, content: json(ErrorResponseSchema) }
      ])
    )
  }

  return describeRoute({
    summary,
    ...(description ? { description } : {}),
    tags: [tag],
    ...(parameters ? { parameters } : {}),
    responses
  } as Parameters<typeof describeRoute>[0])
}

/** A path parameter, described once and reused. */
export function pathParam(name: string, description: string, example: string) {
  return {
    in: 'path',
    name,
    required: true,
    schema: { type: 'string', examples: [example] },
    description
  }
}

export function queryParam(name: string, description: string, example?: string) {
  return {
    in: 'query',
    name,
    required: false,
    schema: { type: 'string', ...(example ? { examples: [example] } : {}) },
    description
  }
}

export const operatorParam = pathParam('operator', 'Kode operator, misalnya `KCI`, `MRTJ`, `TJ`.', 'KCI')
export const stationCodeParam = pathParam('stationCode', 'Kode stasiun versi operatornya, bukan station id yang lengkap.', 'SUD')

/*
 * The departure-window pair, shared by every timetable endpoint so the three of
 * them cannot drift into describing the same two params differently.
 */
export const timeWindowParams = [
  queryParam('from', 'Awal rentang jam keberangkatan, format `HH:MM` 24 jam, waktu lokal Asia/Jakarta. Dibulatkan ke bawah ke jam bulat, jadi `12:13` sama saja dengan `12:00`. Kalau cuma `to` yang diisi, rentangnya mulai dari `00:00`.', '12:00'),
  queryParam('to', 'Akhir rentang jam keberangkatan. Dibulatkan ke atas sampai akhir jamnya, jadi `15:18` mencakup semua keberangkatan sampai `15:59` dan yang diminta tidak ada yang hilang. Boleh lebih kecil dari `from` buat rentang yang melewati tengah malam, misalnya `22:00` sampai `02:00`. Kalau persis sama dengan `from`, yang keluar sehari penuh.', '15:00')
]
