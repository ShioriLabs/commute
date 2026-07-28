import { describeRoute, resolver } from 'hono-openapi'
import * as v from 'valibot'
import { Envelope, ErrorResponseSchema } from './common'

/*
 * Helpers so each route annotation stays a few readable lines instead of a
 * nested wall of OpenAPI boilerplate.
 */

type Tag = 'Stations' | 'Hubs' | 'Lines' | 'Fares' | 'Operators'

const json = (schema: v.GenericSchema) => ({
  'application/json': { schema: resolver(schema) }
})

interface DocOptions {
  summary: string
  description?: string
  tag: Tag
  /** Response body inside `data`. */
  data: v.GenericSchema
  /** Error statuses this route can return, with what they mean. */
  errors?: Partial<Record<404 | 500, string>>
  parameters?: unknown[]
}

export function doc({ summary, description, tag, data, errors, parameters }: DocOptions) {
  const responses = {
    200: { description: 'Success.', content: json(Envelope(data)) },
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

export const operatorParam = pathParam('operator', 'Operator code, e.g. `KCI`, `MRTJ`, `TJ`.', 'KCI')
export const stationCodeParam = pathParam('stationCode', 'Operator-scoped station code — not the full station id.', 'AC')
