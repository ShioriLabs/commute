#!/usr/bin/env bash
# Puts everything under data/ into the LOCAL R2 bucket `wrangler dev` reads,
# laid out as src/app.ts expects. Local only: production uploads are done by
# hand (README.md).
#
#   pnpm --filter @commute/shirase seed:local

source "$(dirname "${BASH_SOURCE[0]}")/tools.sh"
cd "$SHIRASE_DIR"

BUCKET="shirase-tiles"
put() {
  npx wrangler r2 object put "$BUCKET/$1" --file "$2" --local >/dev/null
  echo "  $1"
}

shopt -s nullglob
for archive in "$DATA_DIR"/*.pmtiles; do
  put "$(basename "$archive")" "$archive"
done
for file in "$DATA_DIR"/sprites/*; do
  put "sprites/$(basename "$file")" "$file"
done
for file in "$DATA_DIR"/fonts/*/*.pbf; do
  put "fonts/$(basename "$(dirname "$file")")/$(basename "$file")" "$file"
done
