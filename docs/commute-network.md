# Commute Network

Status: **idea, not started** (written 2026-11-25). Rider-contributed data:
phase 1 is ride surveys, station surveys, disruption reports and train lateness. Anonymous live GPS
comes later.

## Why

- **KCI publishes no punctuality data.** Trip mode on Android already measures
  how late a train is, every ride. Pooled, that is the first public record of
  how late KRL actually runs, by line, station and hour, with the method and
  sample size printed next to every number.
- **Our TJ data source is dead.** Ward lost TJ in October (`tj-mqtt-banned`) and
  the TJ wait model has known biases it can't be refitted out of on the same
  closed sample (`tj-observed-timings.md`, last section). Rider data is the
  only live source left.
- **Station data is incomplete in ways only riders can fix.** KCI amenities are
  15/111 stations done, and "a missing icon means unknown, not absent". Field
  reports have beaten every web source so far.

## 1. Rule zero: Commute must never help anyone track a person

This section comes first because every later choice is checked against it.

Stalking is a chronic problem here, not an edge case. KAI Access's seat map shows
where women are seated, a feature meant for women's safety, and men use it to
book the seat next to a woman. The feature worked as designed. That is the
failure this rule exists to prevent: **any feature that reveals who (any rider
attribute) is where becomes a targeting tool, however well meant.**

**The stalker test**, applied to every field, endpoint, log line and UI element:
*if someone already knows the victim's usual train, does this help them confirm or
follow them?* If yes, it doesn't ship.

Invariants:

1. **Outputs describe vehicles, stations and lines, never people.** "Bogor Line
   is 4 min late on average at 07-09" yes. Anything that changes with whether one
   particular person is aboard (counts, aliases, "first reported by", "reported
   at 07.12") no.
2. **The server never holds an identity next to a location or a trip.** The
   credential stops abuse at the door and is not stored with what it submitted
   (see "Credentials and linkage").
3. **Collect the derived fact, not the trace.** The phone works out "this train
   was 3 min late at Manggarai". Raw GPS never leaves the device in phase 1.
4. **Short retention for raw records, aggregates kept.** Raw submissions are
   deleted once aggregated (proposal: 30 days, open question).
5. **No IPs, user agents or bodies in logs on submit endpoints.** Check the
   request-log observability (KV crawler work, 2026-08) before the first endpoint
   ships. It is the kind of thing that quietly breaks invariant 2.
6. **No social features.** No co-rider lists, aliases, counts, thanks, live
   location sharing. A live indicator, when it comes, is an icon only.
7. **No rider attributes.** No gender, age or "report as" fields, even for a
   safety feature. KRL's women-only cars stay static guidance, never "who's in
   which car".
8. **Thresholds before publishing.** Nothing is published from fewer than k
   distinct contributors, so a number can never mean one person.

## 2. Phase 1

Android only: trip mode, where all three inputs come from, exists only there.
Web joins for station surveys later if wanted.

### 2a. Lateness, measured automatically

What trip mode already computes on the device (`feature/android-app`,
`core/trip/TripEngine.kt`):

- `stopTimes`: when the train was at each stop of the leg, from GPS fixes at the
  stop (the last fix while it waits, about when it left; the first fix at the
  alighting stop, when it got in).
- `clockOffsetS`: lateness against the timetable, re-based each time a fix at a
  stop disagrees with the clock, clamped to `MAX_EARLY_S..MAX_LATE_S`.

**What gets sent**, once per ride leg after it ends (never live in phase 1):

```
{ tripId, lineCode, serviceDay, stops: [{ station, offsetS, source }] }
```

- Only stops with a real observation. `source` = `FIX` (a GPS fix at the stop) or
  `BOARDED_TAP` (the rider tapped "naik", which says the train left late but
  confirms nothing). `ESTIMATED` positions are never sent: they are our own clock,
  not a measurement.
- `offsetS` against the timetable the app was using, not absolute times. Together
  with `tripId` that still pins a moment, which is fine: it describes a train
  (invariant 1) as long as nothing ties it to the sender (invariant 2).
- Not a trace and not a trip log. `POST /uploads/trips` (raw zstd trip logs to
  R2, testers, 7-day expiry) stays what it is: a debugging channel. Network gets
  its own derived-only endpoint.

**Plausibility, server side:**
- `tripId` must exist and run on `serviceDay`, the stations must be on its path,
  in order, and offsets must be monotone within sane bounds.
- An offset that contradicts a quorum of others on the same train and stop is
  dropped, not averaged in.

**What riders get back (phase 1): punctuality, not live.**
- Per line × direction × hour block × day type: median and p90 lateness, share
  on time (definition to settle, e.g. ≤ 2 min), and the number of observed trains.
- Per station on the line page and station page: "Biasanya telat ±4 mnt jam
  07-09 (dari 312 kereta)".
- Only cells with ≥ k distinct contributors over ≥ N trains are shown.
- **Method and sample size beside every number.** If we publish KCI's
  punctuality, the numbers must survive KCI reading them.
- Feeds back into our own estimates: arrive-by margins and trip mode's clock can
  learn typical lateness per line and hour.

### 2b. Ride survey

Transit asks "Did your train come when you thought it was scheduled to arrive?"
with three buttons. Ours, asked once at the end of a ride in trip mode, never
mid-ride, always skippable:

- Ketepatan: Lebih cepat / Pas / Telat (fills gaps where 2a has no fix, e.g.
  underground MRT)
- Kepadatan: Lega / Lumayan / Penuh / Desak-desakan (per *ride*, never per car
  and never tied to who is in it)
- Optional, rotating, one at a time: AC, cleanliness, announcements

**Fixed choices only, no free text**: nothing to spam with and nothing to
moderate. Payload is `{ tripId, legRange, answers: enum[] }` under the same
linkage rules as 2a.

### 2c. Station survey

The amenities backfill, crowdsourced. Asked at most once per station visit, after
alighting or at boarding, skippable:

- One question at a time about one amenity: "Eskalator di sini jalan?" Ada &
  jalan / Ada tapi rusak / Ga ada / Ga tahu.
- Targets the gaps first: unknown amenities (`kci-amenities-backfill` open field
  checks: Bekasi Timur escalator and musala, Cibitung and Tambun escalators),
  then periodic re-checks of things that break (lifts, escalators).

**Survey answers don't edit station data automatically.** They become a queue:
an amenity changes only when a quorum agrees, and changes to curated data
(`stations.amenities`) are reviewed before they ship. "Rusak" reports are
the exception worth surfacing quickly ("Lift dilaporkan rusak hari ini"), still
behind a quorum.

### 2d. Disruption survey

"Ada gangguan?" Riders on board know about a disruption long before any official
post does, and for TransJakarta there is often no official post at all.

**When it's asked:**
- **Prompted** when trip mode sees an anomaly: the train stopped between stations
  for more than N min, lateness jumped by more than M min within a leg, or the
  rider was told to get off short of their stop. Asked once per anomaly, skippable.
- **Manually**, from the line page and from trip mode, for what the phone
  can't see (a halte closed, a flood on the road ahead).

**Fixed choices only**, per mode:
- Rail: Kereta tertahan / Gangguan sinyal atau listrik / Perjalanan dibatalkan
  atau dialihkan / Banjir / Lainnya / Ga tahu
- TJ: Bis dialihkan (lewat jalur lain) / Halte ditutup / Macet parah / Banjir /
  Lainnya / Ga tahu

"Lainnya" stays a choice, never a text box.

**What it describes: the network, not the train you're on.** A report is filed
against a **segment** (station to station on a line) or a **halte**, never
against a trip. "Gangguan di Manggarai–Jatinegara" says something about
infrastructure. It is not "someone on train 1234 reported...". The sender's trip
is used only to work out the segment on the device, then dropped. Rule zero holds:
the output can't tell anyone who was aboard.

**Publishing.** Disruptions are time-sensitive, so this is the one phase 1 output
that is near-live. That makes the guards matter more:
- **Quorum** of k distinct contributors on the same segment within a window
  (proposal: 3 within 15 min) before anything shows. A single report never
  shows: false alarms are the obvious prank, and panic is the cost.
- **Corroborated where possible.** Lateness data (2a) from trains on the same
  segment should show the same story (offsets jumping, trains stopped). A
  disruption with quorum *and* corroboration shows sooner. One with no supporting
  lateness waits for more reports.
- **Labelled as reported by riders** ("Dilaporkan pengguna · 12 menit lalu"),
  distinct from anything official. Phrased as a report, not a fact: "Ada laporan
  gangguan", never "Gangguan".
- **Expires by itself** (proposal: 30-60 min after the last report) unless new
  reports keep it alive. Stale disruptions are worse than none.
- Clears early when riders report it's resolved, or when lateness on the segment
  returns to normal.

**What it feeds beyond the banner:**
- **TJ reroutes.** Repeated "Bis dialihkan" at the same halte is the signal
  `tj-reroute-artifacts` used to get from ward logs (lines that stop serving a
  halte). It could flag topology for review, never edit it automatically.
- **Punctuality context.** Days with a confirmed disruption can be marked in the
  2a statistics, so "Bogor Line telat 4 mnt rata-rata" can say how much of that
  was one bad day.

## 3. Credentials and linkage

Account-less. The aim is to make each fake identity cost something, then limit
per identity.

- **Registration:** Play Integrity on Android (a genuine app on a genuine device),
  verified server side, then the server issues a pseudonymous credential (random
  id, signed, expiring and renewable with the same id). This is a Google-signed
  attestation, not an APK secret, so it doesn't run into the objection that
  ruled out HMAC for trip-log uploads (secrets in an APK are extractable).
  Turnstile for web, if web ever submits.
- **Per-credential rate limits** (Workers Rate Limiting binding). **Not per IP**:
  Indonesian mobile carriers put huge numbers of users behind shared addresses
  (CGNAT), so IP limits punish everyone on the same exit. IP only as a loose
  backstop.
- **Linkage: the credential is checked at the door and not stored.** For quorum
  ("k distinct contributors") the record keeps an HMAC of the credential under a
  **daily key that is deleted at the end of the day**. Same-day records from one
  device can be counted as one. After the key is gone, nothing links records to
  each other or to a device.
- **Reputation**, if needed: kept on the credential, never on records. A
  credential whose submissions keep agreeing with consensus counts for more in
  quorum; a new one counts for less. Fake devices then need time as well as
  attestation. Phase 1 may not need it. Start with quorum + plausibility and add
  it if abuse shows up.
- **Escalation, not blocking:** a credential that spikes gets a fresh attestation
  check before its next submit.
- Revocation list in KV for the rare ban.

## 4. Consent

- **Opt-in**, once, in plain words, before anything is sent: what is measured, what
  leaves the phone, what never does, how long it's kept. Location data is personal
  data under UU PDP (Law 27/2022). Plan for consent, a stated purpose and a
  retention limit from the start (not legal advice; check before launch).
- Visible while it happens: trip mode shows that this ride is contributing, with a
  one-tap "jangan untuk perjalanan ini".
- Off is always one tap, and turning it off deletes what's still queued on the
  device.

## 5. Later phases

- **Phase 2: live.** Anonymous GPS while on a matched trip, prompted per trip like
  Transit's AutoGO (blog.transitapp.com/autogo/), never in the background. Map
  matching on the device. Uploads spend **unlinkable tokens** (Privacy Pass style:
  the credential only obtains a daily batch, and uploads can't be traced back to
  it). Live times get an icon, no counts, published only after k independent
  devices agree and slightly delayed, so an icon can never mean one person on a
  near-empty train. Mock locations dropped. This is also the TJ live source that
  replaces ward and fixes the wait model.
- **Napak Tilas:** a yearly recap like Spotify Wrapped, computed on the device
  from on-device history. Contribution shown as your own count ("Kamu share 48
  perjalanan") plus a network-wide total, never "you helped N people" (that needs
  server-side linkage). Share card defaults to harmless stats; home station and
  usual departure time are opt-in.

## 6. Prior art

Transit (transitapp.com): GO / AutoGO crowdsourced vehicle locations (1-2 s
latency vs ~15 s agency transponders; coverage up to 65% of trips in bus cities,
~20% in rapid-transit cities, where GPS dies underground), the "did your train
come when you thought" survey, and the ETA Accuracy Benchmark. Copy the per-trip
opt-in and the survey shape. **Don't copy GO's rider avatars, counts and
"thanks"**: one public screenshot shows "one of THREE riders" on an airport
shuttle and a named rider ("CTA Girl"), which is rule zero failing.

## Open questions

1. k (distinct contributors) and N (trains) per published cell, and the "on time"
   definition.
2. Raw retention: 30 days, shorter?
3. Is reputation needed in phase 1, or start with quorum + plausibility only?
4. Where punctuality shows first: line page, station page, or a dedicated
   "Ketepatan" page?
5. Does a lateness upload also go to the rider's own on-device history (for Napak
   Tilas), and for how long?
6. Station survey moderation: who reviews the queue, and how often?
7. Disruption thresholds: quorum size and window (3 in 15 min?), expiry (30-60
   min?), and the anomaly triggers N (stopped) and M (lateness jump).
8. Do disruptions get a push notification for riders with a saved route through
   the segment? Useful, but a false positive then reaches people who weren't even
   looking. Probably only with quorum *and* corroboration.
