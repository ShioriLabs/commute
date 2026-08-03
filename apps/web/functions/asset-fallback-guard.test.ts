import { describe, expect, it } from 'vitest'
import { isFallbackForAsset } from './_middleware'

// The guard that stops Cloudflare's edge caching SPA-fallback HTML under a
// content-hashed asset URL. Getting either half wrong is expensive: too narrow
// and a poisoned entry survives for the 30 days public/_headers asks for; too
// broad and real navigations start 404ing.

describe('isFallbackForAsset', () => {
  it('catches the SPA fallback standing in for a missing module', () => {
    expect(isFallbackForAsset('/assets/manifest-f354457b.js', 'text/html; charset=utf-8')).toBe(true)
  })

  it('catches it for every hashed build output, not just js', () => {
    for (const path of [
      '/assets/root-BqYj6Vfo.css',
      '/assets/entry.client-BRQwpqQO.js',
      '/assets/worker-abc123.mjs',
      '/assets/points-rO0fVCwS.json',
      '/assets/root-abc.js.map'
    ]) {
      expect(isFallbackForAsset(path, 'text/html')).toBe(true)
    }
  })

  it('passes a real asset through untouched', () => {
    expect(isFallbackForAsset('/assets/entry.client-BRQwpqQO.js', 'application/javascript')).toBe(false)
    expect(isFallbackForAsset('/assets/root-BqYj6Vfo.css', 'text/css; charset=utf-8')).toBe(false)
  })

  // Navigations legitimately return HTML — 404ing those would break the site
  // far worse than the bug this guards against.
  it('leaves navigations and non-asset paths alone', () => {
    for (const path of ['/', '/stations/KCI/BKST', '/settings/about', '/sitemap.xml', '/index.html']) {
      expect(isFallbackForAsset(path, 'text/html; charset=utf-8')).toBe(false)
    }
  })

  // Static files served from /assets/ that aren't modules: an HTML response for
  // these is still wrong, but they don't fail a MIME check, and the fallback
  // never produces them. Kept out of the pattern so the guard stays narrow.
  it('ignores non-module assets like images and fonts', () => {
    expect(isFallbackForAsset('/assets/logotype-z-W_Cgf9.svg', 'text/html')).toBe(false)
    expect(isFallbackForAsset('/assets/inter-latin.woff2', 'text/html')).toBe(false)
  })

  it('tolerates a missing or odd content-type header', () => {
    expect(isFallbackForAsset('/assets/app-abc.js', null)).toBe(false)
    expect(isFallbackForAsset('/assets/app-abc.js', '')).toBe(false)
    // Leading whitespace and case both appear in the wild.
    expect(isFallbackForAsset('/assets/app-abc.js', '  TEXT/HTML; charset=utf-8')).toBe(true)
  })
})
