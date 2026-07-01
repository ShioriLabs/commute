/**
 * Pages Function middleware: per-station / per-hub OpenGraph for crawlers.
 *
 * The app is a client-rendered SPA (ssr: false), so every route serves the same
 * index.html shell with the static OG tags from app/root.tsx. Link-preview
 * crawlers don't run JS, so the client `meta()` never reaches them and every
 * shared link previews as generic "Commute".
 *
 * This middleware runs only for crawler UAs on /stations/:op/:code and
 * /hubs/:slug: it serves the normal shell via ctx.next() and rewrites just the
 * <head> OG/Twitter tags using HTMLRewriter, pulling live data from the API
 * (which already does KV-read-through with D1 fallback). Humans and every other
 * path pass straight through untouched.
 */

interface Env {
  API_BASE_URL: string
}

const DEFAULT_OG_IMAGE = 'https://commute.shiorilabs.id/img/og-image.png'

// Lowercased substrings matched against the User-Agent of known link-preview
// crawlers. Humans never match, so they skip the API subrequest entirely.
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
  'skypeuripreview'
]

interface OgData {
  title: string
  description: string
  image: string
}

interface ApiLine {
  name: string
  lineCode: string
  colorCode: string
}

interface ApiStation {
  name: string
  formattedName: string | null
  lines: ApiLine[]
}

interface ApiHub {
  name: string
  heroImage: string | null
  members: ApiStation[]
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

async function resolveOg(pathname: string, env: Env): Promise<OgData | null> {
  const base = env.API_BASE_URL
  if (!base) return null

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
      title: `${hub.name} - Commute`,
      description: memberNames
        ? `Stasiun terintegrasi: ${memberNames}`
        : 'Stasiun terintegrasi',
      image: hub.heroImage || DEFAULT_OG_IMAGE
    }
  }

  const stationMatch = pathname.match(/^\/stations\/([^/]+)\/([^/]+)$/)
  if (stationMatch) {
    const operator = decodeURIComponent(stationMatch[1])
    const code = decodeURIComponent(stationMatch[2])
    const station = await fetchJson<ApiStation>(
      `${base}/stations/${encodeURIComponent(operator)}/${encodeURIComponent(code)}`
    )
    if (!station) return null
    const name = station.formattedName || station.name
    return {
      title: `${name} - Commute`,
      description: `Lihat jadwal kereta di Stasiun ${name}`,
      image: DEFAULT_OG_IMAGE
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

// Overwrite the `content` attribute of a matched <meta> element.
class AttrSetter {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setAttribute('content', this.value)
  }
}

// Replace the text content of a matched element (e.g. <title>). `text: true`
// keeps the value plain text so names with & or < can't break markup.
class TextSetter {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setInnerContent(this.value, { html: false })
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, next, env } = ctx

  // Fast path: humans and non-crawlers get the untouched SPA shell.
  if (!isCrawler(request.headers.get('user-agent'))) {
    return next()
  }

  const url = new URL(request.url)
  const og = await resolveOg(url.pathname, env)

  // Not a station/hub path, or the lookup failed — serve defaults, no rewrite.
  const res = await next()
  if (!og) return res

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) return res

  return new HTMLRewriter()
    .on('meta[property="og:title"]', new AttrSetter(og.title))
    .on('meta[property="og:description"]', new AttrSetter(og.description))
    .on('meta[property="og:image"]', new AttrSetter(og.image))
    .on('meta[property="og:url"]', new AttrSetter(url.href))
    .on('meta[name="twitter:title"]', new AttrSetter(og.title))
    .on('meta[name="twitter:description"]', new AttrSetter(og.description))
    .on('meta[name="twitter:image"]', new AttrSetter(og.image))
    .on('title', new TextSetter(og.title))
    .transform(res)
}
