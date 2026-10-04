# Android: trip mode (station reminders and Live Updates)

**Status:** design note, not yet implemented. Part of `android-app.md`; the
watch side is in `android-wear.md`.

## Goal

A rider picks a journey and taps **"Mulai perjalanan"**. From then until they
arrive, the phone tells them what matters at the moment it matters, with the
screen off:

- where to stand before boarding (`best-car-position.md`);
- **"Siap-siap, stasiun berikutnya kamu turun"** one stop before;
- **"Turun di sini"** on arrival, with the exit to take
  (`points-of-interest.md`);
- at a transfer: where to walk, which platform, how long until the next train.

And a Live Update shows the same progress on the lock screen the whole way.

The point is the rider who's reading, asleep, or standing where they can't see
the station signs. It's the most-requested thing a transit app can do that a
website can't.

## The trip

A trip is one chosen journey from the API (a `FareJourney`: `legs[]` of `RIDE`
and `TRANSFER`), copied onto the device when it starts. Everything trip mode
needs is already in that shape:

| Field | Used for |
|---|---|
| `RIDE.stops[]` | the ordered stations of the leg: progress and "N stasiun lagi" |
| `RIDE.departureAt` / `arrivalAt` | the clock, where a real trip covers the leg |
| `RIDE.platformCode`, `headsign` | what to board |
| `TRANSFER.distanceM`, `corridorLabel` | the walk between legs |
| `carPosition`, exits (once they exist) | boarding and alighting hints |

Station coordinates come from the station data the app already caches. The trip
is stored in full, so trip mode works **with no network at all** once started.

## Where is the rider? Three sources, in order of trust

1. **Location fix near a station on the leg.** A fix within a station's radius
   advances progress to that stop. Progress only moves forward along
   `stops[]`; a fix near an earlier stop never moves it back.
2. **The timetable.** When the leg has `departureAt`/`arrivalAt`, the expected
   position follows the clock: interpolated across `stops[]` between the two
   times. This is what carries the trip **underground**, where the MRT gets no
   fixes at all, and through tunnels and urban canyons.
3. **Nothing.** A leg with no times (every TransJakarta leg: the network has
   headways, not a timetable, see `go-mode.md`) and no recent fix. The app
   says so rather than guessing.

Every position carries which source produced it: `CONFIRMED` (a fix),
`ESTIMATED` (the clock) or `UNKNOWN`. A fix always wins, and a fix that
disagrees with the clock **re-bases the clock**: if the train is two minutes
late at a station we can see, it's two minutes late for the rest of the leg.

Today the API gives times for the ends of a ride leg, not for each stop in
between, so interpolation is by stop count. Per-stop times would make the
estimate much better underground; see Open questions.

## Alerts

| Alert | Fires when | If only estimated |
|---|---|---|
| Boarding hint | trip start, and at each transfer | same |
| "Siap-siap turun" | progress reaches the stop before the alighting stop | softer wording: "sekitar 2 menit lagi, cek papan stasiun ya" |
| "Turun di sini" | progress reaches the alighting stop | same softer wording |
| Transfer | right after alighting | same |
| "Kamu kelewatan?" | a fix lands past the alighting stop | only fires on a fix |

Rules:

- **Each alert fires once.** Progress is monotonic, so an alert tied to a stop
  can't repeat when the GPS jitters.
- **Estimated alerts say they're estimates.** A confident "turun sekarang" based
  on a timetable alone would be wrong every time a train is late, and one wrong
  alert teaches the rider to ignore the rest.
- **`UNKNOWN` legs get one honest notice** at boarding: "Buat rute ini belum
  bisa kasih pengingat otomatis, pantau halte ya", plus the stop count.
- Alerts use a high-priority channel with a distinct vibration; the watch
  repeats them as haptics (`android-wear.md`).

## Foreground service

Trip mode runs in a foreground service of type *location*, started by the
rider's tap and stopped at arrival, on cancel, or after a safety timeout (well
past the planned duration, so a forgotten trip doesn't run all night).

- **No background-location permission**: location is only requested while this
  service runs, which the rider started and can see in the notification.
- **Battery:** the request rate follows need. Coarse and slow in the middle of a
  long leg, precise near the alighting stop, paused while the clock says the
  train is underground.
- **Survives being killed:** the trip and its progress are persisted on every
  change. If the system restarts the service, it resumes from the stored state
  and the clock, and says "lanjut dari perkiraan" until a fix confirms.

## Live Update

On Android versions that support it, the trip notification is a **Live
Update**: a promoted ongoing notification with a progress style, shown on the
lock screen and as a status-bar chip.

- **Segments** are the legs, in their line colours; **points** mark transfers.
- The text is the next action: "Turun di Sudirman · 2 stasiun lagi", then
  "Pindah ke Lin Bogor · Peron 5", then "Keluar di Pintu B".
- `ESTIMATED` progress is drawn differently from `CONFIRMED` (a lighter tracker),
  so the bar doesn't claim precision it doesn't have.

On older versions it falls back to a standard ongoing notification with the
same text and a plain progress bar. The exact APIs and minimum version should
be checked against current platform documentation when this is built; the
design only depends on "an ongoing notification with segmented progress".

## What can go wrong

| Situation | Behaviour |
|---|---|
| Train runs late | a fix re-bases the clock; without one, estimated alerts are early and say "sekitar" |
| Rider boards a different train or direction | fixes stop matching `stops[]`; after a few, ask "Masih di rute ini?" with re-plan or stop |
| Train skips a stop or short-turns | progress follows fixes; if the alighting stop becomes unreachable, say so |
| Long dwell, train held | clock runs ahead; the next fix pulls it back |
| Phone has no location permission | trip mode still runs on the clock alone, labelled estimated throughout |
| TJ leg | no times; GPS-only. With a fix it works like rail; without one, it's `UNKNOWN` |
| Battery saver kills location | treated as no fixes: clock-only |

## Build order

1. Trip engine in `:core:trip` (pure Kotlin): progress over `stops[]`, the three sources,
   re-basing, alert scheduling. Fully unit-tested with recorded and synthetic
   fix sequences (late trains, tunnels, wrong direction) before any UI.
2. Foreground service + persistence + the basic ongoing notification.
3. Alerts and their wording for confirmed vs estimated.
4. Live Update presentation, with the fallback.
5. Field testing on real journeys: one surface line, one underground, one with
   a TJ leg.

## Open questions

- Default lead time: alert one stop before, or N minutes before, or both.
- **Per-stop times in the API.** A ride leg carries only its end times today.
  Exposing each stop's scheduled time (the data exists in the timetable)
  would make underground estimates far better. Additive, so it can come later;
  proposed with stop coordinates in `trips-live-fields.md`.
- Off-route: offer an automatic re-plan, or just ask.
- Whether a trip can be started from the web app and handed to the phone.
