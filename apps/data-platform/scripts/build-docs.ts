/*
 * Renders the API reference to static HTML at build time.
 *
 * The previous reference was Scalar, which shipped 3.55 MB of JavaScript (1 MB
 * gzipped) from a third-party CDN to display a 45 KB document — roughly 23x the
 * payload of the thing being displayed, all of it parsed and executed before
 * anything appeared. Nothing on the page needs a framework: it is a document.
 *
 * So the spec is read here, at build time, and emitted as HTML. The only
 * runtime script is a filter box and expand/collapse, which is why the page is
 * readable before any JS runs at all.
 *
 * Source: apps/api/src/app.ts serves /openapi.json, generated from
 * @commute/schemas. Reading it at build time (rather than fetching in the
 * browser) means the docs cannot drift from a spec that deployed, and the page
 * has no runtime dependency on the API being reachable.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SPEC_URL = process.env.DOCS_SPEC_URL ?? 'https://api.commute.shiorilabs.id/openapi.json'
const OUT = resolve(import.meta.dirname, '../docs.html')

// ── the slice of OpenAPI this page renders ──────────────────────────────────

interface JSONSchema {
  $ref?: string
  type?: string
  title?: string
  description?: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: string[]
  /** Discriminator literal on a union branch (`type: "RIDE"`). */
  const?: unknown
  examples?: unknown[]
  anyOf?: JSONSchema[]
  // Discriminated unions (FareLeg's RIDE/TRANSFER, Transfer's INTERNAL/EXTERNAL)
  // arrive as oneOf rather than anyOf.
  oneOf?: JSONSchema[]
  allOf?: JSONSchema[]
}

interface Parameter {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: JSONSchema
}

interface Operation {
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  responses?: Record<string, { description?: string, content?: Record<string, { schema?: JSONSchema }> }>
}

interface Spec {
  info: { title: string, version: string, description?: string, license?: { name: string } }
  servers?: { url: string, description?: string }[]
  tags?: { name: string, description?: string }[]
  paths: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, JSONSchema> }
}

/*
 * The document's named schemas, populated once per render.
 *
 * Responses reference shared shapes as `$ref: '#/components/schemas/Station'`
 * rather than inlining them (see apps/schemas — each registered schema carries
 * `v.metadata({ ref })`). Everything below that walks a schema has to be able
 * to follow those pointers, and a module-level registry is simpler than
 * threading the spec through eight recursive functions.
 */
let components: Record<string, JSONSchema> = {}

/** `#/components/schemas/Station` -> `Station`, or '' for anything else. */
const refName = (schema: JSONSchema | undefined): string =>
  schema?.$ref?.replace('#/components/schemas/', '') ?? ''

// ── signage ─────────────────────────────────────────────────────────────────

/*
 * Left-bar colour per tag, so each section of the reference reads as its own
 * plate — the same device the homepage uses to colour a beat's plate with the
 * line it is showing on the map (see .sign in src/style.css).
 *
 * Hardcoded rather than read from theme/line-colors.ts: that module imports the
 * 34 KB NETWORK constant to derive its palette, which is a fine trade on a page
 * that draws the network and a poor one here. These are build-time strings and
 * never reach the browser as data.
 *
 * One real network colour per tag, and all five distinct. An earlier version
 * gave Tarif and Operator the brand accent on the reasoning that they are
 * platform-level concerns — but with the legend and the per-row dots now
 * showing these side by side, three of five swatches came out the same pink and
 * the whole system read as broken. Distinctness is what makes a legend a
 * legend.
 */
const TAG_ACCENT: Record<string, string> = {
  'Stasiun': '#25B8EB', // KCI Commuter Line
  'Lin': '#ca2a51', // MRT Jakarta
  'Pumpunan Moda': '#F26324', // LRT Jakarta
  'Tarif': '#96C83E', // KCI Rangkasbitung
  'Operator': '#21409A' // LRT Jabodebek Cibubur
}

const tagAccent = (tag: string | undefined): string =>
  (tag && TAG_ACCENT[tag]) || 'var(--color-accent)'

// ── helpers ─────────────────────────────────────────────────────────────────

const esc = (value: string): string =>
  value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))

/** `backticks` in spec prose become inline code; nothing else is interpreted. */
const ticks = (value: string): string =>
  esc(value).replace(/`([^`]+)`/g, '<code>$1</code>')

/** Highlights `{param}` segments so a path reads as a template, not a string. */
const pathHTML = (path: string): string =>
  esc(path).replace(/\{(\w+)\}/g, '<span class="text-accent">{$1}</span>')

/*
 * The path with its last segment promoted.
 *
 * Seven of the twelve endpoints begin `/stations`, so the shared head is what
 * reads first while the tail is what actually distinguishes the row. Dimming
 * the head and bolding the tail is the difference between a scannable list and
 * a wall of near-identical strings. `{param}` keeps its accent either way,
 * because pathHTML() runs over both halves.
 */
const pathSplitHTML = (path: string): string => {
  const cut = path.lastIndexOf('/')
  if (cut <= 0) return `<span class="font-semibold text-white">${pathHTML(path)}</span>`
  // Params in the head are dimmed along with it. At full accent they outshone
  // the promoted tail and the row lost its focal point, which defeats the
  // whole split.
  const head = pathHTML(path.slice(0, cut)).replace(/text-accent/g, 'text-accent/45')
  return `<span class="text-white/40">${head}</span>`
    + `<span class="font-semibold text-white">${pathHTML(path.slice(cut))}</span>`
}

/*
 * The licence chip, linked where the identifier is one we know a canonical URL
 * for. Falls back to plain text rather than guessing a URL from the name, so an
 * unrecognised licence degrades to exactly what this used to render.
 */
const LICENSE_URL: Record<string, string> = {
  'ODbL-1.0': 'https://opendatacommons.org/licenses/odbl/1-0/',
  'MIT': 'https://opensource.org/licenses/MIT',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/'
}

const licenseHTML = (license: { name: string } | undefined): string => {
  if (!license) return ''
  const url = LICENSE_URL[license.name]
  if (!url) return ` · ${esc(license.name)}`
  return ` · <a href="${esc(url)}" class="underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/60 hover:decoration-white/40">${esc(license.name)}</a>`
}

const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/*
 * A copy control for the code block it sits in.
 *
 * It carries no payload of its own: the runtime handler reads the text from the
 * sibling `<pre>`. Duplicating each JSON body into a `data-copy` attribute cost
 * 1.7 KB gzipped (10% of the page) to store a string already present a few
 * bytes away.
 *
 * Rendered `hidden`, and revealed by src/docs.ts. A copy button is useless
 * without JavaScript, and a dead control is worse than an absent one; this way
 * the no-JS page simply never shows it.
 */
const copyButton = (label: string): string =>
  `<button type="button" class="copy absolute right-2 top-2 z-10 rounded border border-line/70 bg-plate/90 px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider text-white/40 backdrop-blur-sm transition-colors hover:border-accent/50 hover:text-white/80" `
  + `hidden aria-label="${esc(label)}">Salin</button>`

/*
 * A schema rendered as an indented field list rather than raw JSON Schema.
 * Depth is capped: past three levels the shape stops being scannable and the
 * reader is better served by the example payload below it.
 */
function schemaHTML(schema: JSONSchema | undefined, depth = 0): string {
  if (!schema || depth > 3) return ''

  /*
   * A reference stops here rather than expanding inline. Its fields live once
   * in the Skema section, and the type chip above is already a link there —
   * inlining a 2.8 KB Station under every endpoint that returns one is exactly
   * the duplication the $refs were introduced to remove.
   */
  if (schema.$ref) return ''

  // `oneOf` too, not just `anyOf`: the discriminated unions in this API
  // (FareLeg's RIDE/TRANSFER, Transfer's INTERNAL/EXTERNAL) arrive as oneOf,
  // and without this they rendered nothing at all here.
  const union = schema.anyOf ?? schema.oneOf
  if (union?.length) {
    // `nullable` is spelled anyOf: [T, null]; collapse it back rather than
    // rendering a union the reader has to decode.
    const nonNull = union.filter(s => s.type !== 'null')
    const nullable = union.length !== nonNull.length
    if (nonNull.length === 1) {
      return schemaHTML({ ...nonNull[0]!, description: schema.description ?? nonNull[0]!.description }, depth)
        + (nullable ? '<span class="ml-1 text-white/30">| null</span>' : '')
    }
    /*
     * A real union. Render every branch, labelled by its discriminator where
     * one exists — `type: RIDE` / `type: TRANSFER` is exactly what a reader
     * needs to tell the branches apart, and "salah satu dari 2 bentuk" (which
     * is all this used to say) told them a union existed and nothing else.
     */
    const branches = nonNull.map((branch) => {
      const discriminator = Object.entries(branch.properties ?? {})
        .find(([, p]) => typeof p.const === 'string')
      const label = discriminator
        ? `<code>${esc(discriminator[0])}: ${esc(String(discriminator[1].const))}</code>`
        : `bentuk ${nonNull.indexOf(branch) + 1}`
      return `<div class="mt-2 first:mt-0">`
        + `<p class="font-mono text-[10px] uppercase tracking-wider text-white/30">${label}</p>`
        + `<div class="mt-1">${schemaHTML(branch, depth + 1)}</div>`
        + `</div>`
    }).join('')
    return `<div class="border-l border-line/70 pl-3">${branches}</div>`
  }

  if (schema.type === 'array' && schema.items) {
    return `<span class="text-white/45">array berisi</span> ${schemaHTML(schema.items, depth)}`
  }

  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required ?? [])
    const rows = Object.entries(schema.properties).map(([name, prop]) => {
      const isRequired = required.has(name)
      const kind = prop.enum
        ? prop.enum.map(v => `<code>${esc(String(v))}</code>`).join(' ')
        : typeLabel(prop)
      const note = prop.description ? `<p class="mt-0.5 w-full max-w-[68ch] text-[12px] leading-snug text-white/45">${ticks(prop.description)}</p>` : ''
      // Descend into objects, arrays of objects, AND unions — a `oneOf` field
      // like FareResult.legs used to render its type chip and then nothing.
      const inner = prop.type === 'array' ? prop.items : prop
      /*
       * Only descend where there is something to show: an object's fields, or a
       * real union's branches. A nullable SCALAR (`anyOf: [number, null]`) is
       * already fully described by the type chip beside the name, and recursing
       * into it printed a second, redundant "number | null" row underneath.
       */
      const branches = (inner?.anyOf ?? inner?.oneOf ?? []).filter(b => b.type !== 'null')
      const isObjectUnion = branches.length > 1 && branches.every(b => b.type === 'object' || b.$ref)
      const nested = (inner && !inner.$ref && (inner.type === 'object' || isObjectUnion))
        ? `<div class="mt-1.5 border-l border-line/70 pl-3">${schemaHTML(inner, depth + 1)}</div>`
        : ''
      return `<div class="py-1.5">`
        + `<div class="flex flex-wrap items-baseline gap-x-2">`
        + `<code class="text-[13px] text-white/90">${esc(name)}</code>`
        + `<span class="font-mono text-[10px] uppercase tracking-wider text-white/35">${kind}</span>`
        + (isRequired ? '' : '<span class="font-mono text-[10px] uppercase tracking-wider text-white/25">opsional</span>')
        + `</div>${note}${nested}</div>`
    })
    return `<div class="divide-y divide-line/40">${rows.join('')}</div>`
  }

  return `<span class="font-mono text-[10px] uppercase tracking-wider text-white/35">${typeLabel(schema)}</span>`
}

function typeLabel(schema: JSONSchema): string {
  /*
   * A reference renders as the NAME it points at, linked to its entry in the
   * Skema section — `Station[]` rather than `object[]`. This is the whole point
   * of registering the schemas: a field's type stops being a shrug and becomes
   * a thing the reader can go and look at.
   */
  const ref = refName(schema)
  if (ref) {
    return `<a href="#skema-${slug(ref)}" class="text-white/60 underline decoration-white/20 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent/50">${esc(ref)}</a>`
  }

  // A discriminator carries `const` and no `type`, so it fell through to "any"
  // — on the very field whose whole purpose is to say which branch you have.
  // Its literal value IS its type.
  if (schema.const !== undefined) return String(schema.const)
  if (schema.enum) return 'enum'

  /*
   * `nullable` is spelled `anyOf: [T, null]` in OpenAPI 3.1, and without this
   * branch every nullable field rendered its type as "any" — latitude,
   * longitude, tripNumber and the rest, sixteen of them, all claiming to accept
   * anything when they are plainly `number` or `string`. schemaHTML() already
   * collapses this shape one level up; the label had simply never learned to.
   *
   * The union is reported honestly when it is a real one (a discriminated
   * union of object shapes), rather than being flattened to its first member.
   */
  const union = schema.anyOf ?? schema.oneOf
  if (union?.length) {
    const nonNull = union.filter(s => s.type !== 'null')
    if (nonNull.length === 1) return typeLabel(nonNull[0]!)
    if (nonNull.length > 1) {
      // Distinct member types are worth naming ("string | number"); a union of
      // several object shapes is not — "object | object | object" says less
      // than "object", and the discriminator is already visible in the field
      // list that schemaHTML renders below.
      const labels = [...new Set(nonNull.map(typeLabel))]
      return labels.length === 1 ? labels[0]! : labels.join(' | ')
    }
    return 'null'
  }

  if (schema.allOf?.length === 1) return typeLabel(schema.allOf[0]!)
  if (schema.type === 'array') return `${schema.items ? typeLabel(schema.items) : 'any'}[]`
  return schema.type ?? 'any'
}

/*
 * A concrete example built from the schema's own `examples` metadata — the same
 * values the live-parity test checks, so what is shown here is a shape the API
 * really returns rather than an invention.
 */
function exampleValue(schema: JSONSchema | undefined, depth = 0): unknown {
  // The cap only guards against a self-referential schema; it must not truncate
  // a real payload. Station.amenities[].type sits at depth 5, so a tighter cap
  // silently rendered `"type": null` in the example.
  if (!schema || depth > 8) return null
  if (schema.examples?.length) return schema.examples[0]
  if (schema.enum?.length) return schema.enum[0]

  if (schema.anyOf?.length) {
    const nonNull = schema.anyOf.find(s => s.type !== 'null')
    return nonNull ? exampleValue(nonNull, depth) : null
  }
  if (schema.type === 'array') return [exampleValue(schema.items, depth + 1)]
  if (schema.type === 'object' && schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, exampleValue(v, depth + 1)])
    )
  }
  if (schema.type === 'number') return 0
  if (schema.type === 'boolean') return true
  return 'string'
}

/** Minimal JSON syntax colouring, applied to already-escaped text. */
function jsonHTML(value: unknown): string {
  return esc(JSON.stringify(value, null, 2) ?? 'null')
    .replace(/&quot;([^&]*?)&quot;(\s*:)/g, '<span class="text-accent/80">&quot;$1&quot;</span>$2')
    .replace(/:\s*&quot;([^&]*?)&quot;/g, ': <span class="text-emerald-300/80">&quot;$1&quot;</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="text-white">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="text-white">$1</span>')
    .replace(/:\s*null/g, ': <span class="text-white/30">null</span>')
}

// ── page ────────────────────────────────────────────────────────────────────

/** Shared by the endpoint row and the sidebar link that targets it. */
const anchorOf = (method: string, path: string, index: number): string =>
  `${slug(method + path)}-${index}`

function operationHTML(path: string, method: string, op: Operation, anchor: string): string {
  const params = op.parameters ?? []
  const pathParams = params.filter(p => p.in === 'path')
  const queryParams = params.filter(p => p.in === 'query')

  /** Mono eyebrow with a leading rule, the homepage's section-label device. */
  const eyebrow = (label: string): string =>
    `<p class="flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/30">`
    + `<span class="h-px w-4 bg-white/15"></span>${esc(label)}</p>`

  const paramRows = (list: Parameter[], label: string): string => {
    if (!list.length) return ''
    return `<div class="mt-6">${eyebrow(label)}`
      + `<div class="mt-2 divide-y divide-line/40">`
      + list.map(p => `<div class="py-2">`
        + `<div class="flex flex-wrap items-baseline gap-x-2.5">`
        + `<code class="text-[13px] font-medium text-white/90">${esc(p.name)}</code>`
        + `<span class="font-mono text-[10px] uppercase tracking-wider text-white/30">${p.schema ? typeLabel(p.schema) : 'string'}</span>`
        // Quieter than the accent it used to carry: at full strength the
        // marker outshone the parameter name it was annotating.
        + (p.required ? '<span class="font-mono text-[9.5px] uppercase tracking-wider text-accent/55">wajib</span>' : '')
        + (p.schema?.examples?.[0] !== undefined
          ? `<code class="ml-auto font-mono text-[12px] text-white/35">${esc(String(p.schema.examples[0]))}</code>`
          : '')
        + `</div>`
        + (p.description ? `<p class="mt-1 w-full max-w-[68ch] text-[12px] leading-snug text-white/45">${ticks(p.description)}</p>` : '')
        + `</div>`).join('')
      + `</div></div>`
  }

  /*
   * Responses become tabs in the right column, the way every good reference does
   * it — status chips across the top, one payload below. Built on radio inputs
   * plus `:checked ~` sibling selectors so it costs ZERO JavaScript and still
   * shows the first payload when scripting is off. `name` is scoped per
   * endpoint so tab groups never fight each other.
   */
  const entries = Object.entries(op.responses ?? {})
  const tabs = entries.map((_, i) =>
    `<input type="radio" name="res-${anchor}" id="res-${anchor}-${i}" class="res-radio" data-res="${i}"${i === 0 ? ' checked' : ''} />`
  ).join('')

  const tabLabels = entries.map(([code], i) => {
    const ok = code.startsWith('2')
    const dot = ok ? 'bg-emerald-300/80' : 'bg-amber-300/80'
    return `<label for="res-${anchor}-${i}" class="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] text-white/35 transition-colors hover:text-white/70 res-tab" data-res="${i}">`
      + `<span class="h-1.5 w-1.5 rounded-full ${dot}"></span>${esc(code)}</label>`
  }).join('')

  const tabPanels = entries.map(([code, res], i) => {
    const schema = res.content?.['application/json']?.schema
    /*
     * A live 200 body if the build could reach the API, otherwise the
     * schema-synthesised shape. Only 2xx: an error example would need the
     * request to actually fail, and the error envelope is small enough that
     * the synthesised version says everything.
     */
    const live = code.startsWith('2') ? liveExamples.get(`${method} ${path}`) : undefined
    const payload = live ?? (schema ? exampleValue(schema) : undefined)
    const json = payload === undefined ? '' : JSON.stringify(payload, null, 2)

    return `<div class="res-panel" data-res="${i}">`
      + `<p class="max-w-[68ch] px-3.5 py-2.5 text-[12px] leading-snug text-white/45">${esc(res.description ?? '')}</p>`
      + (json
        ? `<div class="relative border-t border-line/50">`
        + copyButton('Salin respons')
        + `<pre class="overflow-x-auto bg-plate p-3.5 pr-12 font-mono text-[11.5px] leading-relaxed"><code>${jsonHTML(payload)}</code></pre>`
        + `</div>`
        : '')
      + `</div>`
  }).join('')

  // The 2xx body schema is the field reference and belongs in the reading
  // column, beside the parameters, not inside the payload panel.
  const okSchema = entries.find(([code]) => code.startsWith('2'))?.[1]
    ?.content?.['application/json']?.schema

  /*
   * The path carries the English vocabulary on its own (`/stations/{operator}`,
   * `/timetable/grouped`), so indexing method + path + the Indonesian summary
   * already matches both "timetable" and "jadwal" — no separate English index
   * is needed now that the summaries themselves are Indonesian.
   */
  const search = [method, path, op.summary ?? ''].join(' ').toLowerCase()

  return `<details id="${anchor}" class="group scroll-mt-24" data-endpoint data-search="${esc(search)}">`
    /*
     * A departure-board line (overlay/departures.ts): colour dot, the varying
     * thing set largest, a square mono chip, and the secondary text right-
     * aligned. Every row is the same height on purpose — that uniformity is
     * what lets the colour dot and the promoted path tail do their work.
     */
    + `<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.025]">`
    + `<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: ${tagAccent(op.tags?.[0])}"></span>`
    // `shrink-0` only from md: — it keeps desktop rows a uniform height by
    // making the summary absorb the flex pressure, but on a phone there is no
    // summary to absorb it and an unshrinkable 380px path shoves the method
    // chip and chevron clean off the viewport.
    + `<code class="min-w-0 truncate font-mono text-[13.5px] tracking-tight sm:text-[14.5px] md:shrink-0 md:overflow-visible">${pathSplitHTML(path)}</code>`
    + `<span class="ml-auto hidden min-w-0 truncate text-right text-[12.5px] text-white/35 md:block">${esc(op.summary ?? '')}</span>`
    // Demoted, squared, and moved to the end: every endpoint here is GET, so a
    // loud emerald chip was the highest-contrast element on the row carrying no
    // information at all. This is the PIDS platform chip instead.
    + `<span class="shrink-0 bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-white/40">${esc(method)}</span>`
    + `<svg class="chev h-3 w-3 shrink-0 text-white/25 transition-transform duration-200 group-hover:text-white/50" viewBox="0 0 12 12" fill="none" aria-hidden="true">`
    + `<path d="M4.2 2.4 8 6l-3.8 3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    + `</summary>`
    // Two columns from lg: prose and fields on the left, the payload riding
    // along on the right so a field and its value are read together.
    + `<div class="grid gap-8 border-t border-line/40 bg-plate/40 px-4 pb-8 pt-5 lg:grid-cols-[minmax(0,1fr)_26rem]">`
    + `<div class="min-w-0">`
    + (op.description ? `<p class="w-full max-w-[62ch] whitespace-pre-line text-[13.5px] leading-relaxed text-white/55">${ticks(op.description)}</p>` : '')
    + paramRows(pathParams, 'Parameter path')
    + paramRows(queryParams, 'Parameter query')
    + (okSchema ? `<div class="mt-6">${eyebrow('Bentuk data')}<div class="mt-2">${schemaHTML(okSchema)}</div></div>` : '')
    + `</div>`
    + `<div class="min-w-0 lg:sticky lg:top-24 lg:self-start">`
    + `<div class="border border-line/50 bg-plate/80 backdrop-blur-[6px]">`
    + tabs
    + `<div class="flex items-center gap-1 border-b border-line/50 px-2 py-1.5">${tabLabels}</div>`
    + tabPanels
    + `</div></div>`
    + `</div></details>`
}

/** One operation, as both rendered markup and the bits the sidebar needs. */
interface Entry {
  anchor: string
  path: string
  summary: string
  html: string
}

function render(spec: Spec): string {
  components = spec.components?.schemas ?? {}
  const byTag = new Map<string, Entry[]>()
  let index = 0

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? 'Lainnya'
      const anchor = anchorOf(method, path, index++)
      const html = operationHTML(path, method, op, anchor)
      byTag.set(tag, [...(byTag.get(tag) ?? []), { anchor, path, summary: op.summary ?? '', html }])
    }
  }

  const order = (spec.tags ?? []).map(t => t.name).filter(name => byTag.has(name))
  for (const tag of byTag.keys()) if (!order.includes(tag)) order.push(tag)

  const tagDescription = new Map((spec.tags ?? []).map(t => [t.name, t.description ?? '']))

  // Anchors are slugged from the tag, so they moved with the translation
  // (#stations -> #stasiun). Acceptable: the page has not shipped yet, so there
  // are no links in the wild to break. Once it has, renaming a tag is a
  // breaking change to every deep link into that section.
  /*
   * The sidebar maps the whole API, not just its five section names — with
   * twelve endpoints the full tree still fits without scrolling, and it is the
   * difference between "where is the Tarif section" and "where is the endpoint
   * I need". Both reference docs the design was drawn from nest this way.
   *
   * Endpoint labels are the path TAIL, for the same reason the rows promote it:
   * seven of twelve paths start `/stations`, so the head is noise in a 13rem
   * column. `data-spy` pairs a group with its section for the scroll-spy in
   * src/docs.ts; without JS these are simply anchor links that already work.
   */
  const nav = order.map((tag) => {
    const entries = byTag.get(tag)!
    /*
     * The summary, not the path, is the label.
     *
     * Path tails do not survive this API's shape: three of the seven station
     * routes reduce to `/stations/…`, and `/timetable` vs `/grouped` vs
     * `/timetable/…` gives no clue which is which. The summaries are already
     * written to distinguish exactly these ("Jadwal stasiun", "Jadwal stasiun,
     * dikelompokkan"), so they do the job the path cannot. The full path stays
     * on the title attribute for anyone who wants it.
     */
    const links = entries.map(e =>
      `<a href="#${e.anchor}" class="block truncate rounded py-[3px] pl-[15px] text-[12px] text-white/35 transition-colors hover:text-white/75" title="${esc(e.path)}">${esc(e.summary || e.path)}</a>`
    ).join('')

    return `<div class="nav-group" data-spy="${slug(tag)}" style="--nav-accent: ${tagAccent(tag)}">`
      + `<a href="#${slug(tag)}" class="nav-head flex items-center gap-2 rounded px-2 py-1 text-[13px] text-white/60 transition-colors hover:text-white">`
      + `<span class="nav-dot h-1.5 w-1.5 shrink-0 rounded-full transition-transform" style="background: ${tagAccent(tag)}"></span>`
      + `<span class="min-w-0 flex-1 truncate">${esc(tag)}</span>`
      + `<span class="font-mono text-[9.5px] text-white/25">${entries.length}</span>`
      + `</a>`
      + `<div class="mt-0.5 mb-3 ml-2 border-l border-line/60 pl-1">${links}</div>`
      + `</div>`
  }).join('')

  const sections = order.map((tag, i) => {
    const rows = byTag.get(tag)!
    // `first:` cannot do this — <main>'s first child is the header, not a
    // section, so the variant never matches and every section including the
    // first got the full 96px gap.
    return `<section id="${slug(tag)}" class="scroll-mt-24 ${i === 0 ? 'pt-12' : 'pt-24'}">`
      // The section's colour arrives as a structural left rule rather than the
      // floating pill this used to carry: it is `.sign`'s own 3px device at
      // section scale, and it binds the heading to its colour instead of
      // hovering above it. The eyebrow is a count — actual information, and it
      // sidesteps the problem that a translated tag name in an eyebrow would
      // just repeat the heading word for word.
      + `<div class="border-l-[3px] pl-4" style="border-color: ${tagAccent(tag)}">`
      + `<h2 class="text-[26px] font-bold tracking-tight text-white sm:text-[30px]">${esc(tag)}</h2>`
      + (tagDescription.get(tag) ? `<p class="mt-2 w-full max-w-[58ch] text-[14px] leading-relaxed text-white/45">${esc(tagDescription.get(tag)!)}</p>` : '')
      + `</div>`
      // One divided stack per section rather than N floating cards — the
      // departures board (overlay/departures.ts) uses exactly this:
      // `divide-y divide-line/50` inside a single plate. The backdrop blur only
      // does anything now that the dot field runs behind the whole page.
      + `<div class="mt-6 divide-y divide-line/50 border border-line/50 bg-plate/70 backdrop-blur-[6px]">${rows.map(r => r.html).join('')}</div>`
      + `</section>`
  }).join('')

  /*
   * There is deliberately no colour legend in the masthead.
   *
   * One existed while the sidebar was five bare section links, and it did real
   * work then. Once the sidebar grew to list every endpoint under a coloured,
   * labelled group, the legend was restating five labels that sit a column to
   * its left in the same five colours. The sidebar IS the legend.
   */

  /*
   * One entry per named schema, so a `Station[]` chip anywhere on the page has
   * somewhere to point. Only schemas the document actually references are
   * listed — an orphan in components/schemas would be documenting something no
   * endpoint returns.
   */
  const referenced = new Set(
    [...JSON.stringify({ paths: spec.paths, components })
      .matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)]
      .map(m => m[1]!)
  )
  const schemaNames = Object.keys(components).filter(n => referenced.has(n)).sort()

  /** The sidebar's sixth group, listing every named shape. */
  const schemaNav = (names: string[]): string => names.length
    ? `<div class="nav-group" data-spy="skema" style="--nav-accent: var(--color-accent)">`
    + `<a href="#skema" class="nav-head flex items-center gap-2 rounded px-2 py-1 text-[13px] text-white/60 transition-colors hover:text-white">`
    + `<span class="nav-dot h-1.5 w-1.5 shrink-0 rounded-full transition-transform" style="background: var(--color-accent)"></span>`
    + `<span class="min-w-0 flex-1 truncate">Skema</span>`
    + `<span class="font-mono text-[9.5px] text-white/25">${names.length}</span>`
    + `</a>`
    + `<div class="mt-0.5 mb-3 ml-2 border-l border-line/60 pl-1">`
    + names.map(n => `<a href="#skema-${slug(n)}" class="block truncate rounded py-[3px] pl-[15px] font-mono text-[11.5px] text-white/35 transition-colors hover:text-white/75">${esc(n)}</a>`).join('')
    + `</div></div>`
    : ''

  const schemaSection = schemaNames.length
    ? `<section id="skema" class="scroll-mt-24 pt-24">`
    + `<div class="border-l-[3px] pl-4" style="border-color: var(--color-accent)">`
    + `<h2 class="text-[26px] font-bold tracking-tight text-white sm:text-[30px]">Skema</h2>`
    + `<p class="mt-2 w-full max-w-[58ch] text-[14px] leading-relaxed text-white/45">Bentuk data yang dipakai berulang di beberapa endpoint. Tipe di atas menautkan ke sini.</p>`
    + `</div>`
    + `<div class="mt-6 divide-y divide-line/50 border border-line/50 bg-plate/70 backdrop-blur-[6px]">`
    + schemaNames.map((name) => {
      const schema = components[name]!
      return `<details id="skema-${slug(name)}" class="group scroll-mt-24" data-schema>`
        + `<summary class="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.025]">`
        + `<code class="min-w-0 shrink-0 font-mono text-[14.5px] font-semibold tracking-tight text-white">${esc(name)}</code>`
        + (schema.description
          ? `<span class="ml-auto hidden min-w-0 truncate text-right text-[12.5px] text-white/35 md:block">${esc(schema.description)}</span>`
          : '<span class="ml-auto"></span>')
        + `<svg class="chev h-3 w-3 shrink-0 text-white/25 transition-transform duration-200 group-hover:text-white/50" viewBox="0 0 12 12" fill="none" aria-hidden="true">`
        + `<path d="M4.2 2.4 8 6l-3.8 3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        + `</summary>`
        + `<div class="border-t border-line/40 bg-plate/40 px-4 pb-6 pt-4">`
        + (schema.description ? `<p class="mb-4 max-w-[62ch] text-[13.5px] leading-relaxed text-white/55">${ticks(schema.description)}</p>` : '')
        + schemaHTML({ ...schema, $ref: undefined })
        + `</div></details>`
    }).join('')
    + `</div></section>`
    : ''

  /*
   * The code dictionary.
   *
   * Every enum on the page is a set of opaque strings — `MRTJ`, `CGK`,
   * `ESCALATOR_PAID` — and a reader hitting one mid-schema should not have to
   * hunt for what it means. The labels are folded into each enum's description
   * upstream (apps/schemas/src/common.ts), so this parses them back out rather
   * than keeping a second copy that could disagree with the spec.
   *
   * Only enums whose descriptions actually carry `\`CODE\`: Label` pairs appear.
   * `hub`/`integrated` and `TRUNK`/`RAMP`/… are deliberately absent: their
   * descriptions already explain each value in prose, and a two-column table
   * would just restate it.
   */
  const dictionaries: { title: string, entries: [string, string][] }[] = []
  const seenDict = new Set<string>()

  const collectEnums = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) collectEnums(item)
      return
    }
    const schema = node as JSONSchema
    if (schema.enum?.length && schema.title && schema.description && !seenDict.has(schema.title)) {
      const pairs = [...schema.description.matchAll(/`([A-Z0-9_]+)`: ([^·.]+)/g)]
        .map(m => [m[1]!, m[2]!.trim()] as [string, string])
      if (pairs.length > 1) {
        seenDict.add(schema.title)
        dictionaries.push({ title: schema.title, entries: pairs })
      }
    }
    for (const value of Object.values(schema)) collectEnums(value)
  }
  collectEnums(spec.paths)
  collectEnums(components)

  const DICT_LABEL: Record<string, string> = {
    'Operator code': 'Operator',
    'Region code': 'Wilayah',
    'Amenity type': 'Fasilitas'
  }

  const dictionarySection = dictionaries.length
    ? `<section id="kamus" class="scroll-mt-24 pt-24">`
    + `<div class="border-l-[3px] pl-4" style="border-color: var(--color-accent)">`
    + `<h2 class="text-[26px] font-bold tracking-tight text-white sm:text-[30px]">Kamus</h2>`
    + `<p class="mt-2 w-full max-w-[58ch] text-[14px] leading-relaxed text-white/45">Arti kode-kode yang dipakai di seluruh API.</p>`
    + `</div>`
    + `<div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">`
    + dictionaries.map(d =>
      `<div class="border border-line/50 bg-plate/70 backdrop-blur-[6px]">`
      + `<p class="border-b border-line/50 px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/40">${esc(DICT_LABEL[d.title] ?? d.title)}</p>`
      + `<dl class="divide-y divide-line/40">`
      + d.entries.map(([code, label]) =>
        `<div class="flex items-baseline gap-3 px-4 py-2">`
        + `<dt class="shrink-0 font-mono text-[11.5px] text-accent/80">${esc(code)}</dt>`
        + `<dd class="min-w-0 flex-1 text-right text-[12.5px] text-white/60">${esc(label)}</dd>`
        + `</div>`).join('')
      + `</dl></div>`).join('')
    + `</div></section>`
    : ''

  const dictionaryNav = dictionaries.length
    ? `<div class="nav-group" data-spy="kamus" style="--nav-accent: var(--color-accent)">`
    + `<a href="#kamus" class="nav-head flex items-center gap-2 rounded px-2 py-1 text-[13px] text-white/60 transition-colors hover:text-white">`
    + `<span class="nav-dot h-1.5 w-1.5 shrink-0 rounded-full transition-transform" style="background: var(--color-accent)"></span>`
    + `<span class="min-w-0 flex-1 truncate">Kamus</span>`
    + `<span class="font-mono text-[9.5px] text-white/25">${dictionaries.length}</span>`
    + `</a></div>`
    : ''

  /*
   * The mobile section bar.
   *
   * Below lg: the sidebar is hidden and the page is six screens deep, which
   * left a reader on a phone with no way to reach a section except scrolling
   * past everything before it. This is a horizontally-scrolling strip of the
   * same destinations, pinned under the masthead.
   *
   * Plain anchor links carrying `data-spy-chip`: with no JavaScript it is a
   * working set of jump links, and with JavaScript the existing scroll-spy
   * highlights the current one and scrolls it into view. No open/close state,
   * nothing to trap focus in, nothing to get stuck open.
   */
  const chips = [
    ...order.map(tag => ({ id: slug(tag), label: tag, colour: tagAccent(tag) })),
    ...(schemaNames.length ? [{ id: 'skema', label: 'Skema', colour: 'var(--color-accent)' }] : []),
    ...(dictionaries.length ? [{ id: 'kamus', label: 'Kamus', colour: 'var(--color-accent)' }] : [])
  ]

  const sectionBar = chips.length
    ? `<div class="no-scrollbar sticky top-0 z-20 -mx-5 overflow-x-auto border-b border-line/50 bg-ink/85 backdrop-blur-md lg:hidden">`
    + `<div class="flex w-max items-center gap-1 px-5 py-2.5">`
    + chips.map(c =>
      `<a href="#${c.id}" data-spy-chip="${c.id}" class="flex shrink-0 items-center gap-1.5 rounded-full border border-line/60 px-3 py-1.5 text-[12.5px] text-white/55 transition-colors">`
      + `<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background: ${c.colour}"></span>`
      + `${esc(c.label)}</a>`).join('')
    + `</div></div>`
    : ''

  const server = spec.servers?.[0]?.url ?? ''

  // The spec's own description is markdown; only the parts that render safely
  // as prose are carried over. The full text stays in /openapi.json.
  const intro = (spec.info.description ?? '').split('\n\n')[0] ?? ''

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Referensi API · Commute Data Platform</title>
    <meta name="description" content="Referensi endpoint Commute API: stasiun, lin, pumpunan moda, tarif, dan operator." />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="canonical" href="https://data.commute.shiorilabs.id/docs" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet" />
    <script type="module" src="/src/docs.ts"></script>
  </head>
  <body class="font-sans text-white/80 antialiased selection:bg-accent/30">
    <!-- The dot field, persistent across the whole page exactly as the homepage
         does it (index.html: fixed inset-0 z-0). The ground colour lives on the
         html element (src/style.css), NOT on body — a background here would
         occlude the canvas entirely, since the canvas clears to transparent.
         Content sits at z-10, so the dots run behind everything and the .sign
         plates' backdrop-blur finally has something to blur. -->
    <canvas
      id="docs-field"
      aria-hidden="true"
      class="pointer-events-none fixed inset-0 z-0 h-full w-full"
    ></canvas>
    <!-- Two washes, both fixed rather than clipped to a band.

         The first is the homepage header's gradient verbatim: no bar, no rule,
         the fade IS the edge, and because it is fixed it reads at the top and
         only at the top.

         The second is a full-viewport veil. Once the lattice runs the whole
         page it sits behind dense schema prose and long JSON, and at the
         brightness needed to be visible at all it competes with the text. The
         homepage never has this problem — its copy lives on .sign plates over
         an empty map. Two thirds of an ink wash keeps the texture legible as
         texture while putting the type back in front. -->
    <div class="pointer-events-none fixed inset-0 z-[1] bg-ink/65"></div>
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-[1] h-[560px] bg-[linear-gradient(180deg,rgba(13,15,20,0.92)_0%,rgba(13,15,20,0.7)_40%,rgba(13,15,20,0.3)_72%,transparent_100%)]"
    ></div>

    <div class="relative z-10 mx-auto max-w-[1600px] px-5 pt-8 lg:px-10">
      <a href="/" class="inline-flex items-center" aria-label="Commute Data Platform">
        <!-- Sized by HEIGHT, width follows: the lockup is a two-line 431x137
             (~3.15:1), so constraining width instead would blow up its height. -->
        <img src="/logo.svg" alt="Commute Data Platform" width="431" height="137" class="h-9 w-auto sm:h-10" />
      </a>
    </div>

    <div class="relative z-10 mx-auto flex max-w-[1600px] gap-10 px-5 pb-8 lg:px-10">
      <!-- self-start is load-bearing: the parent is a flex row, so without it
           the nav stretches to the full height of the content column, and a
           sticky element taller than the viewport simply scrolls away. Height is
           capped to the viewport minus the offset, with its own scrollbar for
           the rare case the tree outgrows it. -->
      <nav class="no-scrollbar sticky top-20 hidden max-h-[calc(100vh-6rem)] w-[13.5rem] shrink-0 self-start overflow-y-auto pb-8 lg:block" style="margin-top: 3.5rem" aria-label="Bagian">
        <!-- No back-link here: the logo lockup directly above already links to
             the homepage, and two stacked back-links in the same corner is one
             too many. -->
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">Endpoint</p>
        <div class="mt-3 -ml-2">${nav}${schemaNav(schemaNames)}${dictionaryNav}</div>
      </nav>

      <main class="min-w-0 flex-1">
        <header class="w-full max-w-[68ch] pt-14">
          <p class="rise font-mono text-[10px] uppercase tracking-[0.18em] text-accent" style="animation-delay: 80ms">Referensi API</p>
          <h1 class="rise sign-shadow mt-4 text-[38px] font-extrabold leading-[0.98] tracking-tight text-white sm:text-5xl lg:text-[56px]" style="animation-delay: 160ms">${esc(spec.info.title)}</h1>
          <p class="rise sign-shadow mt-5 w-full max-w-[54ch] text-[15.5px] leading-relaxed text-white/60" style="animation-delay: 240ms">${esc(intro)}</p>
          <div class="rise mt-7 flex flex-wrap items-center gap-2" style="animation-delay: 320ms">
            <!-- The base URL is the one string every reader needs to paste
                 somewhere, so it gets a copy control of its own rather than
                 being selected by hand. Inline rather than absolute: this chip
                 sits in a flex row, not over a code block. -->
            <span class="inline-flex items-stretch overflow-hidden rounded border border-line/70 bg-plate">
              <code class="px-2.5 py-1.5 font-mono text-[12px] text-white/70">${esc(server)}</code>
              <button type="button" class="copy border-l border-line/70 px-2 font-mono text-[9.5px] uppercase tracking-wider text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/80" hidden data-copy="${esc(server)}" aria-label="Salin base URL">Salin</button>
            </span>
            <a href="${esc(server)}/openapi.json" class="rounded border border-line/70 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white/45 hover:border-accent/50 hover:text-white/80">openapi.json</a>
          </div>
          <!-- The licence is a link, not just a chip. This page renders only the
               first paragraph of info.description, so the spec's own Lisensi
               section never reaches it — an unexplained "ODbL-1.0" would be
               the only mention, and the one term a data consumer most needs to
               be able to look up. -->
          <p class="mt-5 font-mono text-[10px] uppercase tracking-wider text-white/25">v${esc(spec.info.version)}${licenseHTML(spec.info.license)} · ${Object.keys(spec.paths).length} endpoint</p>
          <p class="mt-2 max-w-[54ch] text-[12.5px] leading-relaxed text-white/35">Datanya bebas dipakai dan diolah, asal sumbernya tetap dicantumkan dan hasil olahannya dibagi dengan lisensi yang sama.</p>
        </header>

        <div class="mt-10 w-full max-w-[68ch]">
          <input
            id="filter"
            type="search"
            placeholder="Cari endpoint…"
            aria-label="Cari endpoint"
            class="w-full rounded border border-line/70 bg-plate px-3 py-2 text-[13.5px] text-white/85 placeholder:text-white/25 focus:border-accent/60 focus:outline-none"
          />
          <p id="filter-empty" hidden class="py-6 text-center text-[13px] text-white/35">Tidak ada endpoint yang cocok.</p>
        </div>

        ${sectionBar}

        ${sections}
        ${schemaSection}
        ${dictionarySection}
      </main>
    </div>

    <!-- The page ends the way the homepage does: on the grid spelling its own
         name. Outside the max-w-5xl container so the wordmark spans the full
         viewport. 70vh rather than the homepage's full screen — this is a
         lookup reference, and a whole empty viewport after the last endpoint
         reads as a broken page rather than an ending. -->
    <section class="relative z-10 mt-16 flex min-h-[70vh] items-end justify-center overflow-hidden px-6 pb-10">
      <canvas
        id="docs-wordmark"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 h-full w-full"
      ></canvas>
      <!-- Attribution only. A second line naming the spec source and build date
           used to sit under this; it was build metadata shown to readers who
           have no use for it, and anyone who does can read the spec directly.

           sign-shadow, and brighter than the homepage's /30: the footer field
           runs right under this line, and at /30 over a lit lattice the
           attribution was effectively unreadable. -->
      <p class="sign-shadow relative text-center font-mono text-[11px] text-white/55">© ${new Date().getFullYear()} Commute Data Platform · Dibuat oleh Shiori Labs</p>
    </section>
  </body>
</html>
`
}

// ── live examples ───────────────────────────────────────────────────────────

/*
 * Real responses, fetched at build time, instead of values invented from the
 * schema.
 *
 * A synthesised payload is honest about SHAPE and useless about everything
 * else: the fares example read `"legs": ["string"]`, which is not a fare, and
 * `"name": "string"` teaches a reader nothing about what a station looks like.
 * The API is public, GET-only and needs no credentials, so the documentation
 * can simply show what it actually returns — Sudirman with its real amenities,
 * a real Rp14,000 journey.
 *
 * Each endpoint's URL is built from its own parameter examples, which the spec
 * already carries, so nothing is hardcoded here and a new endpoint gets a live
 * example for free as long as its parameters have examples.
 */

/** Arrays longer than this are cut; a 102 KB /stations dump helps nobody. */
const MAX_ARRAY_ITEMS = 2

/**
 * The URL to call for an operation, or '' when a parameter has no example to
 * fill it with.
 */
function exampleURL(path: string, op: Operation): string {
  let url = path
  for (const p of op.parameters ?? []) {
    const value = p.schema?.examples?.[0]
    if (value === undefined) continue
    if (p.in === 'path') url = url.replace(`{${p.name}}`, encodeURIComponent(String(value)))
  }
  return url.includes('{') ? '' : url
}

/*
 * Long arrays keep their first couple of entries and gain a marker saying what
 * was dropped. Truncating rather than sampling keeps the JSON valid and the
 * shape obvious; the marker stops a reader thinking Jakarta has two stations.
 */
function truncate(value: unknown): unknown {
  if (Array.isArray(value)) {
    /*
     * Cutting one item to add a "… 1 lainnya" marker trades a real entry for a
     * note about it, which is a bad deal; only truncate when at least two are
     * hidden.
     */
    if (value.length <= MAX_ARRAY_ITEMS + 1) return value.map(truncate)
    const kept = value.slice(0, MAX_ARRAY_ITEMS).map(truncate)
    return [...kept, `… ${value.length - MAX_ARRAY_ITEMS} lainnya`]
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]))
  }
  return value
}

/**
 * Live 200 bodies keyed by `METHOD path`. Missing entries fall back to the
 * schema-synthesised example, so an unreachable API costs fidelity, never the
 * build.
 */
const liveExamples = new Map<string, unknown>()

async function collectLiveExamples(spec: Spec, base: string): Promise<void> {
  const wanted: { key: string, url: string }[] = []
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (method !== 'get') continue
      const url = exampleURL(path, op)
      if (url) wanted.push({ key: `${method} ${path}`, url })
    }
  }

  const results = await Promise.all(wanted.map(async ({ key, url }) => {
    try {
      const res = await fetch(base + url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      return { key, body: truncate(await res.json()) }
    } catch {
      return null
    }
  }))

  for (const hit of results) if (hit) liveExamples.set(hit.key, hit.body)
  const missed = wanted.length - liveExamples.size
  console.log(
    `live examples: ${liveExamples.size}/${wanted.length} from ${base}`
    + (missed ? ` (${missed} fell back to synthesised)` : '')
  )
}

// ── run ─────────────────────────────────────────────────────────────────────

/*
 * A failure here fails the build, deliberately: shipping CDP with a stale or
 * missing reference is worse than not shipping. The message names the fix,
 * because the usual cause is running this with no API up rather than anything
 * subtle.
 */
let response: Response
try {
  response = await fetch(SPEC_URL)
} catch (cause) {
  throw new Error(
    `Could not reach ${SPEC_URL}.\n`
    + '  Start the API (cd apps/api && pnpm dev) or point DOCS_SPEC_URL at a\n'
    + '  running one — e.g. DOCS_SPEC_URL=http://localhost:3000/openapi.json.',
    { cause }
  )
}

if (!response.ok) {
  throw new Error(`${SPEC_URL} returned HTTP ${response.status}. Expected the OpenAPI document.`)
}

const spec = await response.json() as Spec

/*
 * Examples come from the server the spec describes, not from SPEC_URL — those
 * differ when the document is read from a file or a preview host while the API
 * itself lives elsewhere. DOCS_API_BASE overrides for the case where neither
 * is reachable.
 */
const apiBase = process.env.DOCS_API_BASE
  ?? spec.servers?.[0]?.url
  ?? SPEC_URL.replace(/\/openapi\.json$/, '')
await collectLiveExamples(spec, apiBase)

writeFileSync(OUT, render(spec))

const endpoints = Object.values(spec.paths).reduce((n, methods) => n + Object.keys(methods).length, 0)
console.log(`docs.html — ${endpoints} endpoints from ${SPEC_URL}`)
