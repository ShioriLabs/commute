import { describe, expect, it } from 'vitest'
import { crawlerOgCacheKey, crawlerOgMaxAge, isCrawlablePage, sitemapUrls } from './_middleware'

/*
 * The sitemap advertises what Google should crawl, so a URL in it that answers
 * with the bare SPA shell is worse than no URL at all: the shell is
 * byte-identical for every unresolvable path, so a batch of them lands in
 * Search Console as one duplicate cluster ("Duplicate without user-selected
 * canonical"). That is what 68 topology-less TJ feeder lines did.
 *
 * `searchable` is the API's word for "exists for routing, not for discovery" —
 * already true of TJ feeder stops, now also of the feeder lines themselves.
 */

type Operators = Parameters<typeof sitemapUrls>[0]
type Stations = Parameters<typeof sitemapUrls>[1]

const line = (lineCode: string, searchable?: boolean) => ({
  name: `Lin ${lineCode}`,
  lineCode,
  colorCode: '#000000' as const,
  ...(searchable === undefined ? {} : { searchable })
})

const operator = (code: 'TJ' | 'KCI', lines: ReturnType<typeof line>[]): Operators =>
  [{ code, name: code, lines }]

// Stations always carry the flag; the API selects the column unconditionally.
const station = (id: string, searchable: boolean) => ({
  id,
  name: id,
  officialName: id,
  lines: [],
  searchable
})

const stations = (...list: ReturnType<typeof station>[]): Stations => [list]

describe('isCrawlablePage', () => {
  it('accepts an item with no flag', () => {
    expect(isCrawlablePage({})).toBe(true)
  })

  it('accepts a searchable item', () => {
    expect(isCrawlablePage({ searchable: true })).toBe(true)
  })

  it('rejects an unsearchable item', () => {
    expect(isCrawlablePage({ searchable: false })).toBe(false)
  })

  /*
   * The `=== false` shape, pinned deliberately: `searchable` is optional on
   * Line, so a producer that trims it leaves it undefined. Reading absent as
   * unsearchable would drop every such line from the sitemap.
   */
  it('treats an absent flag as crawlable, not as false', () => {
    expect(isCrawlablePage({ searchable: undefined })).toBe(true)
  })
})

describe('sitemapUrls', () => {
  const ORIGIN = 'https://commute.shiorilabs.id'

  it('always includes the core pages', () => {
    const urls = sitemapUrls([], [], [])
    expect(urls).toContain(`${ORIGIN}/`)
    expect(urls).toContain(`${ORIGIN}/search`)
    expect(urls).toContain(`${ORIGIN}/fare`)
    expect(urls).toContain(`${ORIGIN}/map`)
  })

  it('drops unsearchable lines and keeps searchable ones', () => {
    const urls = sitemapUrls(operator('TJ', [line('1', true), line('2C', false)]), [[]], [])
    expect(urls).toContain(`${ORIGIN}/lines/TJ/1`)
    expect(urls).not.toContain(`${ORIGIN}/lines/TJ/2C`)
  })

  it('drops unsearchable stations and keeps searchable ones', () => {
    const urls = sitemapUrls(
      operator('TJ', []),
      stations(station('TJ-BLOKM', true), station('TJ-FEEDER1', false)),
      []
    )
    expect(urls).toContain(`${ORIGIN}/stations/TJ/BLOKM`)
    expect(urls).not.toContain(`${ORIGIN}/stations/TJ/FEEDER1`)
  })

  // Station ids are OPERATOR-CODE, but TJ halte codes contain hyphens of their
  // own, so only the first segment is the operator.
  it('keeps hyphens inside a station code when splitting off the operator', () => {
    const urls = sitemapUrls(operator('TJ', []), stations(station('TJ-B-01-P', true)), [])
    expect(urls).toContain(`${ORIGIN}/stations/TJ/B-01-P`)
  })

  it('includes hubs by slug and skips slugless ones', () => {
    const urls = sitemapUrls([], [], [{ slug: 'dukuh-atas' }, { name: 'no slug' }])
    expect(urls).toContain(`${ORIGIN}/hubs/dukuh-atas`)
    expect(urls.filter(u => u.includes('/hubs/'))).toHaveLength(1)
  })

  it('keeps lines whose flag is absent, as a trimmed producer leaves it', () => {
    const urls = sitemapUrls(operator('KCI', [line('C'), line('B')]), [[]], [])
    expect(urls).toContain(`${ORIGIN}/lines/KCI/C`)
    expect(urls).toContain(`${ORIGIN}/lines/KCI/B`)
  })

  it('does not repeat a url', () => {
    const urls = sitemapUrls(operator('KCI', [line('C'), line('C')]), [[]], [])
    expect(urls.filter(u => u === `${ORIGIN}/lines/KCI/C`)).toHaveLength(1)
  })
})

// Repeat crawls of the same page must not re-hit the API/KV. These two
// helpers are what onRequest uses to key and expire that edge cache; the
// handler itself needs caches.default/HTMLRewriter and is only exercisable
// under wrangler pages dev, so this is the layer worth pinning here.
describe('crawlerOgCacheKey', () => {
  it('is stable for the same path and query', () => {
    const a = crawlerOgCacheKey('/stations/KCI/BOO', '')
    const b = crawlerOgCacheKey('/stations/KCI/BOO', '')
    expect(a.url).toBe(b.url)
  })

  it('differs by path', () => {
    const a = crawlerOgCacheKey('/stations/KCI/BOO', '')
    const b = crawlerOgCacheKey('/stations/KCI/JAKK', '')
    expect(a.url).not.toBe(b.url)
  })

  it('differs by query, so /fare?from=&to= pairs get distinct entries', () => {
    const a = crawlerOgCacheKey('/fare', '?from=KCI-BOO&to=KCI-JAKK')
    const b = crawlerOgCacheKey('/fare', '?from=KCI-JAKK&to=KCI-BOO')
    expect(a.url).not.toBe(b.url)
  })

  it('is namespaced away from a plain URL, so it cannot collide with an unrelated cache entry for the same page', () => {
    const key = crawlerOgCacheKey('/stations/KCI/BOO', '')
    expect(key.url).not.toBe('https://commute.shiorilabs.id/stations/KCI/BOO')
    expect(key.url).toContain('/__crawler-og/stations/KCI/BOO')
  })
})

describe('crawlerOgMaxAge', () => {
  it('gives /fare the tighter fare TTL, since it depends on a peak/off-peak time bucket', () => {
    expect(crawlerOgMaxAge('/fare')).toBe(600)
  })

  it('gives station/line/hub pages the longer topology TTL', () => {
    expect(crawlerOgMaxAge('/stations/KCI/BOO')).toBe(3600)
    expect(crawlerOgMaxAge('/lines/KCI/C')).toBe(3600)
    expect(crawlerOgMaxAge('/hubs/dukuh-atas')).toBe(3600)
  })
})
