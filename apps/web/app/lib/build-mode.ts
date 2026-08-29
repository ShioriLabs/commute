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
 * Which host serves this lite bundle: 'apache' for the self-hosted zip, 'pages'
 * for the Cloudflare deployment. Meaningless unless IS_LITE.
 *
 * Mirrors LITE_HOST in scripts/lite-flag.ts, which is the Node-side half — the
 * two must agree, so both key off the same name and the same comparison. Folded
 * to a constant here for the same reason IS_LITE is: so a branch on it costs
 * nothing in the bundles where it is not taken.
 *
 * Nothing in app/ reads this yet. It exists because the host axis is real at
 * build time (see vite.config.ts) and app code will need it the moment the
 * service worker comes back for Pages — at which point the gate in root.tsx
 * belongs on this, not on IS_LITE.
 */
export const LITE_HOST: 'apache' | 'pages' = import.meta.env.VITE_LITE_HOST === 'pages' ? 'pages' : 'apache'

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
// The lite deployment keeps Commute's name and identity deliberately: FDTJ
// hosts it, they do not rebrand it. Only the origin differs, because OG tags
// have to point at the site actually serving them. If that ever changes to
// co-branding, this block and LITE_BRANDING in scripts/build-lite.ts (which
// patches manifest.json) are the whole surface — keep the two in step.
// ---------------------------------------------------------------------------

/** Origin the lite bundle is served from. Bakes into OG/Twitter meta. */
export const SITE_ORIGIN = IS_LITE
  ? 'https://maps.transportforjakarta.or.id'
  : 'https://commute.shiorilabs.id'

// Not branched on IS_LITE: both builds are Commute. Kept as named constants
// anyway so root.tsx has one place to read identity from, and so a future
// rebrand is an edit here rather than a hunt through JSX.
export const SITE_TITLE = 'Commute'

export const SITE_DESCRIPTION = 'Aplikasi Jadwal Kereta Buat Anak Jakarta'

/**
 * The share card. The lite bundle keeps Commute's, since dropping public/img/og/
 * (the per-station cards, which only the Cloudflare crawler middleware reads)
 * does not touch this one file.
 */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/img/og-image.png`
