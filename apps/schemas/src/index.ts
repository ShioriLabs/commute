/*
 * @commute/schemas — the single definition of the Commute API's response shapes.
 *
 * The API (apps/api) pipes these into the OpenAPI document at /openapi.json.
 * The web app (apps/web) imports the inferred types. Because both sides read the
 * same file, a shape can no longer drift between what the API documents and what
 * the client expects — which it previously had, in three places.
 *
 * Import types, not schemas, unless you actually intend to validate:
 *
 *   import type { Station } from '@commute/schemas'          // free
 *   import { StationSchema } from '@commute/schemas'         // pulls in valibot
 */

export * from './common'
export * from './station'
export * from './hub'
export * from './line'
export * from './fare'
export * from './searchable'
