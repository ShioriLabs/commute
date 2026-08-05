// Build-time stamp for the map assets requested outside the renderer.
//
// The renderer gets its stamp from the *runtime* manifest (createTileSource in
// map-renderer-tile-source.ts) so a client's manifest and its tiles always move
// together. The two call sites here can't do that: both have to produce a URL
// during the first paint, before any fetch has resolved — the preview backdrop
// *is* the instant-paint fallback, and a warm-up that waits for a round trip has
// warmed nothing. So they read the build hash out of the manifest at bundle time.
//
// The two can only disagree in one window: a long-lived tab holding an old
// bundle that has since re-fetched the max-age=300 manifest. The cost there is
// one wasted preview fetch, never a stale byte — the origin ignores the query,
// so `?v=<anything>` returns current bytes.
import manifest from '../../public/maps/fdtj/manifest.json'

export const MAP_BUILD: string = manifest.build

// The version pointer itself, so it stays unstamped: it is served
// `max-age=300, must-revalidate` and is what tells a client which build to ask
// for. Stamping it with the build it is meant to reveal would be circular.
export const MAP_MANIFEST_URL = '/maps/fdtj/manifest.json'

// Never write this path as a bare literal. public/_headers serves it
// `immutable, max-age=31536000`, so an unstamped request pins a year-long HTTP
// disk entry that no amount of "Clear site data" will dislodge — only "Empty
// cache and hard reload" does, which is not something you can ask users for.
export const MAP_PREVIEW_URL = `/maps/fdtj/preview.webp?v=${MAP_BUILD}`
