# @commute/web

The Commute web app: React Router 7, running as a Cloudflare Worker via
`@cloudflare/vite-plugin`.

## Getting Started

This is a package in a pnpm workspace, so install and run commands from the
repo root (or use `pnpm --filter @commute/web <script>` from anywhere).

### Development

```bash
pnpm install
pnpm --filter @commute/web dev
```

The app is available at `http://localhost:5173`.

### Typecheck & lint

```bash
pnpm --filter @commute/web typecheck
pnpm --filter @commute/web lint
```

## Building for Production

```bash
pnpm --filter @commute/web build
```

This produces a Worker bundle plus static assets, deployed via `wrangler`
(see `wrangler.toml`). There's no Node server to run in production — routing
for the SPA is handled by Workers' `assets.not_found_handling`.

## Lite build

`build:lite` / `build:lite:pages` produce a static, API-only bundle of the
map + fare pages for self-hosting outside Cloudflare (e.g. on plain Apache
hosting). See `scripts/assets/lite/README-FDTJ.md` for the end-user install
doc that ships inside that package.

## Styling

Tailwind CSS (v4).
