# Sokin

Status: **idea, not started** (written 2026-11-24). Depends on `arrive-by.md`
phase 1 for the timed version.

## The idea

"Sokin kita ketemuan di Blok M jam 7."

One person picks a place (and optionally a time) and shares a link. Everyone who
opens it gets their own route there, from wherever they are. The sender never
needs to know where the others are coming from, and nobody has to retype the
destination.

Prompted by Citymapper's "Meet Me", which does this for any address. The name is
ours: casual Jaksel, the way the invite is actually said (`brand-voice.md`). It
doubles as the share text, so the feature names itself in the chat it is pasted
into.

## Why it fits Commute

- **Half of it exists.** `buildFareDestinationPath` (`apps/web/utils/fare-url.ts`)
  already builds `/fare?to=X` for the station page's "Petunjuk Arah" button, and
  `/fare` auto-opens the origin picker on a to-only URL. Sokin is a share entry
  point and a meet time on top of a flow that already works.
- **A meet time is a shareable arrive-by deadline.** With `arrive-by.md` built,
  "jam 7" means each recipient gets *their own* latest departure: exact on rail
  ("berangkat paling lambat 18.12"), budgeted on TransJakarta ("berangkat sekitar
  18.05"). That is what makes it more than a link with a pre-filled field.
- **Places are already places.** Integrated hubs and the directional Arah pairs
  resolve as one endpoint (`place-equivalent-endpoints`), so "ketemuan di Dukuh
  Atas" works whichever of its stations each person ends up at. That matters more
  here than in a normal search: two people arriving at "Dukuh Atas" by KRL and by
  MRT are at different buildings. See "Where exactly" below.

## Scope

### v1: stations and hubs, optional time

**Sender**
- Entry points: a "Sokin" action on a station / hub page (beside "Petunjuk
  Arah") and in the destination picker. Picks the place, and **optionally** a
  time (DECIDED 2026-11-24: optional, so sharing a place stays one tap). The
  time picker, when opened, defaults to the next round half hour, like
  arrive-by.
- Shares via `navigator.share`, clipboard fallback, the same pattern as
  `fare-share-button.tsx`. Share text carries the invite, e.g.
  "Sokin ketemuan di Blok M jam 19.00" plus the link.

**Recipient**
- Opens the link, lands on `/fare` with the destination set and the origin picker
  open (exists today).
- With a time: results come back in arrive-by mode, ranked as `arrive-by.md`
  decides (rail first, then the shortest TJ route).
- Without a time: an ordinary depart-now search.
- The invite stays visible above the results ("Ketemuan di Blok M · 19.00") so
  the page explains why it opened.

### v2: "from where I am"

**The Android app already has "Pakai lokasiku".** A Sokin link opened there gets
it for free, once the app handles Sokin links. The web app has no geolocation
today. Adding it there is planned but unscheduled ("later™"), and it helps every
search, not just Sokin. When it lands, a "Pakai lokasiku" row at the top of the
origin picker:

- One-shot `getCurrentPosition`, nearest stops ranked by straight-line distance
  from `points.json` (or the stations list), computed **on the device**. The
  position never goes to the API.
- Offers the nearest 2-3 stops, not one: the closest halte is often across a
  toll road. Walk distance to the stop is unknown until POIs exist
  (`poi-behind-planner`), so it is shown as straight-line distance, labelled as
  such.
- Permission denied or unavailable: the row disappears, the picker works as now.

### Later: any address

An arbitrary address as the destination needs geocoding and walk legs from
nearby stops, which is the POI work deferred behind the planner
(`points-of-interest.md`). Out of scope until that exists. A meet-up at a mall or
a café is the common case, so this is where Sokin eventually wants to be.

### Not doing

- Live location sharing or "where are you now". A different product, and a
  privacy surface we don't need.
- Accounts, RSVPs, group state. The link is the whole feature, and stateless.
- Picking a fair midpoint for N people ("where should we meet"). Interesting
  (minimise the worst travel time over the group's origins), but it needs
  everyone's origin up front, which is exactly what Sokin avoids asking for.
  Separate idea if it ever comes up.

## Link shape

DECIDED 2026-11-24: **its own link, not `/fare?...&sokin=1`.** It reads better in a
chat, and the link is the feature. Two candidates, still to pick:

**A. A `/sokin` path, stateless**

```
commute.shiorilabs.id/sokin/MRTJ-BLM?jam=2026-11-24T19:00
```

- Everything is in the URL: no storage, never expires, nothing to moderate.
- Opens the same flow as `/fare?to=` (+ `arriveBy` when `jam` is set), so the
  planner side needs nothing new.
- Needs its own SEO middleware case and OG card route.
- Longer, and readable: the destination and time are visible in the link.

**B. A short link, stateful**

```
sokin.commute.shiorilabs.id/s/<snowflake>
```

- An id maps to a stored invite `{ to, at?, createdAt }`. Short and tidy in a
  chat, and the invite can later carry things a URL shouldn't, like a note
  or the sender's chosen exit.
- Needs a store (KV is the natural fit, like the OG cache), an id scheme
  (snowflake: time-ordered, no coordination), a resolver route, and a
  retention rule (an invite is dead a day after its time; untimed ones need a
  TTL, e.g. 30 days).
- **Write endpoint = abuse surface.** Anyone can mint links that preview as
  Commute. The payload is only a station id and a time, never free text or a
  URL, so it can't become an open redirect or a spam carrier, and it should
  stay that way. Rate-limit creation. Note this makes Sokin stateful, which
  "Not doing" below otherwise avoids.
- A new host means its own Pages/Worker route, CORS (`api-cors-policy.md`),
  and Android App Links verification (`assetlinks.json` on that host).

**C. A short link, stateless (sqids)** (proposed 2026-11-24, leading)

```
sokin.commute.shiorilabs.id/s/<sqid>      or      /sokin/<sqid>
```

[Sqids](https://sqids.org) is reversible encoding, not hashing: the id *is* the
invite. Encode `[version, namespace, code36, minutes?]`, decode on landing.
B's short link without B's store:

- **No storage, no write endpoint.** Nothing is minted server-side, so there is
  nothing to rate-limit, expire or moderate. A link can only hold numbers that
  decode to a known place and a time, so no free text and no URL.
- **Places encode as base 36, no table** (DECIDED 2026-11-24). Sqids encodes
  integers and station ids are strings (`MRTJ-BLM`), so the code is read as a
  base-36 number (`0-9A-Z`): reversible, collision-free, and stable for as long
  as the code is, with no registry to maintain. Measured over the routable
  topology: 364 stations, codes uppercase alphanumeric, longest 7 characters
  (`H00093P`), so ≤ 36⁷ ≈ 7.8 × 10¹⁰, well inside `Number.MAX_SAFE_INTEGER`.
  Re-check the bound against *all* stations (TJ has ~2,200, same `H`/`B` +
  digits shape) and fail a test if any code ever leaves `[0-9A-Z]{1,10}`.
  - **Split every id at its last `-`.** Before it is the `namespace`, a small
    index into an **append-only** list. After it is the base-36 `code`. Today's
    list: `KCI`, `APCGK`, `MRTJ`, `LRTJ`, `LRTJBDB`, `TJ` (stations), `HUB` and
    `HUB-TJ` (hubs). That list is the only forever-contract left, and a
    short one.
  - **Hubs link to the hub id** (DECIDED 2026-11-24), through the same
    encoding: `HUB-DKA` → (`HUB`, `DKA`), and the directional Arah hubs
    `HUB-TJ-H00063` → (`HUB-TJ`, `H00063`). The namespace says station vs hub,
    so no separate `kind`. Local D1 today: 15 place hubs (`HUB-<2-4 chars>`), 13
    directional (`HUB-TJ-H00xxx`), all codes `[0-9A-Z]`.
  - A renamed code (KCI's `TTI` → `THI`) decodes to an id that no longer
    exists. Resolve it through the same alias map the feed uses
    (`toFeedStationCode`) before falling back to "tempatnya udah ga ada".
  - Rejected alternatives: an append-only `id ↔ number` table (shortest ids,
    but every station becomes a forever-contract), and hashing (FNV/xxHash:
    one-way, so decoding needs every known id hashed at runtime, retired
    stations kept listed, and a collision test).
  - Cost: ~10-12 character ids instead of ~6-8 with a table index.
  - Exits or other place kinds later get a namespace of their own, same rule.
- **Time** as minutes since a fixed epoch (e.g. 2026-01-01 00:00 WIB), omitted
  when untimed. Minute precision is plenty.
- **`version` first**, so the tuple can grow without breaking old links.
- **Freeze the encoder.** Pin the sqids library and pass our own alphabet and
  blocklist rather than relying on its defaults. To verify at implementation:
  current sqids decoders reject an id that doesn't re-encode identically
  ("canonical" check). If so, a library upgrade that changed the default
  blocklist could silently invalidate old links. A frozen custom blocklist
  removes that risk either way.
- **Length:** ~10-12 characters with base-36 codes and a minute time; shorter
  untimed.
- Not secret, and doesn't need to be: anyone can decode the destination, which
  the preview card shows anyway.

Leaning: **C**. It gets B's short link at A's cost, and old links keep working
for as long as the operator list and encoder stay frozen. Host
(`sokin.` subdomain vs `/sokin/` path) is then only a routing and App Links
question. A stays the readable fallback form if ever needed. Decide at
implementation.

Either way, the landing does exactly what `/fare?to=X` does today (origin picker
open, destination set), plus the invite banner, and arrive-by mode when there is
a time.

### Time in the link

- An absolute WIB instant, not "19:00", so a link sent at 23.30 for tomorrow
  doesn't mean tonight. The share text renders it relative when it is today or
  tomorrow ("jam 19.00", "besok jam 07.30").
- **A time already in the past** (the link opened late, or reused next week):
  drop to a depart-now search and say so in the banner ("Waktu ketemuannya udah
  lewat, ini rute dari sekarang"). Never route to a deadline in the past.
- Service-day rollover at 03:00 and the 5 h lookback cap apply as in
  `arrive-by.md`. A meet time after the last train gets the last-train answer.

## Where exactly

A hub is several buildings. "Ketemuan di Dukuh Atas" puts a KRL rider at Sudirman
and an MRT rider at Dukuh Atas BNI, a walk apart. For v1 the invite names the
place and each recipient's route ends at whichever station suits them, which is
honest but can leave two people at different exits. Options, cheapest first:

1. The sender picks a specific station within the hub when it matters. The
   picker already lists them.
2. The route's last leg shows a walk to a named meeting point (a gate, an exit).
   MRTJ exits are shipped (`mrtj-site-no-exit-data`), so MRTJ stations could
   offer "Pintu B" as the point. Needs the exit data on the other operators too.

Start with 1. Revisit 2 once exits exist beyond MRTJ.

## Preview card

A shared link is judged by its preview. The OG worker (`commute-og`, see
`opengraph-service`) renders fare cards keyed on the from/to pair, and a to-only
link has no pair. v1 needs a destination-only card variant: the place name, the
lines serving it, and the time if set ("Ketemuan di Blok M · 19.00"). Keyed on
`to` + `arriveBy` and KV-cached like the fare cards. The SEO middleware needs a
matching title and description for the to-only case.

## Android

The Android app handles `/fare` deep links today, not `/sokin` ones, and
not a `sokin.` subdomain. Until it learns the Sokin link, opening one on Android
goes to the browser (web flow). Once it does, Android is the better landing:
"Pakai lokasiku" already exists there, so the recipient's origin is one tap. A
subdomain (option B) also needs App Links verification on that host.

## Copy

Functional UI stays plain; the invite line is where the casual voice goes. No em
dashes and no trailing periods in UI prose (`no-em-dashes`). Drafts, to settle at
implementation:

- Action: "Sokin"
- Share text: "Sokin ketemuan di {place} jam {HH.MM}" / without time: "Sokin
  ketemuan di {place}"
- Banner: "Ketemuan di {place} · {HH.MM}"
- Past time: "Waktu ketemuannya udah lewat, ini rute dari sekarang"
- Location row: "Pakai lokasiku"

## Phases

1. **Untimed Sokin.** Share entry points, the sqid link (option C, base-36 place
   codes), the invite banner, share text, the
   destination-only OG card. Buildable today on the existing to-only flow.
   Android: learn the Sokin link.
2. **Timed Sokin.** After `arrive-by.md` phase 1 (rail). The optional time picker
   and `jam` in the link. TJ routes get "sekitar" once arrive-by phase 2 ships.
3. **"Pakai lokasiku" on web**, whenever the web app gets geolocation (exists on
   Android already).
4. **Any address**, after POIs. A sqid can't carry an address, so this is where a
   store (option B) would come back, or a geocoded place gets a number of its own.

## Open questions

1. ~~Link shape.~~ DECIDED: its own link. Leaning C (sqids, stateless short id).
   Still to pick: `sokin.` subdomain or `/sokin/` path for it.
2. ~~Time optional?~~ DECIDED: optional.
3. ~~Hub ids in links.~~ DECIDED: link to the hub id (namespace `HUB` /
   `HUB-TJ`). Implementation note: `/fare` doesn't take a hub as `to` today (the
   picker resolves a station, then the planner widens it to the place), so the
   landing has to resolve a hub to its place endpoints (`utils/places.ts`) itself.
4. ~~"Pakai lokasiku" first?~~ Exists on Android; web gets it later, on its own
   schedule.
