# Sourced by the other scripts. Fetches the two pinned tool binaries into
# .tools/ (gitignored) on first use and checks them against the release
# digests, so a re-run never silently picks up a different build.
#
#   go-pmtiles        https://github.com/protomaps/go-pmtiles
#   build_pbf_glyphs  https://github.com/stadiamaps/sdf_font_tools
#
# Linux x86_64 only, which is where this has been run. Elsewhere, install the
# same versions by hand and put them in .tools/.

set -euo pipefail

SHIRASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$SHIRASE_DIR/.tools"
DATA_DIR="$SHIRASE_DIR/data"

PMTILES_VERSION="1.31.2"
PMTILES_SHA256="3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f"
GLYPHS_VERSION="1.5.1"
GLYPHS_SHA256="8eb1a6e4e5a2977dbdb107a41dddf7d590866d160e86057c8ad5571fed5a004b"

require_linux_x86_64() {
  if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
    echo "Only Linux x86_64 binaries are pinned here. Install go-pmtiles $PMTILES_VERSION and build_pbf_glyphs $GLYPHS_VERSION into $TOOLS_DIR by hand." >&2
    exit 1
  fi
}

verify() {
  local file="$1" expected="$2"
  local actual
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  if [[ "$actual" != "$expected" ]]; then
    echo "Checksum mismatch for $file: expected $expected, got $actual" >&2
    rm -f "$file"
    exit 1
  fi
}

pmtiles_bin() {
  local bin="$TOOLS_DIR/pmtiles-$PMTILES_VERSION/pmtiles"
  if [[ ! -x "$bin" ]]; then
    require_linux_x86_64
    local dir="$TOOLS_DIR/pmtiles-$PMTILES_VERSION"
    local archive="$dir/go-pmtiles.tar.gz"
    mkdir -p "$dir"
    curl -fsSL -o "$archive" "https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSION/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
    verify "$archive" "$PMTILES_SHA256"
    tar -xzf "$archive" -C "$dir" pmtiles
    rm "$archive"
  fi
  echo "$bin"
}

glyphs_bin() {
  local bin="$TOOLS_DIR/build_pbf_glyphs-$GLYPHS_VERSION"
  if [[ ! -x "$bin" ]]; then
    require_linux_x86_64
    mkdir -p "$TOOLS_DIR"
    curl -fsSL -o "$bin" "https://github.com/stadiamaps/sdf_font_tools/releases/download/cli-v$GLYPHS_VERSION/build_pbf_glyphs.x86_64-unknown-linux-gnu"
    verify "$bin" "$GLYPHS_SHA256"
    chmod +x "$bin"
  fi
  echo "$bin"
}
