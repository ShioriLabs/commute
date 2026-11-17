#!/usr/bin/env bash
# The Protomaps basemap sprites (POI and shield icons), light and dark, at 1x
# and 2x. Pinned to a basemaps-assets commit; the v4 sprites match the v4
# basemap schema the extract is built with.
#
#   pnpm --filter @commute/shirase fetch:sprites
#
# Output: data/sprites/{light,dark}{,@2x}.{json,png}

source "$(dirname "${BASH_SOURCE[0]}")/tools.sh"

ASSETS_REF="028c18f713baecad011301ff7a69acc39bcc2ae7"
BASE="https://raw.githubusercontent.com/protomaps/basemaps-assets/$ASSETS_REF/sprites/v4"

out="$DATA_DIR/sprites"
mkdir -p "$out"
for name in light light@2x dark dark@2x; do
  for ext in json png; do
    curl -fsSL -o "$out/$name.$ext" "$BASE/$name.$ext"
  done
done
ls -1 "$out"
