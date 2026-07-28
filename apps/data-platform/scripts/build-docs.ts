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
 * The values are the operator colours these tags correspond to; Fares and
 * Operators are platform-level concerns rather than any one operator, so they
 * take the brand accent.
 */
const TAG_ACCENT: Record<string, string> = {
  'Stasiun': '#25B8EB', // KCI Commuter Line
  'Lin': '#ca2a51', // MRT Jakarta
  'Pumpunan Moda': '#F26324', // LRT Jakarta
  'Tarif': 'var(--color-accent)',
  'Operator': 'var(--color-accent)'
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

function operationHTML(path: string, method: string, op: Operation, index: number): string {
  // Not `id` — that name belongs to the translation helper above.
  const anchor = `${slug(method + path)}-${index}`
  const params = op.parameters ?? []
  const pathParams = params.filter(p => p.in === 'path')
  const queryParams = params.filter(p => p.in === 'query')

  const paramRows = (list: Parameter[], label: string): string => {
    if (!list.length) return ''
    return `<p class="mt-4 font-mono text-[10px] uppercase tracking-wider text-white/35">${label}</p>`
      + `<div class="mt-1.5 divide-y divide-line/40">`
      + list.map(p => `<div class="py-1.5">`
        + `<div class="flex flex-wrap items-baseline gap-x-2">`
        + `<code class="text-[13px] text-white/90">${esc(p.name)}</code>`
        + (p.required ? '<span class="font-mono text-[10px] uppercase tracking-wider text-accent/70">wajib</span>' : '')
        + (p.schema?.examples?.[0] !== undefined
          ? `<code class="ml-auto text-[12px] text-white/40">${esc(String(p.schema.examples[0]))}</code>`
          : '')
        + `</div>`
        + (p.description ? `<p class="mt-0.5 text-[12px] leading-snug text-white/45">${ticks(p.description)}</p>` : '')
        + `</div>`).join('')
      + `</div>`
  }

  const responses = Object.entries(op.responses ?? {}).map(([code, res]) => {
    const schema = res.content?.['application/json']?.schema
    const ok = code.startsWith('2')
    const tone = ok ? 'text-emerald-300/90 bg-emerald-300/10' : 'text-amber-300/90 bg-amber-300/10'
    const body = ok && schema
      ? `<pre class="mt-2 overflow-x-auto rounded border border-line/60 bg-plate p-3 font-mono text-[11.5px] leading-relaxed"><code>${jsonHTML(exampleValue(schema))}</code></pre>`
      + `<div class="mt-3">${schemaHTML(schema)}</div>`
      : ''
    return `<div class="mt-3">`
      + `<div class="flex items-baseline gap-2">`
      + `<span class="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${tone}">${esc(code)}</span>`
      + `<span class="text-[13px] text-white/55">${esc(res.description ?? '')}</span>`
      + `</div>${body}</div>`
  }).join('')

  /*
   * The path carries the English vocabulary on its own (`/stations/{operator}`,
   * `/timetable/grouped`), so indexing method + path + the Indonesian summary
   * already matches both "timetable" and "jadwal" — no separate English index
   * is needed now that the summaries themselves are Indonesian.
   */
  const search = [method, path, op.summary ?? ''].join(' ').toLowerCase()

  return `<details id="${anchor}" class="sign scroll-mt-4 mb-2" style="--sign-accent: ${tagAccent(op.tags?.[0])}" data-endpoint data-search="${esc(search)}">`
    + `<summary class="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-white/[0.03]">`
    + `<span class="rounded bg-emerald-300/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300/90">${esc(method)}</span>`
    + `<code class="min-w-0 break-all font-mono text-[13px] text-white/90">${pathHTML(path)}</code>`
    + `<span class="ml-auto hidden truncate text-[12.5px] text-white/40 sm:block">${esc(op.summary ?? '')}</span>`
    + `<svg class="chev h-3 w-3 shrink-0 text-white/30 transition-transform" viewBox="0 0 12 12" fill="none" aria-hidden="true">`
    + `<path d="M4.2 2.4 8 6l-3.8 3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    + `</summary>`
    + `<div class="px-4 pb-5">`
    + (op.description ? `<p class="max-w-[62ch] whitespace-pre-line text-[13.5px] leading-relaxed text-white/55">${ticks(op.description)}</p>` : '')
    + paramRows(pathParams, 'Parameter path')
    + paramRows(queryParams, 'Parameter query')
    + `<p class="mt-5 font-mono text-[10px] uppercase tracking-wider text-white/35">Respons</p>`
    + responses
    + `</div></details>`
}

function render(spec: Spec): string {
  const byTag = new Map<string, string[]>()
  let index = 0

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? 'Lainnya'
      const html = operationHTML(path, method, op, index++)
      byTag.set(tag, [...(byTag.get(tag) ?? []), html])
    }
  }

  const order = (spec.tags ?? []).map(t => t.name).filter(name => byTag.has(name))
  for (const tag of byTag.keys()) if (!order.includes(tag)) order.push(tag)

  const tagDescription = new Map((spec.tags ?? []).map(t => [t.name, t.description ?? '']))

  // Anchors are slugged from the tag, so they moved with the translation
  // (#stations -> #stasiun). Acceptable: the page has not shipped yet, so there
  // are no links in the wild to break. Once it has, renaming a tag is a
  // breaking change to every deep link into that section.
  const nav = order.map(tag =>
    `<a href="#${slug(tag)}" class="flex items-center gap-2 rounded px-2 py-1 text-[13px] text-white/50 hover:bg-white/[0.04] hover:text-white/80">`
    + `<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background: ${tagAccent(tag)}"></span>`
    + `${esc(tag)}</a>`
  ).join('')

  const sections = order.map(tag =>
    `<section id="${slug(tag)}" class="scroll-mt-4 pt-12">`
    // A coloured rule rather than the mono eyebrow the homepage uses: with the
    // tag names translated, an eyebrow would have repeated the heading word for
    // word. The bar carries the section's colour on its own.
    + `<div class="h-0.5 w-8 rounded-full" style="background: ${tagAccent(tag)}"></div>`
    + `<h2 class="mt-3 text-[19px] font-bold tracking-tight text-white">${esc(tag)}</h2>`
    + (tagDescription.get(tag) ? `<p class="mt-1 max-w-[60ch] text-[13.5px] text-white/45">${esc(tagDescription.get(tag)!)}</p>` : '')
    + `<div class="mt-4">${byTag.get(tag)!.join('')}</div>`
    + `</section>`
  ).join('')

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
  <body class="relative bg-ink font-sans text-white/80 antialiased">
    <!-- Masthead band. The dot field runs the full height of the lockup AND the
         title block below it, then fades out downward — the same device the
         homepage header uses: no hard bar, no rule, the fade IS the edge.
         Fixed height rather than content height so the canvas reserves its space
         before it paints (zero CLS) and the fade always lands in the same place.
         Both the canvas and the gradient are decorative and empty in the markup,
         so neither can delay the text paint. -->
    <div class="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
      <canvas
        id="docs-field"
        aria-hidden="true"
        class="absolute inset-0 h-full w-full"
      ></canvas>
      <div
        class="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,15,20,0.86)_0%,rgba(13,15,20,0.7)_45%,rgba(13,15,20,0.35)_75%,transparent_100%)]"
      ></div>
    </div>

    <div class="relative mx-auto max-w-5xl px-5 pt-8 lg:px-8">
      <a href="/" class="inline-flex items-center" aria-label="Commute Data Platform">
        <!-- Sized by HEIGHT, width follows: the lockup is a two-line 431x137
             (~3.15:1), so constraining width instead would blow up its height. -->
        <img src="/logo.svg" alt="Commute Data Platform" width="431" height="137" class="h-9 w-auto sm:h-10" />
      </a>
    </div>

    <div class="relative mx-auto flex max-w-5xl gap-8 px-5 pb-8 lg:px-8">
      <nav class="sticky top-8 hidden h-[calc(100vh-4rem)] w-44 shrink-0 overflow-y-auto pt-10 lg:block" aria-label="Bagian">
        <a href="/" class="block font-mono text-[10px] uppercase tracking-wider text-white/35 hover:text-white/60">&larr; Commute Data</a>
        <p class="mt-5 font-mono text-[10px] uppercase tracking-wider text-white/35">Endpoint</p>
        <div class="mt-1.5 -ml-2">${nav}</div>
      </nav>

      <main class="min-w-0 flex-1">
        <header class="pt-8">
          <p class="font-mono text-[10px] uppercase tracking-wider text-accent">Referensi API</p>
          <h1 class="sign-shadow mt-3 text-[30px] font-extrabold leading-tight tracking-tight text-white">${esc(spec.info.title)}</h1>
          <p class="sign-shadow mt-3 max-w-[62ch] text-[14px] leading-relaxed text-white/55">${esc(intro)}</p>
          <div class="mt-5 flex flex-wrap items-center gap-2">
            <code class="rounded border border-line/70 bg-plate px-2.5 py-1.5 font-mono text-[12px] text-white/70">${esc(server)}</code>
            <a href="${esc(server)}/openapi.json" class="rounded border border-line/70 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white/45 hover:border-accent/50 hover:text-white/80">openapi.json</a>
          </div>
          <p class="mt-4 font-mono text-[10px] uppercase tracking-wider text-white/25">v${esc(spec.info.version)}${spec.info.license ? ` · ${esc(spec.info.license.name)}` : ''} · ${Object.keys(spec.paths).length} endpoint</p>
        </header>

        <div class="mt-7">
          <input
            id="filter"
            type="search"
            placeholder="Cari endpoint…"
            aria-label="Cari endpoint"
            class="w-full rounded border border-line/70 bg-plate px-3 py-2 text-[13.5px] text-white/85 placeholder:text-white/25 focus:border-accent/60 focus:outline-none"
          />
          <p id="filter-empty" hidden class="py-6 text-center text-[13px] text-white/35">Nggak ada endpoint yang cocok.</p>
        </div>

        ${sections}
      </main>
    </div>

    <!-- The page ends the way the homepage does: on the grid spelling its own
         name. Outside the max-w-5xl container so the wordmark spans the full
         viewport. 70vh rather than the homepage's full screen — this is a
         lookup reference, and a whole empty viewport after the last endpoint
         reads as a broken page rather than an ending. -->
    <section class="relative mt-16 flex min-h-[70vh] items-end justify-center overflow-hidden px-6 pb-10">
      <canvas
        id="docs-wordmark"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 h-full w-full"
      ></canvas>
      <div class="relative text-center font-mono text-[11px] leading-relaxed">
        <p class="text-white/30">© ${new Date().getFullYear()} Commute Data Platform · Dibuat oleh Shiori Labs</p>
        <p class="mt-1 text-white/20">Dibuat dari /openapi.json waktu build · ${new Date().toISOString().slice(0, 10)}</p>
      </div>
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
