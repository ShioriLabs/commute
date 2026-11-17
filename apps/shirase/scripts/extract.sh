#!/usr/bin/env bash
# Cuts Jabodetabek out of a Protomaps daily planet build, over HTTP range
# requests (the ~140 GB planet is never downloaded).
#
#   pnpm --filter @commute/shirase extract              # latest build, dry run
#   pnpm --filter @commute/shirase extract -- --write   # latest build, write it
#   BUILD=20261114 pnpm --filter @commute/shirase extract -- --write
#
# Output: data/jabodetabek-<build>.pmtiles. The build date IS the tileset's
# version: shirase serves it as /jabodetabek-<build>/{z}/{x}/{y}.mvt, and a
# refresh is a new name rather than an overwrite (see src/app.ts).
#
# Daily builds are deleted after a while, so pin BUILD only for a re-run of a
# recent one; the default asks build-metadata.protomaps.dev for the newest.

source "$(dirname "${BASH_SOURCE[0]}")/tools.sh"

# Same box as the web app's bus-map.json sanity test: Jabodetabek plus Banten
# west to Merak, since the rail dots reach there.
BBOX="105.9,-6.8,107.3,-5.85"
# Street level. z15 carries building footprints and every road; going to z16
# roughly doubles the file for detail Peta Bus does not draw.
MAXZOOM=15

write=0
# Anywhere in the arguments: `pnpm ... extract -- --write` passes the `--` through.
for arg in "$@"; do
  [[ "$arg" == "--write" ]] && write=1
done

if [[ -z "${BUILD:-}" ]]; then
  BUILD="$(curl -fsSL https://build-metadata.protomaps.dev/builds.json \
    | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[-1]["key"].removesuffix(".pmtiles"))')"
fi

pmtiles="$(pmtiles_bin)"
mkdir -p "$DATA_DIR"
out="$DATA_DIR/jabodetabek-$BUILD.pmtiles"
args=(extract "https://build.protomaps.com/$BUILD.pmtiles" "$out" "--bbox=$BBOX" "--maxzoom=$MAXZOOM")

if [[ $write -eq 0 ]]; then
  echo "Dry run for build $BUILD (pass --write to extract):"
  "$pmtiles" "${args[@]}" --dry-run
else
  "$pmtiles" "${args[@]}"
  "$pmtiles" show "$out" | head -30
  echo "Wrote $out"
fi
