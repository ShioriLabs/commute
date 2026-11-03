# Android: Wear OS companion

**Status:** design note, not yet implemented. Part of `android-app.md`; depends
on `android-trip-mode.md`.

## Goal

On a crowded train the phone is in a pocket or a bag. The watch is the one
screen a rider can glance at with a hand on the rail, and the one device that
can **tap their wrist** when it's time to get off. The watch app exists for that
and for very little else:

- trip progress at a glance;
- a buzz one stop before, and a stronger one at the stop;
- next departures at a saved station, without opening anything.

## Model: companion first

The phone owns everything: the trip, location, the API and the cache. The watch
**shows and buzzes**.

Why not standalone first:

- The trip engine, location handling and API client would all have to run on
  the watch, on a fraction of the battery.
- Almost every rider with a watch also has their phone on them on a commute.
- A companion is a few screens and a sync channel; standalone is a second app.

Standalone stays a documented option (below), and the trip engine is written as
pure Kotlin in `:core:trip`, which the watch already depends on, so it could move.

## Sync

Phone and watch talk over the Wear Data Layer.

| What | Direction | How |
|---|---|---|
| Active trip: legs, stops, targets, planned times | phone → watch | a data item, replaced when the trip changes |
| Progress: current stop, source (`CONFIRMED`/`ESTIMATED`/`UNKNOWN`), next action | phone → watch | a data item, updated on change (not on a timer) |
| Alerts ("siap-siap turun", "turun di sini", transfer) | phone → watch | a message, so it arrives now or not at all |
| Stop / "aku udah turun" | watch → phone | a message |
| Saved stations and their next departures | phone → watch | a data item, refreshed when the phone refreshes |

The watch keeps the last trip data item, so it has the whole plan even when the
phone goes quiet.

## Surfaces

### Ongoing Activity (during a trip)

The watch-face indicator and the recents entry while a trip is active, mirroring
the phone's Live Update: the line roundel, "2 stasiun lagi", and the alighting
station. Tapping it opens the trip screen.

### Trip screen

One glanceable screen, large type:

```
  (B)  ke Bogor
  Turun di  SUDIRMAN
  2 stasiun lagi · ±4 mnt
  ───●───●───○
```

Swipe for the next leg (transfer walk, platform, car position) and for the
exit at the destination. Estimated progress is marked the same way as on the
phone, so the watch never looks more certain than the phone is.

### Haptics

The reason the watch is worth it. Three distinct patterns, learnable without
looking:

- **Siap-siap:** two short taps, one stop before.
- **Turun:** a long, insistent pattern at the stop, repeating until dismissed
  or until the rider is clearly off the train.
- **Transfer / boarding hint:** one tap with the screen waking.

An estimated alert uses the same pattern with the softer wording on screen. The
wrist can't carry nuance; the text does.

### Tile and complication

- **Tile:** next departures at one saved station, grouped by direction, with
  platform codes. Chosen on the phone.
- **Complication:** the next departure for one line and direction ("B · 4 mnt").

Both show scheduled times from the phone's cache and refresh when the phone
refreshes. System refresh budgets for Tiles and complications are tight, so
neither counts down live; each shows the departure time, not a ticking
"in N min", unless the platform's time-based text does the countdown for free.

## When the phone is out of reach

Bluetooth drops in a crowded carriage, and phones die.

- The watch keeps the trip it last received and carries on **by the clock**,
  like the phone does underground: progress becomes `ESTIMATED` and the screen
  says "HP nggak kesambung, ini perkiraan".
- Alerts the phone would have sent are scheduled on the watch from the planned
  times when the trip is first synced, as a fallback. If the phone is connected
  when one is due, the phone's alert wins and the fallback is cancelled.
- When the link returns, the phone's progress replaces the watch's estimate.

So a rider whose phone dies mid-journey still gets buzzed near their stop, with
honest wording about how sure it is.

## Starting a trip from the watch

**Status:** researched on 2026-11-03 with throwaway spikes on a Galaxy S23 and a
Galaxy Watch5. Nothing has been built.

The idea: list the saved pairs on the watch. A tap starts a trip on the phone on
the first train the rider can still catch, using the same rule as the home
card's first row.

### What the spikes showed

On a locked phone with the app killed:

- **The message gets through.**
  - A Data Layer message from the watch cold-starts the app.
  - The journeys come back and `TripController.start` runs about 2.5 s after the
    tap.
  - The watch picks the trip up from `/trip/active` well within a minute.
- **The foreground service starts.** Play services' delivery gives the app a
  30 s window to start one from the background.
- **The `location` type is refused** at targetSdk 37: `Starting FGS with type
  location … the app must be in the eligible state/exemptions to access the
  foreground only permission`.
  - The app has while-in-use location only, with no
    `ACCESS_BACKGROUND_LOCATION`.
  - `TripService` then does what it already does for any refused start: the trip
    carries on by the clock.
- **GPS comes back when the rider opens the app.** `ActiveTripViewModel` calls
  `resumeTracking()` on unlock, and the service goes foreground with location.

### Why Citymapper can do it

Citymapper's watch app does exactly this: Get Me Home, then Go, with the phone
locked. It starts a `location` foreground service and GPS runs, with the same
while-in-use-only permission as ours. Comparing the two in `dumpsys`:

- Play services binds **both** apps' Wear listeners with "may start activities
  from the background" (`mIsAllowedBgActivityStartsByBinding=true`, bind flags
  `0x100001`).
- At **targetSdk 36** (Citymapper's), a foreground service the app requests
  while that binding is live counts as started by an activity starter:
  `allowWiu:52 ACTIVITY_STARTER`. It gets while-in-use location even with the
  screen locked.
- At **targetSdk 37** (ours), the same binding gives
  `getFgsAllowWiu_legacy=BACKGROUND_ACTIVITY_PERMISSION` but
  `getFgsAllowWiu_new=DENIED`. Android 17 no longer lets that allowance stand in
  for a visible app.
- We confirmed it on our app. Forced to targetSdk 36, with nothing else
  changed, a watch tap on the locked S23 started `TripService` with location,
  and GPS ran.
- The service also has to be requested **inside `onMessageReceived`**, while
  the binding exists. Requested after the callback returns, the process is
  already cached and nothing is allowed.

### Decision

We stay on targetSdk 37, and don't hold the app back a version for this. A trip
started from the watch therefore:

- runs **by the clock** until the rider opens the phone, then GPS joins in;
- takes "Udah naik" and "Udah turun" from the watch meanwhile.

The one known way to have fixes sooner is untested:

- the watch runs its own location service, which it may, because its app is
  visible at the tap;
- it forwards fixes to the phone's `TripControllerImpl.onFix`;
- the phone stops the watch once its own GPS is back.

That needs the phone to stay alive between fixes, under a non-location
foreground service whose Play acceptance is unchecked. It also costs watch
battery.

### For whoever builds it

- Sync saved pairs to the watch as data items, next to the saved stations'.
  Include TransJakarta.
- Pairs are often closed at night (`resumesAt`). The phone has to send back a
  reason the watch can show, rather than starting nothing silently.
- Seen twice in the spikes and not looked into: after "Berhenti" on the watch
  with the phone app dead, the watch kept showing the trip until the phone app
  was next opened.
- Recheck the targetSdk 37 behaviour against each new platform release, in case
  an opt-in appears.

## Battery

- No location, no network and no sensors on the watch in companion mode.
- The trip screen isn't kept on; the Ongoing Activity and haptics do the work.
- Progress updates are sent on change, which on a train is once per station.

## Standalone, later

What it would take, for when it's worth it (LTE watches, runners without a
phone):

- the generated API client and cache on the watch;
- the trip engine from `:core:trip` running in a watch foreground service,
  with the watch's own location;
- its own search and result screens, sized for the wrist;
- a much harder battery budget.

Nothing in the companion design blocks it: the sync items above become local
state.

## Build order

1. Data Layer sync of the active trip and progress; a plain trip screen.
2. Alert messages and the three haptic patterns.
3. Ongoing Activity.
4. Clock fallback when disconnected.
5. Tile, then complication.

## Open questions

- Minimum Wear OS version.
- "Start trip" from the watch is possible, but with no GPS until the phone is
  opened. See [Starting a trip from the watch](#starting-a-trip-from-the-watch).
- Haptic patterns need testing on real wrists on a real train; the three above
  are a starting point.
- Round vs square layouts for the progress strip.
