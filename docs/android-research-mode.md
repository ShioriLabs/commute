# Android: research mode (train motion phases)

**Status:** designed (2026-10-05), not built. An Experimental add-on to trip
mode (`android-trip-mode.md`).

## Goal

Trip mode knows *where* the rider is: a fix within 150 m of a station, or the
timetable in between. It doesn't know *what the train is doing*: standing at a
platform, pulling away, running, braking for a signal, or held outside
Manggarai. Tuning arrival and departure detection, ETAs and signal holds needs
rides where that is written down, second by second.

Research mode records it. With **"Mode riset"** on in Experimental, every rail
leg of an OTW trip also records high-rate GNSS and IMU data. A live classifier
on the phone labels the train's motion phase as it goes. After the trip:

- **TripFinished** shows a speed curve and an acceleration curve for each hop
  (station to station), with the phases shaded;
- **"Kirim data riset"** in Experimental shares the raw recordings, the same
  way "Kirim log perjalanan" shares the trip log.

The ground truth is what the rider already taps: **Tandai manual** (Jalan /
Berhenti / Aneh). "Aneh" is for the moment the label on screen looks wrong.
**Tandai Peron** adds a row for each platform's two ends: "Peron mulai" as the
start of the platform comes level with the rider's window, "Peron habis" as
its end goes past. Against the fixes, these map where each platform runs along
the line, in the same terms as the phone's own position. That is meant to
replace one point and a fixed 150 m radius per station. Platforms don't move,
so this is a survey: a ride or two per line, both ways, maps every station on
it.

## What the data is for

Research mode itself changes nothing a rider sees outside Experimental. The
recordings exist to improve two engines later, each as its own piece of work:

- **OTW mode's trip engine** (`:core:trip`, `TripEngine`):
  - Today "arrived" means a fix within 150 m of the station's point, and "left"
    means the next fix further on. Phase data shows where DWELL really starts
    and ends relative to that radius, and how much sooner STOPPING or
    DEPARTING could tell it.
  - The timetable dead-reckoning that carries a trip underground can use real
    run times and dwells instead of a straight interpolation.
  - HELD time says how often the clock is wrong because the train is waiting
    for a signal, not because it is late.
  - Once `MotionClassifier` has earned it on replayed rides, the engine can
    take its phases as an input of its own.
- **tsundere's timings** (`libs/tsundere`):
  - KCI publishes departures only, so `alightTimeOf`
    (`planner/departures.ts`) uses the departure as the alighting time and
    refuses to invent a dwell that was never measured. These recordings
    *are* that measurement: real dwell per station, real run time per hop,
    and how both vary by time of day.
  - Aggregated over enough rides, they can correct per-stop times where the
    timetable is thin or wrong, and give transfer windows a measured margin
    instead of a guessed one.
  - Getting the numbers into tsundere's inputs (the D1 graph data in
    `apps/api`) is its own design, once there is data worth feeding it.

**Not in scope:**

- phases feeding `TripEngine` decisions, or recorded timings feeding tsundere
  (that is what the data is *for*, above; each comes later, on its own);
- TransJakarta legs;
- live curves on the trip screen;
- raw `GnssMeasurement` pseudoranges;
- a standalone recorder with no journey.

## Phases

Seven, because a KRL run between two stations is rarely clean:

| Phase | Meaning |
|---|---|
| `DWELL` | stopped within 150 m of a stop on the plan (`RAIL_AT_STOP_M`) |
| `HELD` | stopped anywhere else: a signal, a queue into Manggarai |
| `DEPARTING` | pulling away from a stop (DWELL or HELD) |
| `ACCELERATING` | powering up again mid-run, after a slowdown |
| `COASTING` | steady: coasting or cruising, \|a\| small |
| `BRAKING` | slowing while still at speed: for a signal, a speed limit, or the station |
| `STOPPING` | the last of the braking, below about 20 km/h |

The cycle the user described, DWELL → DEPARTING → COASTING → BRAKING →
STOPPING → DWELL, is the clean case. ACCELERATING and HELD are the detours.

### Transitions

Starting thresholds, all in one `MotionTuning` data class so that a replay
(below) can sweep them. Speeds are in m/s, acceleration `a` is forward
acceleration in m/s².

| From | To | When |
|---|---|---|
| any moving phase | DWELL / HELD | `v < 0.3` for 2 s; DWELL if within 150 m of a plan stop, else HELD |
| DWELL / HELD | DEPARTING | `a > 0.10` for 1 s, or `v > 0.5` |
| DEPARTING / ACCELERATING | COASTING | `\|a\| < 0.08` for 3 s |
| COASTING | ACCELERATING | `a > 0.12` for 2 s |
| COASTING / ACCELERATING | BRAKING | `a < −0.15` for 1.5 s |
| BRAKING | COASTING / ACCELERATING | `a > −0.05` for 3 s with `v > 3` |
| BRAKING | STOPPING | `v < 5.5` while still decelerating |
| STOPPING | DWELL / HELD | the stop rule above |

Every rule needs its condition to **hold** for a minimum time, so one jolt
doesn't flip the phase. For scale, KRL EMUs pull away at about 0.8–0.9 m/s² and
brake at about 0.9–1.0 m/s², so the thresholds sit well below real running and
well above platform sway.

## Sensing

### What is read

| Stream | Source | Rate |
|---|---|---|
| position, **Doppler speed**, bearing, their accuracies, altitude | `GPS_PROVIDER` (FUSED only if GPS is off) | 1 Hz |
| linear acceleration (gravity removed) | `TYPE_LINEAR_ACCELERATION` | 50 Hz |
| attitude | `TYPE_GAME_ROTATION_VECTOR` | 50 Hz |
| satellites used / visible, mean C/N0 of the strongest 4, constellations | `GnssStatus` | ~1 Hz |

Two choices here matter:

- **GPS, not FUSED.** The fused provider smooths speed. The tuning wants the
  receiver's own Doppler speed, which is good to about 0.1–0.3 m/s in the open
  sky.
- **The game rotation vector, not the plain one.** The plain rotation vector
  uses the magnetometer, and traction motors and the overhead line make
  magnetic north meaningless inside an EMU. The game vector is gyro and
  accelerometer only: its yaw has no fixed reference and drifts a few degrees a
  minute. The estimator below aligns it against GNSS instead.

Every stream is stamped with `elapsedRealtimeNanos`, the monotonic clock that
`SensorEvent.timestamp` and `Location.getElapsedRealtimeNanos()` share. That is
what lines a 50 Hz accelerometer sample up with a 1 Hz fix. Wall time appears
only on low-rate lines.

### From a phone in a pocket to "forward"

The phone sits at any angle and may be picked up mid-ride. The
`MotionEstimator` (pure Kotlin) turns its readings into the train's forward
acceleration and speed:

1. **World frame.** Rotate linear acceleration by the game quaternion and keep
   the horizontal part. This removes the phone's attitude: tilting it or
   pocketing it no longer changes the reading.
2. **Which way is forward.** The game frame's yaw is arbitrary. Whenever GNSS
   sees the speed change, fit the yaw offset between the game frame and true
   north by least squares: the IMU's Δv over a 2 s window, rotated by the
   offset, against GNSS's Δv. While GNSS is good (speed > 3 m/s, bearing
   accuracy < 15°), the travel direction in the game frame is the GNSS bearing
   minus that offset. In tunnels and under station roofs it holds its last
   value.
3. **Project.** The component along the travel direction is `aLong`. The
   component across it is `aLat`, which is curve load; it is logged because it
   costs nothing.
4. **Fuse speed.** A two-state Kalman filter over `[v, aBias]`:
   - predict with `aLong` at 50 Hz;
   - update with GNSS speed at 1 Hz, with `speedAcc²` as its variance;
   - **zero-velocity update** when still: accel variance low over 2 s, and GNSS
     either below 0.5 m/s or absent;
   - clamp `v ≥ 0`.

   GNSS keeps the integration from drifting; the IMU fills the second between
   fixes and the minutes underground. Without step 4, 1 Hz Doppler alone is too
   coarse to catch the moment braking begins.
5. **Out**, at 5 Hz: `EstSample(nanos, v, aLong (1 s low-pass), aLat, still,
   gnssOk)`. That stream is what the classifier reads.

The `MotionClassifier` is a pure state machine:
`step(state, sample, nearStopId?) → (state, transition?)`. It emits
`PhaseSpan(phase, startNanos, endNanos, stopId?)`. Both the estimator and the
classifier live in `:core:trip` (package `research`) with no Android code, like
`TripEngine`. **`TripEngine` itself doesn't change.**

## Recording

`ResearchRecorder` (`:feature:trip:impl`, runtime) runs while all of these
hold:

- "Mode riset" is on;
- the trip is `RIDING`;
- the current leg is a rail ride.

It stops at a transfer, at the end of the trip, or when the switch goes off.
`TripService` starts and stops it next to its location collection.

While it runs:

- **It collects all four streams** and drives the estimator and the classifier.
- **The engine is fed as if research were off.** The service takes the 1 Hz
  research fixes and forwards to the controller only those at least the
  controller's usual interval apart. Trip behaviour stays exactly what it
  would be without research, which is the point of the data. It also keeps the
  1 MB trip log from flooding.
- **Phase transitions** also go to the trip log as `ev:"phase"`, so they sit
  between the fixes and marks they explain. Marks also go to the research
  file, so that file is self-contained.
- **A partial wake lock**, `commute:research`, capped at 3 h, is held. The
  sensors are non-wakeup: with the CPU asleep their FIFOs overflow and samples
  are lost. Battery cost is accepted; this is research.

### The file

One per ride: `filesDir/research/<yyyyMMdd-HHmm>-<line>.ndjson.zst`, streamed
through `ZstdOutputStream` and flushed every 5 s, so a crash loses at most 5 s.

It opens with a header: the `device()` facts the trip log export already
writes, each sensor's name, vendor, range and resolution, and the plan's stops
(id, name, lat/lon, scheduled time). Then one line per reading:

| `ev` | Fields |
|---|---|
| `imu` | `n`, `a: [x, y, z]`, `q: [w, x, y, z]` |
| `gnss` | `n`, lat, lon, acc, alt, speed, speedAcc, bearing, bearingAcc |
| `sat` | `n`, used, visible, cn0, constellations |
| `est` | `n`, v, aLong, aLat, still, gnssOk: the classifier's own view |
| `phase` | `n`, from, to, stopId |
| `mark` | `n`, kind, what the board showed |

That comes to about 3 MB an hour compressed. The newest 20 files are kept, up
to 200 MB in all.

### The summary

When recording stops, the recorder writes a `ResearchSummary` as JSON next to
the file. For each hop it holds:

- `v` and `aLong` downsampled to 2 Hz;
- the phase spans;
- the marks;
- stats: top speed, peak acceleration, peak braking, dwell time, held time.

`FinishedTrip` gains a nullable `researchId` pointing to it.

## UI

**Experimental**, following the `manualMarks` pattern (a
`DeveloperPreferencesRepository` key `research_mode`, a switch in
`ExperimentalScreen`):

- a **"Mode riset"** switch, with the subtitle "Rekam GPS + sensor gerak tiap naik
  kereta, buat ngulik cara kereta jalan & ngerem";
- a **"Kirim data riset"** item, which shares the recordings with
  `ACTION_SEND_MULTIPLE` through the trip log's FileProvider (plus a
  `research/` path).

**TripFinished**, when `researchId` is set, gets a research section:

- a row of figures: top speed, peak acceleration, peak braking, total held time;
- per hop, a `RunChart`: speed (km/h) above and `aLong` (m/s²) below, on one
  time axis. Phase bands sit behind both, mark ticks sit on the axis, and the
  station names are at the ends.

The chart is custom Canvas drawing, like the rest of the trip screens. No
chart library comes in.

## Tuning loop

`ResearchReplay` is a JVM test in `:core:trip`. Given a recording
(`-Dresearch.file=…`; skipped without one), it:

1. re-runs the estimator and the classifier with a `MotionTuning`;
2. prints the phase timeline next to the marks;
3. gives an agreement score and the dwell, hold and acceleration stats.

```
./gradlew :core:trip:test --tests '*ResearchReplay*' -Dresearch.file=…/20261006-0712-bogor.ndjson.zst
```

This is how thresholds move: ride, export, replay, adjust `MotionTuning`,
replay again. The recorded `est` lines let a replay check itself against what
the phone computed live. zstd-jni comes into `:core:trip` as a test-only
dependency.

## Build order

Each stage is tested and committed:

1. `Fix` gains optional speed, bearing, accuracy, altitude and
   `elapsedNanos` fields (`null` by default, so nothing breaks);
   `LocationMode.RESEARCH`; `MotionSensors` / `AndroidMotionSensors`.
2. `MotionEstimator`, `MotionClassifier`, `MotionTuning`, test first against
   synthetic rides.
3. `ResearchRecorder`, the file, the service wiring and the wake lock; the
   Experimental switch and the export.
4. `ResearchSummary`; `RunChart` and the TripFinished section.
5. `ResearchReplay`; a pointer from `android-trip-mode.md`.

## Testing

- **`:core:trip` unit tests**, with synthetic rides:
  - the full sequence: a 30 s dwell, 0.8 m/s² for 25 s, coasting, a signal
    brake, re-acceleration, then braking to a stop at a station (DWELL) and
    away from one (HELD);
  - the same ride seen through a phone rotated to arbitrary angles;
  - GNSS dropouts;
  - zero-velocity resets.
- **Recorder tests** with fake streams. The existing trip, journey and
  settings suites must stay green.
- **Emulator (Pixel 10):** the switch, a recording with `geo fix` (with the
  alt and sats arguments) and virtual sensors, an export that decodes.
- **The real test, on the S23:** a few KRL hops with Mode riset and Tandai
  manual on. Check that:
  - the curves look like a train (about 0.8–1.0 m/s² either way);
  - the export decodes;
  - `ResearchReplay` on that file reproduces the phases the phone showed.

## Open questions

- Holding the last travel direction underground assumes fairly straight track.
  MRT curves are gentle, but if `aLong` visibly bleeds into `aLat` on a curve,
  track the turn with the game frame's yaw rate.
- A phone moved mid-ride, from pocket to hand, is absorbed by step 1, because
  the world frame doesn't depend on attitude. If replays show a glitch at that
  moment anyway, mark it `Aneh` and look.
