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
  type?: string
  title?: string
  description?: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  enum?: string[]
  examples?: unknown[]
  anyOf?: JSONSchema[]
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
}

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

const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/*
 * A schema rendered as an indented field list rather than raw JSON Schema.
 * Depth is capped: past three levels the shape stops being scannable and the
 * reader is better served by the example payload below it.
 */
function schemaHTML(schema: JSONSchema | undefined, depth = 0): string {
  if (!schema || depth > 3) return ''

  if (schema.anyOf?.length) {
    // `nullable` is spelled anyOf: [T, null]; collapse it back rather than
    // rendering a union the reader has to decode.
    const nonNull = schema.anyOf.filter(s => s.type !== 'null')
    const nullable = schema.anyOf.length !== nonNull.length
    if (nonNull.length === 1) {
      return schemaHTML({ ...nonNull[0]!, description: schema.description ?? nonNull[0]!.description }, depth)
        + (nullable ? '<span class="ml-1 text-white/30">| null</span>' : '')
    }
    return `<span class="text-white/45">salah satu dari ${nonNull.length} bentuk</span>`
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
      const note = prop.description ? `<p class="mt-0.5 text-[12px] leading-snug text-white/45">${ticks(prop.description)}</p>` : ''
      const nested = (prop.type === 'object' || (prop.type === 'array' && prop.items?.type === 'object'))
        ? `<div class="mt-1.5 border-l border-line/70 pl-3">${schemaHTML(prop.type === 'array' ? prop.items : prop, depth + 1)}</div>`
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
  if (schema.enum) return 'enum'
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
        + (p.description ? `<p class="mt-1 text-[12px] leading-snug text-white/45">${ticks(p.description)}</p>` : '')
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

  const tabPanels = entries.map(([, res], i) => {
    const schema = res.content?.['application/json']?.schema
    return `<div class="res-panel" data-res="${i}">`
      + `<p class="px-3.5 py-2.5 text-[12px] leading-snug text-white/45">${esc(res.description ?? '')}</p>`
      + (schema
        ? `<pre class="overflow-x-auto border-t border-line/50 bg-plate p-3.5 font-mono text-[11.5px] leading-relaxed"><code>${jsonHTML(exampleValue(schema))}</code></pre>`
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
      + `<p class="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/30">${rows.length} endpoint</p>`
      + `<h2 class="mt-2 text-[26px] font-bold tracking-tight text-white sm:text-[30px]">${esc(tag)}</h2>`
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
        <div class="mt-3 -ml-2">${nav}</div>
      </nav>

      <main class="min-w-0 flex-1">
        <header class="w-full max-w-[68ch] pt-14">
          <p class="rise font-mono text-[10px] uppercase tracking-[0.18em] text-accent" style="animation-delay: 80ms">Referensi API</p>
          <h1 class="rise sign-shadow mt-4 text-[38px] font-extrabold leading-[0.98] tracking-tight text-white sm:text-5xl lg:text-[56px]" style="animation-delay: 160ms">${esc(spec.info.title)}</h1>
          <p class="rise sign-shadow mt-5 w-full max-w-[54ch] text-[15.5px] leading-relaxed text-white/60" style="animation-delay: 240ms">${esc(intro)}</p>
          <div class="rise mt-7 flex flex-wrap items-center gap-2" style="animation-delay: 320ms">
            <code class="rounded border border-line/70 bg-plate px-2.5 py-1.5 font-mono text-[12px] text-white/70">${esc(server)}</code>
            <a href="${esc(server)}/openapi.json" class="rounded border border-line/70 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white/45 hover:border-accent/50 hover:text-white/80">openapi.json</a>
          </div>
          <p class="mt-5 font-mono text-[10px] uppercase tracking-wider text-white/25">v${esc(spec.info.version)}${spec.info.license ? ` · ${esc(spec.info.license.name)}` : ''} · ${Object.keys(spec.paths).length} endpoint</p>
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

        ${sections}
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
writeFileSync(OUT, render(spec))

const endpoints = Object.values(spec.paths).reduce((n, methods) => n + Object.keys(methods).length, 0)
console.log(`docs.html — ${endpoints} endpoints from ${SPEC_URL}`)
