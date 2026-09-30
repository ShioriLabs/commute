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
- Whether "start trip" is possible from the watch (pick from recent journeys),
  or always starts on the phone.
- Haptic patterns need testing on real wrists on a real train; the three above
  are a starting point.
- Round vs square layouts for the progress strip.
