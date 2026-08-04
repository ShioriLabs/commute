// The lite-build flag, client side, plus the constants that depend on it.
//
// The lite bundle is the self-hosted static build packaged by
// scripts/build-lite.ts for FDTJ: the map and the fare page, served from a
// subdomain root by Apache/LiteSpeed with no Node, no Cloudflare, and no
// service worker. Everything else in the app still exists in the bundle — the
// route tree is not pruned (see app/routes.ts for why) — but the UI never links
// to it, so the surface FDTJ hosts is the one they agreed to host.
//
// Read IS_LITE from here, never `import.meta.env.VITE_LITE` directly. The raw
// value is the string '1' or undefined, so a bare truthiness check on it reads
// correctly and behaves correctly right up until someone writes `VITE_LITE=0`
// and gets a truthy '0'. Comparing here, once, also gives Rollup a single
// constant to fold: every `if (IS_LITE)` branch is eliminated from the
// production bundle and every `if (!IS_LITE)` branch from the lite one.
export const IS_LITE: boolean = import.meta.env.VITE_LITE === '1'

/**
 * Where the lite bundle sends links that leave its surface.
 *
 * The lite map is a funnel: a station tap opens the sheet in place, but "the
 * full page" leaves for the app that has one. Absolute because it crosses an
 * origin — see app/lib/exit-links.ts for the machinery.
 */
export const FULL_APP_ORIGIN = 'https://commute.shiorilabs.id'

// ---------------------------------------------------------------------------
// Branding.
//
// The lite values are PLACEHOLDERS pending FDTJ's answer on how the deployment
// is identified — their product, Commute hosted by them, or co-branded. That
// question is still open along with who operates and pays for the API, and the
// wrong guess ships in a PWA install prompt and every link preview.
//
// scripts/build-lite.ts patches the same names into manifest.json at package
// time. Keep the two in step: these two blocks are the whole branding surface.
// ---------------------------------------------------------------------------

/** Origin the lite bundle is served from. Bakes into OG/Twitter meta. */
export const SITE_ORIGIN = IS_LITE
  ? 'https://maps.transportforjakarta.or.id'
  : 'https://commute.shiorilabs.id'

export const SITE_TITLE = IS_LITE ? 'Commute' : 'Commute'

export const SITE_DESCRIPTION = IS_LITE
  ? 'Aplikasi Jadwal Kereta Buat Anak Jakarta'
  : 'Aplikasi Jadwal Kereta Buat Anak Jakarta'

/**
 * The share card. The lite bundle keeps Commute's, since dropping public/img/og/
 * (the per-station cards, which only the Cloudflare crawler middleware reads)
 * does not touch this one file.
 */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/img/og-image.png`
