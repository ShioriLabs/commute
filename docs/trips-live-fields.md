# Trips: fields for following a journey (design note)

**Status:** built and deployed 2026-10-04 (`API_VERSION` 20261004), and read
by the Android app the same day. Additive changes to `/_internal/trips/:from/:to`
for the Android app's trip mode (`android-trip-mode.md`). The app shipped without
them first, on the fallbacks described below, and keeps those for answers
without the fields; this note is what was added and what the app does with each.

## Why

Trip mode follows a rider along a journey's stops with the screen off: it
confirms where they are from location fixes near a station, and estimates from
the clock where it can't see them (underground, in tunnels, in urban canyons).
Both halves are starved by today's ride leg:

- **`stops[]` is `{ id, name }`.** The app has no coordinates for them, so it
  fetches `GET /stations` once (400 searchable stations, ~13 KB gzipped) and
  joins by id. That works for rail, but `/stations` only lists *searchable*
  stations: TransJakarta haltes that exist only for routing, and the
  directional members of a merged halte, are not in it. A fix near one of those
  stops can't confirm anything.
- **Times are only at the leg's ends.** `departureAt`/`arrivalAt` say when the
  train leaves the boarding stop and reaches the alighting one; everything
  between is interpolated by stop count, or by distance where the app has every
  stop's coordinates. Neither knows that a train dwells at Manggarai or crawls
  into Tanah Abang, and underground — where the clock is all there is — that is
  exactly the error that makes "siap-siap turun" early or late.

The data for both already exists server-side. Nothing here is new engine work.

## Proposal

### 1. Coordinates on every stop

```ts
// FareStation, as used in RIDE.stops[], RIDE.from/to and TRANSFER.from/to
{ id: 'KCI-SUD', name: 'Sudirman', latitude: -6.2026, longitude: 106.8233 }
```

- Optional on the schema, present whenever the station row has them. Seventeen
  stations have none today; those stay without, and the app treats the stop as
  unconfirmable (clock only), as it does now.
- Comes from the same station rows `stationRef` (the namer in
  `utils/fare-journey.ts`) already reads for `name`, including routing-only
  haltes. No extra query.
- Cost: two numbers per stop. A 20-stop journey grows by well under 1 KB before
  compression; the KV entry grows the same.

Rounding: 5 decimals (~1 m) is plenty; the app's stop radius is 80–250 m.

### 2. Scheduled time at every stop

```ts
// FareRideLeg
stopTimes?: (string | null)[]   // ISO, WIB offset, index-aligned with stops[]
```

- Present only on a leg that has `departureAt`, i.e. a leg a real trip covers.
  Absent on TransJakarta and on every leg after an untimed one, for the same
  reason those legs have no `departureAt`: the clock is no longer known.
- `stopTimes[0] === departureAt` and `stopTimes[last] === arrivalAt`, always.
- Each entry is the time the vehicle is *at* that stop: the per-stop arrival
  where the feed records a real one, the departure otherwise, the same rule
  `alightTimeOf` in `libs/tsundere/src/planner/departures.ts` applies to the
  alighting stop. KCI stores the terminus arrival on every row of a trip, so
  its arrivals are dropped and the departure stands — never an invented dwell.
- `null` for a stop the boarded trip passes without a recorded time. The app
  interpolates across nulls between known neighbours.

Where it comes from: `resolveDepartures` already picks a `Trip` per leg and
knows its boarding index; `trip.departuresS` / `trip.arrivalsS` hold every
stop. `LegTiming` grows a `stopsS: (number | null)[]` (sliced from the boarding
index for `stationIds.length`), and the `retime` stamp in
`apps/api/src/utils/journey-times.ts` formats it beside `departureAt` and
`arrivalAt`.

It stays on the per-request half. Like the leg's end times it is resolved in
`retime`, on cache hits and misses alike, and is never stored in the 20-hour KV
entry — the route is cacheable, the vehicle is not (`go-mode.md`).

### 3. The trip boarded (optional)

```ts
// FareRideLeg
tripId?: string
```

`LegTiming.tripId` already exists for tracing. Exposing it lets a later
version ask "is this still the train I'm on" against a refreshed answer, and
lets two rows of one route be told apart without comparing clocks. Opaque to
the app; never parsed. Lowest priority of the three.

## Compatibility

All three are optional additions to `/_internal/trips`, so they fit the rule in
`android-app.md`: app versions stay on phones for months, and a change to an
`APP_PATHS` route must be additive. Old app versions ignore unknown keys; new
ones keep their fallbacks for answers without the fields (a warm cache, an old
API deploy):

| Field | With it | Without it (today) |
|---|---|---|
| `stops[].latitude/longitude` | coordinates straight from the trip, every stop | join on `GET /stations`; routing-only haltes have none |
| `stopTimes` | expected position from per-stop schedule | interpolate end times by distance, else stop count |
| `tripId` | identity of the vehicle | compare boarding clocks |

The web app needn't read any of them. `/fares` (the public contract, the OG
card, the embed) is untouched.

Schema lives in `apps/schemas` with the other trip shapes; regenerate the
internal OpenAPI snapshot so the app's models pick the fields up as a compile
change.

## Not proposed

- **Realtime positions.** Still a separate question (`go-mode.md` open
  questions, `tj-live-bus-board.md`). Nothing here claims a train is running
  late; the app learns that only from a fix.
- **A trip-mode endpoint.** The trip answer the rider chose is what trip mode
  follows; a second request shape would let the two disagree.
- **Track shapes per leg.** The real shape of each hop is served once, as a
  separate prebaked file the app caches, rather than on every trip answer:
  see `track-shapes.md`.
