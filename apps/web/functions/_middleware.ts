import type { CompactGroupedTimetable, Hub, Line, LineDetail, OperatorWithLines, Station } from '@commute/schemas'

/**
 * Pages Function middleware: crawler-facing SEO for the client-rendered SPA.
 *
 * The app is a client-rendered SPA (ssr: false), so every route serves the same
 * index.html shell: a spinner `<body>` plus the static tags from app/root.tsx.
 * Crawlers don't run JS, so:
 *   - Link-preview crawlers (Discord/WhatsApp/…) only ever see generic OG tags.
 *   - Search crawlers (Googlebot/Bingbot) see no indexable body content, so the
 *     deep station/line/hub pages never rank for queries like "jadwal krl".
 *
 * For crawler UAs this middleware serves the normal shell via ctx.next() and,
 * using HTMLRewriter, (1) rewrites the <head> title + description + OG/Twitter
 * tags and (2) appends a lightweight, text-only crawlable block plus JSON-LD to
 * the <body> - all from live API data (already KV-read-through with D1
 * fallback). Humans pass straight through untouched.
 *
 * It also serves /sitemap.xml (built from the API) for every UA.
 */

interface Env {
  API_BASE_URL: string
}

const SITE_ORIGIN = 'https://commute.shiorilabs.id'
// Prerendered per-item cards (see scripts/build-og-images.ts). Station files are
// keyed by station id (OPERATOR-CODE); hubs by slug.
const stationOgImage = (id: string) => `${SITE_ORIGIN}/img/og/stations/${id}.png`
const hubOgImage = (slug: string) => `${SITE_ORIGIN}/img/og/hubs/${slug}.png`
// Line files are keyed OPERATOR-LINECODE (e.g. KCI-C).
const lineOgImage = (operator: string, lineCode: string) => `${SITE_ORIGIN}/img/og/lines/${operator}-${lineCode}.png`
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/img/og-image.png`
// Fare cards can't be prerendered (arbitrary station pairs); the commute-og
// worker generates them on demand from the two full station ids.
const OG_WORKER_ORIGIN = 'https://og.commute.shiorilabs.id'
const fareOgImage = (from: string, to: string) => `${OG_WORKER_ORIGIN}/fare/${encodeURIComponent(from)}/${encodeURIComponent(to)}`

// Lowercased substrings matched against the User-Agent of known crawlers (link
// previews + search engines). Humans never match, so they skip the API
// subrequest entirely.
const CRAWLER_UA = [
  'facebookexternalhit',
  'twitterbot',
  'slackbot',
  'discordbot',
  'whatsapp',
  'telegrambot',
  'googlebot',
  'bingbot',
  'linkedinbot',
  'pinterest',
  'redditbot',
  'embedly',
  'skypeuripreview',
  'applebot',
  'yandex',
  'duckduckbot',
  'baiduspider'
]

// Per-operator search vocabulary. Commute is not KRL-only - an MRT/LRT station
// page must not say "Jadwal KRL". `mode` is the short term people actually
// search ("KRL", "MRT", "LRT"); `vehicle` is the vehicle noun ("kereta"/"bus")
// and `stop` the stop noun ("Stasiun"/"Halte"). Keyed by operator code; unknown
// operators fall back to a generic rail vocabulary.
interface OperatorVocab {
  mode: string
  vehicle: string
  stop: string
}
const OPERATOR_VOCAB: Record<string, OperatorVocab> = {
  KCI: { mode: 'KRL', vehicle: 'kereta', stop: 'Stasiun' },
  MRTJ: { mode: 'MRT', vehicle: 'kereta', stop: 'Stasiun' },
  LRTJ: { mode: 'LRT', vehicle: 'kereta', stop: 'Stasiun' },
  LRTJBDB: { mode: 'LRT', vehicle: 'kereta', stop: 'Stasiun' },
  TJ: { mode: 'TransJakarta', vehicle: 'bus', stop: 'Halte' },
  APCGK: { mode: 'Kalayang', vehicle: 'kereta', stop: 'Stasiun' }
}
const GENERIC_VOCAB: OperatorVocab = { mode: 'kereta', vehicle: 'kereta', stop: 'Stasiun' }
function vocabFor(operator: string): OperatorVocab {
  return OPERATOR_VOCAB[operator] ?? GENERIC_VOCAB
}

interface OgData {
  title: string
  description: string
  image: string
  // Optional extra HTML injected into <body> for search crawlers: an <h1> +
  // text content + JSON-LD. Absent for link-preview-only pages.
  bodyHtml?: string
}

/*
 * Response subsets, derived from @commute/schemas rather than hand-declared.
 *
 * Only the fields this file renders are picked — a crawler needs a name and a
 * line list, not amenities or coordinates — but `Pick` ties them to the real
 * definitions, so a reshape that drops or renames one breaks the build here.
 * Hand-copied shapes did not: this file silently read `station.lines.map(l =>
 * l.name)` for a while after `lines` became a string array.
 *
 * The imports are type-only, so nothing is added to the bundle. (Wrangler
 * resolves them fine; an older comment here claimed a Pages Function could not
 * import from the workspace, which is no longer true.)
 */
type APILine = Pick<Line, 'name' | 'lineCode' | 'colorCode' | 'searchable'>

/** `officialName` is the operator's own spelling; kept as a search/SEO alias. */
type APIStation = Pick<Station, 'id' | 'name' | 'lines' | 'officialName' | 'searchable'>

type APIHub = Pick<Hub, 'name' | 'heroImage' | 'kind'> & {
  members: APIStation[]
}

// Inlined rather than imported from @commute/constants: HUB_KIND_LABEL is a
// value, and keeping this file's runtime imports at zero keeps the crawler path
// dependency-free.
function hubKindLabel(hub: APIHub): string {
  return hub.kind === 'hub' ? 'Pumpunan Moda' : 'Stasiun Terintegrasi'
}

type APILineDetail = Pick<LineDetail, 'operator' | 'line'> & {
  segments: { stations: { name?: string }[] }[]
}

/*
 * `KCI:C` -> `C`. Grouped timetables carry line keys; resolving them to full
 * names would mean fetching /operators on every crawl, and the bare code reads
 * fine in a heading a crawler consumes.
 */
function lineLabel(key: string): string {
  return key.split(':')[1] ?? key
}

/*
 * The `?compact=1` grouped timetable. `label` is narrowed to a string because
 * this file joins it before rendering, unlike the app which keeps the array.
 */
type GroupedLineTimetable = Pick<CompactGroupedTimetable, 'line'> & {
  timetable: {
    label: string
    destinations: Pick<
      CompactGroupedTimetable['timetable'][number]['destinations'][number],
      'boundFor' | 'via' | 'schedules'
    >[]
  }[]
}

type APIOperator = Pick<OperatorWithLines, 'code' | 'name'> & { lines: APILine[] }

interface APIResponse<T> {
  status: number
  data?: T
  error?: { message: string, code: string }
}

function isCrawler(ua: string | null): boolean {
  if (!ua) return false
  const lower = ua.toLowerCase()
  return CRAWLER_UA.some(bot => lower.includes(bot))
}

// Minimal HTML-escaping for text interpolated into injected markup. HTMLRewriter
// escapes attribute values (AttrSetter) and title text (TextSetter) for us, but
// bodyHtml is appended as raw HTML so it must be escaped here.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// The compact timetable returns each departure as minutes since local midnight
// (e.g. 327 -> "05:27") for the crawlable markup and JSON-LD.
function departureTime(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// Build the crawlable body block + JSON-LD for a station. Kept text-only and
// visually hidden so it never affects the human SPA (which hydrates over it).
function buildStationBody(
  station: APIStation,
  operator: string,
  code: string,
  timetable: GroupedLineTimetable[] | null
): string {
  const name = station.name
  const vocab = vocabFor(operator)
  // `lines` are operator-qualified keys (`KCI:C`); the bare code is what a
  // crawler needs, and resolving names would mean an extra /operators fetch.
  const lineNames = station.lines.map(lineLabel)

  const lineItems = lineNames.map(n => `<li>${esc(n)}</li>`).join('')
  const linesSection = lineItems
    ? `<h2>Lin yang melayani ${vocab.stop} ${esc(name)}</h2><ul>${lineItems}</ul>`
    : ''

  let departuresSection = ''
  const scheduleLd: Record<string, unknown>[] = []
  if (timetable && timetable.length > 0) {
    const blocks: string[] = []
    for (const line of timetable) {
      const rows: string[] = []
      for (const group of line.timetable) {
        for (const dest of group.destinations) {
          const times = dest.schedules
            .map(s => departureTime(s[1]))
            .filter(Boolean)
          if (times.length === 0) continue
          const via = dest.via ? ` (via ${esc(dest.via)})` : ''
          rows.push(
            `<li>Arah ${esc(dest.boundFor)}${via}: ${esc(times.slice(0, 8).join(', '))}</li>`
          )
          for (const t of times.slice(0, 4)) {
            scheduleLd.push({
              '@type': 'Schedule',
              'scheduleTimezone': 'Asia/Jakarta',
              'name': `${lineLabel(line.line)} → ${dest.boundFor}`,
              'departureTime': t
            })
          }
        }
      }
      if (rows.length > 0) {
        blocks.push(`<h3>${esc(lineLabel(line.line))}</h3><ul>${rows.join('')}</ul>`)
      }
    }
    if (blocks.length > 0) {
      departuresSection = `<h2>Jadwal keberangkatan berikutnya</h2>${blocks.join('')}`
    }
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': operator === 'TJ' ? 'BusStation' : 'TrainStation',
    'name': `${vocab.stop} ${name}`,
    'identifier': `${operator}-${code}`,
    'url': `${SITE_ORIGIN}/stations/${operator}/${code}`,
    'address': { '@type': 'PostalAddress', 'addressRegion': 'Jabodetabek', 'addressCountry': 'ID' },
    ...(scheduleLd.length > 0 ? { event: scheduleLd } : {})
  }

  return (
    `<section aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">`
    + `<h1>Jadwal ${vocab.mode} ${vocab.stop} ${esc(name)} (${esc(code)})</h1>`
    + `<p>Lihat jadwal dan jam keberangkatan ${vocab.vehicle} di ${vocab.stop} ${esc(name)} kagak pake ribet dan gratis di Commute.</p>`
    + linesSection
    + departuresSection
    + `</section>`
    + `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  )
}

function buildLineBody(detail: APILineDetail, stationCount: number): string {
  const stationNames: string[] = []
  for (const seg of detail.segments) {
    for (const s of seg.stations) {
      const n = s.name
      if (n) stationNames.push(n)
    }
  }
  const items = stationNames.map(n => `<li>${esc(n)}</li>`).join('')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': `Rute ${detail.line.name}`,
    'numberOfItems': stationCount,
    'itemListElement': stationNames.map((n, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'name': `Stasiun ${n}`
    }))
  }
  return (
    `<section aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">`
    + `<h1>Jadwal ${esc(detail.line.name)}</h1>`
    + `<p>Rute, ${stationCount} stasiun, dan jam keberangkatan ${esc(detail.line.name)} (${esc(detail.operator.name)}).</p>`
    + (items ? `<h2>Stasiun yang dilalui</h2><ul>${items}</ul>` : '')
    + `</section>`
    + `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  )
}

function buildHubBody(hub: APIHub, slug: string, memberNames: string): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TrainStation',
    'name': hub.name,
    'url': `${SITE_ORIGIN}/hubs/${slug}`,
    'description': memberNames ? `Stasiun terintegrasi: ${memberNames}` : undefined
  }
  const items = hub.members
    .map(m => m.name)
    .filter(Boolean)
    .map(n => `<li>${esc(n)}</li>`)
    .join('')
  return (
    `<section aria-hidden="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">`
    + `<h1>Jadwal Kereta ${esc(hub.name)}</h1>`
    + `<p>Stasiun terintegrasi ${esc(hub.name)} di Jabodetabek.</p>`
    + (items ? `<h2>Stasiun terhubung</h2><ul>${items}</ul>` : '')
    + `</section>`
    + `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  )
}

async function resolveOg(pathname: string, searchParams: URLSearchParams, env: Env): Promise<OgData | null> {
  // NOTE: the homepage "/" is intentionally not handled here. Under the current
  // deploy the static index.html shadows this middleware for "/", so a "/" case
  // would never run. Station/line/hub/fare paths have no shadowing asset and are
  // handled normally below. See the sitemap for how "/" is still discoverable.

  // Static pages need no API lookup - resolve before the API_BASE_URL guard.
  if (pathname === '/map') {
    return {
      title: 'Peta Integrasi KRL, MRT & LRT Jabodetabek - Commute',
      description: 'Cek peta integrasi KRL, MRT, LRT, dan Transjakarta se-Jabodetabek, kagak pake ribet.',
      image: `${SITE_ORIGIN}/img/og-map.png`
    }
  }

  const base = env.API_BASE_URL
  if (!base) return null

  if (pathname === '/fare') {
    const fromId = searchParams.get('from')
    const toId = searchParams.get('to')

    if (fromId && toId) {
      const [fromOp, fromCode] = fromId.split('-')
      const [toOp, toCode] = toId.split('-')

      const [fromStation, toStation] = await Promise.all([
        fetchJson<APIStation>(`${base}/stations/${encodeURIComponent(fromOp)}/${encodeURIComponent(fromCode)}`),
        fetchJson<APIStation>(`${base}/stations/${encodeURIComponent(toOp)}/${encodeURIComponent(toCode)}`)
      ])

      if (fromStation && toStation) {
        const fromName = fromStation.name
        const toName = toStation.name
        return {
          title: `Cek Tarif ${fromName} ke ${toName} - Commute`,
          description: `Cek tarif dari ${fromName} ke ${toName} kagak pake ribet, biar pas tap out gak ada drama saldo kurang.`,
          image: fareOgImage(fromId, toId)
        }
      }
    }

    return {
      title: 'Kalkulator Tarif KRL, MRT, dan LRT - Commute',
      description: 'Cek tarif KRL, MRT, dan LRT se-Jabodetabek kagak pake ribet, biar pas tap out gak ada drama saldo kurang.',
      image: DEFAULT_OG_IMAGE
    }
  }

  const hubMatch = pathname.match(/^\/hubs\/([^/]+)$/)
  if (hubMatch) {
    const slug = decodeURIComponent(hubMatch[1])
    const hub = await fetchJson<APIHub>(`${base}/hubs/${encodeURIComponent(slug)}`)
    if (!hub) return null
    const memberNames = hub.members
      .map(m => m.name)
      .filter(Boolean)
      .join(', ')
    return {
      title: `Jadwal Kereta ${hub.name} - ${hubKindLabel(hub)} - Commute`,
      description: memberNames
        ? `Cek jadwal kereta di ${hub.name} kagak pake ribet. Stasiun terintegrasi: ${memberNames}.`
        : `Cek jadwal kereta di stasiun terintegrasi ${hub.name} kagak pake ribet.`,
      image: hub.heroImage || hubOgImage(slug),
      bodyHtml: buildHubBody(hub, slug, memberNames)
    }
  }

  const lineMatch = pathname.match(/^\/lines\/([^/]+)\/([^/]+)$/)
  if (lineMatch) {
    const operator = decodeURIComponent(lineMatch[1])
    const lineCode = decodeURIComponent(lineMatch[2])
    const detail = await fetchJson<APILineDetail>(
      `${base}/lines/${encodeURIComponent(operator)}/${encodeURIComponent(lineCode)}`
    )
    if (!detail) return null
    const stationCount = detail.segments.reduce((n, s) => n + s.stations.length, 0)
    return {
      title: `Jadwal ${detail.line.name} - Rute & Jam Keberangkatan - Commute`,
      description: `Cek rute, ${stationCount} stasiun, dan jam keberangkatan ${detail.line.name} (${detail.operator.name}) kagak pake ribet.`,
      image: lineOgImage(detail.operator.code, detail.line.lineCode),
      bodyHtml: buildLineBody(detail, stationCount)
    }
  }

  const stationMatch = pathname.match(/^\/stations\/([^/]+)\/([^/]+)$/)
  if (stationMatch) {
    const operator = decodeURIComponent(stationMatch[1])
    const code = decodeURIComponent(stationMatch[2])
    const [station, timetable] = await Promise.all([
      fetchJson<APIStation>(`${base}/stations/${encodeURIComponent(operator)}/${encodeURIComponent(code)}`),
      fetchJson<GroupedLineTimetable[]>(`${base}/stations/${encodeURIComponent(operator)}/${encodeURIComponent(code)}/timetable/grouped?compact=1`)
    ])
    if (!station) return null
    const name = station.name
    const vocab = vocabFor(operator)
    return {
      title: `Jadwal ${vocab.mode} ${vocab.stop} ${name} (${code}) - Commute`,
      description: `Cek jadwal & jam keberangkatan ${vocab.mode} di ${vocab.stop} ${name} kagak pake ribet, lengkap per jalur. Gratis di Commute.`,
      image: stationOgImage(station.id),
      bodyHtml: buildStationBody(station, operator, code, timetable)
    }
  }

  return null
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json() as APIResponse<T>
    return body.data ?? null
  } catch {
    return null
  }
}

/*
 * Whether an item is worth putting in front of a crawler.
 *
 * Routing-only items — TJ feeder stops, and the feeder lines they sit on —
 * carry `searchable: false`. Their pages resolve to nothing, so the SPA shell
 * answers under a 200 with its generic title; because that shell is identical
 * for every such path, a batch of them reads to Google as one page duplicated
 * many times rather than as many missing pages. Sixty-eight TJ lines were
 * indexed exactly that way.
 *
 * `=== false` rather than a truthiness check, because the flag is optional on
 * Line: producers that trim it (SearchableLine) leave it undefined, and reading
 * absent as unsearchable would drop those from the sitemap entirely. Stations
 * always carry it.
 */
export function isCrawlablePage(item: { searchable?: boolean }): boolean {
  return item.searchable !== false
}

/*
 * The sitemap's URL list, given already-fetched API data.
 *
 * Split from the fetching so the selection rules are testable without a
 * network: `stationLists` is positional, one entry per operator.
 */
export function sitemapUrls(
  operators: APIOperator[],
  stationLists: (APIStation[] | null)[],
  hubs: { slug?: string, name?: string }[]
): string[] {
  const urls = new Set<string>([
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/search`,
    `${SITE_ORIGIN}/fare`,
    `${SITE_ORIGIN}/map`
  ])

  operators.forEach((op, i) => {
    for (const line of op.lines ?? []) {
      if (!isCrawlablePage(line)) continue
      urls.add(`${SITE_ORIGIN}/lines/${op.code}/${line.lineCode}`)
    }
    for (const station of stationLists[i] ?? []) {
      if (!isCrawlablePage(station)) continue
      // station.id is OPERATOR-CODE; the route path is /stations/:operator/:code.
      // TJ halte codes contain hyphens, so only the first segment is dropped.
      const code = station.id.split('-').slice(1).join('-')
      urls.add(`${SITE_ORIGIN}/stations/${op.code}/${code}`)
    }
  })

  for (const hub of hubs) {
    if (hub.slug) urls.add(`${SITE_ORIGIN}/hubs/${encodeURIComponent(hub.slug)}`)
  }

  return [...urls]
}

// Build /sitemap.xml from live API data: core pages + every crawlable station,
// line, and hub. Cached in the Cloudflare edge cache since it fans out to
// several API calls and rarely changes.
async function buildSitemap(env: Env): Promise<string> {
  const base = env.API_BASE_URL

  let urls: string[] = sitemapUrls([], [], [])
  if (base) {
    const operators = await fetchJson<APIOperator[]>(`${base}/operators`) ?? []
    // Stations per operator + lines from the operator payload + hubs, fetched in parallel.
    const [stationLists, hubs] = await Promise.all([
      Promise.all(
        operators.map(op => fetchJson<APIStation[]>(`${base}/stations/${encodeURIComponent(op.code)}`))
      ),
      fetchJson<{ slug?: string, name?: string }[]>(`${base}/hubs`).then(h => h ?? [])
    ])
    urls = sitemapUrls(operators, stationLists, hubs)
  }

  const body = urls
    .map(u => `  <url><loc>${esc(u)}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

/*
 * Build output that must never be answered by the SPA fallback.
 *
 * `not_found_handling = "single-page-application"` turns a 404 for a missing
 * /assets/<hash>.js into a 200 text/html. On its own that only breaks the one
 * request — but public/_headers stamps /assets/* with
 * `max-age=2592000, immutable`, so Cloudflare's edge caches that HTML under a
 * JS URL for thirty days. Every later visitor to the same edge node then gets
 * HTML for a module, fails the strict MIME check, and the app never hydrates.
 *
 * That is not hypothetical: it happened to /assets/manifest-f354457b.js during
 * a deploy, when the shell went live a moment before its assets did. A request
 * landed in that window, the fallback answered, and the poisoned entry outlived
 * the deploy that caused it. Purging the cache was the only way out.
 *
 * The window is inherent to deploying — assets and the shell referencing them
 * cannot go live atomically — so the fix is to make the fallback uncacheable
 * for these paths rather than to try to close it.
 */
// Exported for app/lib/asset-fallback-guard.test.ts. Pages Functions have no
// test runner of their own here, and these two predicates are the whole
// decision — worth pinning even though the handler around them isn't covered.
export const HASHED_ASSET_PATH = /^\/assets\/.+\.(?:js|mjs|css|json|map)$/
export const HTML_CONTENT_TYPE = /^\s*text\/html/i

/** True when `next()` answered a hashed-asset request with the SPA fallback. */
export function isFallbackForAsset(pathname: string, contentType: string | null): boolean {
  return HASHED_ASSET_PATH.test(pathname) && HTML_CONTENT_TYPE.test(contentType ?? '')
}

/*
 * A 404 with `no-store`, in place of the SPA fallback's cacheable 200 HTML.
 *
 * 404 rather than a 5xx because the asset genuinely is not there, and it is
 * what the browser's module loader and the service worker's own
 * `isSpaFallbackPoison` check already expect. `no-store` is the load-bearing
 * part: it keeps this response out of the edge cache and the browser's, so the
 * next request after the deploy settles gets the real file.
 */
function assetNotFound(): Response {
  return new Response('', {
    status: 404,
    headers: {
      'cache-control': 'no-store, must-revalidate',
      'content-type': 'text/plain; charset=utf-8'
    }
  })
}

// Overwrite the `content` attribute of a matched <meta> element.
class AttrSetter {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setAttribute('content', this.value)
  }
}

// Replace the text content of a matched element (e.g. <title>). `text: false`
// keeps the value plain text so names with & or < can't break markup.
class TextSetter {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setInnerContent(this.value, { html: false })
  }
}

// Append raw HTML inside a matched element (used to inject crawlable body content).
class HtmlAppender {
  constructor(private readonly html: string) {}
  element(element: Element) {
    element.append(this.html, { html: true })
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, next, env } = ctx
  const url = new URL(request.url)

  // Ahead of everything else: a content-hashed asset must never be answered
  // with the SPA fallback's cacheable HTML. Only the response is inspected, so
  // a real asset costs one comparison and is passed through untouched.
  if (HASHED_ASSET_PATH.test(url.pathname)) {
    const res = await next()
    return isFallbackForAsset(url.pathname, res.headers.get('content-type'))
      ? assetNotFound()
      : res
  }

  // Sitemap is served for every UA, built from the API and edge-cached.
  if (url.pathname === '/sitemap.xml') {
    const cache = caches.default
    const cacheKey = new Request(`${SITE_ORIGIN}/sitemap.xml`)
    const cached = await cache.match(cacheKey)
    if (cached) return cached
    const xml = await buildSitemap(env)
    const res = new Response(xml, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      }
    })
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return res
  }

  // Fast path: humans and non-crawlers get the untouched SPA shell.
  if (!isCrawler(request.headers.get('user-agent'))) {
    return next()
  }

  const og = await resolveOg(url.pathname, url.searchParams, env)

  // Not a handled path, or the lookup failed - serve defaults, no rewrite.
  const res = await next()
  if (!og) return res

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) return res

  let rewriter = new HTMLRewriter()
    .on('title', new TextSetter(og.title))
    .on('meta[name="description"]', new AttrSetter(og.description))
    .on('meta[property="og:title"]', new AttrSetter(og.title))
    .on('meta[property="og:description"]', new AttrSetter(og.description))
    .on('meta[property="og:image"]', new AttrSetter(og.image))
    .on('meta[property="og:url"]', new AttrSetter(url.href))
    .on('meta[name="twitter:title"]', new AttrSetter(og.title))
    .on('meta[name="twitter:description"]', new AttrSetter(og.description))
    .on('meta[name="twitter:image"]', new AttrSetter(og.image))

  if (og.bodyHtml) {
    rewriter = rewriter.on('body', new HtmlAppender(og.bodyHtml))
  }

  return rewriter.transform(res)
}
