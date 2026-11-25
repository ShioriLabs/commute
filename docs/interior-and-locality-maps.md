# Interior and locality maps

**Status:** design note, not yet implemented. Depends on station exits from
`points-of-interest.md` ("Exits: which door to use"). Companion to
`jaklingko-wayfinding.md` (the rules these maps follow) and `fdtj-map-points.md`
(the authoring workflow they reuse).

## Goal

Close the last metres of a journey. Today a result ends at a station name. With
POIs and exits it ends at *"Keluar di Pintu B, jalan kaki ± 250 m ke GBK"*. These
two map surfaces make that sentence visual:

- **Interior map**: inside one station. Which platform you arrive on, which
  stairs/escalator/lift, which gate, which exit. Answers "how do I get out
  (or in, or across to the other line)".
- **Locality map**: the ~500 m around a station exit. Which way to walk, what
  you'll pass, how long it takes. Answers "which way from here".

Together they cover platform → exit → street → destination, which is the part
riders currently solve by asking a guard. Both are the digital form of what
Jak Lingko already puts on station totems.

## Aesthetic: a dark ground and one glowing path

The inspiration is the in-game city map of *Yakuza Kiwami*: a dark, low-detail
ground where buildings are plain shapes, one loud accent for "you" and "your
target", bold pictograms read at a glance, and almost no text. We take those
**principles** and draw everything ourselves. No game assets, icons, fonts,
layouts or traced artwork.

Jak Lingko's colour roles fit these principles closely, so the palette comes from the
standard, not from the game:

| Role | Colour | Source |
|---|---|---|
| Ground (base) | `#0C1B2A` | Jak Lingko pedestrian totem base |
| Structure (walls, platform edges, streets) | light neutral lines on the ground | ours |
| **Exit** | `#F9D437` | Jak Lingko: yellow means "way out" and nothing else |
| **Your path + you are here** | one accent, reserved for this role only | ours; must not be yellow, red, green or blue (all taken by exit/ISO 7010 roles) |
| Line identity (platforms, roundels) | existing line colours | `@commute/constants` |

Rules carried over from `jaklingko-wayfinding.md` ("Information hierarchy"):

1. **You are here, first.** Every map opens with the location identifier and a
   position marker before any directions.
2. **Layer by proximity.** Show only what serves the current step. An interior
   map on the arrival platform doesn't need the other line's ticket office.
3. **Distance and walking time together.** Every walk shows both. This resolves
   audit item 5 in `jaklingko-wayfinding.md`. Time is distance ÷ the rider's
   walking-speed tier (BRISK/AVERAGE/SLOW/SLOWEST, 1.5/1.2/0.9/0.7 m/s in
   `libs/tsundere/src/planner/departures.ts`), rounded up to whole minutes, everywhere including transfer
   cards. No separate constant: the tiers replaced the old 1.2 m/s proposal.
4. **Pictograms from the Jak Lingko vocabulary** (see its pictogram list), the
   ones riders already see on signs in the station.

Open: whether these maps are always dark (like the standard's totems) or follow
the app theme. Lean: always dark. They're signage, and the accent path reads
best on a dark ground.

## Interior maps: schematic, not survey

Accurate indoor maps need architectural data nobody publishes. Operator PDF maps
are their artwork (reference only, never traced), and OSM indoor tagging is sparse
in Jakarta. So interior maps are **schematics**: correct topology and relative
positions, simplified geometry. It's the same stance as FDTJ versus a real map.
A rider needs "exit B is past the gates on the left", not millimetres.

### Model

Per station, authored by hand:

- **Levels**: ordered (`B2`, `B1`, `G`, `1`…), each drawn as its own plan.
- **Areas** on a level: platform, concourse, paid zone, unpaid zone, as simple
  polygons. Paid versus unpaid matters: it's where the gates are, and crossing it costs
  a tap.
- **Nodes**: the things a rider navigates between:
  - `platform`: per line and direction, tied to `PLATFORM_CODES` where one exists;
  - `gate`: a gate line (paid ⇄ unpaid);
  - `exit`: references a `stationExits` row (`ref` A/B/Utara…);
  - `connector`: stairs, escalator (with direction) or lift, joining two levels;
  - `transfer`: where a walk to another station or line leaves this map.
- **Edges**: walkable links between nodes, each with a length (metres) and a flag
  for step-free access.

The node graph is what the highlighted path runs on. The artwork is just what's
drawn under it.

### Storage: authored assets, not database rows

Like the FDTJ map, an interior map is artwork plus a small graph, edited by a
person and reviewed as a diff. It lives in the repo, not D1:

```
apps/web/public/maps/interior/<stationId>/
  level-<ref>.svg       # the drawing, one per level
  graph.json            # levels, nodes (with level + position), edges
```

`graph.json` references `stationExits.id` and platform keys by id, so the
database stays the source of truth for *what* exists and the asset only says
*where it is drawn*. Positions use the same pixel → world convention as
`fdtj-map-points.md`, and the authoring workflow reuses its tooling.

### The path

Given a result's arrival platform (line + direction → platform node) and exit
(`poiStations.exitId` → exit node), run a shortest path on the station's graph
and highlight it in the accent colour:

> Platform 2 → escalator up → gates → **Pintu B**

When the path changes level, the view shows the current level with the
connector marked ("naik eskalator ke Concourse"), and a step list with walking
time sits beside the drawing. A **step-free** toggle routes via lifts only,
using the edge flag. That's a real need at stations where escalators are often
out of service.

The same graph also answers interchanges: "MRT platform → the Kendal tunnel →
KRL Sudirman" is a path across `transfer` nodes, and it's what `transfers` rows
with `fromExitId`/`toExitId` (see the POI doc) would point into.

## Locality maps: 500 m around an exit

The standard's rule is **500 m radius, reader-oriented**, meaning rotated so "up"
is the way the reader is facing, not north.

- **Anchor:** an exit (not the station centroid). Riders stand at a door, and
  the view should start there.
- **Orientation:** heading-up when the device reports a compass heading;
  otherwise rotate to the exit's authored `facing` bearing (a small addition
  to `stationExits`), which gives the "you're looking out of Pintu B" view. North-up
  only as a last resort, with the north arrow shown.
- **Content:** simplified streets and blocks, the anchor exit and the
  station's other exits (yellow), TJ haltes and other stops, POIs from the
  `pois` table with category pictograms, and the highlighted walk to the
  destination with distance + time.
- **Geometry:** generated, not hand-drawn. Streets and blocks within ~600 m
  come from OpenStreetMap, simplified and styled in the palette above. OSM
  is ODbL: the rendered map needs visible attribution ("© OpenStreetMap
  contributors"), and any derived dataset we store stays separable, same as
  OSM-sourced exits.
- **Rendering:** reuse the existing map renderer rather than a second engine;
  the locality map is a tightly framed, restyled view, not a new map.

## Complex maps: a whole POI on one sheet

Some POIs are too big or have too many ways in for one locality map: GBK can be
entered from MRT Istora Mandiri, MRT Senayan and KRL Palmerah, and the right gate
depends on which venue you're going to. A **complex map** frames the whole POI
instead of one exit.

| | Interior | Locality | Complex |
|---|---|---|---|
| Anchored on | a station | one exit, 500 m around it | the POI's footprint |
| Entrances shown | the station's exits | that exit | every access station's entrance |
| Geometry | hand-drawn schematic | generated from OSM | generated from OSM, framed on the footprint, plus a hand-drawn overlay |
| Path | platform → exit | exit → POI | the entrance the router picked → the right gate or venue inside |

**Which POIs get one.** It depends on the place, not on its `category`: a POI
gets a complex map when its footprint doesn't fit in one 500 m locality frame
from its access exit, **or** it has more than one access station. Applied to POI
batch 1 (`points-of-interest.md` → "Roster"):

- **Complex map:** GBK (JCC, Indonesia Arena and Istora as sub-venues), Monas,
  Kota Tua, JIExpo, Senopati.
- **Locality only, probably:** Tebet Eco Park, Gambir, Whoosh. JIS is borderline:
  one KRL station plus a TJ halte, but the stadium's gates may tip it over.
- **ICE BSD:** the halls are indoors and the last stretch is a shuttle, so it's
  closer to an interior map.

**Pilot: GBK.** It has every hard case at once: several entrances, sub-venues,
a POI inside a POI (JCC). Its locality map from MRT Istora Mandiri is already
the pilot above.

### Built on shirase, not a new renderer

Most of what a complex map needs already exists in `apps/shirase`:

| Need | shirase has |
|---|---|
| A dark signage look | Palettes in `src/flavors.ts` (`APPLE_LIGHT`, `APPLE_DARK`). The signage palette is one more |
| Served as a style | `/styles/{theme}.json` (`src/style.ts`). The apps load a URL and know nothing about layers, so a new theme is just a new name |
| Plain block shapes | The `build:jp-roads` bake: each road at its real width, merged into solid surfaces with real junction shapes. Drawn without the markings, that's the Kiwami look |
| Site outlines | The OSM pipeline (`fetch:osm`, `clip-osm.py`) and Protomaps' land-use layer (GBK, Monas, parks) |
| Pictograms | The sprite build (`build:sprites`) |
| Typography | PT Sans / PT Sans Narrow glyphs, the Jak Lingko faces |
| A test bench | `/map?theme=` |

So a complex map is:

1. **A signage theme in shirase.** It uses the palette from "Aesthetic" above
   (ground `#0C1B2A`, light neutral structure, line colours). The same theme
   serves locality maps, which are just this theme framed on one exit. This
   is what "reuse the existing map renderer" means concretely.
2. **Baked road surfaces, no markings.** This is a rule, not a taste call. The
   `jp` markings include yellow centre lines, and yellow is reserved for exits.
   So the signage theme takes the surfaces and junction shapes from the bake and
   none of the paint.
3. **Its own pictogram mapping.** `src/pois.json` maps *Protomaps* POI kinds to
   Maki icons and colours. The signage theme uses the Jak Lingko categories
   from the POI doc instead, so it needs its own mapping table, not a reuse of
   that one.
4. **A hand-drawn overlay, added by the app.** Gates, sub-venues and entrance
   points are curated per site and change, so they stay out of the basemap:
   `apps/web/public/maps/complex/<poiId>/overlay.json`, alongside the interior
   maps' `graph.json`. Same split as routing: the basemap knows streets, curated
   data knows doors.
5. **Framing in the app.** Fit to the footprint, then rotate to face the way the
   rider is facing, same orientation rules as locality maps.

Operator and district maps are references only, never traced. **We build our own
geometry** (decided 2026-11-25). That includes FDTJ's Blok M basemap: licensing it
was considered and dropped, because our own pipeline gives more flexibility
than coordinating with FDTJ for every change.

### Lessons from the Blok M totem

FDTJ's area totem at Taman Literasi (basemap by @raihanaulia_rar) is already a
Kiwami-style map: dark ground, grey building blocks split into individual plots,
blue for major venues, coloured small tenants. What to copy and what to avoid:

- **Copy: entrance letters in yellow squares.** Same as our exit-yellow rule, and
  readable even at night.
- **Copy: stop chips with roundels at the edge** to show where each mode enters
  the map (CSW 2, CSW, ASEAN, Terminal Blok M). For GBK these are the three
  access stations.
- **Copy: routes drawn as lines on the streets**, not pins (the totem's red TJ line).
- **Copy: the legend sits in empty space** inside the frame.
- **Avoid: repeated letters.** The totem has two separate A–H sets (Terminal Blok M
  and MRT Blok M BCA), so two F's and two D's are in view at once, and you only
  learn which is which from the legend. Our badges are styled per facility
  (`stationExits.id` is already namespaced, e.g. `MRTJ-BLM:D`), so the same letter
  never looks the same twice.
- **Avoid: unexplained building colours.** Blue reads as "major venue"; yellow,
  orange and purple mean nothing to the reader. Colour a plot only when the
  colour maps to a Jak Lingko category with its pictogram, otherwise it stays grey.
- **Avoid: a tiny "you are here".** On the totem it's a small red label. Ours comes
  first and is the strongest mark on the map.
- **Different by design: orientation.** A fixed totem is north-up; ours rotates to
  the rider's heading.

**Building detail, checked 2026-11-25** on shirase dark (`jabodetabek-20261114`):

- **GBK is ready.** Every venue is its own footprint: Stadion Utama, Madya,
  the tennis courts, Istora, Taman Kota, Hutan Kota. GBK is a campus of separate
  venues, so it never needed plot-level detail. The pilot can use OSM as-is.
- **Blok M has plot-level detail in OSM too.** osm.org shows the Melawai rows
  split into individual shophouses. shirase's `dark` only *looks* block-level:
  `style.ts` makes buildings opaque with no outline, so touching footprints merge
  into one mass. The data is fine; the style hides it.
- **Fix, in the signage theme:** draw building edges as thin gaps (a line layer on
  the buildings source in the ground colour, ~1 px from z17), which is exactly the
  Kiwami/totem plot texture. Don't change `light`/`dark` for this; opaque
  merged blocks are their Apple look on purpose.

Things the signage theme must change from today's `dark`:

- **Contrast.** In `dark`, buildings, ground and streets are all close shades of
  blue, and blocks barely separate from streets. The signage theme needs light
  blocks on a dark ground with streets clearly darker than blocks, so the street
  grid reads as gaps between blocks.
- **The complex outline.** GBK's pedestrian areas are drawn in the same colour as
  the ground everywhere else, so the complex has no visible edge. The signage
  theme should outline or tint the POI footprint (OSM `leisure`/`landuse`), with
  the surroundings dimmed.

## Where they show up

1. **Result card**: after an `ACCESS` leg with an exit, a small locality map
   with the walk highlighted; tap to open the interior map for the arrival
   station with the platform → exit path.
2. **Station page**: a "Peta stasiun" tab: interior map by level, exits
   listed, and a locality map per exit with nearby POIs.
3. **Map**: at street zoom around a station, switch to the locality style, and
   tapping the station opens its interior map. Defer until 1–2 prove out.

## Pilot

Start with one station that's small and POI-rich, then do the showcase:

1. **MRT Istora Mandiri**: few levels, lettered exits, and it anchors GBK, JCC and
   Senayan Park, so it exercises POI + exit + locality immediately.
2. **Dukuh Atas area**: MRT Dukuh Atas BNI, KRL Sudirman, BNI City (airport
   train), LRT Dukuh Atas and TJ in one complex, with the tunnel connections. This is
   the station that justifies the whole feature; do it once the pilot has
   settled the model.

Then Manggarai and Tanah Abang, where riders get lost the most.

## Build order

1. POIs + exits (`points-of-interest.md`, including build step 7). Hard dependency.
2. Show time next to distance everywhere, from the rider's walking-speed tier
   (resolves wayfinding audit item 5).
3. Locality map for Istora Mandiri exits: OSM extraction + styling, anchor
   exit, orientation, POIs, highlighted walk. It's generated, so it's the cheaper
   first win.
4. Interior map for Istora Mandiri: authored levels + `graph.json`, path from
   platform to exit, step-free toggle.
5. Result-card and station-page integration.
6. Complex map for GBK: the shirase signage theme (if step 3 hasn't already
   built it), the overlay for gates and sub-venues, framing on the footprint.
7. Dukuh Atas, then further hubs and the other complex maps from POI batch 1.

## Open questions

- Always-dark maps versus following the app theme (lean: always dark).
- The accent colour for "your path": must stay clear of exit yellow and the ISO
  7010 safety colours.
- `facing` bearing on `stationExits`: add it with the exits work, or only with
  locality maps.
- Name of the shirase signage theme (`/styles/<name>.json`).
- Whether the signage theme needs a light variant, or stays always dark like
  the other signage maps.
- How stale an interior map may get: stations get renovated. Stamp each
  station's `graph.json` with a `verifiedAt` date and show it.
- Offline: interior assets are small, so cache them for saved stations in the
  service worker.
- Bilingual labels: the app is Indonesian-only today (a recorded divergence
  in the wayfinding doc); tourists at Istora/GBK may change that calculus for
  these maps specifically.
