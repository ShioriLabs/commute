# shirase

The basemap behind Peta Bus, the geographic TransJakarta view on `/map`.

Named for the icebreaker Shirase, the ship that carries the girls to Antarctica in *A Place Further than the Universe* (Sora yori mo Tooi Basho).

It serves three things from one R2 bucket, all from one origin:

- **Vector tiles** from a Protomaps PMTiles extract of Jabodetabek, as plain `/{tileset}/{z}/{x}/{y}.mvt` URLs. Every tile caches at the edge and in the web app's service worker like a static file, and the browser needs no PMTiles library.
- **Glyphs** in PT Sans and PT Sans Narrow, the typefaces JakLingko's guideline uses for wayfinding, instead of Protomaps' default Noto Sans.
- **Sprites**, the Protomaps v4 light and dark icon sets.
- **Finished MapLibre styles** (`/styles/light.json`, `/styles/dark.json`, `/styles/jp.json`). The web app and Android load one URL and need to know nothing about Protomaps layers, fonts or tilesets.

## Routes

| Route | Serves |
| --- | --- |
| `GET /{tileset}/{z}/{x}/{y}.mvt` | One tile, sent with the gzip encoding it is stored in. `204` where the archive has no tile, `404` for a tileset or z/x/y that does not exist. |
| `GET /{tileset}.json` | TileJSON 3.0 for the tileset. Use it as the style source's `url`. |
| `GET /fonts/{font}/{start}-{end}.pbf` | A glyph range. Each stack is a single font, so a comma-joined stack returns `404`. |
| `GET /sprites/{name}.json` and `.png` | `light`, `light@2x`, `dark`, `dark@2x`. |
| `GET /styles/{theme}.json` | A complete MapLibre style, `light`, `dark` or `jp`, pointing at the newest tileset (`?tileset=` pins one), cached for 5 minutes. Built from Protomaps' basemap layers with Indonesian labels and PT Sans fonts (src/style.ts). |
| `GET /map` | A test map that loads `/styles/{theme}.json`, so it shows exactly what the apps get. `?tileset=` and `?theme=` pick the archive and theme. There's also a tile-boundaries toggle, and the map is available as `window.shiraseMap` in the console. |

A tileset is named for its build date, e.g. `jabodetabek-20261114`. To refresh the map you upload a new name and point the style at it. Nothing is overwritten in place, so a cached tile can never outlive its archive.

## R2 layout (`shirase-tiles`)

```
jabodetabek-20261114.pmtiles
fonts/PT Sans Regular/0-255.pbf ...
fonts/PT Sans Narrow Bold/0-255.pbf ...
sprites/light.json, light.png, light@2x.json, light@2x.png, dark...
```

## Building the data

All outputs land in `data/` and the pinned tools in `.tools/`. Both are gitignored. The scripts need Linux x86_64 and bash.

```sh
pnpm --filter @commute/shirase extract             # dry run: shows the size for the newest planet build
pnpm --filter @commute/shirase extract -- --write  # data/jabodetabek-<build>.pmtiles
pnpm --filter @commute/shirase build:glyphs        # data/fonts/<Font Name>/*.pbf
pnpm --filter @commute/shirase fetch:sprites       # data/sprites/* (Protomaps' sheets)
pnpm --filter @commute/shirase build:sprites       # data/sprites/commute-*: those plus our place icons (Maki)
pnpm --filter @commute/shirase fetch:osm           # data/osm/*: raw OSM roads and lanes for the bake (~20 min)
pnpm --filter @commute/shirase build:jp-roads      # data/roads-v<N>.pmtiles: baked road surfaces and markings, every theme
```

`fetch:osm` downloads Geofabrik's Java extract once (~860 MB, MD5-checked, from their CDN, never Overpass), clips it to the basemap's bounds (`jabodetabek.osm.pbf`, ~185 MB), and exports:

- `roads.sqlite`: every road the bake draws, with its properties and exact lane counts, ways joined end to end as Protomaps joins them, indexed by z15 tile (`scripts/export-osm-roads.py`);
- `lanes.json`: lane-tagged main roads, used only when baking from the Protomaps tiles instead (`scripts/export-osm-lanes.py`).

Its Python steps install pyosmium 4.3.2 into `.tools/pylib` on first use. The Java download stays in `data/osm/` for re-clipping; delete it if space matters. Refresh `fetch:osm` and the basemap `extract` together, since the baked roads come from one and the labels and arrows from the other.

The scripts use these tools and sources, each pinned and checksum-verified:

- go-pmtiles 1.31.2
- stadiamaps `build_pbf_glyphs` 1.5.1
- google/fonts at a fixed commit, for PT Sans (OFL 1.1)
- protomaps/basemaps-assets at a fixed commit, for the sprites

## The `jp` theme

`jp` is `light` with real road surfaces and Japanese road markings from z17 up. The markings follow 道路標識、区画線及び道路標示に関する命令 (the ordinance in force from 2026-09-01) and MLIT's standard values for division lines.

- **Centre lines:** yellow no-overtaking lines on two-way arterials. White dashed 5/5 centre lines on two-lane roads.
- **Lane lines:** dashed 6/9 m on ordinary roads and 8/12 m on motorways.
- **Edge lines:** solid white.
- **Small roads:** no centre line under 5.5 m, as the ordinance says.
- **TransJakarta busways:** red-brown bus lanes inside yellow no-lane-change lines.

`src/jp-roads.json` is the single spec. Every value in it is annotated with where in the ordinance or circular it comes from, and tests keep it within the ordinance's ranges.

`build:jp-roads` (`scripts/build-jp-roads.mjs`) turns the spec into geometry. It reads roads from `data/osm/roads.sqlite` when present: each tile projects every road from its own coordinates and clips it, so neighbouring tiles cut the same road from the same line. Without it, it falls back to the basemap's z15 tiles, which Protomaps encodes tile by tile, so roads jog ~0.3 m at tile edges. For every z15 tile:

1. **Road surfaces:** each painted road is buffered to its true cross-section width. The union of those buffers is the road surface, so junctions and forks get their real shape.
2. **Junction zones:** wherever roads really meet, the overlap of their carriageways becomes a junction zone. That's the box at a crossing, the mouth at a T, and the whole shared stretch at a fork.
3. **Markings:** the markings are offset lines from each road's centreline, with dashes cut in true metres. They're drawn everywhere except inside junction zones, so they stop where roads meet, as on a Japanese road.
4. **Bus-lane paving:** the busways minus every other road, so it stops at intersections too.

It runs offline from our own extract with no network access. Expect about 20–30 minutes for the whole region. `src/jp-roads.ts` only styles the result: one fill and one line layer per level.

Things to know before changing it:

- **Bump `tileset` in the spec** whenever you rebuild with different geometry or markings. Tiles are cached for a day, so the old name keeps serving the old roads. While iterating locally, use dev names (`roads-dev-v1`, `roads-dev-v2`, …), which never go to R2; when a build is ready to ship, name it the next release (`roads-v1` → `roads-v2`) and upload that. Sprites follow the same rule in `src/pois.json` (`commute-light-dev-v1` while iterating, `commute-light-v2` to ship); they are served immutable for 30 days, so a released sprite name must never be reused for different icons.
- **Cross-sections are symmetric,** so a road reads the same whichever way it was drawn in OSM.
- **Stripe width:** stripes are `boldStripeFactor` wider at z17 and ease to true width at z20, so a 0.15 m line is visible when zoomed out.
- **Lanes:** main roads (motorway to tertiary, and ramps) tagged with `lanes` in OSM get their real width (lanes × 3.25 m plus the class's shoulder) and a lane line between every two lanes; elsewhere the cross-section comes from the road's class. A lane change tapers over 30 m; runs under 40 m are folded into a neighbour.
- **Known limits:**
  - OSM lane tags can be stale (Rasuna Said is tagged 2 lanes where it is 3+3).
  - One-way pairs closer together than their widths merge into one surface.
  - Dashes restart at z15 tile edges.
  - Text, arrows, stop lines and crosswalks aren't drawn: they need placing at points, and PT Sans has no kana.

## Running locally

```sh
pnpm --filter @commute/shirase seed:local   # data/ -> local R2
pnpm --filter @commute/shirase dev          # http://localhost:3002
```

`seed:local` puts all ~1,300 objects (256 glyph ranges per font) from one process, in about 15 seconds. It uses wrangler's `getPlatformProxy`, which writes to the same local state `wrangler dev` reads. Separate `wrangler r2 object put --local` processes fail when run in parallel, because local R2 doesn't take concurrent writers.

The local edge cache persists in `.wrangler/state/v3/cache`. If you replace an object under the same key locally, delete that folder, or the old response keeps being served. Production never does this: tilesets get new names, and glyph and sprite files don't change.

## Production (by hand)

These steps are not scripted on purpose. Run them yourself:

```sh
npx wrangler r2 bucket create shirase-tiles
npx wrangler r2 object put shirase-tiles/jabodetabek-<build>.pmtiles --file data/jabodetabek-<build>.pmtiles --remote
# glyphs and sprites: ~1,300 small files, easiest with rclone against R2's S3 API:
#   rclone copy data/fonts   r2:shirase-tiles/fonts
#   rclone copy data/sprites r2:shirase-tiles/sprites
npx wrangler deploy
```

Then attach a custom domain to the worker (e.g. `shirase.shiorilabs.id`). If the web app is served from another origin, add it to `ALLOWED_ORIGINS` in `wrangler.toml`.

## License and attribution

[LICENSE.md](LICENSE.md) has the full terms:

- Code is MIT.
- Data is ODbL.
- Creative assets Shiori Labs makes are all rights reserved, for use in Commute only.
- Third-party glyphs and sprites keep their own licenses.

The map must show the attributions that come with the tiles:

- Tiles: © OpenStreetMap contributors (ODbL), built by Protomaps. The TileJSON's `attribution` field carries this.
- Glyphs: PT Sans and PT Sans Narrow, © ParaType, SIL Open Font License 1.1.
- Sprites: from Protomaps, derived from tangrams/icons, © 2017 Mapzen, MIT.

## Using the styles in an app

```js
// Web (MapLibre GL JS)
const map = new maplibregl.Map({ container, style: 'https://<shirase>/styles/light.json' })
// Add Commute's own layers (bus lines, haltes, rail dots) below the labels:
map.addLayer({ id: 'bus-lines', type: 'line', source: 'bus', /* ... */ }, 'commute-overlay')
```

```kotlin
// Android (MapLibre Native)
map.setStyle("https://<shirase>/styles/light.json") { style ->
    style.addLayerBelow(busLines, "commute-overlay")
}
```

`commute-overlay` is an empty, hidden layer that sits above every fill and line and directly below the first label layer. Anything added before it draws under street and place names.

When you upload a new extract, the styles pick it up within 5 minutes, with no app release. Theme names belong to the app. What `light` and `dark` look like can be changed in `src/style.ts` without any app changing its URL.
