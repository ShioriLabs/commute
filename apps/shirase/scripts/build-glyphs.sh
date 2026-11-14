#!/usr/bin/env bash
# MapLibre glyph PBFs for PT Sans and PT Sans Narrow, the typefaces JakLingko's
# guideline sets for wayfinding. Replaces Protomaps' default Noto Sans.
#
#   pnpm --filter @commute/shirase build:glyphs
#
# Output: data/fonts/<Font Name>/<start>-<end>.pbf, one folder per font. The
# tool names folders after the TTF file (PT_Sans-Web-Regular), so they are
# renamed to the stack names below, which the map style must use verbatim, one
# font per text-font stack. All 256 ranges are kept, empty ones included, so a
# label with characters PT Sans lacks gets an empty range, not a 404.
#
# Both families are SIL Open Font License 1.1 (ParaType), taken from the
# google/fonts repository; the licence travels with them into data/fonts-src.
#
# PT Sans covers Latin, Latin Extended and Cyrillic: every Indonesian name.
# Labels in other scripts would render as nothing, which is why the style
# labels with name:id / name:latin rather than raw `name`.

source "$(dirname "${BASH_SOURCE[0]}")/tools.sh"

# Pinned to a google/fonts commit so a re-run builds the same glyphs.
FONTS_REF="29b4ec6df2522a8aee279414b78a07910b065874"
BASE="https://raw.githubusercontent.com/google/fonts/$FONTS_REF/ofl"
# google/fonts path -> font stack name.
declare -A FONTS=(
  ["ptsans/PT_Sans-Web-Regular.ttf"]="PT Sans Regular"
  ["ptsans/PT_Sans-Web-Bold.ttf"]="PT Sans Bold"
  ["ptsans/PT_Sans-Web-Italic.ttf"]="PT Sans Italic"
  ["ptsansnarrow/PT_Sans-Narrow-Web-Regular.ttf"]="PT Sans Narrow Regular"
  ["ptsansnarrow/PT_Sans-Narrow-Web-Bold.ttf"]="PT Sans Narrow Bold"
)

src="$DATA_DIR/fonts-src"
out="$DATA_DIR/fonts"
rm -rf "$src" "$out"
mkdir -p "$src" "$out"

for file in "${!FONTS[@]}"; do
  curl -fsSL -o "$src/$(basename "$file")" "$BASE/$file"
done
curl -fsSL -o "$src/OFL.txt" "$BASE/ptsans/OFL.txt"

"$(glyphs_bin)" "$src" "$out"

for file in "${!FONTS[@]}"; do
  built="$out/$(basename "$file" .ttf)"
  if [[ ! -d "$built" ]]; then
    echo "Expected $built from build_pbf_glyphs; its naming changed?" >&2
    exit 1
  fi
  mv "$built" "$out/${FONTS[$file]}"
done

echo "Font stacks written to $out:"
ls -1 "$out"
