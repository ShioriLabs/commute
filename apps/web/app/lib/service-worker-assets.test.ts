import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The service worker hardcodes the tile grid (MAP_ROWS/MAP_COLS/RASTER_TIERS)
// because it can't import from the app bundle. That duplication silently broke
// once already: the grid moved 4x4 -> 8x8 and gained a half-res tier, but the SW
// kept pre-caching the old 4x4 names — caching tiles that no longer existed and
// leaving every real tile out of the cache-first allowlist.
//
// These tests pin the SW's generated URLs against what the build actually emits,
// so the next re-tile fails here instead of on a phone.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(HERE, '..', '..')
const PUBLIC_DIR = path.join(WEB_ROOT, 'public')
const TILE_DIR = path.join(PUBLIC_DIR, 'maps', 'fdtj')

interface SwLists {
  CACHE_NAME: string
  MAP_PRECACHE_URLS: string[]
  IMMUTABLE_MAP_ASSETS: Set<string>
}

// The SW declares its constants above an explicit marker comment so this test
// can evaluate that section in isolation. Splitting on a dedicated sentinel
// rather than on whatever declaration happened to come next means the fetch
// handler below it can be restructured freely without breaking these tests.
const SPLIT_MARKER = '// --- test split marker ---'

// Evaluates the SW's list-building section in isolation. Everything above the
// marker is pure constant/function declarations with no side effects and no
// access to service-worker globals beyond `self.location`.
function loadSwLists(): SwLists {
  const src = readFileSync(path.join(PUBLIC_DIR, 'service-worker.js'), 'utf8')
  const [snippet, ...rest] = src.split(SPLIT_MARKER)
  // A missing marker would silently evaluate the entire worker, which throws in
  // ways that look like a grid mismatch. Fail with the real reason instead.
  if (rest.length === 0) throw new Error(`service-worker.js is missing "${SPLIT_MARKER}"`)
  const factory = new Function(
    'self',
    `"use strict";${snippet}; return { CACHE_NAME, MAP_PRECACHE_URLS, IMMUTABLE_MAP_ASSETS }`
  ) as (self: unknown) => SwLists
  return factory({ location: { hostname: 'example.test', protocol: 'https:' } })
}

function tileAssetsOnDisk(): string[] {
  return readdirSync(TILE_DIR)
    // manifest.json is deliberately revalidated, never frozen in the cache.
    .filter(f => f !== 'manifest.json')
    .map(f => `/maps/fdtj/${f}`)
}

describe('service worker map assets', () => {
  it('references only files that exist', () => {
    const { IMMUTABLE_MAP_ASSETS } = loadSwLists()
    const missing = [...IMMUTABLE_MAP_ASSETS].filter(u => !existsSync(path.join(PUBLIC_DIR, u)))
    expect(missing).toEqual([])
  })

  it('covers every tile asset the build emits', () => {
    const { IMMUTABLE_MAP_ASSETS } = loadSwLists()
    const unreferenced = tileAssetsOnDisk().filter(f => !IMMUTABLE_MAP_ASSETS.has(f))
    expect(unreferenced).toEqual([])
  })

  it('matches the grid and tiers in the shipped manifest', () => {
    const manifest = JSON.parse(readFileSync(path.join(TILE_DIR, 'manifest.json'), 'utf8')) as {
      grid: { rows: number, cols: number }
      raster: { tiers: number[] }
    }
    const { MAP_PRECACHE_URLS } = loadSwLists()
    // preview + one raster per tile per tier.
    const expected = 1 + manifest.grid.rows * manifest.grid.cols * manifest.raster.tiers.length
    expect(MAP_PRECACHE_URLS).toHaveLength(expected)
  })

  it('pre-caches rasters but not the on-demand SVG fallbacks', () => {
    const { MAP_PRECACHE_URLS, IMMUTABLE_MAP_ASSETS } = loadSwLists()
    // SVGs are only read when a raster fetch fails, so they are cached on
    // demand — in the allowlist, out of the install payload.
    expect(MAP_PRECACHE_URLS.some(u => u.endsWith('.svg'))).toBe(false)
    expect(IMMUTABLE_MAP_ASSETS.has('/maps/fdtj/tile-0-0.svg')).toBe(true)
  })

  it('keeps the install payload small enough to fetch on mobile data', () => {
    const { MAP_PRECACHE_URLS } = loadSwLists()
    const bytes = MAP_PRECACHE_URLS.reduce(
      (n, u) => n + statSync(path.join(PUBLIC_DIR, u)).size,
      0
    )
    // ~9 MB today. cache.addAll is atomic, so this is one all-or-nothing
    // download on first visit; the SVG tiles alone would have tripled it.
    expect(bytes).toBeLessThanOrEqual(12 * 1024 * 1024)
  })
})
