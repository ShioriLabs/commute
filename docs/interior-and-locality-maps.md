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
   audit item 5 in `jaklingko-wayfinding.md`: pick one walking-speed constant
   (proposal: 1.2 m/s, rounded up to whole minutes) and use it everywhere,
   including transfer cards.
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
2. Walking-speed constant; show time next to distance everywhere (resolves
   wayfinding audit item 5).
3. Locality map for Istora Mandiri exits: OSM extraction + styling, anchor
   exit, orientation, POIs, highlighted walk. It's generated, so it's the cheaper
   first win.
4. Interior map for Istora Mandiri: authored levels + `graph.json`, path from
   platform to exit, step-free toggle.
5. Result-card and station-page integration.
6. Dukuh Atas, then further hubs.

## Open questions

- Always-dark maps versus following the app theme (lean: always dark).
- The accent colour for "your path": must stay clear of exit yellow and the ISO
  7010 safety colours.
- `facing` bearing on `stationExits`: add it with the exits work, or only with
  locality maps.
- How stale an interior map may get: stations get renovated. Stamp each
  station's `graph.json` with a `verifiedAt` date and show it.
- Offline: interior assets are small, so cache them for saved stations in the
  service worker.
- Bilingual labels: the app is Indonesian-only today (a recorded divergence
  in the wayfinding doc); tourists at Istora/GBK may change that calculus for
  these maps specifically.
