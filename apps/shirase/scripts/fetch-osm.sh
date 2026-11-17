#!/usr/bin/env bash
# Raw OSM for the road bake: Geofabrik's Java extract (daily, ~860 MB),
# checked against its published MD5, clipped to the basemap's bounds, then
# exported as the roads the bake reads (scripts/export-osm-roads.py) and the
# lane counts its Protomaps fallback matches (scripts/export-osm-lanes.py).
#
#   pnpm --filter @commute/shirase fetch:osm
#
# One download per run, from Geofabrik's CDN (no Overpass queries). The
# Python steps need pyosmium, installed on first use into .tools/pylib at a
# pinned version (no virtualenv needed).
#
# Output: data/osm/{java-latest,jabodetabek}.osm.pbf, roads.sqlite, lanes.json

source "$(dirname "${BASH_SOURCE[0]}")/tools.sh"

PYOSMIUM_VERSION="4.3.2"
URL="https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"

out="$DATA_DIR/osm"
mkdir -p "$out"
pylib="$TOOLS_DIR/pylib"
if ! PYTHONPATH="$pylib" python3 -c "import osmium" 2>/dev/null; then
  pip install --quiet --target "$pylib" "osmium==$PYOSMIUM_VERSION"
fi

curl -fsSL -A "shirase-build/1.0" -o "$out/java-latest.osm.pbf" "$URL"
curl -fsSL -A "shirase-build/1.0" -o "$out/java-latest.osm.pbf.md5" "$URL.md5"
(cd "$out" && md5sum -c java-latest.osm.pbf.md5)

scripts="$SHIRASE_DIR/scripts"
PYTHONPATH="$pylib" python3 "$scripts/clip-osm.py" "$out/java-latest.osm.pbf" "$out/jabodetabek.osm.pbf"
PYTHONPATH="$pylib" python3 "$scripts/export-osm-roads.py" "$out/jabodetabek.osm.pbf" "$out/roads.sqlite"
PYTHONPATH="$pylib" python3 "$scripts/export-osm-lanes.py" "$out/jabodetabek.osm.pbf" "$out/lanes.json"
ls -lh "$out"
