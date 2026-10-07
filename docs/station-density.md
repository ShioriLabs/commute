# Station density (design note)

**Status:** design note — not yet built. Measured inputs gathered 2026-10-07 (see
"Measured inputs" below); they replace the hand-authored curve. The temporal companion to
`station-score.md`: that column says how busy a station is *in general*; this says
how busy it is *right now*. Renders as a crowding badge on the station page and on
the live board (`apps/android/feature/trip/.../PidsBoard.kt`). KCI's C-Access app
shows a crowding badge like this; the data behind ours is our own.

## Why

Riders decide between "leave now" and "wait one" partly on how packed the platform
is. We already rank stations by a static busyness score; what we don't show is the
*time-of-day shape* of that busyness — Manggarai at 08:00 vs. 14:00 is the same
score but a completely different platform. A simple three-level badge ("Lengang /
Padat / Sangat Padat") next to a departure is a cheap, legible way to carry that.

## Prior art — what C-Access does

KCI's C-Access app already shows station crowding, and the *shape* is worth
copying:

- A **three-level** badge — not crowded / crowded / very crowded.
- Shown in two places: on the station itself, and against a specific train in the
  schedule.

What we take: the **three-level badge and where it sits** (on the station, and per
upcoming train). What we do **not** take: their numbers. Theirs almost certainly
come from live fare-gate counts that only KCI holds, served from their own private
backend — not a feed we have or should try to reach. Ours is modelled from data we
already own (below).

## The data problem

We have no live crowding feed and — per `station-score.md` — **no usage telemetry
at all**: no analytics SDK, no ingestion endpoint, recents/favourites never leave
the device. Trip-mode's per-stop GPS and boarding logs are recorded locally and
exported by hand for research (`android-trip-mode.md`); they are not aggregated
server-side and can't be, without building the ingestion pipeline we've
deliberately declined.

So, exactly like station-score, density is honestly an **estimate**, and the UI
must never dress it up as a live measurement. No "live" label, no pretending it's
sensed. A plain badge that reads as a typical-for-this-time hint, not a readout.

## The model — density as modulated station-score

Density is the existing `stations.score` (0–100) bent by *when* you're looking:

```
density(station, t) = score(station)                       # static baseline (0–100)
                     × dayTypeProfile[dayType(t)][bin(t)]   # WD/SAT/SUN × time-of-day curve
                     × headwayFactor(station, line, t)      # fewer trains ⇒ fuller platform
```

- `dayType(t)` and the service-hours windows come from `service-hours-day-types.md`
  (`WD` / `SAT` / `SUN`); `bin(t)` is a coarse slot (e.g. 30-min).
- ~~The time-of-day curve is a hand-authored profile~~ **Superseded:** the curve is
  measured **per operator** from JakLingko hourly taps, and the curves differ too much
  to share one (MRT spikes 7x at 07h, KCI never drops below half its peak, LRT has
  almost no morning peak). See "Measured inputs".
- ~~`headwayFactor` multiplies~~ **Superseded:** crowding is riders *per departure*, so
  the curve is **divided** by departures per hour, not multiplied by a headway factor.
  Multiplying gets the MRT peak wrong; dividing shows 06h is as full as 07h.
- Output is bucketed to three levels by threshold (below), never shown as a number.

Everything on the right-hand side already exists in D1 or the API. No new data
source, no new permission, no backend telemetry.

## Levels & thresholds

| Level | Label (id) | Colour | Rough band |
|---|---|---|---|
| 1 | Lengang | green | low |
| 2 | Padat | amber | mid |
| 3 | Sangat Padat | red | high |

Thresholds are tuned against the 16 **measured** stations in `ridership.ts` so the
busiest-hour buckets land where a rider would expect, then applied uniformly.
Colours follow the existing status palette (green / amber / red), not line colours,
so the badge never collides with a `LineRoundel`.

## Where it renders

- **Station page** — one station-level badge for the current time, near the header
  or the frequency/timetable section (`StationSections.kt` / `FrequencyList.kt`).
- **Live board** (`PidsBoard.kt`) — per upcoming departure row, the predicted level
  at that train's time, matching how C-Access ties crowding to a specific train.
- Web: station page only, same baseline; the live board is android-only today.

## Measured inputs (2026-10-07)

Nothing here has been built. These are the findings the model should be built on, and how far each one can be
trusted. A working chart is published as the "Jakarta Platform Load" artifact.

### Revised model

Consolidated after the press-release and crowdsourced checks (2026-10-07). This supersedes the per-operator
`load(op, h)` sketch, which stays as the network baseline.

```
curve(station, day, h) = roleBlend(station, day)                  # residential / business / interchange / leisure / mixed
                         shifted by rideTime(station → core)      # from our own timetable, never hand-tuned
level(station, day)    = dayLevel(role, day)                      # weekend spectrum; holiday ≠ weekend; FRI ~0.93
riders(station, day, h)= anchorPerDay(station) × level × curve    # anchors from ridership.ts, else score-derived
density(station, day, h)= riders / departures(station, day, h)    # needs real KCI weekend boards
                          clipped to service hours; masked where departures < ¼ of peak
```

- **Roles are per (station, day type).** Bogor is an origin on weekdays and a leisure destination at weekends. Tebet
  is mixed. Interchanges keep destination timing in the morning.
- **Network baseline:** the JakLingko per-operator curve, with KCI's morning reweighted up (real ~35% / 43% /
  51% of the day by 10:00 / 11:00 / 13:00, against JakLingko's 28 / 33 / 42).
- **Evening at origins** is partly exit and forecourt crowding. Discount it against the morning platform crush.
- **Calendar inputs:** public holidays (a late-running curve), Ramadan (deferred, see below),
  recurring local events (Car Free Day Sunday mornings at Sudirman–Thamrin).

Thresholds should be set in **riders per departure** where an anchor exists. It is an absolute
unit that compares across stations and operators (Manggarai at midday, ~317, is still twice
Dukuh Atas BNI at its peak, ~155). `score × load` does not.

Mask any hour with under a quarter of the station's peak departures. Ratios there come from a
handful of trains (KCI 03h comes out at 3.2 from 11 departures and taps made before the
first train).

### Sources

| Source | What it gives | Limits |
|---|---|---|
| JakLingko `jam_sibuk_per_pto` export (2026-10-05) | riders per hour, per operator (MRT, KCI, LRT, TJ) | no time window stated; JakLingko payers only; all days mixed together; network-wide, not per station |
| D1 `schedules` (weekday `dayMask & 0b100`) | rail departures per hour, per station | departures, not capacity (KCI runs 8-, 10- and 12-car sets) |
| TJ GTFS `frequencies.txt` | vehicles per hour | flat 05–22: **no peak timetable**, so useless as a TJ denominator |
| KAI daily ridership PDF, 1 Jan–31 May 2026 | KRL daily totals | the "Jumlah" row is **May's** total, not the grand total. It's KCI's own series: the Basoetta figure for 17 Mar (10,465) matches the release exactly. KRL release totals differ from it by 1–5% (Lebaran +2.4%, Q1 +1.3%, May −4.6%) |
| KCI press releases (below) | systemwide and per-station counts "by 13:00" | one day each, often unusual days |

### How much of each operator JakLingko covers

Relative to published ridership (independent of the unknown window): MRT ≈ 1.0 (close to every
rider), LRT ≈ 1 if "LRT" means LRT Jakarta, TJ ≈ 0.09, **KCI ≈ 0.01**. With counts this large
the random error is negligible. All the error is **bias** in who gets counted.

### Per-operator load (weekday, 1.0 = daily average)

- **MRT:** the most trustworthy curve. The rider swing is 7x but load per train only ~4.5x, because peak
  trains run more often. **06h is as full as 07h** (1.9 vs 1.8): fewer riders, but far fewer
  trains. **19h stays at 1.3** after service is cut from 259 to 164 departures. Mixing in weekends
  slightly understates the weekday peaks.
- **LRT Jakarta:** 56 departures every hour, so load is just the rider curve; 17h (1.9) is the only
  crowded hour. Valid only if "LRT" in the export is LRT Jakarta, not Jabodebek.
- **KCI:** load sits between 0.8 and 1.5 all day. **The JakLingko curve under-weights mornings**; see the
  calibration below.
- **TJ:** use the rider curve alone. The GTFS frequency is flat, so dividing changes nothing, and
  real peak buses would make the true load per bus *flatter* than the 1.8 at 17h.

### KCI calibration against press releases

| Day | Count by 13:00 | Full day | Share before 13:00 |
|---|---|---|---|
| Fri 8 May 2026, WFH Friday, school term | 499,101 (−9% vs a normal workday → ~548k normal) | 1,041,182 (PDF); that week's Mon–Thu ≈ 1.078M | **~48–51%** |
| Fri 12 Jun 2026, protest day + school holiday | 406,139 | June weekday average 1,030,610 | ~39% (outlier) |
| JakLingko KCI curve | | | **41.7%** |
| JakLingko curve shifted 1h earlier | | | 46.0% |

**The same comparison through the morning.** Three KCI releases about WFH Fridays each give a
cutoff with the normal Friday before it as the baseline:

| Cutoff | Normal Friday | Share of a ~1.06–1.08M day | JakLingko KCI | Gap | Source |
|---|---|---|---|---|---|
| 10:00 | 376,186 | **~35%** | 28.3% | ~7 pts | Q1 2026 release |
| 11:00 | 460,184 | **~43%** | 32.9% | ~10 pts | "WFH ASN berlaku" release |
| 13:00 | ~548k (499,101 at −9%) | **~51%** | 41.7% | ~9 pts | 8 May release |

So JakLingko under-represents the morning by 7–10 points, and the gap opens in the **early peak**
before 10:00, which matches KCI's stated 05:00–07:30 peak. A WFH Friday's morning (300,180 by 10:00,
~28.8%) looks like the JakLingko curve, because the riders who would have filled the early peak stayed home.

The 10:00 → 11:00 step (+84k, ~8% of the day in one hour) is larger than any off-peak hour should
be, so the three baselines are probably different Fridays. Read the column as three separate
checks that all point the same way, not as one cumulative curve.

**Dates are not settled.** The Q1 release dates its WFH Friday "Jumat, 10 Maret 2026", which is
a Tuesday. Its full-day 1,041,319 matches the PDF's 8 May (1,041,182) to 0.01%, but 10 April is
also a Friday, and the "WFH ASN berlaku" release says the policy started "hari ini". The
WFH-day counts across the three releases (300,180 by 10:00, 335,268 by 11:00, 499,101 by 13:00)
don't fit one day: 11:00–13:00 would run at more than twice the 10:00–11:00 rate. Check the
publication dates on the kci.id pages before treating any two of them as the same day.

- **The 8 May day is the reference.** It was a school-term day, and the full day was only 3% below its
  week. The protest day combined a holiday and a protest, and both cut morning travel. Reading the
  protest day alone briefly suggested the opposite conclusion (an evening too light). Don't
  repeat that.
- KCI's stated peak windows disagree from release to release:

  | Release | Morning | Evening |
  |---|---|---|
  | January 2026 monthly | **06:00–09:00** | **16:00–19:00** |
  | Ramadan 2026 (describing the normal pre-Ramadan pattern) | **06:00–08:00** | — |
  | June 2026 school holiday | 05:00–07:30 | 15:00–18:00 |

  Two of the three match the JakLingko curve's timing (peaks at 07h and 17h, 16–19h all ≥ 71% of
  peak). The June one is the odd one out. The JakLingko
  curve sits later than that. The likely cause is that the ~1% of KCI riders who pay through
  JakLingko are inner-city riders who board later than those starting from the outer suburbs.
- **The fix is more weight on the morning, not a time shift.** A 1h shift only reaches 46%, and
  KCI's own pre-Ramadan description (06:00–08:00) says the timing is already right. What's off is how
  much of the day the morning carries.
- A commuter railway should land near 50% before midday anyway: one trip in each morning and one
  out each evening.
- The KCI release of 8 May writes "436.520" next to the 499,101. It's garbled; news copies
  (Kompas, Bisnis) carry only 499,101.

### Station roles: directional split

The network curve hides the biggest station-level effect. **Business-district stations take in
riders in the morning and send them out in the evening.** At those stations the platform crowd that
matters is the *evening boarding* crowd, the people waiting. Morning alighting riders leave the
platform.

Normal-Friday figures. The 11:00 column is stated outright in the release. The others are reconstructed
by undoing the stated WFH drop.

| Station | Role | by 10:00 | by 11:00 | by 13:00 |
|---|---|---|---|---|
| Bogor | origin (boarding) | ~24.7k* | **27,659** | ~30k |
| Bekasi | origin | ~23.1k | **24,835** | ~24.2k |
| Sudimara | origin | ~13.3k | **14,390** | ~12.8k |
| Tangerang / Bekasi Timur | origin | — | — | ~12k / ~5.3k |
| Gondangdia | destination (alighting) | — | **19,504** | ~19k |
| Juanda | destination | — | **15,621** | ~15.2k |
| Palmerah | destination (DPR) | — | ~18.4k (13,060 at −29%) | — |
| Sudirman | destination | — | — | ~33.7k |
| Tebet | destination | — | — | ~19.4k |
| Sudirman Baru | destination | 8,662 by **12:00** (day 2 after Karet closed): **80–88%** of the day's alighting | | |

\* The Q1 release prints Bogor as **7,484** by 10:00 (−29.3%), which reconstructs to 10.6k, impossible
against 27.7k by 11:00. **17,484** reconstructs to 24.7k and fits, so it's a dropped digit.

- **Outer origins start earlier than the network.** Bekasi's normal 05:00–06:00 hour is ~3.3–4.9k
  boardings (back-calculated from the Ramadan release: 5,000–8,000 at +50–64%). That's ~13–20% of its
  boarding before 11:00, against 9.5% for the JakLingko network curve's 05h. This is the first
  station-level figure for a single hour that we have. It's rough, because the release pairs ranges with ranges.
- **At residential origins the morning is over by 10:00.** Bekasi reaches ~93% of its pre-13:00 boarding by
  10:00, and Bogor ~82–89%. Boarding at origins barely moves after 10:00. (The 76–81% this doc first gave
  came from the WFH day itself, which runs later. The normal-day figures above replace it.)
- **Destinations are nearly done by 11:00.** Gondangdia and Juanda by 11:00 are within ~3% of the
  13:00 reconstruction.
- **Business-district stations are strongly one-way; residential ones less so over the whole day.**
  Bogor's ~30k by 13:00 is ~55% of its weekday boarding: it's also a leisure destination, so its
  afternoon boarding is real traffic, not just commuters going home.
- **The releases agree on station figures to within ~5–10%** (Sudimara is the worst, ~12% spread),
  better than the systemwide figures. Use them for station-role curves. They're one Friday each, so
  they still aren't ridership anchors.
- **KCI lists Tebet as an office-district arrival station.** We had assumed it was residential. Assign
  station roles from data like this, never from a sense of the neighbourhood.
- The protest-day station counts (Sudirman 45,204, Juanda 21,598, Palmerah 23,994, Tanah Abang
  27,310) are inflated against the normal-day figures: Juanda +38%, Palmerah ~+30% against its
  normal ~18.4k by 11:00. Palmerah is the DPR station. **Don't use them as anchors.**

This means the model needs a boarding curve and an alighting curve, picked by station role
(residential / business district / interchange / mixed), and not one curve for every station.
Interchanges like Manggarai stay closest to the network curve.

### Day types

- KRL medians, Jan–May 2026: weekday ~1.08M, **Saturday 0.80**, **Sunday 0.70**. June 2026 gave
  weekend/holiday days at 0.71 of a weekday, which agrees.
- Q1 2026: 86,865,947 riders (+5.7% on Q1 2025's 82,114,334), "hampir 1,1 juta" on an average
  weekday. The PDF's Q1 daily rows sum to 87,979,372, 1.3% higher, so the release and the PDF
  differ slightly in what they count, as they did for May (−4.6%).
- **Fridays** have run 5–9% low since government staff began working from home every Friday (May
  2026). This is a candidate FRI day type.
- **Public holidays** sit at Sunday level or below (Lebaran Fri 20 Mar 2026: 421k).
- **Holidays also change the shape, not just the level.** KCI: "pada masa libur, pergerakan penumpang
  cenderung lebih merata sepanjang hari", meaning trips spread across the day and are mostly not commutes. After
  people return to work, volume concentrates in the morning and evening peaks again. So SUN/holiday
  needs a **flatter curve**, not the weekday curve scaled to 0.70.
- Angleb (Lebaran period) 2026, 11–25 Mar: 13,306,263 riders on KRL (887,084/day; PDF 907,978/day). The busiest
  day was Sun 22 Mar (899,640; PDF 927,319). Station totals for the period: Bogor 756,219,
  Sudirman 403,781, Cikarang 337,049, Cawang 277,456, Rangkasbitung 236,634. The release doesn't
  say which measure those are (boarding or in+out), so they're **not usable as anchors**.
- **Holiday days run late, not flat.** Two Lebaran-period releases both put only about a quarter of the
  day's KRL boardings before 13:00:

  | Day | by 13:00 | Full day (PDF) | Share |
  |---|---|---|---|
  | Mon 23 Mar 2026 (cuti bersama) | 236,923 | 923,617 | **25.7%** |
  | Wed 25 Mar 2026 (first workday back) | 279,114 | 1,021,776 | **27.3%** |
  | On the same 23 Mar: KA Bandara / Merak | 2,737 / 8,736 | 7,039 / 17,439 | 38.9% / 50.1% |

  An earlier pass rejected the 25 Mar figure as "below even a flat curve". The 23 Mar release
  confirms it instead. On holidays the KRL day runs into the afternoon and evening (visiting family,
  outings, the trip home at night). KCI's "lebih merata" describes the lack of sharp peaks, not an
  even spread of riders across the day. On 25 Mar, commuter stations had recovered further (Bogor and
  Sudirman ~68% of a normal morning) than the system as a whole (~51%), because commuters come back
  before leisure riders do. The SUN/holiday curve should push most of its weight past midday.
- **Day type depends on station role.** Manggarai set a **transit record of 201,617 on Sun 22 Mar**
  (Lebaran), above its 166,587 weekday average (2024). On 23 Mar by 13:00 the busiest stations
  were the leisure ones: Bogor 32,080, Jakarta Kota 13,226, Cikarang 12,518 (KA Lokal home trips),
  against Sudirman 11,056, Tanah Abang 8,129, Cawang 6,483 and Manggarai gates 841 (Manggarai is almost
  all transfers). The release doesn't say which measure the station numbers use. A single 0.70 holiday factor
  is wrong for interchanges and leisure stations, which get *busier*.
- **A station's role flips by day type.** Sun 4 Jan 2026 (the last day of the Christmas–New Year holiday, PDF full day 850,882 ≈ 0.79 of
  a weekday), counts by 14:00: **Bogor 18,158 alighting**, Jakarta Kota 16,964 alighting. On weekdays Bogor is the network's
  biggest *origin*; on weekends and holidays it is a *destination* (leisure), like Jakarta Kota. Shopping
  stations stay busy: Tanah Abang 20,504. Office stations drop to **~41% of a weekday morning**:
  Sudirman 13,758 (vs ~33.7k), Tebet 7,896 (vs ~19.4k), a much bigger drop than the system's 0.79.
  The return-trip flow shows up at stations where people change from regional trains: Cikarang 11,111 boarding (from Walahar),
  Rangkasbitung 6,697 (from Merak), Bandara Soetta 1,062. So station role has to be set per **(station,
  day type)**, not per station. Source: KCI, "Volume Pengguna Stasiun Bogor dan Jakarta Kota Melonjak di
  Penghujung Libur Nataru" (4 Jan 2026).
- **KCI runs fewer trips at weekends; D1 doesn't show it.** That Sunday ran 1,030 Jabodetabek trips
  (vs 1,065 on weekdays) and 64 Basoetta (vs 70). Every KCI row in D1 has `dayMask = 7`, so there are no weekend
  boards, and weekend KCI departures are overstated by ~3% (Basoetta ~9%). This inflates
  weekend load by the same amount. The `station-score.md` figure of 64 for Basoetta is the weekend/older count.
- Nataru 2025/26 (18 Dec – 3 Jan): 16,577,134 KRL riders, 16,954,833 across all services (+6%).
- **31 Dec 2025 (Wed) was a workday, not a holiday.** It was the busiest day of the Nataru period, 1,155,484
  across all services, *above* a normal weekday. Per KCI, daily commuters dominated until midday. By 14:00, alighting was
  Tanah Abang 25,976, Sudirman 22,868 (~68% of a normal weekday morning, with many people on leave between the holidays),
  Jakarta Kota 14,339, and Juanda 13,846 (~89% of normal; government offices still open). The extra volume came
  in the evening: KCI ran extra trips until 01:30 for the New Year's Eve crowds. Treat it as a **weekday plus
  an event evening**, not a holiday. It's the same pattern as any big-event night. Source: KCI, "Update
  Operasional Commuter Line Masa Nataru" (31 Dec 2025).
- **Not usable:** that release's "885.266 orang yang telah dilayani hingga pukul 14.00". As boardings it
  would be 77% of the day by 14:00, which is impossible before an evening surge. "Dilayani" (served) is probably a
  different measure (gate movements in+out?) from "naik" (boarded), which the calibration figures use.
  **Only use cutoffs worded as "naik".**
- The releases' Lebaran running totals don't fit together: 11–22 Mar is 11,589,375 in one release
  (PDF 10,810,153, +7.2%) and 11–25 Mar is 13,306,263 in the next (PDF 13,619,679, −2.3%). Use the PDF
  for daily levels.
- The day-type ratios above are KCI-only. MRT, LRT and TJ have no published equivalents yet.

### Ramadan (separate day type, deferred)

Ramadan is its own day type. **Never mix Ramadan figures into the WD/SAT/SUN calibration.** The daily
total barely moves, but the shape of the day does, so scaling the weekday curve gets it wrong for
a month every year. It's deferred because switching it on needs a Hijri date table: Ramadan moves
~11 days earlier each year (2026 ≈ 18 Feb – 19 Mar). That's the same kind of calendar input as
public holidays.

Source: KCI, "KAI Commuter Catat Pergeseran Pengguna di Jam Sibuk Selama Ramadhan Ini" (Ramadan
2026, exact date not stated),
<https://www.kci.id/informasi-publik/berita/kai-commuter-catat-pergeseran-pengguna-di-jam-sibuk-selama-ramadhan-ini-peak-hours-pagi-paling-terlihat-perubahan-volume-penggunanya>.
kci.id returns 403 to non-browser clients, so the text was read in a browser.

| | Normal (per the same release) | Ramadan |
|---|---|---|
| Morning | rises from 06:00, busiest 06:00–08:00 | rises from **05:00**, peaks **06:00–07:00** |
| Evening | — | 15:00–18:00, then a **second rise from 19:00** after iftar |
| Daily total | ~1.08M weekday (PDF) | "relatif stabil", 1M+ |
| Trips | 1,065 | 1,065 (unchanged) |

- **Morning: earlier and sharper.** People leave about an hour earlier (for sahur, and shorter working days). The outer
  origins move most: **Rangkasbitung +28% from 04:00** (1,500–1,600 people) and **Bekasi
  +50–64% at 05:00–06:00** (5,000–8,000). So the Ramadan shift also depends on station role.
- **Evening: two parts.** An early rush before iftar (15:00–18:00), an implied dip around
  iftar itself (~18:00–19:00), and a second rise after it. Riders may break their fast on the train
  with drinks and light snacks (KCI's Ramadan rule), so a train running at iftar is emptier, not closed.
- **Data that overlaps Ramadan:**
  - the PDF's 18 Feb – 19 Mar weekdays (levels look normal: Feb/Mar weekday medians 1.117M/1.110M)
  - the Q1 release's WFH Friday, *if* its "10 Maret" really means March
  - the JakLingko export, if its window turns out to reach back to Feb–Mar

  Check each before using it for the regular curve.
- **Still missing:** any Ramadan figure "by hour X", especially an afternoon cutoff (15:00 or 16:00),
  to put numbers on the early evening rush. Collect these from Ramadan releases, always with the date.

### Crowdsourced checks (words only, never data)

**Sudirman (KCI), checked 2026-10-07.** The place listing covers the integrated Dukuh Atas area
(its review tags mention TransJakarta, MRT and the airport rail link), not just the KCI platforms.

- **Wednesday:** two peaks. The **evening one is clearly the bigger**, busiest around 17:00–19:00 and
  still busy until ~21:00–22:00. The morning peak is smaller and sits at **08:00–09:00**, with a clear
  midday dip around 12:00–13:00.
  - *Agrees with:* the commuter mirror and the reason for the badge. At a business-district station the
    crowd that stays on the platform is the evening boarding crowd. Morning alighting riders leave quickly, and a
    curve weighted by how long people stay shows exactly that.
  - *New:* the morning peak at a **destination** is ~1–2h **later** than the network's 06:00–08:00 boarding
    peak, because that's when riders who boarded at the origins arrive. Our station-level load copies the
    network curve's timing (Sudirman's modelled morning peaks at 06–07h). **Role curves need a time
    offset:** destinations run later than origins by roughly the ride time.
- **Saturday:** almost nothing in the morning, a gradual rise to a broad **late afternoon and evening
  plateau (~16:00–21:00)**, well below the weekday evening peak. It agrees that weekends run late, and that
  the business-district drop is far bigger than the system's.
- **Sunday:** a distinct **morning bump around 07:00–09:00**, then a flat moderate level until ~21:00.
  The bump is almost certainly **Car Free Day** (Jl. Sudirman–Thamrin, every Sunday morning). No
  network curve or day-type factor will produce it. It's a **recurring local event**, so it needs a
  per-station, per-weekday override, the same kind of input as public holidays.

**Bogor and Bekasi (KCI origins), checked 2026-10-07.**

- **Wednesday, both stations:** a morning peak at **06:00–07:00**, a midday dip, and a bigger evening peak
  at **19:00–20:00** that stays high until ~22:00. Bekasi's morning is a little stronger relative to its
  evening than Bogor's.
- **The time offset between home and work stations holds in both directions.** Compared with Sudirman:

  | | Morning | Evening |
  |---|---|---|
  | Origins (Bogor, Bekasi) | 06:00–07:00 | 19:00–20:00 |
  | Destination (Sudirman) | 08:00–09:00 | 17:00–19:00 |

  The gap is ~1–2h, about the ride time. So role curves are shifted copies of each other, offset by the ride
  time. A single network curve smears the gap out.
- **The evening is the bigger peak at origins too,** in a curve weighted by how long people stay. Part of that is
  real: arrivals pour onto platforms and exits, which is why Bogor's new west access was built
  "untuk mengurai kepadatan flow pengguna … pagi maupun sore". Part of it is the place outline taking in
  the forecourt, where returning riders wait for angkot or ride-hailing pick-ups. Treat the evening at origins as
  crowding at the exits, not on the platform, and don't rate it as high as the morning platform crush.
- **The weekend role differs between the two origins:**
  - **Bogor becomes a destination.** There's no morning peak. It builds from ~07:00 to a broad
    afternoon and evening peak (~15:00–21:00), the same on Saturday and Sunday. That's leisure visitors arriving and
    leaving.
  - **Bekasi stays an origin.** It still has a morning bump (~08:00–09:00) before the evening peak (~18:00–21:00).
    Residents go out in the morning and come back at night. Saturday and Sunday are about the same.

  This confirms role per **(station, day type)**: two origins that look alike on a weekday split apart at
  weekends.
- **How busy the weekend is compared with a weekday** (each place uses one scale for every day of the week, so
  these compare within a station):

  | Station | Role | Weekend peak vs weekday peak |
  |---|---|---|
  | Sudirman | business district | **~40%** |
  | Bekasi | commuter origin | ~70% |
  | Bogor | origin that becomes a leisure destination | ~75–80% |

  Sudirman's ~40% agrees with KCI's own count for a holiday Sunday (~41% of a weekday morning, 4 Jan 2026). That's two
  independent sources agreeing. It also means a single 0.70–0.80 weekend factor is fine for origins and
  roughly **2x too high for business-district stations**.

**Manggarai, Tebet, Jakarta Kota, Kranji, checked 2026-10-07.** Summary of all seven:

| Station | Role (as observed) | Weekday morning peak | Weekday evening peak | Evening vs morning | Weekend peak vs weekday |
|---|---|---|---|---|---|
| Sudirman | business district | 08–09 | 17–19 | evening clearly bigger | ~40% |
| Tebet | **mixed** (arrivals + residential + TJ transfer) | 08–09 | ~19 | about equal | ~55–60% |
| Manggarai | interchange | 08–09 | 18–19 | evening bigger | ~55–60% |
| Jakarta Kota | terminus, leisure, nightlife | ~08 | 18–19, long tail past midnight | evening bigger | ~55–65%, weekend peak **22–23** |
| Kranji | near origin (Bekasi Barat) | ~07, small | 18–19 | evening ~2.5x | ~45–50% |
| Bekasi | far origin | ~07 | 19–20 | evening bigger | ~70% |
| Bogor | far origin, leisure destination at weekends | 06–07 | 19–20 | evening bigger | ~75–80% |

- **Tebet: KCI's "arrival station" holds for the morning.** It peaks at 08–09, destination timing, but
  unlike Sudirman its evening is as big as its morning. It's genuinely **mixed**: office arrivals,
  residents and a TransJakarta transfer. A single role label would be wrong in one half of the day.
- **The interchange keeps destination timing in the morning.** Manggarai peaks at 08–09 like Sudirman, because the
  transfer comes late in the journey. Its evening (18–19) sits between Sudirman's and the far origins'. Its
  weekend sits mid-range (~55–60%). Ordinary weekends are lower than weekdays, yet Lebaran Sunday set Manggarai's transfer
  record (201,617), so **a holiday is not a weekend**, again.
- **The offset grows with distance.** Kranji (close to Jakarta) has its evening peak at 18–19, while Bogor and Bekasi (far) peak
  at 19–20. Mornings run the other way. **The offset can come from our own timetable:** scheduled ride time
  from the station to the core (Manggarai / Sudirman), so it never needs hand tuning per station.
- **Clip anything outside service hours.** Jakarta Kota stays busy until 01:00–02:00, and on weekends it peaks at
  22–23, after or at the edge of the last trains. That's the Kota Tua and Glodok nightlife inside the place outline, not rail.
  Kranji's 2.5x evening is probably also mostly forecourt (vendors, angkot hub). The density curve must be
  cut to the station's service hours, and evening bulges at origins discounted as exit and forecourt crowding.
- **Weekend levels form a spectrum by role**, not one factor: business district ~40% < near commuter origin
  ~45–50% < interchange / mixed / terminus ~55–65% < far origin and leisure ~70–80%.


### Verified along the way

- D1 has 376 weekday line-B trips against KCI's stated 392 (96%). Manggarai's 598 weekday departures
  (~30–39/h) is real, not an undercount.
- D1 has **1,393** weekday KCI trip numbers against KCI's stated **1,065** trips. The excess is on C
  (260 of 621 trips have 3 stops or fewer) and TP (32 of 64), which matches the known KCI chain
  gaps. Departures per station, which is what this model uses, are unaffected. Anything that counts
  *trains* is affected.
- **Jan 2026 KRL total: 30,226,365, an exact match** with the PDF's January rows. April matched exactly too.
  So monthly figures in releases are the same series as the PDF. Only the running Lebaran totals drifted.
- **Jatake** (opened ~29 Jan 2026): KCI says 192 of 206 line-R trips stop there; D1 has **192**
  at KCI-JTK and 208 line-R trips. First week to 5 Feb: 7,936 boarding + 8,206 alighting (~1k each
  way per day). It's a new station whose ridership was still building, so it's not an anchor yet.
- **Trips per day by service** (Jan 2026): 1,065 Jabodetabek, **70 Basoetta** (matches the seed's
  35 per direction; the 64 in `station-score.md` predates the current seed), 14 Merak.
- **Stated average headways:** Bogor line 5 min, Bekasi 7–9, Rangkasbitung 10–15, Tangerang 18.
  D1's daily trip counts land close on R and T (~19 min on T over a ~20h day); B's 5 min is a
  peak figure, against ~6.4 min averaged across the day.
- Train length per departure is unknown: only 10 Bogor-line sets are 12-car (5 CLI-125 and 5 CLI-225).

### Confidence (load index)

| PTO | Rider curve | Departures | Overall | Plausible error |
|---|---|---|---|---|
| MRT | good | exact | **high** | ±10–15% |
| LRT Jakarta | good* | exact | **medium-high** | ±15–20% (*if the export's "LRT" is LRTJ) |
| KCI | biased, calibrated | verified | **medium** | ±20–25% after reweighting the morning |
| TJ | moderate | none | **low** | peaks probably overstated |

Station-level figures add roughly ±20–30% on top until station roles are modelled.

### Next data to look for

- **Evening figures are rare,** because KCI publishes releases around midday, so the cutoffs are 10:00–14:00.
  Ways to get at the evening without one:
  - **Full day minus the cutoff.** Every dated "naik" cutoff, together with the PDF's full day, gives the share after
    the cutoff for free: ~49% after 13:00 on a normal weekday, ~73–74% on the Lebaran days.
  - **The commuter mirror.** At business-district stations the evening *boarding* is roughly the daily boarding
    minus a small morning part (Sudirman Baru boards 13,450/day while 80–88% of its alighting is
    before noon). At origins, evening *alighting* is the return trip (Bogor gate out, 9.08M in H1
    2026). Daily in/out totals plus the morning figures already give a rough evening volume per station.
  - **MRT's evening shape as a proxy** for KCI office-district boarding. JakLingko covers nearly every MRT rider, so
    its evening is trustworthy. It's a proxy, though, and should be labelled one.
  - Event-night releases (concerts at JIS or GBK, football, Jakarta Fair, New Year's Eve) do report late counts,
    but for event nights only.
  - C-Access spot checks and trip-mode logs taken **in the evening**, where the platform crowd that matters is.
  - **Crowdsourced data: for checking only, never a data source.** Hourly busyness curves per place, by day of
    week, evenings included. They're useful to sanity-check our shapes for about five stations, one per role:
    Sudirman (business district), Bogor (origin), Manggarai (interchange), Tebet (KCI calls it an arrival station),
    Jakarta Kota (leisure). Take weekday, Saturday and Sunday views, dated. Record the comparison in
    words (peak hour matches or not, evening shape, does Bogor flip to a destination at weekends). **Never
    digitize the curves into data files, and never ship anything derived from them.** Like C-Access, we
    take ideas from it, not its numbers. It also measures something else: people *present* at a place,
    weighted by how long they stay, sometimes including the forecourt or an attached mall. That isn't
    boardings or platform waiting.
- **Open: C-Access showed Cakung (KCI-CUK) as "Padat" at 14:00 on Wed 7 Oct 2026.** Our data
  can't explain it: Cakung's weekday service is flat (16–19 departures every hour 05–21, no
  midday thinning), and a regular rider going home through it at ~15:00 sees nothing unusual there.
  (KBN Cakung is in Cilincing, not by the station, so it's not shift work.) Re-check C-Access for
  Cakung around 14:00 on other weekdays, and compare a neighbour on the same line (Klender, Buaran)
  at the same moment:
  - **Repeats, neighbours calm:** a C-Access oddity (per-station thresholds, or a train-load reading).
  - **One day only:** a live spike, e.g. trains bunched after a disruption.

  Either way it's evidence about what C-Access measures, not a reason to change our curve.
- KCI Annual Report 2025 (550 pp.) has **no hourly data**. Its one scale figure is **dynamic occupancy of
  42.82%** for 2025 (41.24% in 2024): passenger-km ÷ seat-km over the whole year and every service. It can put an
  absolute number on load index 1.0, but it's averaged over whole lines, so the busiest sections
  run far above it.
- A KCI "by hour X" count for an ordinary day at a **residential** station, to firm up that end
  of the station-role scale.
- The re-exported JakLingko file, to fix the time window and check that the shapes hold.
- Any figure split by hour, which would settle the shape *inside* each peak.

## Open / deferred

1. **Where the curve lives.** Ship it as app/backend data first (like the authored
   `ridership.ts`). A dedicated density endpoint is only worth it once the shape
   stabilises; until then it's a pure client/edge computation off score + headway.
2. **Per-line vs. per-station.** C-Access reports it per-station. Per-line density
   on an interchange (Manggarai KC vs. local) is richer but needs per-line splits we
   don't model yet — keep it per-station for v1.
3. **If we ever ingest telemetry.** A real crowd signal would need the ingestion
   pipeline station-score calls out as absent. That's a privacy decision, not a
   feature decision — gate it there, not here.
4. **Don't over-promise.** Keep copy in the "typically" register. The failure mode
   to avoid is a rider trusting a green badge onto a packed platform; an estimate
   that's honestly labelled survives being wrong, a fake "live" one doesn't.
