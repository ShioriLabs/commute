import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Manifest } from './map-renderer'
import { createTileSource } from './map-renderer-tile-source'

// Tile filenames are stable across builds, and Cloudflare serves everything
// under /maps/fdtj/tile-* as `immutable, max-age=31536000`. When the grid moved
// 4x4 -> 8x8 the 16 overlapping URLs kept returning year-old bytes from the
// edge while manifest.json (max-age=300) updated — a new manifest pointing at
// stale tiles. These tests pin the `?v=<build>` stamp that fixes it.

const manifest: Manifest = {
  version: '2026-06a',
  build: 'abc12345',
  source: 'test.pdf',
  viewBox: [0, 0, 4000, 3000],
  grid: { rows: 2, cols: 2 },
  tileSize: { w: 2000, h: 1500 },
  raster: { format: 'webp', tiers: [1, 2] },
  preview: { url: 'preview.webp', w: 768, h: 543 }
}

function stubFetch() {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return {
      ok: true,
      blob: async () => new Blob([]),
      text: async () => '<svg/>'
    } as unknown as Response
  }))
  // createImageBitmap isn't implemented in the test environment; the URL is
  // what these tests assert on, so a stub bitmap is enough.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: 1, height: 1, close: () => {}
  } as unknown as ImageBitmap)))
  return urls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tile source URL versioning', () => {
  it('stamps raster tile URLs with the manifest build hash', async () => {
    const urls = stubFetch()
    const src = createTileSource({ manifest, baseUrl: '/maps/fdtj/' })
    await src.loadTile(1, 0, 2)
    expect(urls).toEqual(['/maps/fdtj/tile-1-0@2x.webp?v=abc12345'])
  })

  it('stamps the preview URL too', async () => {
    const urls = stubFetch()
    const src = createTileSource({ manifest, baseUrl: '/maps/fdtj/' })
    await src.loadPreview()
    expect(urls).toEqual(['/maps/fdtj/preview.webp?v=abc12345'])
  })

  it('stamps the SVG fallback URL', async () => {
    const urls = stubFetch()
    // Tier 4 has no raster, so this takes the SVG path.
    const src = createTileSource({ manifest, baseUrl: '/maps/fdtj/' })
    await src.loadTile(0, 1, 4)
    expect(urls[0]).toBe('/maps/fdtj/tile-0-1.svg?v=abc12345')
  })

  it('changes every tile URL when the build hash changes', async () => {
    const first = stubFetch()
    await createTileSource({ manifest, baseUrl: '/maps/fdtj/' }).loadTile(0, 0, 1)
    vi.unstubAllGlobals()

    const second = stubFetch()
    const rebuilt = { ...manifest, build: 'def67890' }
    await createTileSource({ manifest: rebuilt, baseUrl: '/maps/fdtj/' }).loadTile(0, 0, 1)

    // Same tile, different build -> different URL, so the edge cannot serve the
    // previous build's bytes from its year-long immutable entry.
    expect(first[0]).not.toBe(second[0])
    expect(second[0]).toContain('?v=def67890')
  })

  it('omits the query entirely for a manifest with no build field', async () => {
    const urls = stubFetch()
    const legacy: Manifest = { ...manifest }
    delete legacy.build
    await createTileSource({ manifest: legacy, baseUrl: '/maps/fdtj/' }).loadTile(0, 0, 1)
    // A pre-`build` manifest must still resolve — unversioned, exactly as before.
    expect(urls[0]).toBe('/maps/fdtj/tile-0-0@1x.webp')
  })

  it('matches the build hash in the shipped manifest', async () => {
    const shipped = (await import('../../public/maps/fdtj/manifest.json')).default as Manifest
    // Guards against shipping tiles whose manifest lost its stamp — that alone
    // would re-expose every tile URL to the year-long edge cache.
    expect(shipped.build).toMatch(/^[0-9a-f]{8}$/)
  })
})
