# Android app

**Status:** design note, not yet implemented, and not scheduled. It records the
shape a native Android app would take so the decision doesn't have to be
re-argued when it starts. Feature notes: `android-trip-mode.md`,
`android-ic-balance.md`, `android-wear.md`.

## Goal

Commute is a PWA, and for looking things up that's the right shape: no install,
instant updates, works everywhere. A native app is worth building only for what
a PWA cannot do:

- **Read an IC card over NFC** and answer "is my balance enough for this trip?"
- **Trip alerts that keep working with the screen off**: "next stop is
  yours", on the phone and on a watch.
- **Live Updates**: trip progress on the lock screen and status bar.
- **Widgets, Tiles and complications**: next departures without opening
  anything.

Everything else the app shows is what the web app already shows, from the same
API.

## Non-goals

- **Not a rewrite of the web app.** v1 covers search, departures, fare/trip
  results and saved stations. The map, hub pages and the rest stay web-only
  until a native version clearly earns its keep.
- **No on-device planner.** `libs/tsundere` stays the one planning engine,
  behind the API. Porting it to Kotlin would mean two engines to keep in
  agreement.
- **No realtime vehicle positions.** The app shows schedules and headways,
  like the web app. `go-mode.md` leaves realtime as a separate, later question,
  and this app doesn't reopen it.
- **No iOS.** Most riders here are on Android; an iOS app is its own decision.

## What v1 is

| Surface | Source |
|---|---|
| Station search | `/searchables` |
| Station page, departures | `/stations/…` (grouped timetable, `platformCode`) |
| Fare and trip results | see "The trips endpoint" below |
| Saved stations | on device |
| IC card balance | NFC, on device (`android-ic-balance.md`) |
| Trip mode, Live Updates | `android-trip-mode.md` |
| Wear companion | `android-wear.md` |

## Architecture

Kotlin, Jetpack Compose (Material 3), single activity. Hilt for DI, Ktor for
HTTP, kotlinx.serialization, Arrow for `Either`, DataStore for preferences. The
Gradle project lives at `apps/android` in this monorepo (pnpm ignores it: no
`package.json`), so an API change and its client update land in one commit.

It is a multi-module app with one rule: **dependencies point downward only.**
`:app` depends on features and core; a feature depends on core and on other
features' `:api`; a `:core:*` module never depends on a feature or on `:app`.

### Module graph

```
:app    Application, MainActivity, nav host, deep links. Nothing else.
  └─ every :feature:*:impl and :core:* below
:wear   Wear OS companion (its own UI; shares :core:trip, :core:model, :core:common)

:feature:search:impl     station/POI search
:feature:station:{api,impl}   station page, departures
:feature:journey:{api,impl}   fare and trip results, the itinerary timeline
:feature:saved:impl      saved stations
:feature:trip:{api,impl}      trip mode: foreground service, alerts, Live Update
:feature:card:{api,impl}      IC card: reader interface (api); screens, comparison (impl)
:feature:settings:impl   settings, about, licences

:core:ui            → navigation, common, datastore   design system: theme, roundel, sheets, icons
:core:navigation    → common                          Route, navigator, NavGraphContribution
:core:trip          → model, common                   the trip engine. Pure Kotlin, no Android
:core:notification  → common                          channels, permission handling
:core:query         → common                          stale-while-revalidate cache, persisted
:core:network       → model, config, common           HttpClient, the one CommuteService
:core:datastore     → common                          saved stations, saved cards, theme
:core:config        → common                          Environment (API base URL, API version)
:core:model         → (serialization only)            wire models, generated from /openapi.json
:core:common        → (arrow, coroutines)             Failure, UIState, pure extensions
```

Ten core modules, seven features. What an app with accounts and payments would
also need (session, security, analytics, locale switching, per-environment
flavors) is deliberately absent: there is no login, one backend, one language,
and nothing to measure that the API logs don't already show.

**`:api` only when someone else needs it.** A feature gets an `:api` module
when another feature uses its types: `journey` needs `card`'s balance and
`trip`'s "start a trip"; `trip` and `journey` both need `station`'s models.
`search`, `saved` and `settings` are `:impl` only. Nobody depends on an
`:impl` except `:app`.

**`:core:trip` is pure Kotlin.** The trip engine (progress over a leg's stops,
the three position sources, alert scheduling) has no Android dependency, so it
is unit-tested on the JVM and shared as-is by the phone's service and the
watch.

### Layers inside a feature

```
CommuteService (in :core:network)  →  Repository  →  ViewModel  →  Composable
```

- **Service:** one `CommuteService` for the one backend. It throws on a
  non-2xx response and returns the response envelope.
- **Repository:** returns `Either<Failure, T>`; never lets a `Throwable`
  escape. `Failure` is one small sealed type in `:core:common` (`Network`,
  `Remote(code)`, `Unknown`). Interfaces live in the feature's `:api` when it
  has one, implementations and their Hilt `@Binds` module in `:impl`.
- **ViewModel:** exposes a read-only `StateFlow<UIState<T>>`, where `UIState`
  is `Idle`, `Loading`, `Success(data, isRefreshing)` or `Error`.
- **Composable:** collects with lifecycle awareness and renders a `when` over
  `UIState`. Pure logic (grouping, sorting, mapping) lives in its own file
  next to the screen, not inside a `@Composable`, so it gets unit tests.

Package layout inside `presentation/` is **by screen**, not by kind: a
single-screen feature stays flat; a feature with two or more screens gets one
package per screen, each with its own `components/`.

### Navigation

`Route` is a sealed type of destinations in `:core:navigation`. Each feature
`:impl` contributes its own entries through a `NavGraphContribution` bound into
a Hilt set, and `:app` replays the set into one nav host. Adding a screen
touches its feature and `Route`, never `:app`.

### Build logic

Module setup lives in a `build-logic` included build, as convention plugins, so
a module's `build.gradle.kts` is a few lines:

| Plugin | For |
|---|---|
| `commute.android.application` | `:app` and `:wear` |
| `commute.android.library` | Android libraries (non-transitive R) |
| `commute.android.library.compose` | the same, plus Compose |
| `commute.android.hilt` | any module that declares or injects |
| `commute.kotlin.library` | pure Kotlin modules (`:core:trip`, `:core:common`) |
| `commute.kotlin.serialization` | modules with `@Serializable` types |

Versions come from one version catalog. There are no product flavors: the
debug build can point at a local API through `Environment`, which `:app`
provides from build config.

### Tests

JUnit plus coroutines-test, hand-written fakes over a mocking library, and test
fixtures published per module (a `FakeCommuteService`, a fake `CardReader`).
Tests live with their module; pure modules (`:core:trip`, `:core:common`) need
no device.

### Where the code lives: public app, private risky modules

The app lives in this public repo, like everything else in Commute. The
exception is any module whose *implementation* someone could plausibly object
to. Those live in a **separate private repo** and are pulled in at build time.

- **First case: the card readers.** `:feature:card:api` here holds the
  `CardReader` interface, and `:feature:card:impl` the screens and the fare
  comparison. The reader implementations (the command sequences for each card)
  are a module in the private repo that implements `:feature:card:api`.
- **Why:** an objection to one reader would otherwise be an objection to the
  whole repo: the web app, the API and these docs would all sit behind the
  same takedown notice. Kept apart, a contested module can be pulled without
  the public repo being touched.
- **The public build must work without them.** The app compiles and runs with
  no private module present, registering zero readers and hiding the card
  screen. Forks, contributors and CI for pull requests never need access to
  the private repo; only release builds include it.
- **The rule generalises.** Anything else that turns out to be contestable
  goes the same way: interface here, implementation there.

Signing keys and store credentials live in neither repo. Release builds come
from CI with secrets, not from a laptop.

### API client: generated, not hand-written

The API publishes `/openapi.json` (`apps/api/src/app.ts`), built from the same
Valibot schemas in `apps/schemas` that the web app parses with. The wire
models in `:core:model` are **generated from that document** at build time, so
a schema change shows up as a compile error in the app rather than as a runtime
parse failure on someone's phone. `CommuteService` in `:core:network` is the
thin, hand-written layer over them. Which generator to use is a choice for when
the project starts; the rule is that no response model is typed by hand.

The API is public and read-only by policy (`api-cors-policy.md`), so the app
sends no credentials and holds no secrets.

### The trips endpoint (a prerequisite)

The multi-journey answer the web app shows (`TripResult`: `journeys[]` with
labels, `boardings`, per-leg `departureAt`/`arrivalAt`) is served from
`/_internal/trips/:from/:to`. `/_internal` is deliberately **absent from the
OpenAPI document** and carries no compatibility promise: it is shaped around the
web app's screen and may change without notice.

The web app can live with that because it deploys together with the API. An
installed Android app can't: old versions stay on phones for months. So before
the app ships, one of these has to happen:

1. **Promote a trips endpoint into the public API** (documented in
   `/openapi.json`, versioned, changed only additively). A second consumer is
   what earns an endpoint a public contract, and the schemas were written to
   be "ready to promote" (`apps/schemas/src/fare.ts`).
2. Ship v1 on the public `/fares/:from/:to` (single journey) and add
   multi-journey results after promotion.

Lean: option 1, done as its own change before any Android code. Do not point an
installed app at `/_internal`.

### Offline cache

Riders open a transit app underground and in dead zones. The rule is: **anything
already seen is available offline, and its age is shown.**

- **Cached:** searchables (the station list), saved stations' pages and
  timetables, the most recent fare/trip results, and the active trip in full.
- **Where:** `:core:query`, a stale-while-revalidate cache persisted to disk
  (the same idea as the web app's SWR with its IndexedDB provider), for
  responses; `:core:datastore` for settings and saved stations.
- **Staleness:** entries are keyed by the API version they came from. A
  version bump marks them stale; stale entries still show, labelled with their
  age, until refreshed.
- **Offline:** cached screens render with a "terakhir diperbarui …" line.
  Nothing pretends to be live.

## Design language

The app should feel like Commute, not like a stock Material app that happens to
show trains:

- **Type:** Plus Jakarta Sans for UI; the PT Sans roundel face only inside line
  roundels, exactly as on web (`jaklingko-wayfinding.md`).
- **Colour:** the brand pink as the accent; line colours from
  `@commute/constants`, shipped to the app as generated resources rather than
  copied by hand.
- **Motion:** the same spring feel as the web app's sheets.
- **Components:** Compose Material 3 as the base, themed; bottom sheets behave
  like the web app's (snap points, fling, scroll hand-off).
- **Copy:** `brand-voice.md` applies unchanged: casual Jakarta Indonesian,
  "Kamu", personality only where it isn't interrupting a task.

When the shared design tokens planned for the web apps exist, the Android theme
should be generated from the same source so the two can't drift.

## Permissions and store policy

| Permission | When | Why |
|---|---|---|
| Location (while in use) | only during an active trip | alight reminders |
| Foreground service (location) | same | keeps the trip running with the screen off |
| Notifications | trip mode | alerts and the Live Update |
| NFC | card screen only | reading a card's balance |

- **No background-location permission.** Location runs only inside a
  foreground service the rider started by tapping "Mulai perjalanan", and stops
  at arrival. That keeps the app out of the store's strictest review category
  and is also simply the honest scope.
- **Nothing leaves the device:** no location, no card data, no account.
  The only network traffic is the public API.
- **No analytics by default.** If it's ever added, it's opt-in and documented.

## Store listing

- No operator logos, and no wording that implies affiliation with an operator.
  The app is an independent rider tool; say so in the listing.
- Station and line names are used descriptively. Line colours are the ones
  riders see on signage.
- Data sources are credited in the app (the same attribution the web app
  carries).

## Feature order

1. **App shell + IC balance.** Search, station pages, results, saved stations,
   and "enough for this trip?". It's small, useful on day one, and something
   the PWA can't offer.
2. **Trip mode.** Alight reminders and the Live Update, phone only.
3. **Wear companion.** Mirrors trip mode; then a Tile.
4. **Home-screen widget.** Next departures at a saved station.

Each step ships on its own.

## Open questions

- Minimum Android version. Lower covers more phones; Live Updates need a recent
  one, with a fallback below it.
- Application id and listing name.
- Whether saved stations sync between web and app (they're local to each
  today; syncing would need accounts, which nothing else wants).
- Release track: closed testing first, and for how long.
