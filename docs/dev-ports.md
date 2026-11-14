# Dev ports

Every app has a fixed local port. The two Vite apps use `strictPort`, so if the port is taken the server fails to start instead of quietly moving to the next one. Before this, `apps/web` and `apps/data-platform` both defaulted to 5173, and whichever started second got 5174, so the ports swapped depending on start order.

| App | Command | HTTP | Debugger |
| --- | --- | --- | --- |
| `apps/api` | `pnpm dev` (wrangler) | 3000 | 9230 |
| `apps/opengraph` | `pnpm dev` (wrangler) | 3001 | 9231 |
| `apps/shirase` | `pnpm dev` (wrangler) | 3002 | 9232 |
| `apps/data-platform` | `pnpm start` (wrangler preview of the build) | 3003 | 9233 |
| `apps/web` | `pnpm dev` (Vite + Cloudflare plugin) | 5173 | 9234 |
| `apps/data-platform` | `pnpm dev` (Vite) | 5174 | none |

Rules for these ports:

- Wrangler workers get 300x for HTTP and 923x for the debugger, numbered in the order of the table. A new worker takes the next free pair.
- Vite front ends get 517x.
- 9229 stays free for Node's own `--inspect` default.

## Where the ports are set

- **Wrangler apps:** `dev.port` and `dev.inspector_port` in each `wrangler.toml`.
- **Vite apps:** `server.port` / `strictPort` in `vite.config.ts`. For `apps/web`, the debugger port is set by the Cloudflare plugin's `inspectorPort`.

## Allowlists that name these ports

These lists must change whenever a port changes:

- `apps/api/src/middleware/rate-limit.ts` `EXEMPT_ORIGINS`: :3000, :5173, :5174. This list only exempts our own front ends from rate limiting. The API itself answers any origin.
- `apps/opengraph/src/app.ts` CORS: :3000, :5173.
- `apps/shirase/wrangler.toml` `ALLOWED_ORIGINS`: :5173. MapLibre on `apps/web` is the only consumer.

`VITE_API_BASE_URL` in `apps/web/.env` and `apps/data-platform/src/env.ts` points at the API on :3000.

To run something on a different port for a one-off check (e.g. `wrangler dev --port 8799` beside a running instance), pass the port on the command line. Don't change the config.
