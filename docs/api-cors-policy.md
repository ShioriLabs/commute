# API CORS policy

**Status:** *implemented* (August 2026) — `apps/api/src/app.ts`

The API sends `Access-Control-Allow-Origin: *`, with `GET` and `OPTIONS` as the
only allowed methods.

## Why open

Every mounted route serves read-only public data, and the docs say so in as many
words: "Datanya bebas dipakai dan diolah, asal sumbernya tetap dicantumkan."

An origin allowlist contradicts that. It is the one restriction that stops
*only* browser JavaScript, so it blocked hobbyists building a map in a page
while doing nothing about curl, servers, apps or scrapers — all of which could
always read this API freely. It also meant every new consumer (data.commute, the
TransportForJakarta embed, the Commute Lite build on their `maps.` subdomain)
needed a deploy here before it could make a single request.

## What this is not

Not access control. That distinction is stated where it matters most:
`routes/sync.ts` and `routes/cache.ts` are unmounted precisely because CORS
would not have protected them.

Abuse is bounded by `rateLimit()`, which is origin-independent and therefore
unaffected by the open policy, and by the `cacheControl()` TTLs plus KV
read-through that keep repeat reads off D1.

## The cost

What this shifts is load, not risk. A popular site embedding the API puts many
client IPs on it at once, which per-IP limiting bounds only loosely. The caching
layer is what absorbs that, and it is why opening this up is safe.

## Constraints to preserve

- `GET`/`OPTIONS` only. Allowing `POST` would advertise a capability that does
  not exist. Any mutating route added later must carry its own credentials
  rather than inherit trust from an origin header a client controls.
- `Server-Timing` must stay in `exposeHeaders`, or browsers hide it from every
  cross-origin caller — which is every caller we have.
