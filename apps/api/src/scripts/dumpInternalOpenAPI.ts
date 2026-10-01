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
  '/_internal/searchables'
]

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

  const kept: JsonObject = Object.fromEntries(APP_PATHS.map(path => [path, paths[path]]))

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
