#!/usr/bin/env python3
"""
Builds tap-target rects for the station NAMES drawn on the FDTJ map.

A station's label is far bigger than its marker — median ~8,300 world units^2
against ~450 for an r=12 dot — so making the name tappable is most of a tap
target for free. Output is `app/data/label-points.json`, in points.json's own
shape, and nothing consumes it yet.

Run:
    MAP_PDF="2026-08a Peta Integrasi Jakarta FDTJ Web.pdf" \
        python3 apps/web/scripts/build_label_points.py

Why Python rather than TypeScript beside the other build scripts: this needs the
per-line text geometry (bbox, direction vector, font size), and `pdf2svg` — the
converter build-map-tiles.ts uses — renders text as glyph OUTLINES. The master
SVG for this edition has zero <text> elements and 11,583 <use> references into
anonymous `glyph-N-M` paths, so a Node port would have to re-implement text
layout to recover which glyphs spell which word. PyMuPDF hands over lines
already assembled, in the SAME world space as points.json (0 0 9513.57 6726.88),
so no coordinate translation is involved either. `scratch/fdtj/extract_numbers.py`
takes the same route for the same reason.
"""

import json
import math
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit('PyMuPDF is required: pip install pymupdf')

WEB_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_ROOT.parent.parent
OUT_PATH = WEB_ROOT / 'app' / 'data' / 'label-points.json'
POINTS_PATH = WEB_ROOT / 'app' / 'data' / 'points.json'
MANIFEST_PATH = WEB_ROOT / 'public' / 'maps' / 'fdtj' / 'manifest.json'
STATIONS_URL = 'https://api.commute.shiorilabs.id/stations'

# Corner radius for the emitted rect. A label is a word, not a lozenge: a capsule
# bulges a half-width past each end of the glyph run, which pushed neighbouring
# labels closer than their text actually is.
CORNER_RADIUS = 6.0
# Breathing room around the measured ink, world units.
PAD = 3.0
# How far a label may sit from its marker and still be considered its label.
MAX_LABEL_DIST = 400.0

# A line that is ENTIRELY corridor sequence numbers ("12-12", "10-4 12-19").
# This map opens a new label with one, so such a line below a group can never be
# a continuation of it — that is what stops "12-14 Sunter Utara" swallowing the
# first line of "12-12 14-7 Danau Agung" beneath it. A badge at the TOP of a
# group is that label's own prefix and is kept.
BADGE_ONLY_RE = re.compile(r'^\s*\d+[-–]\d+(\s+\d+[-–]\d+)*\s*$')
BADGE_RE = re.compile(r'\b\d+[-–]\d+\b')

# Points the stations API cannot name, which still have a name drawn on the map.
# The LRTJ entries are Phase 1B renames where the artwork is already on the new
# names and the DB is not; both come out once lrtj_phase1b_rename.sql reaches
# prod. KCI-BST is deliberately absent — the map draws no name for it at all.
FALLBACK_NAMES = {
    'KCI-GMR': 'Gambir',
    'TJ-B08301P': 'Manggarai',
    'TJ-B08302P': 'Manggarai',
    'LRTJ-KYM': 'Matraman',
    'LRTJ-MAT': 'Proklamasi',
}


def log(msg):
    print(f'[build-label-points] {msg}')


def normalise(text):
    """Fold a drawn label or a station name to a comparable key."""
    t = unicodedata.normalize('NFKD', text).lower()
    t = re.sub(r'\b\d+[-–]\d+\b', ' ', t)   # corridor sequence badges
    t = re.sub(r'\b\d+[a-z]?\b', ' ', t)     # bare line badges
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    return ' '.join(t.split())


def squashed(text):
    """Spacing-insensitive key: the map writes "Bojong Gede" where the DB has
    "Bojonggede", and "Jurangmangu" where it has "Jurang Mangu"."""
    return normalise(text).replace(' ', '')


def read_lines(page):
    """Every drawn text line with its box, baseline direction and size."""
    out = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            spans = [s for s in line.get('spans', []) if s['text'].strip()]
            if not spans:
                continue
            dx, dy = line.get('dir', (1.0, 0.0))
            text = ' '.join(s['text'] for s in spans).strip()
            xs = [c for s in spans for c in (s['bbox'][0], s['bbox'][2])]
            ys = [c for s in spans for c in (s['bbox'][1], s['bbox'][3])]
            bb = [min(xs), min(ys), max(xs), max(ys)]
            out.append({
                'text': text,
                'bb': bb,
                'size': max(s['size'] for s in spans),
                'dir': (dx, dy),
                'rotated': abs(dy) > 0.1,
                'badge_only': bool(BADGE_ONLY_RE.match(text)),
                'cx': (bb[0] + bb[2]) / 2,
                'cy': (bb[1] + bb[3]) / 2,
            })
    return out


def wraps_onto(seed, group, cand):
    """Is `cand` the next line of the label `group` already holds?

    The two orientations need genuinely different tests, and neither works for
    the other. Horizontal labels wrap flush-left OR centred and this map uses
    both, so compare left edges and centres — never centres alone, because
    wrapped lines differ in width and their centres slide ("14-5 / JIEXPO /
    Kemayoran" fails a centre test). Rotated labels offset DIAGONALLY, so their
    left edges differ by tens of units ("Bojong" / "Gede" by 31); project the
    offset onto the baseline and its perpendicular instead.
    """
    size = seed['size']
    for member in group:
        if seed['rotated']:
            dx, dy = seed['dir']
            px, py = -dy, dx
            ox = cand['cx'] - member['cx']
            oy = cand['cy'] - member['cy']
            along = ox * dx + oy * dy
            across = ox * px + oy * py
            # 1.00, not 1.35: swept over every rotated pair that passes the
            # along test, real wraps cluster at 0.80-0.87 of font size and the
            # nearest false pair — "Bekasi Timur" above "Tambun", two adjacent
            # stations on the same diagonal — sits at 1.34. The old ceiling
            # merged those two into one box.
            if abs(along) <= size * 0.55 and 0 < across <= size * 1.00:
                return True
        else:
            # The gap must be NEGATIVE. This map sets a wrapped label with
            # leading tight enough that consecutive line boxes overlap, while
            # two SEPARATE labels stacked above one another are set apart. That
            # sign is the whole discriminator, and it separates the two classes
            # with no overlap at all: across every pair the rest of this rule
            # would merge, all 170 real wraps measure -0.45..-0.03 of font size
            # and all 55 false ones are positive. Allowing 0..+0.45 is what gave
            # "5-8 Pal Putih" and "5-9 Kramat Sentiong" — two haltes on the same
            # corridor, each with its own marker — a single shared box.
            # The floor is -0.60 rather than -0.45 because "Istora" / "Mandiri"
            # is set at -0.53 and was being dropped, leaving MRTJ-IST a box over
            # the word "Mandiri" alone. Widening to -0.60 admits exactly that
            # one pair and nothing else: swept over every pair this rule would
            # otherwise accept, the -1.20..-0.45 band contains one entry.
            gap = cand['bb'][1] - member['bb'][3]
            if not (-size * 0.60 <= gap < 0):
                continue
            # All three alignments are in use, and each is the only one that
            # works for its own labels: "14-5 / JIEXPO / Kemayoran" is flush
            # left, "Pondok / Jati" is centred, and "Bendungan / Hilir" is
            # RIGHT-aligned (2.6 units, against 121 on the left edge). Testing
            # only two of the three left MRTJ-BNH with a box over "Hilir" alone.
            if abs(cand['bb'][0] - member['bb'][0]) <= size * 0.30:
                return True
            if abs(cand['cx'] - member['cx']) <= size * 0.90:
                return True
            if abs(cand['bb'][2] - member['bb'][2]) <= size * 0.30:
                return True
    return False


def merge_blocks(lines):
    """Group wrapped lines into one label each."""
    order = sorted(range(len(lines)), key=lambda i: (round(lines[i]['bb'][1], 1), lines[i]['bb'][0]))
    used = [False] * len(lines)
    blocks = []
    for i in order:
        if used[i]:
            continue
        seed = lines[i]
        group = [seed]
        used[i] = True
        # Repeat so a third line can join via the second.
        for _ in range(4):
            for j in order:
                if used[j]:
                    continue
                cand = lines[j]
                if cand['rotated'] != seed['rotated']:
                    continue
                if abs(cand['size'] - seed['size']) > 1.0:
                    continue
                if cand['badge_only']:
                    continue
                if wraps_onto(seed, group, cand):
                    group.append(cand)
                    used[j] = True
        blocks.append(build_block(seed, group))
    return blocks


def build_block(seed, group):
    xs = [c for g in group for c in (g['bb'][0], g['bb'][2])]
    ys = [c for g in group for c in (g['bb'][1], g['bb'][3])]
    bb = [min(xs), min(ys), max(xs), max(ys)]
    text = ' '.join(g['text'] for g in group)
    cx = (bb[0] + bb[2]) / 2
    cy = (bb[1] + bb[3]) / 2
    dx, dy = seed['dir']
    size = seed['size']
    if len(group) == 1:
        w = bb[2] - bb[0]
        h = bb[3] - bb[1]
        length = math.hypot(w, h) if seed['rotated'] else w
        half = max(length / 2 - size * 0.42, size * 0.15)
        radius = size * 0.44
        ux, uy = dx, dy
    elif seed['rotated']:
        length = max(math.hypot(g['bb'][2] - g['bb'][0], g['bb'][3] - g['bb'][1]) for g in group)
        half = max(length / 2 - size * 0.42, size * 0.15)
        radius = size * 0.44 * len(group)
        ux, uy = dx, dy
    else:
        half = max((bb[2] - bb[0]) / 2 - size * 0.42, size * 0.15)
        radius = (bb[3] - bb[1]) / 2 * 0.80
        ux, uy = 1.0, 0.0
    return {
        'text': text,
        'key': normalise(text),
        'squashed': squashed(text),
        'rotated': seed['rotated'],
        'lines': group,
        'ax': cx - ux * half, 'ay': cy - uy * half,
        'bx': cx + ux * half, 'by': cy + uy * half,
        'r': radius,
    }


def similarity(block, want, want_squashed):
    """How well a drawn label matches a station name, or None."""
    key = block['key']
    if not key:
        return None
    if key == want:
        return 1.0
    if len(key) >= 4 and f' {key} ' in f' {want} ':
        return 0.95
    if len(want) >= 4 and f' {want} ' in f' {key} ':
        return 0.90
    sq = block['squashed']
    if len(sq) >= 6 and sq == want_squashed:
        return 0.88
    if len(sq) >= 6 and (sq in want_squashed or want_squashed in sq):
        return 0.84
    return None


def match(points, blocks, names):
    """Assign each point the label that names it."""
    matched, unmatched = [], []
    for point in points:
        station = point.get('station', point['id'])
        name = FALLBACK_NAMES.get(station) or names.get(station)
        if not name:
            unmatched.append((station, 'no drawn name'))
            continue
        want = normalise(name)
        want_squashed = squashed(name)
        is_tj = station.startswith('TJ-')
        cx = (point['ax'] + point['bx']) / 2
        cy = (point['ay'] + point['by']) / 2
        best = None
        for block in blocks:
            sim = similarity(block, want, want_squashed)
            if sim is None:
                continue
            bx = (block['ax'] + block['bx']) / 2
            by = (block['ay'] + block['by']) / 2
            dist = math.hypot(bx - cx, by - cy)
            if dist > MAX_LABEL_DIST:
                continue
            # A corridor badge is a TransJakarta halte number, so a badged label
            # leans TJ and a bare one leans rail. A nudge and not a filter:
            # plenty of TJ haltes are drawn without their badge. Without it the
            # TJ halte at Kemayoran took the KCI station's bare label at 83
            # units and "14-4 Kemayoran" went unclaimed.
            bonus = 0.30 if bool(BADGE_RE.search(block['text'])) == is_tj else -0.30
            score = sim - dist / 4000.0 + bonus
            if best is None or score > best[0]:
                best = (score, dist, block)
        if best is None:
            unmatched.append((station, name))
            continue
        matched.append({'point': point, 'station': station, 'dist': best[1], 'block': best[2]})
    return matched, unmatched


def fit_to_ink(page, entry):
    """Shrink-wrap the shape onto the label's own glyphs.

    Two passes, because neither signal is sufficient alone. Rendered ink gives
    the true extent ACROSS the baseline (font size alone runs tight there —
    descenders on "Genjing" hung outside their own box). But ink cannot tell
    whose glyphs are whose: where the starting box already overlaps a
    neighbour, that neighbour's glyphs are inside the region being measured and
    the fit can never shrink past them, which left "4-12 Pasar Genjing" 33 units
    too wide on each side. So clamp the ALONG extent to this label's own text
    spans afterwards.
    """
    block = entry['block']
    length = math.hypot(block['bx'] - block['ax'], block['by'] - block['ay'])
    half_w = length / 2 + block['r']
    half_h = block['r']
    cx = (block['ax'] + block['bx']) / 2
    cy = (block['ay'] + block['by']) / 2
    if length:
        ux, uy = (block['bx'] - block['ax']) / length, (block['by'] - block['ay']) / length
    else:
        ux, uy = 1.0, 0.0
    px, py = -uy, ux

    scale = 4
    margin = 8
    # The clip must cover the shape's AXIS-ALIGNED bounds, not half_w x half_h.
    # Those are extents along the shape's own axes, and for a 45-degree label
    # they understate the y extent by ~8x: the ink search then saw a thin
    # horizontal sliver of a diagonal label, found ink only near the middle, and
    # collapsed the capsule to it — every rotated target came out a median 71
    # units short of its own text, the worst by 190.
    span_x = abs(ux) * half_w + abs(px) * half_h
    span_y = abs(uy) * half_w + abs(py) * half_h
    clip = fitz.Rect(cx - span_x - margin, cy - span_y - margin,
                     cx + span_x + margin, cy + span_y + margin)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip)
    samples, stride, comps = pixmap.samples, pixmap.stride, pixmap.n
    lo_a = lo_p = math.inf
    hi_a = hi_p = -math.inf
    for iy in range(pixmap.height):
        row = iy * stride
        for ix in range(pixmap.width):
            j = row + ix * comps
            if samples[j] < 110 and samples[j + 1] < 110 and samples[j + 2] < 110:
                dxw = clip.x0 + ix / scale - cx
                dyw = clip.y0 + iy / scale - cy
                along = dxw * ux + dyw * uy
                across = dxw * px + dyw * py
                # Only ink inside the ORIGINAL shape counts.
                if abs(along) > half_w or abs(across) > half_h:
                    continue
                lo_a = min(lo_a, along); hi_a = max(hi_a, along)
                lo_p = min(lo_p, across); hi_p = max(hi_p, across)
    if lo_a is math.inf:
        return None

    # Clamp along-extent to this label's own lines.
    own_lo = own_hi = None
    for line in block['lines']:
        for X in (line['bb'][0], line['bb'][2]):
            for Y in (line['bb'][1], line['bb'][3]):
                along = (X - cx) * ux + (Y - cy) * uy
                own_lo = along if own_lo is None else min(own_lo, along)
                own_hi = along if own_hi is None else max(own_hi, along)
    if own_lo is not None:
        if block['rotated']:
            # Rotated text needs the spans rather than the ink fit — the fit
            # loses the tips to antialiasing and left every diagonal capsule
            # ~25 units short of its own name — but the raw spans overshoot,
            # so they have to be corrected first.
            #
            # A rotated line's bbox is the axis-aligned box AROUND the run, and
            # its corners are not where the glyphs end. For a run of length D
            # and line height H at 45 degrees the bbox is (D+H)/sqrt2 per side,
            # so its diagonal is D+H and projecting the corners overshoots the
            # true run by H/2 at each end. Measured: a median +36.5 units of
            # slack, near-constant across all 80, which is exactly half a line
            # height at this map's 40pt labels.
            #
            # So the spans cannot be used raw. Use the ink fit — which finds the
            # glyphs themselves and so has no such overshoot — and only fall
            # back to the spans if it found nothing, clamping to them either
            # way so a stray neighbour cannot stretch the box.
            #
            # The ink fit loses a little at each tip to antialiasing, hence the
            # extra PAD here: measured against the drawn glyphs this lands the
            # diagonals within ~3 units of where horizontal labels sit, where
            # taking the spans raw overshot by a median 36.
            lo_a = max(lo_a - PAD, own_lo)
            hi_a = min(hi_a + PAD, own_hi)
            if hi_a <= lo_a:
                lo_a, hi_a = own_lo, own_hi
        else:
            # Horizontal text needs the intersection: a wrapped label's lines
            # differ in width, so its bbox is wider than the narrower line and
            # the ink fit is what trims the box back onto the glyphs.
            lo_a = max(lo_a, own_lo - PAD)
            hi_a = min(hi_a, own_hi + PAD)
            if hi_a <= lo_a:
                lo_a, hi_a = own_lo, own_hi

    mid_a = (lo_a + hi_a) / 2
    mid_p = (lo_p + hi_p) / 2
    half_a = (hi_a - lo_a) / 2 + PAD
    half_p = (hi_p - lo_p) / 2 + PAD
    ncx = cx + ux * mid_a + px * mid_p
    ncy = cy + uy * mid_a + py * mid_p
    radius = half_p
    half_len = max(half_a - radius, 0.0)
    return {
        'ax': round(ncx - ux * half_len, 1), 'ay': round(ncy - uy * half_len, 1),
        'bx': round(ncx + ux * half_len, 1), 'by': round(ncy + uy * half_len, 1),
        'r': round(radius, 1),
    }


def main():
    pdf_env = os.environ.get('MAP_PDF')
    if not pdf_env:
        sys.exit('MAP_PDF is required, e.g. MAP_PDF="2026-08a Peta Integrasi Jakarta FDTJ Web.pdf"')
    pdf_path = (REPO_ROOT / pdf_env).resolve()
    if not pdf_path.exists():
        sys.exit(f'no such PDF: {pdf_path}')

    manifest = json.loads(MANIFEST_PATH.read_text())
    points = json.loads(POINTS_PATH.read_text())['points']

    log(f'reading {pdf_path.name}')
    doc = fitz.open(pdf_path)
    page = doc[0]

    lines = read_lines(page)
    blocks = merge_blocks(lines)
    log(f'{len(lines)} text lines -> {len(blocks)} label blocks')

    req = urllib.request.Request(STATIONS_URL, headers={'User-Agent': 'commute-build'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        names = {s['id']: s['name'] for s in json.load(resp)['data']}
    log(f'{len(names)} station names from the API')

    matched, unmatched = match(points, blocks, names)
    log(f'matched {len(matched)}/{len(points)} points')

    out = []
    for entry in matched:
        shape = fit_to_ink(page, entry) or {
            k: round(entry['block'][k], 1) for k in ('ax', 'ay', 'bx', 'by', 'r')
        }
        out.append({
            'id': f"LBL-{entry['point']['id']}",
            'station': entry['station'],
            'text': entry['block']['text'],
            **shape,
            'cr': round(min(CORNER_RADIUS, shape['r'] * 0.30), 1),
            # A ring is an offset outline settling onto the shape's edge: right
            # for a marker, wrong for a word, where it reads as a box drawn
            # around the text. The scrim alone isolates a tapped label.
            'noRing': True,
            'rot': entry['block']['rotated'],
            'dist': round(entry['dist'], 1),
        })
    out.sort(key=lambda o: o['id'])

    OUT_PATH.write_text(json.dumps({'version': manifest['version'], 'points': out}, indent=1) + '\n')
    log(f'wrote {len(out)} label targets to {OUT_PATH.relative_to(REPO_ROOT)}')
    if unmatched:
        log(f'{len(unmatched)} points have no drawn name: ' + ', '.join(s for s, _ in unmatched))


if __name__ == '__main__':
    main()
