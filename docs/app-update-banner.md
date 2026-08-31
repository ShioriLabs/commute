# App update banner (design note)

**Status:** design note — not yet built. Depends on nothing; the caching rules
it needs were established by the `points.json` hashing work (see *Caching* below
and `fdtj-map-points.md`).

## Why

The app never tells the *user* a new version exists, even though it already
recovers silently under the hood: `app/lib/register-service-worker.ts` calls
`registration.update()` on a throttled `visibilitychange`, and its
`controllerchange` handler auto-reloads the page once a new worker takes
control (bounded by `MAX_RELOADS_PER_SESSION`, guarded against reloading on
the very first `clients.claim()`).

For asset freshness this no longer matters much: `index.html` is short-TTL,
hashed chunks are immutable-and-honest, and `points.json` ships as a hashed
`/assets/` file. What's missing is specifically the user-facing half — the
auto-reload is silent, so someone with the PWA open for days sees the app
jump to a new version with no explanation and no chance to finish what they
were doing first.

## What triggers it

`apps/web/package.json`'s `version`, bumped by hand at release time. The banner
therefore fires on deliberate releases, not on every deploy.

This was a deliberate choice over the alternatives:

- **Client bundle hash** (from the built entry chunk) would fire whenever the
  shipped code changed — accurate, but it nags on every deploy, including ones
  the user would not describe as a new version.
- **Git SHA / build timestamp** fire even when the client bundle is byte-
  identical, so a docs-only deploy or a rebuild of the same commit would prompt
  everyone.
- **Service-worker updates** (the textbook `registration.waiting` pattern) would
  be near-silent here: `public/service-worker.js` is a static file copied
  verbatim, so its bytes change only when someone edits it — maybe twice a year.
  A release that shipped new map code would not trigger it.

Consequence to accept: forgetting to bump the version means no banner. That's
the intended trade — a quiet failure to notify, never a false alarm.

## Design

### Version source

A post-build script (`scripts/build-version.ts`, alongside the existing
`build-map-tiles.ts` / `build-og-images.ts`) writes `build/client/version.json`:

```json
{ "version": "1.2.0" }
```

Read from `npm_package_version` — the same env var `vite.config.ts` already
bakes into `__APP_VERSION__`, so the served value and the compiled-in value
cannot drift. Wire it as `"build": "react-router build && tsx scripts/build-version.ts"`.

### Caching — the part that will silently break it

`version.json` must be uncacheable at *both* layers. This is the same trap that
pinned `points.json`:

1. `public/_headers` — its own non-overlapping rule, `Cache-Control: no-store`.
   Rules must not overlap: Cloudflare Pages *appends* when two rules match, so a
   catch-all plus an override yields a doubled header and the override loses.
2. `public/service-worker.js` — needs an early `return` in the `fetch` handler,
   next to the existing `__vite` exclusions. Without it `/version.json` falls
   into the stale-while-revalidate branch, whose
   `Promise.race([fetched, cached])` can resolve the *cached* copy first. The
   poll would then compare against a frozen version and never fire.

### `useAppVersion` — `app/hooks/version.ts`

Mirrors `useNetworkStatus`'s shape, returning `'CURRENT' | 'OUTDATED'`. Checks
on mount and on `visibilitychange` → `visible`. No interval: a backgrounded PWA
generates zero traffic, and returning to the app is exactly when the check is
wanted. The gap — a tab left focused for hours — is not worth a timer on a
mobile transit app.

```ts
const res = await fetch('/version.json', { cache: 'no-store' })
const { version } = await res.json()
setStatus(version === __APP_VERSION__ ? 'CURRENT' : 'OUTDATED')
```

Two guards:

- **PROD only** (`import.meta.env.PROD`), matching the service-worker
  registration. Dev would mismatch constantly.
- **Fail closed to `'CURRENT'`.** A failed fetch — offline, 404, malformed —
  must never produce a nag.

State starts at `'CURRENT'` with all browser access inside `useEffect`. This is
load-bearing, not defensive: `root.tsx`'s `Layout` runs in Node while
prerendering the 8 routes in `react-router.config.ts`. `useNetworkStatus` would
actually crash there, since it reads `navigator.onLine` in a `useState`
initializer — don't copy that part.

### `UpdateBanner` — `app/components/update-banner.tsx`

Visual language matches the offline banner (`station-content.tsx`,
`timetable-content/index.tsx`): `bg-amber-100 text-amber-950`, `rounded-xl`,
`font-semibold`, duotone Phosphor icon. Two differences — it is `fixed` at the
top rather than inline in content, and it is a `<button>`, tapping to
`location.reload()`.

`z-20` layers it above sticky route headers (`z-10`) and below bottom sheets
(`z-30`), so an open sheet's scrim correctly dims it.

Copy in Indonesian, matching the app's register — e.g. "Versi baru tersedia —
ketuk buat muat ulang".

### Mount point

`root.tsx`'s `Layout`, inside `InstallableProvider`, before `{children}`. That
covers every route, including the static/settings layout.

## Open questions

Both deferred, both cheap to change once it's built:

- **Dismissible?** Currently specced as not. It only appears on a deliberate
  bump, and tapping is the resolution — but a rider mid-lookup may want it gone
  without reloading.
- **Reload immediately, or confirm?** Specced as immediate. An accidental tap
  costs a reload and whatever transient state the screen held.

## Verification

The component isn't unit-testable as things stand: `vitest.config.ts` is
node-only (no jsdom, no testing-library) and its include glob covers
`app/**/*.test.ts`, not `.tsx`.

Drive it instead, the way the `points.json` fix was verified: `pnpm build`, serve
with `wrangler pages dev build/client`, load the app, rewrite
`build/client/version.json` to a different value, dispatch a `visibilitychange`,
and assert the banner appears and that tapping it loads the new build. Confirm
in the same run that `/version.json` responds `no-store` and never appears in
the tile cache — `caches.keys()` will show it as `pwa-cache-v5-<build>`, named
after the hash `build:map-tiles` stamps into the worker, so don't hardcode the
name when checking.
