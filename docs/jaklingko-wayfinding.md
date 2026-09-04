# Jak Lingko wayfinding standard

**Status:** reference note. Source: *Buku Panduan Ikonografi dan Wayfinding Transportasi
Jakarta*, Versi 2021 (ITDP Indonesia + Forum Diskusi Transportasi Jakarta, published for
Pemprov DKI Jakarta). Companion to `transit-hubs.md` and `fdtj-map-points.md`.

## Why this is here

This app imitates a visual grammar it never wrote down. The roundels, the mode icons, the
station codes — they all follow rules, and those rules turn out to be *published* ones:
the same FDTJ whose schematic we trace in `fdtj-map-points.md` co-authored the official
DKI Jakarta wayfinding standard. Several of our conventions match it exactly, arrived at
by copying the signs rather than reading the book.

That is fragile. A rule nobody recorded is a rule that looks arbitrary to the next person
touching the component, and gets "simplified" away. This note records the durable parts
so new UI has something to conform to, and so existing agreement survives refactors.

## Scope: rules, not values

**Deliberately excluded: every line-specific colour and code table.** The book lists KRL
lines as B/C/L/R/T and TJ as Koridor 1–13. KAI has since renamed the Commuter Line
services away from those letters, and TJ runs far more corridors than thirteen.
Reproducing the tables would plant a second, wrong source of truth beside the `lines`
table that already carries `colorCode` — the one place a line colour should come from.

The *grammar* — how a roundel is constructed, how an arrow relates to its label — ages
well. The values do not. Only the grammar is recorded below.

Also out of scope: physical sign geometry (totem heights, kerb setbacks, braille plate
dimensions), which occupies most of Bagian 5 and has no digital analogue.

## Roundel grammar (p28–30)

The standard splits service badges into **two families**, and the split is the whole
point — it lets a rider tell a bus route from a rail line before reading either.

| | Face | Content | Ring |
|---|---|---|---|
| **Bus / BRT** | filled, route colour | route number | none |
| **Rail** (MRT, LRT, KRL, KA Bandara) | white | letter code | coloured, route colour |

Two stacked forms extend it:

- **Station code** — line letter over sequence number. `M` over `15` is the 15th station
  on the MRT line, rendered as one roundel, not two.
- **BRT halte code** — corridor number over stop number. `9` over `15` reads as stop 15
  on Koridor 9. Same stacked shape, different meaning per family, consistent with the
  face rule above.

The airport **Kalayang** is signed with an aircraft glyph in place of a letter — it is a
single line, so a code would be noise.

Implemented in `apps/web/app/components/line-roundel.tsx`, which follows all of this.

## Arrows and labels (p18)

The book gives an explicit alignment rule and prints four struck-through counter-examples
for it, which is a strong hint about how easily it gets lost:

| Arrow position | Label alignment | Verdict |
|---|---|---|
| Leading (left) | left-aligned, follows the arrow | correct |
| Trailing (right) | right-aligned, precedes the arrow | correct |
| Leading, label right-aligned | — | wrong |
| Trailing, label left-aligned | — | wrong |

The arrow and its text belong to the same edge of the sign. Mixing them makes the reader
scan across dead space to bind the direction to the destination.

Diagonal arrows are first-class (the eight-point set is "Panah Utama"); U-turn and
hook-back arrows are "Panah Tambahan", to be used *only* where genuinely needed.

## Information hierarchy (p7, p60)

Four rules worth carrying into UI:

1. **Layer by proximity.** More detail the closer the reader gets. Give enough
   information, do not flood with the unnecessary — the book's phrasing is explicit that
   over-filling a sign is a failure mode, not thoroughness.
2. **Say where the reader is before saying where to go.** Every totem opens with a
   location identifier ("Anda berada di | You are in — Stasiun Tanah Abang") before any
   directional content.
3. **Distance and walking time, together.** Directional content pairs a destination with
   *both* — "5 km | 5 min", "↥ 30m". Distance alone leaves the reader doing arithmetic
   they lack the inputs for.
4. **Locality maps are 500 m radius and reader-oriented** — rotated to the reader's
   facing direction, not north-up.

## Bilingual labelling

Every pictogram in the book is captioned twice: Indonesian in bold, English beneath in
light. This is the standard's answer to the tourist audience it names in its own
introduction. Recorded because our UI is Indonesian-only, so this is a known,
deliberate divergence rather than an oversight.

## Colour roles (p17)

Not line colours — semantic roles, which *are* durable:

- `#0C1B2A` — base for MRT/BRT/LRT signage and pedestrian totems (the near-black
  everything else sits on).
- `#00629F` — bus stop signage.
- `#006D3A` — cycling facilities.
- `#F9D437` — **exit**. Yellow means "way out" and nothing else.

Safety signage defers to ISO 7010: red = prohibition/emergency, green = safety/escape,
blue = mandatory, yellow = hazard. We render none of these today; noted so that a future
disruption or emergency surface picks the standard's colour rather than inventing one.

## Typeface (p16)

PT Sans, chosen as a public-space typeface with distinct letterforms and better legibility
for readers with visual impairments. PT Sans Narrow is explicitly permitted where space is
tight (restated on p83 for door signs).

**We adopt this for roundels only.** The reasoning is the same as everywhere else in this
note — take the rule where we are reproducing the artifact, take only the reasoning where
we are not:

- **Roundels are the artifact.** They are meant to read as the badge bolted to the wall, so
  they are set in PT Sans Bold, and in PT Sans Narrow for the stacked/multi-character case
  the standard sanctions Narrow for.
- **Everything else stays on Plus Jakarta Sans**, which is not an arbitrary choice losing to
  a standard: it is Tokotype's typeface for the **+Jakarta** city brand — the identity
  printed alongside Jak Lingko on nearly every page of this book, specified on p15. The app
  already runs on an official Jakarta typeface. Swapping body text to PT Sans would trade
  one half of the city's identity system for the other, and PT Sans's stated rationale is
  legibility on *signage* — distance viewing, glancing reads — which does not transfer to a
  phone held at 30 cm.

There is also a practical reason not to spread it: "station names" is an unworkable boundary
for a two-font system, since the same name appears in headings, buttons, search results and
mid-sentence. The roundel is a bounded, self-contained badge, which is what makes it a safe
place to switch faces.

Implementation: `--font-roundel` / `--font-roundel-narrow` in `apps/web/app/app.css`,
self-hosted and subset to `[0-9A-Za-z]` (~24 KB and ~28 KB), applied by
`line-roundel.tsx` and `line-strip/station-row.tsx`.

## Pictogram vocabulary

The book's value here is the **names**, not the artwork. When adding a facility, mode, or
POI type, take the standard's noun instead of coining one — the rider has already seen it
on a sign.

**Modes (p19).** Pejalan Kaki, Sepeda, Bus, MRT, LRT, Kereta Komuter, Angkutan Kota,
KA Bandara, Kalayang, Kereta Jarak Jauh, Kereta Cepat, Angkutan Perairan, Bandar Udara,
Bajaj, Ojek Daring, Ojek/Sepeda Motor, Taksi, Mobil Pribadi, Becak, Sepeda Sewa,
Skuter/Otopet.

**Station and halte facilities (p20–22).** Parkir Mobil, Parkir Motor, Parkir Sepeda,
Park and Ride, Penurunan/Pengantaran, Isi Daya Kendaraan Listrik, Pintu Masuk, Pintu
Keluar, Toilet, Toilet Pria, Toilet Wanita, Kamar Bayi, Fasilitas Disabilitas, Lift,
Tangga, Eskalator, Eskalator Naik, Eskalator Turun, Travelator, Travelator Naik,
Travelator Turun, CCTV, Ruang Petugas, Pos Kesehatan, Tiket, Loket Tiket, Gerbang Tiket,
Mesin Tiket, Informasi, Konter Informasi, Musala, Kantin dan Restoran, Area Komersial,
Minimarket, Telepon, ATM, Barang Hilang, Loker Bagasi, Ruang Tunggu, Isi Daya, Ruang
Kerja Bersama, Kereta Dorong Bayi, Tempat Cuci Tangan, Penyanitasi Tangan, Sepeda Lipat,
Tempat Sampah, Titik Pertemuan, Pemeriksaan Barang, Troli, Kontrol Stasiun, Pembersih.

Note the **Eskalator / Eskalator Naik / Eskalator Turun** triple: the up and down glyphs
mean *direction of travel*. They are not free to repurpose (see finding 1).

**Universal access (p22).** Lansia, Penumpang Disabilitas, Ibu Hamil, Penumpang Dengan
Anak, Tuna Netra, Kendala Fisik, Tuna Rungu, Kereta Bayi.

**POI categories (p23–24).** Pasar, Masjid, Gereja, Pura, Klenteng, Vihara, Monumen,
Museum, Kantor Polisi, Pemadam Kebakaran, Rumah Sakit, Sarana Olahraga, Penginapan,
Pusat Perbelanjaan, Kantor Pemerintahan, Sekolah/Universitas, Apartemen/Perkantoran,
Perumahan, SPBU, Pusat Wisata, Perpustakaan, Taman/RPTRA, Restoran, Kafe, Kantor Pos,
Kedutaan Besar, Teater, Galeri Seni, Pantai, Bank.

Beyond the categories, the book draws **individual landmark glyphs** (p25–26) for named
places — Monas, Istiqlal, Kota Tua, TMII, Ragunan, GBK, Blok M, Ancol, Sunda Kelapa. A
sufficiently famous landmark gets its own mark rather than a category icon.

## POI curation criteria (p60)

The test for what earns POI status at all, in the book's own two tiers:

**POI Utama (primary)** — a public attraction with high visitation; the nearest transit
or bike-share access point; a distinctly local place; internationally recognised.

**POI Sekunder (secondary)** — memorable and easy to identify along a walking route;
heritage or architecturally unusual; a place that *defines* an area; an important or
well-known building; located at a major junction.

The second tier is the interesting one: it selects for **navigational** value rather than
importance. A weird building on a corner is a better wayfinding POI than a significant one
set back from the street. See `points-of-interest.md`, which adopts these.

---

# Audit: where the app stands

Findings against the rules above, most actionable first.

### 1. Escalator amenity icons contradict the standard's meaning

`apps/web/app/components/station-content.tsx` maps `ESCALATOR_UNPAID` → `EscalatorUpIcon`
and `ESCALATOR_PAID` → `EscalatorDownIcon`. In the standard those glyphs mean *direction
of travel* (Eskalator Naik / Eskalator Turun, p20), so a rider reads "escalator going
down" where we meant "escalator inside the fare gates".

The neighbouring lifts do not do this — `ELEVATOR_UNPAID` and `ELEVATOR_PAID` share one
`ElevatorIcon` — so the codebase was already inconsistent with itself.

**Resolved:** both escalator types now share a single glyph, matching the lift pair. The
paid/unpaid distinction lives in the label, where it was already stated. Phosphor ships no
neutral escalator — only up and down — so one is used for both rather than leaving the
pair to carry a direction it doesn't mean.

### 2. `AMENITY_TYPES` is a 13-item ad-hoc subset

`apps/constants/src/index.ts`. The standard names roughly fifty station facilities; we
carry thirteen. Plausibly-real gaps for Jabodetabek stations: ticket gate, ticket machine,
ticket counter, first-aid post, waiting lounge, meeting point, canteen/commercial area,
convenience store, ATM, lost-and-found, luggage lockers (distinct from our generic
`LOCKERS`), trolley.

**Not a bulk-add.** Each new amenity needs data behind it, and inventing enum members with
nothing to populate them is worse than the gap. The point of recording the vocabulary is
that the *next* amenity added takes the standard's noun. Our labels are also
Indonesian-only against the standard's ID/EN pairs — a known divergence, not an oversight.

### 3. Roundel grammar already conforms

`apps/web/app/components/line-roundel.tsx` implements the p28–30 two-family split exactly:
filled face for TJ, white face with a coloured ring for rail, prefix stacked over number
for station codes, aircraft glyph for the Kalayang. This was arrived at by copying signage,
not by reading the standard — which is precisely why it needed recording.

**Resolved:** the component now cites this note, so the split reads as a standard rather
than a stylistic choice — and it is now set in the standard's own typeface (see *Typeface*).

### 7. Stacked station numbers collided — latent, in a dormant path

Found while verifying the typeface change. `line-roundel.tsx` set the number span to
`leading-0` (line-height: 0), collapsing its line box so the glyphs overflowed upward into
the prefix stacked above them: `M` over `15` rendered as the two mashed together.

**Not caused by the font.** Verified against the built CSS with the exact classes the
component emits — the collision reproduced identically in Plus Jakarta Sans. It had never
been seen because `leading-0` is harmless on a *lone* centred number, and the only stacked
case is `station={true}`, which no call site passes yet (`map-rail-pill.tsx` notes station
roundels still need API support first).

**Resolved:** the override is gone; the span now inherits `leading-none` from the roundel
itself. A rendering check confirmed `leading-0` and `leading-none` are pixel-identical for a
lone number — it was doing no optical-centring work — so removing it fixes M/15, 9/15, b/23
and the SM sizes while leaving every shipping roundel untouched.

No regression test accompanies it: the repo has no component-render or visual-regression
harness, and JSDOM performs no layout, so a unit test could only assert a class string. The
constraint is recorded as a comment on the element instead.

### 4. POI category vocabulary was an open ellipsis

`docs/points-of-interest.md` declared `category VARCHAR(32)` with four example values and
a trailing `…`. The standard closes it — both a category set (p23–24) and criteria for
what earns POI status (p60). POIs are still a design note with nothing implemented, so
adopting the vocabulary cost nothing.

**Resolved:** `points-of-interest.md` now carries the categories and the Utama/Sekunder
curation criteria.

### 5. Transfers show distance without walking time

`apps/web/app/components/station-content.tsx` renders a walk pictogram and
`{transfer.distanceM}m` for each transfer. The standard pairs distance with estimated
walking time everywhere it gives a direction (p47; and the Tanah Abang totem lists a
walking time per surrounding POI, p60). Distance alone asks the reader to convert.

**Open.** Not fixed here: it needs a walking-speed constant and a decision about whether
gated interchanges get a penalty over open ones — its own change, with its own argument.

### 6. Arrow/label alignment is followed but was uncodified

The "OTW Ke Sini" button in `station-content.tsx` puts the arrow leading with the label
after it — the standard's left-aligned form. Nothing recorded why, so a future "move the
icon to the right" tweak would break the rule invisibly.

**Resolved by this note** (see *Arrows and labels*); no code change was needed.
