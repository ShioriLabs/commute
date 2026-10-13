# MCP server

Status: design, not implemented.

Two MCP servers sharing one goal — let AI assistants use commute's data
without scraping the web app:

- **Public server**: remote, read-only, mounted in `commute-api` at `/mcp`.
  For end users' assistants.
- **Dev server**: local stdio, read-only, never deployed. For agents working
  in this repo.

## Public server

### Transport and hosting

- Lives in `apps/api/src/mcp/`, mounted on the existing Hono app as
  `POST /mcp`.
- Official `@modelcontextprotocol/sdk` with its web-standard Streamable HTTP
  transport, **stateless**: a fresh server instance per request. All tools are
  pure reads, so there is no session state and no Durable Object.
- No auth. The data is already public through the REST API.

Rejected: Cloudflare `agents`/`McpAgent` (needs a Durable Object and a
migration for state we don't have; revisit only if a tool ever needs
per-session memory) and a hand-rolled JSON-RPC layer (spec drift becomes our
problem).

### Tools (MVP)

| Tool | Arguments | Backed by |
|---|---|---|
| `search_stations` | `query`, `operator?` | `GET /stations/:operator` name index |
| `get_fare_and_route` | `from`, `to`, `payment?` | `GET /fares/:from/:to` |
| `next_departures` | `station`, `operator?`, `limit?` | `GET /stations/:operator/:stationCode/timetable` |

Deliberately small: a short tool list is cheaper for the model's context and
selected more reliably. Transfers, headway, density, lines, hubs and
operators are out of scope for v1 and can be added later without breaking
clients.

### Behaviour

- Tools call the existing handlers in-process (`app.request(...)`) rather than
  re-implementing logic, so caching, `API_VERSION` cache keys and fare rules
  stay in one place and cannot drift from the REST API.
- Results are compact JSON plus a one-line text summary (for example origin,
  destination, duration, fare). No full route graphs.
- Failures map to MCP tool errors (`isError: true` with a one-line cause), not
  HTTP 500s.
- Rate limiting: the existing limiter covers `/mcp`. Tool calls that reach
  fares share `RATE_LIMIT_FARE`, so MCP cannot be used to sidestep it.

### Open items to verify during planning

1. In-process `app.request()` does not double-count the rate limiter for a
   single MCP call.
2. Whether `openapi.test.ts` needs to account for `/mcp`, so the generated
   spec does not gain or lose a route unexpectedly.
3. SDK bundle size against the Worker size limit.

## Dev server

- New workspace package `apps/dev-mcp`, stdio transport, registered in the
  repo's `.mcp.json`. Never deployed.
- Tools: `query_local_d1(sql)` and `lookup_station(code | name)`.
- **Read-only by construction**: the local D1 sqlite file is opened with a
  read-only handle, so writes fail at the driver level rather than depending
  on SQL filtering.
- v1 is local-only. The local D1 is a prod dump, which covers nearly all
  inspection needs. Prod access via `wrangler d1 execute --remote` is a later,
  explicit opt-in.

## Testing

- Public: vitest cases in the existing Worker pool that call `/mcp` with
  `tools/list` and `tools/call`, asserting results match the REST responses
  for the same inputs, plus the error mapping.
- Dev: a fixture sqlite file; a test that `INSERT`/`DROP` attempts are
  rejected.

## Out of scope

- The remaining public tools (transfers, headway, density, lines, hubs,
  operators).
- Prod D1 access from the dev server.
- Ops tools (KV cache bust, `API_VERSION` checks, regen status).
- Router benchmarking tool.
- Auth, per-client quotas, any web UI for MCP.
