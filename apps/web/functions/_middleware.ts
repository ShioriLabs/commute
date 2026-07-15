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
  TJ: { mode: 'TransJakarta', vehicle: 'bus', stop: 'Halte' }
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

interface ApiLine {
  name: string
  lineCode: string
  colorCode: string
}

interface ApiStation {
  id: string
  name: string
  formattedName: string | null
  lines: ApiLine[]
}

interface ApiHub {
  name: string
  heroImage: string | null
  members: ApiStation[]
}

interface ApiLineDetail {
  operator: { code: string, name: string }
  line: ApiLine
  segments: { stations: { name?: string, formattedName?: string | null }[] }[]
}

interface CompactSchedule {
  id: string
  estimatedDeparture: string
}

interface GroupedDestination {
  boundFor: string
  via: string | null
  schedules: CompactSchedule[]
}

interface GroupedLineTimetable {
  name: string
  colorCode: string
  lineCode: string
  timetable: { label: string, destinations: GroupedDestination[] }[]
}

interface ApiOperator {
  code: string
  name: string
  lines: ApiLine[]
}

interface ApiResponse<T> {
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

// The compact timetable returns wall-clock local time as a bare "HH:MM:SS"
// string (e.g. "05:27:00") -> "05:27". Guard the shape rather than assuming a
// full ISO datetime.
function departureTime(raw: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(raw)
  return m ? `${m[1]}:${m[2]}` : ''
}

// Build the crawlable body block + JSON-LD for a station. Kept text-only and
// visually hidden so it never affects the human SPA (which hydrates over it).
function buildStationBody(
  station: ApiStation,
  operator: string,
  code: string,
  timetable: GroupedLineTimetable[] | null
): string {
  const name = station.formattedName || station.name
  const vocab = vocabFor(operator)
  const lineNames = station.lines.map(l => l.name)

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
            .map(s => departureTime(s.estimatedDeparture))
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
              'name': `${line.name} → ${dest.boundFor}`,
              'departureTime': t
            })
          }
        }
      }
      if (rows.length > 0) {
        blocks.push(`<h3>${esc(line.name)}</h3><ul>${rows.join('')}</ul>`)
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

function buildLineBody(detail: ApiLineDetail, stationCount: number): string {
  const stationNames: string[] = []
  for (const seg of detail.segments) {
    for (const s of seg.stations) {
      const n = s.formattedName || s.name
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

function buildHubBody(hub: ApiHub, slug: string, memberNames: string): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TrainStation',
    'name': hub.name,
    'url': `${SITE_ORIGIN}/hubs/${slug}`,
    'description': memberNames ? `Stasiun terintegrasi: ${memberNames}` : undefined
  }
  const items = hub.members
    .map(m => m.formattedName || m.name)
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
      description: 'Peta integrasi antarmoda KRL, MRT, LRT, dan TransJakarta di Jabodetabek',
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
        fetchJson<ApiStation>(`${base}/stations/${encodeURIComponent(fromOp)}/${encodeURIComponent(fromCode)}`),
        fetchJson<ApiStation>(`${base}/stations/${encodeURIComponent(toOp)}/${encodeURIComponent(toCode)}`)
      ])

      if (fromStation && toStation) {
        const fromName = fromStation.formattedName || fromStation.name
        const toName = toStation.formattedName || toStation.name
        return {
          title: `Cek Tarif ${fromName} ke ${toName} - Commute`,
          description: `Hitung tarif perjalanan dari ${fromName} ke ${toName} di Jabodetabek.`,
          image: DEFAULT_OG_IMAGE
        }
      }
    }

    return {
      title: 'Kalkulator Tarif KRL, MRT, dan LRT - Commute',
      description: 'Hitung tarif perjalanan KRL, MRT, dan LRT antar stasiun di Jabodetabek.',
      image: DEFAULT_OG_IMAGE
    }
  }

  const hubMatch = pathname.match(/^\/hubs\/([^/]+)$/)
  if (hubMatch) {
    const slug = decodeURIComponent(hubMatch[1])
    const hub = await fetchJson<ApiHub>(`${base}/hubs/${encodeURIComponent(slug)}`)
    if (!hub) return null
    const memberNames = hub.members
      .map(m => m.formattedName || m.name)
      .filter(Boolean)
      .join(', ')
    return {
      title: `Jadwal Kereta ${hub.name} - Stasiun Terintegrasi - Commute`,
      description: memberNames
        ? `Jadwal kereta di ${hub.name}. Stasiun terintegrasi: ${memberNames}.`
        : `Jadwal kereta di ${hub.name}. Stasiun terintegrasi.`,
      image: hub.heroImage || hubOgImage(slug),
      bodyHtml: buildHubBody(hub, slug, memberNames)
    }
  }

  const lineMatch = pathname.match(/^\/lines\/([^/]+)\/([^/]+)$/)
  if (lineMatch) {
    const operator = decodeURIComponent(lineMatch[1])
    const lineCode = decodeURIComponent(lineMatch[2])
    const detail = await fetchJson<ApiLineDetail>(
      `${base}/lines/${encodeURIComponent(operator)}/${encodeURIComponent(lineCode)}`
    )
    if (!detail) return null
    const stationCount = detail.segments.reduce((n, s) => n + s.stations.length, 0)
    return {
      title: `Jadwal ${detail.line.name} - Rute & Jam Keberangkatan - Commute`,
      description: `Lihat rute, ${stationCount} stasiun, dan jam keberangkatan ${detail.line.name} (${detail.operator.name}).`,
      image: lineOgImage(detail.operator.code, detail.line.lineCode),
      bodyHtml: buildLineBody(detail, stationCount)
    }
  }

  const stationMatch = pathname.match(/^\/stations\/([^/]+)\/([^/]+)$/)
  if (stationMatch) {
    const operator = decodeURIComponent(stationMatch[1])
    const code = decodeURIComponent(stationMatch[2])
    const [station, timetable] = await Promise.all([
      fetchJson<ApiStation>(`${base}/stations/${encodeURIComponent(operator)}/${encodeURIComponent(code)}`),
      fetchJson<GroupedLineTimetable[]>(`${base}/stations/${encodeURIComponent(operator)}/${encodeURIComponent(code)}/timetable/grouped?compact=1`)
    ])
    if (!station) return null
    const name = station.formattedName || station.name
    const vocab = vocabFor(operator)
    return {
      title: `Jadwal ${vocab.mode} ${vocab.stop} ${name} (${code}) - Commute`,
      description: `Jadwal & jam keberangkatan ${vocab.mode} di ${vocab.stop} ${name}, lengkap per jalur. Gratis di Commute.`,
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
    const body = await res.json() as ApiResponse<T>
    return body.data ?? null
  } catch {
    return null
  }
}

// Build /sitemap.xml from live API data: core pages + every station, line, and
// hub. Cached in the Cloudflare edge cache since it fans out to several API
// calls and rarely changes.
async function buildSitemap(env: Env): Promise<string> {
  const base = env.API_BASE_URL
  const urls = new Set<string>([
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/search`,
    `${SITE_ORIGIN}/fare`,
    `${SITE_ORIGIN}/map`
  ])

  if (base) {
    const operators = await fetchJson<ApiOperator[]>(`${base}/operators`) ?? []
    // Stations per operator + lines from the operator payload, fetched in parallel.
    const stationLists = await Promise.all(
      operators.map(op => fetchJson<ApiStation[]>(`${base}/stations/${encodeURIComponent(op.code)}`))
    )
    operators.forEach((op, i) => {
      for (const line of op.lines ?? []) {
        urls.add(`${SITE_ORIGIN}/lines/${op.code}/${line.lineCode}`)
      }
      for (const station of stationLists[i] ?? []) {
        // station.id is OPERATOR-CODE; the route path is /stations/:operator/:code.
        const code = station.id.split('-').slice(1).join('-')
        urls.add(`${SITE_ORIGIN}/stations/${op.code}/${code}`)
      }
    })

    const hubs = await fetchJson<{ slug?: string, name?: string }[]>(`${base}/hubs`) ?? []
    for (const hub of hubs) {
      if (hub.slug) urls.add(`${SITE_ORIGIN}/hubs/${encodeURIComponent(hub.slug)}`)
    }
  }

  const body = [...urls]
    .map(u => `  <url><loc>${esc(u)}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
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
