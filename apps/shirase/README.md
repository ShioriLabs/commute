# shirase

The basemap behind Peta Bus, the geographic TransJakarta view on `/map`.

Named for the icebreaker Shirase, the ship that carries the girls to Antarctica in *A Place Further than the Universe* (Sora yori mo Tooi Basho).

It serves three things from one R2 bucket, all from one origin:

- **Vector tiles** from a Protomaps PMTiles extract of Jabodetabek, as plain `/{tileset}/{z}/{x}/{y}.mvt` URLs. Every tile caches at the edge and in the web app's service worker like a static file, and the browser needs no PMTiles library.
- **Glyphs** in PT Sans and PT Sans Narrow, the typefaces JakLingko's guideline uses for wayfinding, instead of Protomaps' default Noto Sans.
- **Sprites**, the Protomaps v4 light and dark icon sets.

## Routes

| Route | Serves |
| --- | --- |
| `GET /{tileset}/{z}/{x}/{y}.mvt` | One tile, sent with the gzip encoding it is stored in. `204` where the archive has no tile, `404` for a tileset or z/x/y that does not exist. |
| `GET /{tileset}.json` | TileJSON 3.0 for the tileset. Use it as the style source's `url`. |
| `GET /fonts/{font}/{start}-{end}.pbf` | A glyph range. Each stack is a single font, so a comma-joined stack returns `404`. |
| `GET /sprites/{name}.json` and `.png` | `light`, `light@2x`, `dark`, `dark@2x`. |

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
pnpm --filter @commute/shirase fetch:sprites       # data/sprites/*
```

The scripts use these tools and sources, each pinned and checksum-verified:

- go-pmtiles 1.31.2
- stadiamaps `build_pbf_glyphs` 1.5.1
- google/fonts at a fixed commit, for PT Sans (OFL 1.1)
- protomaps/basemaps-assets at a fixed commit, for the sprites

## Running locally

```sh
pnpm --filter @commute/shirase seed:local   # data/ -> local R2
pnpm --filter @commute/shirase dev          # http://localhost:3002
```

`seed:local` puts objects one at a time. There are 256 glyph ranges per font, so expect it to take a while.

## Production (by hand)

These steps are not scripted on purpose. Run them yourself:

```sh
npx wrangler r2 bucket create shirase-tiles
npx wrangler r2 object put shirase-tiles/jabodetabek-<build>.pmtiles --file data/jabodetabek-<build>.pmtiles --remote
# glyphs and sprites: same as scripts/seed-local.sh with --remote instead of --local,
# or `rclone copy data/fonts r2:shirase-tiles/fonts` for the ~1,300 glyph files
npx wrangler deploy
```

Then attach a custom domain to the worker (e.g. `shirase.shiorilabs.id`). If the web app is served from another origin, add it to `ALLOWED_ORIGINS` in `wrangler.toml`.

## Attribution

The map must show the attributions that come with the tiles:

- Tiles: © OpenStreetMap contributors (ODbL), built by Protomaps. The TileJSON's `attribution` field carries this.
- Glyphs: PT Sans and PT Sans Narrow, © ParaType, SIL Open Font License 1.1.
