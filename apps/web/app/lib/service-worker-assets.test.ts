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
  TILE_BUILD: string
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
    `"use strict";${snippet}; return { CACHE_NAME, TILE_BUILD, MAP_PRECACHE_URLS, IMMUTABLE_MAP_ASSETS }`
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
    // 8.6 MiB today, and this is what a cache rotation costs every user, since
    // precacheTiles is atomic and a new CACHE_NAME starts empty. The 64 SVG
    // fallbacks (~24 MB) are cached on demand and stay out of it.
    expect(bytes).toBeLessThanOrEqual(12 * 1024 * 1024)
  })
})

// The invariant cacheFirst depends on: because it matches with `ignoreSearch`,
// the `?v=` stamp on the page's requests is invisible to CacheStorage, so the
// cache name is the *only* thing that can invalidate a tile. It used to be
// hand-edited while manifest.build rotated automatically, which meant a re-tile
// shipped bytes no client would ever see. build-map-tiles.ts stamps it now, and
// these tests are what stop the two drifting apart again.
describe('service worker cache identity', () => {
  it('is stamped with the build hash of the shipped tiles', () => {
    const { build } = JSON.parse(readFileSync(path.join(TILE_DIR, 'manifest.json'), 'utf8'))
    const { TILE_BUILD } = loadSwLists()

    // Red here means the tiles were regenerated without committing the stamped
    // worker. Re-run `pnpm build:map-tiles` and commit both files together.
    expect(TILE_BUILD).toBe(build)
  })

  it('derives the cache name from the build hash', () => {
    const { CACHE_NAME, TILE_BUILD } = loadSwLists()

    // A stamp that lands but never reaches the cache identity would be inert.
    expect(CACHE_NAME).toContain(TILE_BUILD)
  })

  // The anti-stranding pin. Clients poisoned by the old scheme only heal if the
  // name they hold is superseded: install's `missing` diff finds all 193 entries
  // already present under `pwa-cache-v4` and skips the re-fetch entirely, so
  // reverting to that literal would strand every one of them on a worker that
  // contains the fix.
  it('never reverts to the pre-fix cache name', () => {
    const { CACHE_NAME } = loadSwLists()

    expect(CACHE_NAME).not.toBe('pwa-cache-v4')
  })
})
