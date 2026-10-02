import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildInternalDocument } from '../openapi-internal'

/*
 * Writes the internal OpenAPI document to the snapshot the Android app generates
 * its wire models from.
 *
 * A checked-in snapshot rather than a fetch at build time, so an Android build
 * needs neither this workspace installed nor a network: a schema change shows up
 * as a diff in that file, and then as a compile error in the app. Rerun this
 * whenever a schema the app reads changes.
 *
 * The document is built from route annotations alone, so no database or KV
 * binding is needed.
 *
 * What is written is not what `buildInternalDocument` returns verbatim: it is cut
 * down to the routes the app reads (`pruneToAppPaths`) and restated for code
 * generators (`normalizeForCodegen`).
 */
const SNAPSHOT = path.resolve(__dirname, '../../../android/openapi/commute-internal.json')

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

const isObject = (node: Json | undefined): node is JsonObject =>
  typeof node === 'object' && node !== null && !Array.isArray(node)

const refName = (node: Json) =>
  isObject(node) && typeof node.$ref === 'string' ? node.$ref.replace('#/components/schemas/', '') : undefined

/*
 * Restates three things in the form code generators read.
 *
 * The document is correct as generated, and every rewrite below says the same
 * thing in different words. But generators lag JSON Schema 2020-12, and each of
 * these made one fall back to an untyped `Any`, which does not even compile
 * under kotlinx.serialization:
 *
 *   - `const: 'STATION'` becomes a one-value `enum`. Same meaning, older keyword.
 *   - A `oneOf` whose variants all pin the same property to a different constant
 *     gains a `discriminator` naming it. That is what turns the union into a
 *     sealed type rather than three unrelated classes.
 *   - A bare `number` gains `format: double`, or it is generated as BigDecimal.
 *
 * And one thing is deliberately loosened. A string `enum` of more than one value
 * becomes a plain string, its values kept in the description. The API's enums
 * only ever grow (a new amenity, a new operator), which is an additive change
 * for the API and a crash for an installed app: kotlinx.serialization fails the
 * whole response on a value its enum class does not know. The one-value enums
 * that discriminate unions stay, since those are the union.
 *
 * Applied to the snapshot only. The served /openapi.json is untouched.
 */
function normalizeForCodegen(document: JsonObject): JsonObject {
  const components = document.components
  const schemas = isObject(components) && isObject(components.schemas) ? components.schemas : {}

  // Read before any rewrite, while `const` is still there to find.
  const constantsOf = (name: string): Record<string, string> => {
    const schema = schemas[name]
    const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {}
    const constants: Record<string, string> = {}
    for (const [key, property] of Object.entries(properties)) {
      if (isObject(property) && typeof property.const === 'string') constants[key] = property.const
    }
    return constants
  }

  const discriminatorFor = (variants: Json[]): Json | undefined => {
    const names = variants.map(refName)
    if (names.length < 2 || names.some(name => name === undefined)) return undefined

    const constants = (names as string[]).map(constantsOf)
    const propertyName = Object.keys(constants[0]).find(
      key => constants.every(variant => key in variant)
        && new Set(constants.map(variant => variant[key])).size === constants.length
    )
    if (!propertyName) return undefined

    return {
      propertyName,
      mapping: Object.fromEntries(
        (names as string[]).map((name, index) => [constants[index][propertyName], `#/components/schemas/${name}`])
      )
    }
  }

  const visit = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(visit)
    if (!isObject(node)) return node

    const next: JsonObject = { ...node }

    if (Array.isArray(next.oneOf) && !('discriminator' in next)) {
      const discriminator = discriminatorFor(next.oneOf)
      if (discriminator) next.discriminator = discriminator
    }

    if ('const' in next && typeof next.const !== 'object') {
      const { const: constant, ...rest } = next
      return visit({ ...rest, type: typeof constant, ...(typeof constant === 'string' ? { enum: [constant] } : {}) })
    }

    if (next.type === 'number' && !('format' in next)) next.format = 'double'

    if (Array.isArray(next.enum) && next.enum.length > 1 && next.enum.every(value => typeof value === 'string')) {
      const values = next.enum.map(value => `\`${String(value)}\``).join(', ')
      const description = typeof next.description === 'string' ? `${next.description} ` : ''
      delete next.enum
      next.type = 'string'
      next.description = `${description}Nilai yang dikenal saat ini: ${values}. Bisa bertambah.`
    }

    for (const [key, value] of Object.entries(next)) next[key] = visit(value)
    return next
  }

  return visit(document) as JsonObject
}

/*
 * The routes the Android app reads. Add a path here when a screen starts
 * consuming it, then rerun the script.
 */
const APP_PATHS = [
  '/_internal/searchables',
  '/_internal/trips/{from}/{to}',
  '/operators',
  '/stations/{operator}/{stationCode}',
  '/stations/{operator}/{stationCode}/timetable/grouped',
  '/stations/{operator}/{stationCode}/transfers'
]

/*
 * Response shapes the app never asks for, left out of the snapshot even where a
 * route it reads can return them.
 *
 * CompactGroupedTimetable is the `?compact=1` answer of the grouped timetable.
 * Its CompactSchedule is a `[string | null, number]` tuple that no typed model
 * can express, and the app asks for the full form instead, which is a little
 * larger on the wire (4.4 against 3.3 KB gzipped for Manggarai) and typed.
 */
const APP_EXCLUDED_SCHEMAS = new Set([
  'CompactGroupedTimetable'
])

/*
 * Cuts the document down to `APP_PATHS` and the components they reach.
 *
 * The app's generator emits a class for every component it is handed, so a
 * snapshot of the whole API would regenerate the app's models whenever any
 * schema changed, including the ones no screen reads. It would also have to
 * compile all of them, and CompactSchedule is a `[string | null, number]` tuple
 * that no typed model can express. That one is a problem for the day a screen
 * needs the compact timetable, not a reason to hold up the rest.
 */
function pruneToAppPaths(document: JsonObject): JsonObject {
  const paths = isObject(document.paths) ? document.paths : {}
  const missing = APP_PATHS.filter(path => !(path in paths))
  if (missing.length > 0) throw new Error(`not described: ${missing.join(', ')}`)

  // A union that offered an excluded shape keeps the rest; one left with a single
  // alternative becomes that alternative.
  const dropExcluded = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(dropExcluded)
    if (!isObject(node)) return node

    const next: JsonObject = {}
    for (const [key, value] of Object.entries(node)) next[key] = dropExcluded(value)

    for (const union of ['anyOf', 'oneOf']) {
      const alternatives = next[union]
      if (!Array.isArray(alternatives)) continue
      const excludes = (alternative: Json) => {
        const name = refName(alternative) ?? (isObject(alternative) && isObject(alternative.items) ? refName(alternative.items) : undefined)
        return name !== undefined && APP_EXCLUDED_SCHEMAS.has(name)
      }
      const kept = alternatives.filter(alternative => !excludes(alternative))
      if (kept.length === alternatives.length) continue
      if (kept.length === 1 && isObject(kept[0])) {
        const rest = Object.fromEntries(Object.entries(next).filter(([key]) => key !== union))
        return { ...rest, ...kept[0] }
      }
      next[union] = kept
    }
    return next
  }

  const kept = dropExcluded(Object.fromEntries(APP_PATHS.map(path => [path, paths[path]]))) as JsonObject

  const components = isObject(document.components) ? document.components : {}
  const schemas = isObject(components.schemas) ? components.schemas : {}

  const reached = new Set<string>()
  const collect = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(collect)
    if (!isObject(node)) return

    const name = refName(node)
    if (name && !reached.has(name)) {
      reached.add(name)
      collect(schemas[name] ?? null)
    }
    Object.values(node).forEach(collect)
  }
  collect(kept)

  const usedTags = new Set(
    Object.values(kept).flatMap(methods => isObject(methods)
      ? Object.values(methods).flatMap(op => isObject(op) && Array.isArray(op.tags) ? op.tags : [])
      : [])
  )

  return {
    ...document,
    tags: Array.isArray(document.tags)
      ? document.tags.filter(tag => isObject(tag) && usedTags.has(tag.name))
      : [],
    paths: kept,
    components: {
      ...components,
      // In document order, so the snapshot's diff follows the source's.
      schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => reached.has(name)))
    }
  }
}

async function main() {
  const document = normalizeForCodegen(
    pruneToAppPaths(await buildInternalDocument() as unknown as JsonObject)
  )

  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true })
  fs.writeFileSync(SNAPSHOT, JSON.stringify(document, null, 2) + '\n')
  console.log(`Wrote ${path.relative(process.cwd(), SNAPSHOT)}`)
}

void main()
